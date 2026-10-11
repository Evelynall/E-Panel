# -*- coding: utf-8 -*-
"""待办清单模块测试：验证「新增模块 = 新增一个文件」这条路走得通。"""
import os, pathlib, json

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console.error: " + m.text)
          if m.type == "error" else None)
    pg.goto(URL)
    pg.wait_for_timeout(800)

    print("模块已注册:", pg.evaluate("() => EP.modules.list().map(m => m.id)"))

    # 1. 编辑模式 -> 添加卡片 -> 选「待办清单」
    pg.click("#btnEdit")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const t = [...document.querySelectorAll('button')].find(b => /添加卡片/.test(b.textContent||''));
      if (t) t.click();
    }""")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const t = [...document.querySelectorAll('.dialog-bd button')].find(b => /待办清单/.test(b.textContent||''));
      if (t) t.click();
    }""")
    pg.wait_for_timeout(400)
    print("卡片数:", pg.evaluate("() => document.querySelectorAll('.card').length"))

    # 2. 定位待办卡片
    todo_sel = """() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
      return c ? c : null;
    }"""
    print("待办卡片存在:", pg.evaluate("() => !!document.querySelector('.todo-row, .card .empty')"))

    # 3. 添加三条
    inp = ".card input[type='text']"
    for txt in ["剪片：光盘科普", "导出 BGM 草稿", "回甲方消息"]:
        pg.evaluate("""(t) => {
          const c = [...document.querySelectorAll('.card')].find(
            x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
          const i = c.querySelector("input[type='text']");
          i.focus(); i.value = t;
        }""", txt)
        pg.evaluate("""() => {
          const c = [...document.querySelectorAll('.card')].find(
            x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
          const i = c.querySelector("input[type='text']");
          i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
        }""")
        pg.wait_for_timeout(150)

    state1 = pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
      return {
        rows: [...c.querySelectorAll('.todo-row')].map(r => r.querySelector('.todo-text').textContent),
        stat: c.querySelector('.hint').textContent,
        chips: [...c.querySelectorAll('.chip')].map(b => b.textContent)
      };
    }""")
    print("添加后:", json.dumps(state1, ensure_ascii=False))

    # 4. 勾选第一条
    pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
      c.querySelector('.todo-check').click();
    }""")
    pg.wait_for_timeout(250)
    state2 = pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
      const r = c.querySelector('.todo-row');
      return { done: r.classList.contains('done'), stat: c.querySelector('.hint').textContent,
               checkOn: r.querySelector('.todo-check').classList.contains('on') };
    }""")
    print("勾选后:", json.dumps(state2, ensure_ascii=False))

    # 5. 刷新，验证持久化
    pg.reload()
    pg.wait_for_timeout(800)
    state3 = pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
      if (!c) return null;
      return {
        rows: [...c.querySelectorAll('.todo-row')].map(r => ({
          text: r.querySelector('.todo-text').textContent,
          done: r.classList.contains('done')
        })),
        stat: c.querySelector('.hint').textContent
      };
    }""")
    print("刷新后:", json.dumps(state3, ensure_ascii=False, indent=2))

    # 6. 卡片设置里应自动生成两个开关
    pg.click("#btnEdit")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
      const acts = c.querySelector('.card-actions');
      const btn = [...acts.querySelectorAll('button')].pop();
      if (btn) btn.click();
    }""")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const t = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '卡片设置');
      if (t) t.click();
    }""")
    pg.wait_for_timeout(350)
    settings = pg.evaluate("""() => {
      const d = document.querySelector('.dialog');
      if (!d) return null;
      return [...d.querySelectorAll('.field')].map(f => ({
        label: f.querySelector('label').textContent,
        type: (f.querySelector('input')||{}).type,
        checked: (f.querySelector('input')||{}).checked
      }));
    }""")
    print("卡片设置:", json.dumps(settings, ensure_ascii=False))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)

    geo = pg.evaluate("""() => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /待办清单/.test((x.querySelector('.card-title')||{}).textContent||''));
      const r = e => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
      const i = c.querySelector("input[type='text']"), btn = c.querySelector('.btn.primary');
      const ck = c.querySelector('.todo-check'), row = c.querySelector('.todo-row');
      const cs = getComputedStyle(ck);
      return {
        input: r(i), addBtn: r(btn), check: r(ck), row: r(row), card: r(c),
        checkRadius: cs.borderRadius, checkBorder: cs.borderTopWidth,
        doneRowTextDecoration: getComputedStyle(
          (c.querySelector('.todo-row.done') || row).querySelector('.todo-text')).textDecorationLine,
        svgInCheck: !!ck.querySelector('svg')
      };
    }""")
    print("几何:", json.dumps(geo, ensure_ascii=False))

    pg.screenshot(path=str(ROOT / "tests" / "_shot_todo.png"))
    print("ERRORS:", errs)
    b.close()
