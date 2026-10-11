# -*- coding: utf-8 -*-
"""托盘图标的端到端测试（Windows）

真的把托盘版服务端拉起来，然后：
  1. HTTP 能通（直连，不走系统代理）
  2. 托盘窗口真的创建了（FindWindow 按类名找）
  3. 没有控制台 —— 日志只写在文件里（有这个文件就说明 stdout/stderr 是 None）
  4. 模拟点「复制地址」→ 剪贴板里真的是那个地址
  5. 模拟点「关闭服务」→ 进程退出、端口释放

用 PostMessage(WM_COMMAND, 菜单 ID) 来触发菜单项，等价于用户右键点那一项，
只是绕过了 TrackPopupMenu（它需要真人用鼠标点）。
"""
import ctypes
import http.client
import os
import pathlib
import socket
import subprocess
import sys
import time
from ctypes import wintypes

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
FIXTURES = ROOT / "tests" / "fixtures" / "music"
PORT = 8830

TRAY_CLASS = "EPanelMusicServerTray"
WM_COMMAND = 0x0111
TRAY_COPY, TRAY_OPEN, TRAY_LOG, TRAY_QUIT = 1001, 1002, 1003, 1004
CF_UNICODETEXT = 13

_u32 = ctypes.WinDLL("user32", use_last_error=True)
_k32 = ctypes.WinDLL("kernel32", use_last_error=True)
_u32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
_u32.FindWindowW.restype = wintypes.HWND
_u32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
_u32.OpenClipboard.argtypes = [wintypes.HWND]
_u32.EmptyClipboard.argtypes = []
_u32.CloseClipboard.argtypes = []
_u32.GetClipboardData.argtypes = [wintypes.UINT]
_u32.GetClipboardData.restype = wintypes.HANDLE
_u32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
_u32.SetClipboardData.restype = wintypes.HANDLE
# ⚠️ 这几个必须声明 restype/argtypes，否则 64 位句柄会被截成 32 位 → GlobalLock 拿到野指针
_k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
_k32.GlobalAlloc.restype = wintypes.HANDLE
_k32.GlobalLock.argtypes = [wintypes.HANDLE]
_k32.GlobalLock.restype = ctypes.c_void_p
_k32.GlobalUnlock.argtypes = [wintypes.HANDLE]


def clip_get(retries=8):
    for _ in range(retries):
        if _u32.OpenClipboard(None):
            try:
                h = _u32.GetClipboardData(CF_UNICODETEXT)
                if h:
                    p = _k32.GlobalLock(h)
                    if p:
                        s = ctypes.wstring_at(p)
                        _k32.GlobalUnlock(h)
                        return s
                return None
            finally:
                _u32.CloseClipboard()
        time.sleep(0.25)
    return None


def clip_set(text):
    """先往剪贴板塞一个标记，等下好判断是不是真被改了"""
    for _ in range(8):
        if _u32.OpenClipboard(None):
            try:
                _u32.EmptyClipboard()
                size = (len(text) + 1) * ctypes.sizeof(ctypes.c_wchar)
                h = _k32.GlobalAlloc(0x0002, size)
                p = _k32.GlobalLock(h)
                ctypes.memmove(p, ctypes.create_unicode_buffer(text), size)
                _k32.GlobalUnlock(h)
                _u32.SetClipboardData(CF_UNICODETEXT, h)
                return True
            finally:
                _u32.CloseClipboard()
        time.sleep(0.25)
    return False


def port_listening(port, timeout=12):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.3):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def http_get(port, path, timeout=6):
    """直连，不走 http_proxy 环境变量"""
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        c.request("GET", path)
        r = c.getresponse()
        return r.status, r.read(400).decode("utf-8", "replace")
    finally:
        c.close()


def proc_alive(pid):
    r = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"],
                       capture_output=True)
    out = (r.stdout or b"").decode("mbcs", "replace")
    return str(pid) in out


