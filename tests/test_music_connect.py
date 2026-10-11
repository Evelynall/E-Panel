# -*- coding: utf-8 -*-
"""音乐连接：失败原因分类 + 多候选地址

四种失败情形要给出不同的、可操作的提示，而且不能白等：
  1. 服务端没有跨域头       → 秒失败，提示里要点出「跨域头」
  2. 端口上没服务在监听     → 秒失败
  3. 连上了但不响应（黑洞） → 等超时，提示里要点出「超时 / 防火墙」
  4. 填了多个地址           → 自己挨个试，哪个通用哪个
"""
import json
import os
import pathlib
import socket
import socketserver
import subprocess
import sys
import threading
import time

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "music"
PY = sys.executable
URL = (ROOT / "index.html").as_uri()
P_NOCORS, P_DEAD, P_TARPIT, P_GOOD = 8801, 8802, 8803, 8804


# ---------- 三种"坏"服务端 ----------

class NoCorsHandler(__import__("http.server", fromlist=["SimpleHTTPRequestHandler"]).SimpleHTTPRequestHandler):
    """有目录列表，但故意不发任何跨域头"""

    def log_message(self, *a):
        pass

    def end_headers(self):
        pass                      # 不调用 super，等于一个 CORS 头都没有

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(FIXTURES), **k)


class Tarpit(socketserver.BaseRequestHandler):
    """接受连接但永不响应，用来模拟"地址不通/被防火墙丢包"的超时"""

    def handle(self):
        try:
            self.request.recv(1024)
            time.sleep(30)
        except Exception:
            pass


def start_nocors():
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", P_NOCORS), NoCorsHandler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def start_tarpit():
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", P_TARPIT), Tarpit)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def start_good():
    p = subprocess.Popen([PY, "-u", str(ROOT / "tools" / "music_server.py"),
                          "--dir", str(FIXTURES), "--port", str(P_GOOD), "--quiet"],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    t0 = time.time()
    while time.time() - t0 < 10:
        try:
            with socket.create_connection(("127.0.0.1", P_GOOD), 0.3):
                return p
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("好服务没起来")


# ---------- 页面侧 ----------

def add_card(pg, base_url):
    pg.evaluate("""(base) => {
      EP.state.cards = EP.state.cards.filter(c => c.moduleId !== 'musicPlayer');
      EP.state.cards.push({
        id: 'c_music', pageId: 'p_main', moduleId: 'musicPlayer', title: '音乐播放器',
        settings: { baseUrl: base, autoNext: false, prefetch: false, showCover: true,
                    lyricOffset: 0, bodyHeight: 420 },
        layout: { w: 6, hMode: 'auto', h: 0 }, collapsed: false, order: 9 });
      EP.store.saveCards();
    }""", base_url)


def state(pg):
    return pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
      if (!c) return { err: 'no-card' };
      const items = [...c.querySelectorAll('.mp-item')];
      return {
        错误态: !!(c.querySelector('.mp-setup') && !c.querySelector('.mp-setup').hidden),
        提示: (c.querySelector('.mp-setup-msg') || {}).textContent || '',
        曲目数: items.length,
        曲目地址前缀: items.length ? (items[0].getAttribute('data-url') || '').slice(0, 26) : '',
        扫描中: (c.querySelector('.mp-setup-msg') || {}).textContent.indexOf('扫描') >= 0
      };
    }""")


def set_base(pg, base_url):
    """等价于在设置区填地址并点「连接」"""
    add_card(pg, base_url)
    pg.reload()
    pg.wait_for_timeout(300)


def wait_state(pg, pred, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = state(pg)
        if st.get("错误态") and st.get("提示") and not st["提示"].startswith("填写"):
            if pred(st["提示"]):
                return st, round(time.time() - t0, 1)
        if st.get("曲目数", 0) > 0:
            return st, round(time.time() - t0, 1)
        pg.wait_for_timeout(200)
    return state(pg), round(time.time() - t0, 1)


def main():
    errs = []
    srv_nocors = srv_tarpit = srv_good = None
    try:
        srv_nocors = start_nocors()
        srv_tarpit = start_tarpit()
        srv_good = start_good()
        print("三个测试服务已就绪：无跨域头 %d / 黑洞 %d / 正常 %d" % (P_NOCORS, P_TARPIT, P_GOOD))

        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": 1280, "height": 900})
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            pg.on("console", lambda m: errs.append("console.error: " + m.text)
                  if m.type == "error" else None)
            pg.goto(URL)
            pg.wait_for_timeout(600)

            print("== 1) 服务端没有跨域头 → 应该秒失败，并点名「跨域头」 ==")
            t0 = time.time()
            set_base(pg, "http://127.0.0.1:%d/" % P_NOCORS)
            st1, sec1 = wait_state(pg, lambda m: True, timeout=25)
            print("  耗时 %.1f 秒" % (time.time() - t0))
            print("  ", json.dumps(st1, ensure_ascii=False))
            print("  是错误态:", st1["错误态"])
            print("  提示里点出跨域:", "跨域" in st1["提示"])
            print("  没有白等 8 秒:", (time.time() - t0) < 6)

            print("== 2) 端口上没服务 → 秒失败 ==")
            t0 = time.time()
            set_base(pg, "http://127.0.0.1:%d/" % P_DEAD)
            st2, _ = wait_state(pg, lambda m: True, timeout=25)
            print("  耗时 %.1f 秒" % (time.time() - t0))
            print("  ", json.dumps(st2, ensure_ascii=False))
            print("  是错误态:", st2["错误态"], " 没有白等:", (time.time() - t0) < 6)

            print("== 3) 连上但不响应（黑洞）→ 超时，提示要点出超时/防火墙 ==")
            t0 = time.time()
            set_base(pg, "http://127.0.0.1:%d/" % P_TARPIT)
            st3, _ = wait_state(pg, lambda m: True, timeout=30)
            el3 = time.time() - t0
            print("  耗时 %.1f 秒" % el3)
            print("  ", json.dumps(st3, ensure_ascii=False))
            print("  是错误态:", st3["错误态"])
            print("  提示里点出超时:", "超时" in st3["提示"] or "没有任何响应" in st3["提示"])
            print("  比秒失败慢（确实等了超时）:", el3 > 5)

            print("== 4) 填多个地址（前两个是坏的，第三个是好的）→ 自己试出来 ==")
            multi = ("http://127.0.0.1:%d/ http://127.0.0.1:%d/ http://127.0.0.1:%d/ "
                     % (P_DEAD, P_NOCORS, P_GOOD))
            set_base(pg, multi)
            st4, sec4 = wait_state(pg, lambda m: False, timeout=30)
            print("  ", json.dumps(st4, ensure_ascii=False))
            print("  连上了:", st4["曲目数"] > 0)
            print("  用的是第三个地址:", st4["曲目地址前缀"].startswith("http://127.0.0.1:%d/" % P_GOOD))

            print("== 5) 顺序反过来（好的放最前）也该连上 ==")
            set_base(pg, "http://127.0.0.1:%d/ http://127.0.0.1:%d/" % (P_GOOD, P_DEAD))
            st5, _ = wait_state(pg, lambda m: False, timeout=20)
            print("  连上了:", st5["曲目数"] > 0, "地址:", st5["曲目地址前缀"])

            noise = ("ERR_CONNECTION_REFUSED", "ERR_INVALID_HTTP_RESPONSE")
            real = [e for e in errs if not any(n in e for n in noise)]
            print("ERRORS:", real)
            b.close()
    finally:
        for s in (srv_nocors, srv_tarpit):
            if s:
                s.shutdown()
        if srv_good:
            srv_good.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
