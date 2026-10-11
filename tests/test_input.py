# -*- coding: utf-8 -*-
"""软键盘 / 重排回归测试

背景：软键盘弹出会让 WebView 触发 resize；如果这时 renderPage() 把页面重建了，
正在聚焦的输入框会被销毁 → 失焦 → 软键盘立刻收回（"打不了字"）。

这里用"只改视口高度"来模拟软键盘（adjustResize 的效果），验证：
  1. 高度变化不会重建页面，输入框保持焦点、还能继续打字
  2. 聚焦期间的宽度变化被挂起，失焦后补上
  3. 宽度变化（真的换布局）在失焦后仍然正常重排
"""
import os
import pathlib
import json

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()


def focus_settings_input(pg):
    pg.evaluate("""() => {
      const nav = [...document.querySelectorAll('.navitem')].find(
        n => /设置/.test(n.textContent || ''));
      if (nav) nav.click();
    }""")
    pg.wait_for_timeout(300)
    return pg.evaluate("""() => {
      const box = document.querySelector('#page');
      const inp = box.querySelector('input[type="text"]');
      if (!inp) return null;
      inp.__mark = 'first-node';       // 打个标记，重建后就会消失
      window.__firstNode = inp;
      inp.focus();
      return { tag: inp.tagName, focused: document.activeElement === inp,
               value: inp.value, w: window.innerWidth, h: window.innerHeight };
    }""")


def probe(pg):
    return pg.evaluate("""() => {
      const box = document.querySelector('#page');
      const now = box.querySelector('input[type="text"]');
      return {
        当前是原节点: now === window.__firstNode,
        还是同一个输入框聚焦: document.activeElement === now && document.activeElement !== document.body,
        值: now ? now.value : null,
        视口: [window.innerWidth, window.innerHeight]
      };
    }""")


def main():
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 900})
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console.error: " + m.text)
              if m.type == "error" else None)
        pg.goto(URL)
        pg.wait_for_timeout(700)

        print("== 1) 聚焦设置页的输入框 ==")
        st = focus_settings_input(pg)
        print("  ", json.dumps(st, ensure_ascii=False))
        if not st:
            print("  没找到设置页输入框")
            b.close()
            return 1
        pg.keyboard.type("ABC")
        pg.wait_for_timeout(150)
        print("  打字后:", probe(pg))

        print("== 2) 只改高度（模拟软键盘弹出）==")
        pg.set_viewport_size({"width": 1280, "height": 430})   # 宽度不变、高度变小
        pg.wait_for_timeout(600)                               # 超过 200ms 的重排防抖
        after = probe(pg)
        print("  ", json.dumps(after, ensure_ascii=False))
        print("  输入框没被重建:", after["当前是原节点"])
        print("  焦点还在:", after["还是同一个输入框聚焦"])
        ok_type = False
        if after["还是同一个输入框聚焦"]:
            pg.keyboard.type("中文OK")
            pg.wait_for_timeout(200)
            v = probe(pg)["值"]
            ok_type = bool(v) and "中文OK" in v
            print("  还能继续打字:", ok_type, "当前值=", v)
        else:
            print("  还能继续打字: False（焦点丢了）")

        print("== 3) 聚焦时改宽度：先挂起，失焦后补上 ==")
        pg.set_viewport_size({"width": 820, "height": 430})     # 宽度变了
        pg.wait_for_timeout(500)
        held = probe(pg)
        print("  宽度变化被挂起（节点还在）:", held["当前是原节点"], json.dumps(held, ensure_ascii=False))
        pg.evaluate("() => { document.activeElement && document.activeElement.blur(); }")
        pg.wait_for_timeout(500)
        flushed = probe(pg)
        print("  失焦后补上了重排（节点已重建）:", not flushed["当前是原节点"])

        print("== 4) 无焦点时改宽度：正常重排 ==")
        pg.set_viewport_size({"width": 1280, "height": 900})
        pg.wait_for_timeout(300)
        focus_settings_input(pg)
        pg.evaluate("() => { document.activeElement && document.activeElement.blur(); }")
        pg.wait_for_timeout(200)
        pg.set_viewport_size({"width": 900, "height": 900})
        pg.wait_for_timeout(500)
        normal = probe(pg)
        print("  正常重排了:", not normal["当前是原节点"], json.dumps(normal, ensure_ascii=False))

        pg.screenshot(path=str(ROOT / "tests" / "_shot_input.png"))
        print("ERRORS:", errs)
        b.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
