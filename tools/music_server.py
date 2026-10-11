#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EPanel 音乐服务 —— 给局域网里的音乐目录开一个"面板友好"的 HTTP 服务

为什么不用 python -m http.server？
  1. 它不返回 CORS 头，浏览器（尤其是 file:// 打开的面板）读不到目录列表和文件头
  2. 它不支持 Range 请求，进度条拖动会失效，读歌词要把整首歌下完
  3. 面板要逐个目录爬 HTML 目录页，慢且脆

本脚本一次解决这三件事，另外提供一个一次性返回全部曲目的接口，
面板会优先使用它（扫描从「逐个目录爬」变成「一个请求」）。

用法：
    python music_server.py --dir "D:\\Music"
    python music_server.py --dir "D:\\Music" --port 8080
    python music_server.py --dir "D:\\Music" --plain     # 只提供 CORS + Range，不带 /__epanel 接口

启动后把打印出来的「局域网」地址填进面板的「音乐目录地址」即可。
"""

import argparse
import json
import os
import posixpath
import socket
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AUDIO_EXT = {
    ".mp3", ".mp2", ".flac", ".m4a", ".mp4", ".aac",
    ".ogg", ".oga", ".opus", ".wav", ".webm", ".mka",
}


_LOG_FILE = None


def _log_stream():
    """没有控制台时（pythonw.exe / .pyw）退回写日志文件，保证日志有地方看"""
    global _LOG_FILE
    if _LOG_FILE is False:
        return None
    if _LOG_FILE is None:
        try:
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_server.log")
            # 别让它无限长大：超过 1MB 就截断重来
            try:
                if os.path.isfile(path) and os.path.getsize(path) > 1024 * 1024:
                    open(path, "w", encoding="utf-8").close()
            except Exception:
                pass
            _LOG_FILE = open(path, "a", encoding="utf-8", buffering=1)
        except Exception:
            _LOG_FILE = False
    return _LOG_FILE


def out(*parts, **kw):
    """安全地往控制台写一行（没有控制台就写日志文件）。

    ⚠️ 用 pythonw.exe（.pyw、双击不弹黑窗口）启动时，sys.stdout / sys.stderr 都是 None，
    直接 print() 或 sys.stderr.write() 会抛 AttributeError。
    这个异常会出现在**请求处理线程**里，后果是每个请求都被掐断、一个字节都不回 ——
    手机浏览器上就是「该地址未发送任何数据 / Empty reply from server」，
    而且因为报错也只能往 stderr 写（它不存在），日志里什么都看不到。
    所以所有控制台输出都必须走这里。
    """
    end = kw.get("end", "\n")
    msg = " ".join(str(p) for p in parts) + end
    for stream in (sys.stdout, sys.stderr):
        if stream is None:
            continue
        try:
            stream.write(msg)
            stream.flush()
            return
        except Exception:
            continue
    f = _log_stream()
    if f:
        try:
            f.write(msg)
        except Exception:
            pass

MIME_EXTRA = {
    ".flac": "audio/flac",
    ".opus": "audio/ogg",
    ".oga": "audio/ogg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".webm": "audio/webm",
    ".mka": "audio/x-matroska",
}


def lan_ips():
    """列出本机所有可用的局域网地址，返回 [(ip, 网卡名, 建议)]。

    ⚠️ 以前这里只做「默认路由 IP + gethostname 解析」，结果**只拿到主网卡的地址**。
    电脑同时插网线又连 WiFi 时（两张网卡在不同网段），另一个地址会被漏掉 ——
    手机连的是 WiFi，却只看到网线的地址，于是永远连不上、服务端还一条请求都收不到。
    所以改成枚举全部网卡，并标出哪些是虚拟网卡/VPN（那些手机连不上）。
    """
    # 优先借 net_check 里的实现（同一目录，能拿到网卡名并做分类）
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from net_check import list_adapters, classify
        out = []
        for ip, name, _ in list_adapters():
            kind, advice, why = classify(ip, name)
            out.append((ip, name or kind, advice))
        if out:
            # 推荐的排前面
            out.sort(key=lambda x: {"ok": 0, "maybe": 1, "no": 2}[x[2]])
            return out
    except Exception:
        pass

    # 兜底：至少给出默认路由那个
    res = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        res.append((s.getsockname()[0], "默认网卡", "ok"))
        s.close()
    except Exception:
        pass
    return res


class Handler(BaseHTTPRequestHandler):
    server_version = "EPanelMusic/1.0"
    protocol_version = "HTTP/1.1"

    root = "."
    plain = False     # True 时不提供 /__epanel 接口

    # ---------------- 基础 ----------------

    def log_message(self, fmt, *args):
        if self.server.verbose:
            out("  " + (fmt % args))

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header(
            "Access-Control-Expose-Headers",
            "Content-Range, Content-Length, Accept-Ranges, Content-Type",
        )
        self.send_header("Access-Control-Max-Age", "86400")

    def json_out(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def err_out(self, status, msg):
        body = ("%d %s\n%s" % (status, HTTPStatus(status).phrase, msg)).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ---------------- 路由 ----------------

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.handle_req(head=True)

    def do_GET(self):
        self.handle_req(head=False)

    def handle_req(self, head=False):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path, errors="replace")
        query = urllib.parse.parse_qs(parsed.query)

        if not self.plain and path.startswith("/__epanel/"):
            what = path[len("/__epanel/"):].strip("/")
            if what == "ping":
                return self.json_out({"ok": True, "service": "EPanel Music Server", "version": 1})
            if what == "list":
                return self.api_list(query, head)
            return self.err_out(404, "未知接口：/__epanel/%s" % what)

        return self.serve_file(path, head)

    # ---------------- 曲目清单 ----------------

    def api_list(self, query, head=False):
        sub = (query.get("dir") or [""])[0].strip("/")
        start = os.path.join(self.root, *sub.split("/")) if sub else self.root
        if not os.path.isdir(start):
            return self.err_out(404, "目录不存在：%s" % sub)

        tracks = []
        for dirpath, dirnames, filenames in os.walk(start):
            dirnames[:] = sorted(
                d for d in dirnames if not d.startswith(".") and d not in ("#recycle", "@eaDir")
            )
            rel_dir = os.path.relpath(dirpath, self.root).replace(os.sep, "/")
            if rel_dir == ".":
                rel_dir = ""
            for fn in sorted(filenames):
                if fn.startswith("."):
                    continue
                if os.path.splitext(fn)[1].lower() not in AUDIO_EXT:
                    continue
                full = os.path.join(dirpath, fn)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                rel = posixpath.join(rel_dir, fn) if rel_dir else fn
                url = "/" + urllib.parse.quote(rel, safe="/@()[]{}!$&'*+,;=:~")
                tracks.append({
                    "name": fn,
                    "url": url,
                    "dir": rel_dir,
                    "size": st.st_size,
                    "mtime": int(st.st_mtime),
                })
            if len(tracks) > 20000:
                break

        return self.json_out({
            "ok": True,
            "root": os.path.basename(os.path.abspath(self.root)),
            "count": len(tracks),
            "tracks": tracks,
        })

    # ---------------- 静态文件（CORS + Range） ----------------

    def resolve(self, path):
        path = path.replace("\\", "/")
        parts = [p for p in path.split("/") if p not in ("", ".", "..")]
        full = os.path.normpath(os.path.join(self.root, *parts)) if parts else os.path.normpath(self.root)
        root_abs = os.path.abspath(self.root)
        if full != root_abs and not full.startswith(root_abs + os.sep):
            return None
        return full

    def serve_file(self, path, head=False):
        full = self.resolve(path)
        if not full:
            return self.err_out(403, "越界路径")
        if os.path.isdir(full):
            if not path.endswith("/"):
                self.send_response(301)
                self.cors()
                self.send_header("Location", urllib.parse.quote(path + "/", safe="/"))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self.serve_dir(full, path)
        if not os.path.isfile(full):
            return self.err_out(404, "文件不存在")

        size = os.path.getsize(full)
        ctype = self.guess_type(full)
        rng = self.headers.get("Range")

        start, end = 0, size - 1
        partial = False
        if rng and rng.startswith("bytes="):
            spec = rng[6:].split(",")[0].strip()
            if "-" in spec:
                a, _, b = spec.partition("-")
                try:
                    if a == "":
                        n = int(b)
                        if n > 0:
                            start = max(0, size - n)
                            end = size - 1
                            partial = True
                    else:
                        start = int(a)
                        end = int(b) if b else size - 1
                        partial = True
                except ValueError:
                    partial = False
            if partial and (start > end or start >= size):
                self.send_response(416)
                self.cors()
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            end = min(end, size - 1)

        length = end - start + 1

        if partial:
            self.send_response(206)
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        else:
            self.send_response(200)

        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        # 音乐文件改一次名字/标签就变内容，但用 mtime 做校验对局域网够用
        self.send_header("ETag", '"%d-%d"' % (int(os.path.getmtime(full)), size))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()

        if head:
            return
        try:
            with open(full, "rb") as f:
                f.seek(start)
                remain = length
                while remain > 0:
                    chunk = f.read(min(262144, remain))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remain -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def guess_type(self, full):
        ext = os.path.splitext(full)[1].lower()
        if ext in MIME_EXTRA:
            return MIME_EXTRA[ext]
        import mimetypes
        return mimetypes.guess_type(full)[0] or "application/octet-stream"

    def serve_dir(self, full, url_path):
        """极简目录列表：面板在拿不到 /__epanel/list 时靠它爬目录"""
        try:
            names = sorted(os.listdir(full))
        except OSError as e:
            return self.err_out(500, str(e))

        rows = []
        up = "../" if url_path.strip("/") else ""
        if up:
            rows.append('<li><a href="%s">../</a></li>' % up)
        for n in names:
            if n.startswith("."):
                continue
            is_dir = os.path.isdir(os.path.join(full, n))
            href = urllib.parse.quote(n, safe="") + ("/" if is_dir else "")
            label = n + ("/" if is_dir else "")
            rows.append('<li><a href="%s">%s</a></li>' % (href, label))

        html = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<title>%s</title></head><body><h1>%s</h1><ul>%s</ul></body></html>"
            % (url_path, url_path, "\n".join(rows))
        )
        body = html.encode("utf-8")
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


class Server(ThreadingHTTPServer):
    """在 TCP 层就把连接打出来。

    HTTP 那层的日志只有在请求被正常解析后才会打，所以"手机连不上、日志一条都没有"
    时没法区分是「包没到」还是「包到了但 HTTP 层没解析成功」。
    这里在 accept 就打印一行，一眼就能看出包到底有没有到电脑。
    """
    daemon_threads = True
    quiet = False

    # ⚠️ Windows 上必须关掉 SO_REUSEADDR：Python 的 HTTPServer 默认开 allow_reuse_address，
    # 而 Windows 的 SO_REUSEADDR 语义和 Linux 不同 —— 它**允许两个进程同时绑同一个端口**。
    # 后果：老的（比如用 pythonw 启动、脚本都删了的）进程还在，新进程照样能起来，
    # 但进来的连接可能被那个坏进程吃掉，新进程的日志里一条都没有，排查时极其迷惑。
    # 关掉之后第二个实例会直接报「端口被占用」，一眼就看明白了。
    allow_reuse_address = (os.name != "nt")

    def get_request(self):
        sock, addr = super().get_request()
        if not self.quiet:
            out("  [%s] ← TCP 连接 %s:%s" % (time.strftime("%H:%M:%S"), addr[0], addr[1]))
        return sock, addr


# ==================== Windows 系统托盘（纯 ctypes，零第三方依赖） ====================
# 目的：双击启动时不弹黑窗口，服务照样跑；托盘图标右键可以复制地址 / 打开日志 / 关闭服务。
# 只有 Windows 下生效；其它平台 --tray 会被忽略，退回普通模式。

TRAY_CLASS = "EPanelMusicServerTray"
TRAY_COPY, TRAY_OPEN, TRAY_LOG, TRAY_QUIT = 1001, 1002, 1003, 1004
ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_server.ico")

if os.name == "nt":
    import ctypes
    import threading
    from ctypes import wintypes

    _u32 = ctypes.WinDLL("user32", use_last_error=True)
    _sh32 = ctypes.WinDLL("shell32", use_last_error=True)
    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _LRESULT = ctypes.c_ssize_t
    _WNDPROC = ctypes.WINFUNCTYPE(_LRESULT, wintypes.HWND, wintypes.UINT,
                                  wintypes.WPARAM, wintypes.LPARAM)

    WM_DESTROY, WM_CLOSE, WM_COMMAND, WM_QUIT = 0x0002, 0x0010, 0x0111, 0x0012
    WM_TRAY = 0x8000 + 1
    WM_LBUTTONUP, WM_RBUTTONUP, WM_LBUTTONDBLCLK = 0x0202, 0x0205, 0x0203
    WS_POPUP, PM_REMOVE = 0x80000000, 0x0001

    NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
    NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 1, 2, 4, 0x10
    IMAGE_ICON, LR_LOADFROMFILE, LR_DEFAULTSIZE = 1, 0x0010, 0x0040
    IDI_APPLICATION = 32512
    MF_STRING, MF_SEPARATOR = 0, 0x800
    TPM_RIGHTBUTTON, TPM_RETURNCMD = 0x0002, 0x0100
    CF_UNICODETEXT, GMEM_MOVEABLE = 13, 0x0002
    NIIF_INFO = 0x00000001

    class NOTIFYICONDATA(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND),
            ("uID", wintypes.UINT), ("uFlags", wintypes.UINT),
            ("uCallbackMessage", wintypes.UINT), ("hIcon", wintypes.HICON),
            ("szTip", wintypes.WCHAR * 128),
            ("dwState", wintypes.DWORD), ("dwStateMask", wintypes.DWORD),
            ("szInfo", wintypes.WCHAR * 256), ("uVersion", wintypes.UINT),
            ("szInfoTitle", wintypes.WCHAR * 64), ("dwInfoFlags", wintypes.DWORD),
        ]

    class WNDCLASS(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT), ("lpfnWndProc", _WNDPROC),
            ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
            ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR),
        ]

    _u32.CreateWindowExW.restype = wintypes.HWND
    _u32.DefWindowProcW.restype = _LRESULT
    _u32.LoadImageW.restype = wintypes.HANDLE
    _u32.LoadIconW.restype = wintypes.HANDLE
    _k32.GetModuleHandleW.restype = wintypes.HANDLE

    # ⚠️ 必须显式声明 argtypes：不声明的话 ctypes 会把 Python int 按 32 位算，
    # 传 64 位句柄（比如 HMODULE）时会报 "OverflowError: int too long to convert"。
    _u32.CreateWindowExW.argtypes = [
        wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HANDLE, wintypes.HANDLE, ctypes.c_void_p]
    _u32.RegisterClassW.argtypes = [ctypes.c_void_p]
    _u32.CreatePopupMenu.restype = wintypes.HANDLE
    _u32.AppendMenuW.argtypes = [wintypes.HANDLE, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
    _u32.TrackPopupMenu.argtypes = [wintypes.HANDLE, wintypes.UINT, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, wintypes.HWND, ctypes.c_void_p]
    _u32.TrackPopupMenu.restype = ctypes.c_int
    _u32.DestroyMenu.argtypes = [wintypes.HANDLE]
    _u32.SetForegroundWindow.argtypes = [wintypes.HWND]
    _u32.GetCursorPos.argtypes = [ctypes.c_void_p]
    _u32.DestroyWindow.argtypes = [wintypes.HWND]
    _u32.PostQuitMessage.argtypes = [ctypes.c_int]
    _u32.PeekMessageW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT,
                                  wintypes.UINT, wintypes.UINT]
    _u32.TranslateMessage.argtypes = [ctypes.c_void_p]
    _u32.DispatchMessageW.argtypes = [ctypes.c_void_p]
    _u32.DispatchMessageW.restype = _LRESULT
    _u32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    _u32.LoadImageW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.UINT,
                                ctypes.c_int, ctypes.c_int, wintypes.UINT]
    _u32.LoadIconW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR]
    _u32.OpenClipboard.argtypes = [wintypes.HWND]
    _u32.EmptyClipboard.argtypes = []
    _u32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    _u32.SetClipboardData.restype = wintypes.HANDLE
    _u32.CloseClipboard.argtypes = []
    _k32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    _k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    _k32.GlobalAlloc.restype = wintypes.HANDLE
    _k32.GlobalLock.argtypes = [wintypes.HANDLE]
    _k32.GlobalLock.restype = ctypes.c_void_p
    _k32.GlobalUnlock.argtypes = [wintypes.HANDLE]
    _sh32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.c_void_p]
    _sh32.Shell_NotifyIconW.restype = wintypes.BOOL

    # 回调必须留引用，否则被 GC 掉会直接崩
    _KEEP = []

    def _set_clipboard(text):
        """把文本放进剪贴板"""
        if not _u32.OpenClipboard(None):
            return False
        try:
            _u32.EmptyClipboard()
            size = (len(text) + 1) * ctypes.sizeof(ctypes.c_wchar)
            h = _k32.GlobalAlloc(GMEM_MOVEABLE, size)
            if not h:
                return False
            p = _k32.GlobalLock(h)
            ctypes.memmove(p, ctypes.create_unicode_buffer(text), size)
            _k32.GlobalUnlock(h)
            _u32.SetClipboardData(CF_UNICODETEXT, h)
            return True
        except Exception:
            return False
        finally:
            try:
                _u32.CloseClipboard()
            except Exception:
                pass

    def _load_icon(path):
        if path and os.path.isfile(path):
            h = _u32.LoadImageW(None, path, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
            if h:
                return h
        return _u32.LoadIconW(None, ctypes.cast(IDI_APPLICATION, wintypes.LPCWSTR))

    def run_tray(httpd, url, tracks, log_path):
        """主线程跑托盘消息循环；HTTP 服务由调用方放后台线程。

        返回后由调用方 httpd.shutdown()。
        """
        st = {"hwnd": None, "url": url, "log": log_path, "nid": None}

        def balloon(title, text):
            nid = st["nid"]
            if not nid:
                return
            nid.uFlags = NIF_INFO
            nid.dwInfoFlags = NIIF_INFO
            nid.szInfoTitle = title
            nid.szInfo = text
            _sh32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid))

        def do(cmd):
            if cmd == TRAY_COPY:
                ok = _set_clipboard(st["url"])
                balloon("EPanel 音乐服务", ("已复制 " + st["url"]) if ok
                        else "复制失败，手动选一下吧：" + st["url"])
                out("  [托盘] 复制地址 -> %s（%s）" % (st["url"], "成功" if ok else "失败"))
            elif cmd == TRAY_OPEN:
                try:
                    os.startfile(st["url"])
                except Exception as e:
                    out("  [托盘] 打开浏览器失败：%s" % e)
            elif cmd == TRAY_LOG:
                target = st["log"] if os.path.isfile(st["log"]) else os.path.dirname(st["log"])
                try:
                    os.startfile(target)
                except Exception as e:
                    out("  [托盘] 打开日志失败：%s" % e)
            elif cmd == TRAY_QUIT:
                out("  [托盘] 收到关闭命令，正在停止服务…")
                _u32.DestroyWindow(st["hwnd"])
            return 0

        def show_menu(hwnd):
            hm = _u32.CreatePopupMenu()
            _u32.AppendMenuW(hm, MF_STRING, TRAY_COPY, "复制地址  " + st["url"])
            _u32.AppendMenuW(hm, MF_STRING, TRAY_OPEN, "在浏览器里打开")
            _u32.AppendMenuW(hm, MF_SEPARATOR, 0, None)
            _u32.AppendMenuW(hm, MF_STRING, TRAY_LOG, "打开日志")
            _u32.AppendMenuW(hm, MF_STRING, TRAY_QUIT, "关闭服务")
            pt = wintypes.POINT()
            _u32.GetCursorPos(ctypes.byref(pt))
            # 不先 SetForegroundWindow 的话，点到菜单外面菜单不会消失
            _u32.SetForegroundWindow(hwnd)
            cmd = _u32.TrackPopupMenu(hm, TPM_RIGHTBUTTON | TPM_RETURNCMD,
                                      pt.x, pt.y, 0, hwnd, None)
            _u32.DestroyMenu(hm)
            if cmd:
                do(cmd)

        def wndproc(hwnd, msg, wparam, lparam):
            if msg == WM_TRAY:
                if lparam in (WM_RBUTTONUP, WM_LBUTTONUP, WM_LBUTTONDBLCLK):
                    show_menu(hwnd)
                return 0
            if msg == WM_COMMAND:
                return do(wparam & 0xFFFF)
            if msg == WM_CLOSE:
                _u32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                _u32.PostQuitMessage(0)
                return 0
            return _u32.DefWindowProcW(hwnd, msg, wparam, lparam)

        cb = _WNDPROC(wndproc)
        _KEEP.append(cb)
        wc = WNDCLASS()
        wc.lpfnWndProc = cb
        wc.lpszClassName = TRAY_CLASS
        wc.hInstance = _k32.GetModuleHandleW(None)
        _u32.RegisterClassW(ctypes.byref(wc))
        # 用普通隐藏窗口而不是 message-only 窗口：这样 FindWindow 找得到，方便自测
        hwnd = _u32.CreateWindowExW(0, TRAY_CLASS, "EPanel 音乐服务", WS_POPUP,
                                    0, 0, 0, 0, None, None, wc.hInstance, None)
        if not hwnd:
            out("  ⚠ 托盘窗口创建失败，退回无托盘模式（服务照常）")
            return
        st["hwnd"] = hwnd
        _KEEP.extend([wc, hwnd])

        nid = NOTIFYICONDATA()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATA)
        nid.hWnd = hwnd
        nid.uID = 1
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        nid.uCallbackMessage = WM_TRAY
        nid.hIcon = _load_icon(ICON_PATH)
        nid.szTip = ("EPanel 音乐服务 · %d 首 · %s" % (tracks, url))[:120]
        st["nid"] = nid
        if not _sh32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid)):
            out("  ⚠ 托盘图标添加失败，退回无托盘模式（服务照常）")
            _u32.DestroyWindow(hwnd)
            return
        out("  [托盘] 图标已添加：右键 = 复制地址 / 在浏览器打开 / 打开日志 / 关闭服务")

        msg = wintypes.MSG()
        try:
            # 用 PeekMessage 轮询而不是 GetMessage 阻塞：这样 Ctrl+C 能生效
            while True:
                if _u32.PeekMessageW(ctypes.byref(msg), None, 0, 0, PM_REMOVE):
                    if msg.message == WM_QUIT:
                        break
                    _u32.TranslateMessage(ctypes.byref(msg))
                    _u32.DispatchMessageW(ctypes.byref(msg))
                else:
                    time.sleep(0.05)
        finally:
            try:
                _sh32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(nid))
            except Exception:
                pass
            st["nid"] = None


def main():
    ap = argparse.ArgumentParser(description="EPanel 音乐服务")
    ap.add_argument("--dir", "-d", default=".", help="音乐目录，默认当前目录")
    ap.add_argument("--port", "-p", type=int, default=8000, help="端口，默认 8000")
    ap.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0（局域网可访问）")
    ap.add_argument("--plain", action="store_true", help="不带 /__epanel 接口，只做 CORS + Range + 目录页")
    ap.add_argument("--quiet", action="store_true", help="不打印每条请求")
    ap.add_argument("--tray", action="store_true",
                    help="显示系统托盘图标（右键可复制地址 / 打开日志 / 关闭服务）；仅 Windows")
    args = ap.parse_args()

    root = os.path.abspath(args.dir)
    if not os.path.isdir(root):
        out("目录不存在：%s" % root)
        return 2

    Handler.root = root
    Handler.plain = args.plain

    try:
        httpd = Server((args.host, args.port), Handler)
    except OSError as e:
        msg = str(e).lower()
        if "in use" in msg or "10048" in msg or "只允许" in str(e) or "permission" in msg:
            out("")
            out("  ✗ 端口 %d 起不来：已经被别的程序占用了。" % args.port)
            out("    最常见的原因：之前用 pythonw / .pyw 启动的那个进程还在后台跑着 ——")
            out("    它没有窗口，你以为关了，其实没有，而且它会一直占着端口、")
            out("    还会把你的请求一个个掐断（手机浏览器显示「未发送任何数据」）。")
            out("")
            out("    查是谁占着（管理员 CMD / PowerShell）：")
            out("      netstat -ano | findstr :%d" % args.port)
            out("    最右边那列就是 PID，然后结束它：")
            out("      taskkill /PID <PID> /F")
            out("")
            out("    或者换个端口启动：  python tools/music_server.py --port 8001")
            out("")
            return 2
        raise
    httpd.verbose = not args.quiet
    httpd.quiet = args.quiet

    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        n += sum(1 for f in filenames
                 if os.path.splitext(f)[1].lower() in AUDIO_EXT
                 and not f.startswith("."))

    out("")
    out("  EPanel 音乐服务已启动")
    out("  " + "-" * 46)
    out("  音乐目录 : %s" % root)
    out("  可播放文件: %d 首" % n)
    out("  本机访问 : http://127.0.0.1:%d/" % args.port)
    lan = lan_ips()
    usable = [x for x in lan if x[2] == "ok"]
    for ip, name, advice in lan:
        if advice == "ok":
            tag = "   <- 手机填这个"
        elif advice == "maybe":
            tag = "   （不确定能不能用）"
        else:
            tag = "   <- 手机别填这个"
        out("  局域网   : http://%s:%d/   %s%s" % (ip, args.port, name, tag))
    if len(usable) > 1:
        out("  " + "-" * 46)
        out("  ⚠ 这台电脑有好几张网卡、地址在不同网段，手机只能连上和它同一个网络的那个。")
        out("  ⭐ 怎么确定填哪个：看手机 WLAN 详情里它自己的 IP，")
        out("     前三位和哪个地址一样就填哪个（手机 192.168.1.23 → 填 192.168.1.5）。")
        out("     都对不上 = 手机和电脑不在同一个网络（换了 WiFi / 路由器开了 AP 隔离）。")
        out("  嫌麻烦就把下面这一整行复制进面板的「音乐目录地址」，面板会挨个试：")
        out("    " + " ".join("http://%s:%d/" % (ip, args.port) for ip, _n, _a in usable))
    elif usable:
        out("  " + "-" * 46)
        out("  手机连的是同一个网络的话，就用上面那个地址")
    else:
        out("  " + "-" * 46)
        out("  ⚠ 没找到可用的局域网地址：电脑可能没连上 WiFi / 网线")
    if not args.plain:
        out("  已启用 /__epanel/list 接口（面板会优先使用，扫描更快）")
    if httpd.verbose:
        out("  " + "-" * 46)
        out("  怎么看日志（手机点连接的那一刻盯这里）：")
        out("    · 出现「← TCP 连接 192.168.x.x」= 包到电脑了，网络没问题；")
        out("      后面还是连不上，那是跨域头/接口之类的事")
        out("    · 一行都没有 = 包根本没到：地址选错网段 / 防火墙 / 路由器 AP 隔离")
        out("  想安静点加 --quiet")
    # 托盘要用的"该复制哪个地址"：优先第一个可用的局域网地址
    primary = ""
    for ip, _n2, advice in lan:
        if advice == "ok":
            primary = "http://%s:%d/" % (ip, args.port)
            break
    if not primary:
        primary = "http://127.0.0.1:%d/" % args.port
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_server.log")

    if args.tray and os.name == "nt":
        out("  托盘模式已开启：日常操作点右下角托盘图标右键，")
        out("  窗口关掉服务也会一起退出（想让它留在后台就把窗口留着）")
        out("")
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            run_tray(httpd, primary, n, log_path)
            out("  已停止")
        except KeyboardInterrupt:
            out("\n  已停止")
        except Exception as e:
            # 托盘只是锦上添花，绝不能因为它出问题把服务带崩 —— 退回普通模式接着服务
            out("")
            out("  ⚠ 托盘图标没能创建（%s: %s）" % (type(e).__name__, e))
            out("    服务照常在跑，只是没有托盘图标；Ctrl+C 或关掉窗口即可停止。")
            out("")
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                out("\n  已停止")
        finally:
            try:
                httpd.shutdown()
            except Exception:
                pass
            httpd.server_close()
        return 0

    out("  Ctrl+C 退出")
    out("")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        out("\n  已停止")
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
