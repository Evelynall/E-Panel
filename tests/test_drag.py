# -*- coding: utf-8 -*-
"""拖动排序 / 拖动缩放的回归测试

真机现象：触摸端完全拖不动；缩放"能用但很奇怪"。

根因：
  1. 标题栏/缩放手柄没设 `touch-action: none` → 浏览器把手势判成页面滚动，
     拖动刚开始就被 pointercancel 打断；
  2. 缩放没处理 pointercancel，也没收尾 → 监听器一直挂在 window 上，
     之后手指随便动一下都在继续改尺寸（"很奇怪"）；
  3. 缩放手柄只有 22×22，触摸端太小。

这里用 pointerType='touch' 的真实 PointerEvent 走一遍完整手势。
"""
import json
import os
import pathlib

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()

# 在页面里装一套"手指"工具
HELPERS = """
() => {
  window.__fire = function (el, type, x, y, id) {
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: true,
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      buttons: type === 'pointerup' ? 0 : 1
    }));
  };
  window.__cards = () => [...document.querySelectorAll('#page .card[data-id]')];
  window.__order = () => window.__cards().map(c => c.getAttribute('data-id'));
  window.__cardRect = (i) => window.__cards()[i].getBoundingClientRect();
  window.__hdCenter = (i) => {
    const r = window.__cards()[i].querySelector('.card-hd').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
}
"""


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
        pg.evaluate(HELPERS)

        print("== 0) touch-action 是否设好 ==")
        ta = pg.evaluate("""() => {
          const c = document.querySelector('#page .card');
          return {
            标题栏: getComputedStyle(c.querySelector('.card-hd')).touchAction,
            缩放手柄: getComputedStyle(c.querySelector('.resize')).touchAction,
            标题栏禁选中: getComputedStyle(c.querySelector('.card-hd')).webkitUserSelect
                             || getComputedStyle(c.querySelector('.card-hd')).userSelect
          };
        }""")
        print("  ", json.dumps(ta, ensure_ascii=False))
        print("  标题栏 touch-action=none:", ta["标题栏"] == "none")
        print("  手柄 touch-action=none:", ta["缩放手柄"] == "none")

        print("== 1) 触摸拖动排序（把最后一列拖到最前）==")
        n = pg.evaluate("() => window.__cards().length")
        before = pg.evaluate("() => window.__order()")
        print("  卡片数:", n, "起始顺序:", before)
        if n < 2:
            print("  卡片太少，跳过")
        else:
            pg.evaluate("""() => {
              const i = window.__cards().length - 1;
              const [x0, y0] = window.__hdCenter(i);
              const first = window.__cardRect(0);
              const hd = window.__cards()[i].querySelector('.card-hd');
              window.__fire(hd, 'pointerdown', x0, y0, 7);
              window.__fire(window, 'pointermove', x0 + 12, y0 + 12, 7);      // 越过 6px 阈值
              window.__fire(window, 'pointermove', first.left + 60, first.top + 8, 7);
              window.__fire(window, 'pointermove', first.left + 60, first.top + 6, 7);
              window.__fire(window, 'pointerup', first.left + 60, first.top + 6, 7);
            }""")
            pg.wait_for_timeout(300)
            after = pg.evaluate("() => window.__order()")
            moved = before[-1]
            print("  拖动后顺序:", after)
            print("  被拖的卡片跑到第一位:", after[0] == moved)
            print("  顺序确实变了:", after != before)
            saved = pg.evaluate("""() => {
              const ls = JSON.parse(localStorage.getItem('ep.cards') || '[]');
              return window.__order().map(id => (ls.find(c => c.id === id) || {}).order);
            }""")
            print("  已持久化 order:", saved)

        print("== 2) 拖动中途被系统打断 → 顺序要还原 ==")
        before2 = pg.evaluate("() => window.__order()")
        pg.evaluate("""() => {
          const i = window.__cards().length - 1;
          const [x0, y0] = window.__hdCenter(i);
          const first = window.__cardRect(0);
          const hd = window.__cards()[i].querySelector('.card-hd');
          window.__fire(hd, 'pointerdown', x0, y0, 9);
          window.__fire(window, 'pointermove', x0 + 12, y0 + 12, 9);
          window.__fire(window, 'pointermove', first.left + 60, first.top + 6, 9);
        }""")
        mid2 = pg.evaluate("() => window.__order()")
        print("  拖动中顺序:", mid2, "（确实动过:", mid2 != before2, "）")
        pg.evaluate("""() => {
          window.__fire(window, 'pointercancel', 0, 0, 9);
        }""")
        pg.wait_for_timeout(250)
        after2 = pg.evaluate("() => window.__order()")
        print("  打断后顺序:", after2)
        print("  已还原:", after2 == before2 and mid2 != before2)

        print("== 3) 触摸缩放 ==")
        pg.click("#btnEdit")                       # 编辑模式下手柄常显，坐标才有意义
        pg.wait_for_timeout(300)
        pg.evaluate(HELPERS)
        geo0 = pg.evaluate("""() => {
          const c = window.__cards()[0];
          const card = EP.state.cards.find(x => x.id === c.getAttribute('data-id'));
          const r = c.querySelector('.resize').getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                   w: card.layout.w, hMode: card.layout.hMode, h: card.layout.h };
        }""")
        print("  缩放前:", json.dumps(geo0, ensure_ascii=False))
        pg.evaluate("""(g) => {
          const c = window.__cards()[0];
          const rz = c.querySelector('.resize');
          window.__fire(rz, 'pointerdown', g.x, g.y, 11);
          window.__fire(window, 'pointermove', g.x + 200, g.y + 80, 11);
          window.__fire(window, 'pointermove', g.x + 210, g.y + 90, 11);
          window.__fire(window, 'pointerup', g.x + 210, g.y + 90, 11);
        }""", geo0)
        pg.wait_for_timeout(400)
        geo1 = pg.evaluate("""() => {
          const c = window.__cards()[0];
          const card = EP.state.cards.find(x => x.id === c.getAttribute('data-id'));
          return { w: card.layout.w, hMode: card.layout.hMode, h: card.layout.h,
                   styleW: c.style.gridColumn, styleH: c.style.height };
        }""")
        print("  缩放后:", json.dumps(geo1, ensure_ascii=False))
        print("  宽度变大:", geo1["w"] > geo0["w"])
        print("  高度改成固定:", geo1["hMode"] == "fixed")
        print("  高度变大:", geo1["h"] > (geo0["h"] or 0))

        print("== 4) 缩放中途被打断 → 尺寸要还原，且不能再偷偷改 ==")
        base = pg.evaluate("""() => {
          const c = window.__cards()[0];
          const card = EP.state.cards.find(x => x.id === c.getAttribute('data-id'));
          const r = c.querySelector('.resize').getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                   w: card.layout.w, hMode: card.layout.hMode, h: card.layout.h };
        }""")
        pg.evaluate("""(g) => {
          const rz = window.__cards()[0].querySelector('.resize');
          window.__fire(rz, 'pointerdown', g.x, g.y, 13);
          window.__fire(window, 'pointermove', g.x + 200, g.y + 120, 13);
        }""", base)
        mid4 = pg.evaluate("""() => {
          const c = window.__cards()[0];
          const card = EP.state.cards.find(x => x.id === c.getAttribute('data-id'));
          return { w: card.layout.w, h: card.layout.h };
        }""")
        print("  打断前:", json.dumps(mid4, ensure_ascii=False),
              "（确实变了:", mid4 != {"w": base["w"], "h": base["h"]}, "）")
        pg.evaluate("""() => { window.__fire(window, 'pointercancel', 0, 0, 13); }""")
        pg.wait_for_timeout(400)
        restored = pg.evaluate("""() => {
          const c = window.__cards()[0];
          const card = EP.state.cards.find(x => x.id === c.getAttribute('data-id'));
          return { w: card.layout.w, hMode: card.layout.hMode, h: card.layout.h };
        }""")
        print("  打断后:", json.dumps(restored, ensure_ascii=False),
              "原值:", json.dumps({k: base[k] for k in ("w", "hMode", "h")}, ensure_ascii=False))
        print("  尺寸已还原:", restored["w"] == base["w"]
              and restored["hMode"] == base["hMode"] and restored["h"] == base["h"]
              and mid4 != {"w": base["w"], "h": base["h"]})
        # 关键：打断后监听器有没有残留
        pg.evaluate("""() => {
          window.__fire(window, 'pointermove', 400, 700, 13);
          window.__fire(window, 'pointerup', 400, 700, 13);
        }""")
        pg.wait_for_timeout(300)
        leaked = pg.evaluate("""() => {
          const c = window.__cards()[0];
          const card = EP.state.cards.find(x => x.id === c.getAttribute('data-id'));
          return { w: card.layout.w, hMode: card.layout.hMode, h: card.layout.h };
        }""")
        print("  之后再动手指不再改尺寸（无残留监听）:",
              leaked["w"] == base["w"] and leaked["h"] == base["h"],
              json.dumps(leaked, ensure_ascii=False))

        pg.screenshot(path=str(ROOT / "tests" / "_shot_drag.png"))
        print("ERRORS:", errs)
        b.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
