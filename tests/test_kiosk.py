# -*- coding: utf-8 -*-
"""空闲自动进入展示模式 + 右下角唤出把手 的回归测试"""
import json
import os
import pathlib

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()

SET_FIELD = """
([label, val]) => {
  const f = [...document.querySelectorAll('#page .field')].find(x => {
    const l = x.querySelector('label');
    return l && l.textContent.indexOf(label) >= 0;
  });
  if (!f) return null;
  const i = f.querySelector('input, select');
  if (!i) return null;
  if (i.type === 'checkbox') { i.checked = !!val; i.dispatchEvent(new Event('change', { bubbles: true })); }
  else {
    i.value = String(val);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { tag: i.tagName, type: i.type, value: i.value, checked: !!i.checked };
}
"""


def set_field(pg, label, val):
    return pg.evaluate(SET_FIELD, [label, val])


def state(pg):
    return pg.evaluate("""() => {
      const d = EP.store.get().display;
      return { autoKiosk: d.autoKiosk, idleSec: d.idleSec,
               kiosk: !!EP.ui.kiosk,
               kioskClass: /(^|\\s)kiosk(\\s|$)/.test(document.querySelector('#app').className),
               把手可见: (() => {
                 const h = document.querySelector('#chromeHandle');
                 if (!h) return 'no-el';
                 return getComputedStyle(h).display !== 'none';
               })() };
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

        print("== 1) 默认状态 ==")
        s0 = state(pg)
        print("  ", json.dumps(s0, ensure_ascii=False))
        print("  默认关闭:", s0["autoKiosk"] is False)
        print("  默认 10 秒:", s0["idleSec"] == 10)
        print("  把手默认不显示:", s0["把手可见"] is False)
        pg.wait_for_timeout(2500)
        print("  关着的时候静止不动不会进展示模式:", state(pg)["kiosk"] is False)

        print("== 2) 设置页里的开关与时长 ==")
        pg.evaluate("() => EP.ui.openPage('p_settings')")
        pg.wait_for_timeout(400)
        print("  开关:", json.dumps(set_field(pg, "空闲自动进入展示模式", True), ensure_ascii=False))
        pg.wait_for_timeout(300)
        shown = pg.evaluate("""() => {
          const f = [...document.querySelectorAll('#page .field')].find(x => {
            const l = x.querySelector('label');
            return l && l.textContent.indexOf('空闲时长') >= 0;
          });
          return f ? { label: f.querySelector('label').textContent, value: f.querySelector('input').value,
                       min: f.querySelector('input').min, max: f.querySelector('input').max } : null;
        }""")
        print("  打开开关后时长字段出现:", json.dumps(shown, ensure_ascii=False))
        print("  默认值 10:", shown and shown["value"] == "10")

        print("== 3) 静止到点自动进入展示模式 ==")
        print("  改成 5 秒（下限）:", json.dumps(set_field(pg, "空闲时长", 5), ensure_ascii=False))
        pg.wait_for_timeout(200)
        # 直接把秒数压到 2 秒来跑测试（代码里内部下限是 2）
        pg.evaluate("""() => { EP.store.get().display.idleSec = 2; EP.ui.resetIdle(); }""")
        pg.wait_for_timeout(2600)
        s3 = state(pg)
        print("  ", json.dumps(s3, ensure_ascii=False))
        print("  已进入展示模式:", s3["kiosk"] and s3["kioskClass"])
        print("  顶栏/侧栏已隐藏:", pg.evaluate("""() => {
          const a = document.querySelector('#app');
          return getComputedStyle(document.querySelector('.appbar')).display === 'none'
              && getComputedStyle(document.querySelector('.sidebar')).display === 'none';
        }"""))

        print("== 4) 退出后再等一轮还会自动进入 ==")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(400)
        print("  Esc 退出:", state(pg)["kiosk"] is False)
        pg.wait_for_timeout(2600)
        print("  又自动进来了:", state(pg)["kiosk"] is True)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)

        print("== 5) 有弹窗时不进展示模式 ==")
        pg.evaluate("""() => { EP.dialog.open({ title: '测试弹窗', html: '<div class=\"hint\">占位</div>' }); }""")
        pg.wait_for_timeout(2600)
        print("  弹窗开着时没进:", state(pg)["kiosk"] is False)
        pg.evaluate("() => EP.dialog.closeTop()")
        pg.wait_for_timeout(2800)
        print("  关掉弹窗后会进:", state(pg)["kiosk"] is True)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)

        print("== 6) 操作会重置计时 ==")
        pg.evaluate("""() => { EP.store.get().display.idleSec = 3; EP.ui.resetIdle(); }""")
        pg.wait_for_timeout(2000)
        pg.evaluate("""() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))""")
        pg.wait_for_timeout(2000)
        mid = state(pg)
        print("  中途点了一下，2 秒后仍未进:", mid["kiosk"] is False)
        pg.wait_for_timeout(1600)
        print("  再过 1.6 秒进来了:", state(pg)["kiosk"] is True)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)

        print("== 7) 关掉开关就不再有自动展示 ==")
        pg.evaluate("() => EP.ui.openPage('p_settings')")
        pg.wait_for_timeout(400)
        set_field(pg, "空闲自动进入展示模式", False)
        pg.wait_for_timeout(200)
        print("  开关已关:", state(pg)["autoKiosk"] is False)
        pg.wait_for_timeout(3200)
        print("  静止 3 秒也没进:", state(pg)["kiosk"] is False)

        print("== 8) 右下角圆球：只在顶栏完全隐藏时出现 ==")
        print("  当前（顶栏常驻）:", state(pg)["把手可见"])
        print("  顶栏改为「完全隐藏」:", json.dumps(set_field(pg, "顶栏", "never"), ensure_ascii=False))
        pg.wait_for_timeout(400)
        vis = state(pg)["把手可见"]
        print("  把手出现了:", vis is True)
        pg.screenshot(path=str(ROOT / "tests" / "_shot_handle.png"))
        print("  顶栏改回常驻:", json.dumps(set_field(pg, "顶栏", "always"), ensure_ascii=False))
        pg.wait_for_timeout(400)
        print("  把手又藏起来了:", state(pg)["把手可见"] is False)

        print("ERRORS:", errs)
        b.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