def main():
    errs = []
    log = TOOLS / "music_server.log"
    log.unlink(missing_ok=True)
    clip_set("__EPANEL_BEFORE__")
    print("启动前的剪贴板:", repr(clip_get()))

    env = dict(os.environ)
    env["EPANEL_MUSIC_DIR"] = str(FIXTURES)
    env["EPANEL_MUSIC_PORT"] = str(PORT)
    env.pop("http_proxy", None)
    env.pop("HTTP_PROXY", None)

    DETACHED = 0x00000008 | 0x00000200 | 0x08000000   # 无控制台，等同双击 .pyw
    p = subprocess.Popen([sys.executable.replace("python.exe", "pythonw.exe"),
                          str(TOOLS / "music_server.pyw")],
                         env=env, creationflags=DETACHED, close_fds=True)
    # 这个 venv 里没有 pythonw.exe 就退回系统那份
    if not p.pid or not proc_alive(p.pid):
        p = subprocess.Popen([r"D:\Python\Python313\pythonw.exe", str(TOOLS / "music_server.pyw")],
                             env=env, creationflags=DETACHED, close_fds=True)
    print("已拉起托盘版服务，PID =", p.pid)
    tray_hwnd = None
    try:
        print("== 1) 服务在监听 ==")
        ok = port_listening(PORT)
        print("   端口 %d 在监听: %s" % (PORT, ok))
        st, body = http_get(PORT, "/__epanel/ping")
        print("   /__epanel/ping -> HTTP %s %s" % (st, body[:60]))
        assert st == 200 and '"ok": true' in body.replace("'", '"'), "ping 不正常"
        st2, body2 = http_get(PORT, "/__epanel/list")
        print("   /__epanel/list -> HTTP %s" % st2)

        print("== 2) 没有控制台：日志只在文件里 ==")
        txt = log.read_text(encoding="utf-8") if log.exists() else ""
        print("   music_server.log 存在:", log.exists(), "长度", len(txt))
        print("   日志里有「托盘」相关行:", "托盘" in txt)
        assert log.exists() and "托盘" in txt, "没写日志文件 = 说明还有控制台，或托盘没起来"

        print("== 3) 托盘窗口真的创建了 ==")
        tray_hwnd = _u32.FindWindowW(TRAY_CLASS, None)
        print("   FindWindow('%s') -> %s" % (TRAY_CLASS, tray_hwnd))
        assert tray_hwnd, "找不到托盘窗口"

        print("== 4) 右键「复制地址」 ==")
        _u32.PostMessageW(tray_hwnd, WM_COMMAND, TRAY_COPY, 0)
        time.sleep(1.0)
        copied = clip_get()
        print("   剪贴板现在是:", repr(copied))
        assert copied and copied.startswith("http://") and copied.endswith(":%d/" % PORT), \
            "剪贴板内容不对：%r" % copied

        print("== 5) 右键「关闭服务」 ==")
        _u32.PostMessageW(tray_hwnd, WM_COMMAND, TRAY_QUIT, 0)
        t0 = time.time()
        while time.time() - t0 < 10 and proc_alive(p.pid):
            time.sleep(0.3)
        alive = proc_alive(p.pid)
        print("   10 秒后进程还在:", alive)
        print("   端口还占着:", port_listening(PORT, timeout=2))
        assert not alive, "点了关闭服务，进程却没退出"
        assert not port_listening(PORT, timeout=2), "端口没释放"

        print("== 6) 日志里的托盘记录 ==")
        for line in log.read_text(encoding="utf-8").splitlines():
            if "托盘" in line:
                print("   ", line.strip())
        print("\n全部通过 ✓")
    except AssertionError as e:
        errs.append(str(e))
        print("\n✗ 失败:", e)
    finally:
        try:
            if p.pid and proc_alive(p.pid):
                subprocess.run(["taskkill", "/PID", str(p.pid), "/F"], capture_output=True)
        except Exception:
            pass
    print("ERRORS:", errs)
    return 0 if not errs else 1


if __name__ == "__main__":
    raise SystemExit(main())
