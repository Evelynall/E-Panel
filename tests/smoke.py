# -*- coding: utf-8 -*-
"""EPanel 冒烟测试：确认模块化重构后四张卡片与通道均正常注册并渲染。"""
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
    pg.wait_for_timeout(900)

    info = pg.evaluate("""() => ({
      modules: EP.modules.all().map(m => m.id),
      realModules: EP.modules.list().map(m => m.id),
      channels: EP.channels.all().map(c => c.id),
      realChannels: EP.channels.list().map(c => c.id),
      cards: [...document.querySelectorAll('.card')].map(c => ({
        title: (c.querySelector('.card-title') || {}).textContent,
        bodyLen: (c.querySelector('.card-body') || {innerHTML:''}).innerHTML.length,
        emptyText: (c.querySelector('.card-body .empty') || {}).textContent
      })),
      utilKeys: Object.keys(EP.util || {}),
      netKeys: Object.keys(EP.net || {}),
      hasEditButton: typeof EP.editButton === 'function'
    })""")
    print("== 初始 ==")
    print(json.dumps(info, ensure_ascii=False, indent=2))

    # 插一个按钮，验证 buttonGrid 模块能渲染出来
    pg.evaluate("""() => {
      EP.state.buttons.push({
        id: 'b_test', name: '测试按钮', categoryId: EP.state.categories[0].id,
        color: '#3b82f6', opacity: 100, icon: {type:'emoji', value:'⚡'},
        bg: {type:'none', url:''},
        channel: 'quicker',
        params: {operation:'copy', data:'hello', wait:false, maxWaitMs:3000},
        confirm: false, order: 0
      });
      EP.store.saveButtons();
    }""")
    pg.wait_for_timeout(400)
    after = pg.evaluate("""() => ({
      pbtns: [...document.querySelectorAll('.pbtn')].map(b => b.textContent.trim()),
      chips: [...document.querySelectorAll('.chip')].map(b => b.textContent.trim()),
      btnW: (document.querySelector('.pbtn')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width,
      btnH: (document.querySelector('.pbtn')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height
    })""")
    print("== 插入按钮后 ==")
    print(json.dumps(after, ensure_ascii=False, indent=2))

    # 点击按钮 -> 走通道调度 -> 返回值面板收到事件（未配置凭证，应为可控失败而非崩溃）
    pg.click(".pbtn")
    pg.wait_for_timeout(600)
    run1 = pg.evaluate("""() => ({
      toast: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()),
      resultPanel: (() => {
        const cards = [...document.querySelectorAll('.card')];
        const c = cards.find(x => /动作返回值/.test((x.querySelector('.card-title')||{}).textContent||''));
        return c ? c.querySelector('.card-body').textContent.trim().slice(0, 80) : null;
      })(),
      logPanel: (() => {
        const cards = [...document.querySelectorAll('.card')];
        const c = cards.find(x => /执行日志/.test((x.querySelector('.card-title')||{}).textContent||''));
        return c ? c.querySelector('.card-body').textContent.trim().slice(0, 60) : null;
      })()
    })""")
    print("== 执行按钮后 ==")
    print(json.dumps(run1, ensure_ascii=False, indent=2))

    # 按钮编辑器回填（回归：之前 textarea 不回填）
    pg.click("#btnEdit")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const b = [...document.querySelectorAll('.pbtn-more')][0];
      if (b) b.click();
    }""")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const t = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑');
      if (t) t.click();
    }""")
    pg.wait_for_timeout(400)
    ed = pg.evaluate("""() => {
      const d = document.querySelector('.dialog');
      if (!d) return null;
      const inputs = [...d.querySelectorAll('input,textarea,select')];
      return inputs.slice(0, 8).map(i => ({
        tag: i.tagName, type: i.type || '',
        val: (i.value || '').slice(0, 30)
      }));
    }""")
    print("== 按钮编辑器回填 ==")
    print(json.dumps(ed, ensure_ascii=False, indent=2))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)

    # 添加卡片弹窗：确认是注册表驱动（编辑模式在按钮编辑器测试后仍是开启的）
    pg.evaluate("""() => {
      const t = [...document.querySelectorAll('button')].find(b => /添加卡片/.test(b.textContent||''));
      if (t) t.click();
    }""")
    pg.wait_for_timeout(400)
    dlg = pg.evaluate("""() => {
      const d = document.querySelector('.dialog');
      if (!d) return null;
      return [...d.querySelectorAll('.dialog-bd button')].map(b => ({
        text: b.textContent.trim().slice(0, 24), disabled: b.disabled
      }));
    }""")
    print("== 添加卡片弹窗 ==")
    print(json.dumps(dlg, ensure_ascii=False, indent=2))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(200)

    pg.click("#btnEdit")
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(ROOT / "tests" / "_shot_light.png"))

    # 暗色
    pg.click("#btnTheme")
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(ROOT / "tests" / "_shot_dark.png"))

    print("ERRORS:", errs)
    b.close()
