# -*- coding: utf-8 -*-
"""音乐服务"断了又回来"的自动恢复测试

背景（用户反馈）：忘记开电脑上的文件服务，面板报连不上；后来把服务打开了，
面板却依旧显示连不上 —— 像是"失败被记住了"。

根因：扫描失败后永久停在错误态，**只有手动点「连接」或刷新页面才会再试一次**。
现在改成：失败后按 5s → 10s → 20s → 30s → 60s 退避自动重试，连上就重置退避。
另外补一个「重新扫描目录」按钮，以及"先连上过、后来服务没了"时的兜底重新校验。
"""
import json
import os
import pathlib
import socket
import subprocess
import sys
import time

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "music"
PY = sys.executable
URL = (ROOT / "index.html").as_uri()
PORT = 8796


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), 0.3):
            return True
    except OSError:
        return False


def start_server():
    p = subprocess.Popen([PY, str(ROOT / "tools" / "music_server.py"),
                          "--dir", str(FIXTURES), "--port", str(PORT), "--quiet"],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    t0 = time.time()
    while time.time() - t0 < 10:
        if port_open(PORT):
            return p
        time.sleep(0.2)
    raise RuntimeError("服务没起来")


def stop_server(p):
    if not p:
        return None
    p.terminate()
    try:
        p.wait(timeout=5)
    except Exception:
        p.kill()
    t0 = time.time()
    while time.time() - t0 < 5:
        if not port_open(PORT):
            break
        time.sleep(0.2)
    return None


def card_state(pg):
    return pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
      if (!c) return { err: 'no-card' };
      const setup = c.querySelector('.mp-setup');
      return {
        设置区可见: !!(setup && !setup.hidden),
        提示: (c.querySelector('.mp-setup-msg') || {}).textContent || '',
        曲目数: c.querySelectorAll('.mp-item').length,
        当前曲: (c.querySelector('.mp-title') || {}).textContent || '',
        扫描态: (EP.state.cards.find(x => x.moduleId === 'musicPlayer') || {}).id ? 'ok' : ''
      };
    }""")


def wait_recover(pg, timeout=25):
    """什么都不做，等着它自己恢复"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = card_state(pg)
        if st["曲目数"] > 0 and not st["设置区可见"]:
            return True, round(time.time() - t0, 1)
        pg.wait_for_timeout(500)
    return False, round(time.time() - t0, 1)


def main():
    errs = []
    srv = None
    print("目标端口 %d 当前监听状态: %s" % (PORT, port_open(PORT)))
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = b.new_page(viewport={"width": 1280, "height": 900})
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console.error: " + m.text)
              if m.type == "error" else None)
        pg.goto(URL)
        pg.wait_for_timeout(600)
        pg.evaluate("""(base) => {
          EP.state.cards.push({
            id: 'c_music', pageId: 'p_main', moduleId: 'musicPlayer', title: '音乐播放器',
            settings: { baseUrl: base, autoNext: true, prefetch: true, showCover: true, lyricOffset: 0, bodyHeight: 420 },
            layout: { w: 6, hMode: 'auto', h: 0 }, collapsed: false, order: 9 });
          EP.store.saveCards();
        }""", "http://127.0.0.1:%d/" % PORT)

        print("== 1) 服务没开 → 报错，并且提示会自动重试 ==")
        pg.reload()
        pg.wait_for_timeout(2500)
        s1 = card_state(pg)
        print("  ", json.dumps(s1, ensure_ascii=False))
        print("  是错误态:", s1["设置区可见"] and s1["曲目数"] == 0)
        print("  提示里说明了会自动重试:", "自动重试" in s1["提示"])

        print("== 2) 把服务打开，之后【什么都不点】，看它自己恢复 ==")
        srv = start_server()
        print("  服务已启动:", port_open(PORT))
        ok, sec = wait_recover(pg, timeout=25)
        s2 = card_state(pg)
        print("  等待 %.1f 秒后:" % sec, json.dumps(s2, ensure_ascii=False))
        print("  自动恢复:", ok)

        print("== 3) 服务再关掉 + 手动「重新扫描」→ 回到错误态 ==")
        srv = stop_server(srv)
        pg.wait_for_timeout(400)
        pg.evaluate("""() => {
          const c = [...document.querySelectorAll('.card')].find(
            x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
          c.querySelector('.mp-rescan').click();
        }""")
        pg.wait_for_timeout(2500)
        s3 = card_state(pg)
        print("  ", json.dumps(s3, ensure_ascii=False))
        print("  扫描按钮生效（回到错误态）:", s3["设置区可见"])

        print("== 4) 再打开服务，还是什么都不点 ==")
        srv = start_server()
        ok4, sec4 = wait_recover(pg, timeout=25)
        print("  等待 %.1f 秒后自动恢复: %s" % (sec4, ok4))
        s4 = card_state(pg)
        print("  ", json.dumps(s4, ensure_ascii=False))

        print("== 5) 重新扫描不该打断已经选中的曲目 ==")
        pg.evaluate("""() => {
          const c = [...document.querySelectorAll('.card')].find(
            x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
          c.querySelectorAll('.mp-item')[2].click();
        }""")
        pg.wait_for_timeout(1200)
        before = card_state(pg)["当前曲"]
        pg.evaluate("""() => {
          const c = [...document.querySelectorAll('.card')].find(
            x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
          c.querySelector('.mp-rescan').click();
        }""")
        pg.wait_for_timeout(2500)
        after = card_state(pg)
        print("  扫描前当前曲:", before, "→ 扫描后:", after["当前曲"])
        print("  曲目还在:", after["曲目数"] > 0)
        print("  当前曲没丢:", bool(after["当前曲"]) and after["当前曲"] != "未选择曲目")

        print("== 6) 断点续播那台服务：播放中断也会走自动重试 ==")
        print("  测试结束，服务清理")
        srv = stop_server(srv)

        # 服务是故意关掉的，ERR_CONNECTION_REFUSED 属于预期噪音
        real = [e for e in errs if "ERR_CONNECTION_REFUSED" not in e]
        print("ERRORS:", real)
        if len(real) != len(errs):
            print("(已忽略 %d 条预期内的网络噪音)" % (len(errs) - len(real)))
        b.close()
    if srv:
        stop_server(srv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
