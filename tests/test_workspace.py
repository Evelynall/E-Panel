# -*- coding: utf-8 -*-
"""多工作区回归测试

覆盖：迁移、新建/复制/重命名/排序/删除、数据隔离、刷新持久化、导出结构。
"""
import json
import os
import pathlib

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri()


def wss(pg):
    return pg.evaluate("""() => EP.store.getWorkspaces().map(w => ({ id: w.id, name: w.name }))""")


def active(pg):
    return pg.evaluate("""() => {
      const w = EP.store.activeWorkspace();
      return { id: w.id, name: w.name,
               chip: (document.querySelector('#btnWs') || {}).textContent,
               cards: EP.state.cards.map(c => c.moduleId + ':' + c.title) };
    }""")


def menu_click(pg, kw):
    """点当前弹窗里文本包含 kw 的按钮"""
    ok = pg.evaluate("""(kw) => {
      const d = document.querySelector('.dialog');
      if (!d) return false;
      const b = [...d.querySelectorAll('button')].find(x => (x.textContent || '').indexOf(kw) >= 0);
      if (!b) return false;
      b.click();
      return true;
    }""", kw)
    pg.wait_for_timeout(350)
    return ok


def fill_dialog(pg, text, ok_label="确定"):
    pg.evaluate("""(t) => {
      const d = document.querySelector('.dialog');
      const i = d.querySelector('input[type="text"]');
      i.focus(); i.value = t;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }""", text)
    menu_click(pg, ok_label)


def main():
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 900})
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console.error: " + m.text)
              if m.type == "error" else None)

        # ---------- 阶段 0：老数据迁移 ----------
        print("== 阶段 0：从单工作区老数据迁移 ==")
        pg.goto(URL)
        pg.wait_for_timeout(700)
        pg.evaluate("""() => {
          // 造出"没有工作区结构"的老状态
          localStorage.removeItem('ep.workspaces');
          localStorage.removeItem('ep.activeWs');
          for (const k of Object.keys(localStorage)) {
            if (k.indexOf('ep.ws.') === 0) localStorage.removeItem(k);
          }
          localStorage.setItem('ep.pages', JSON.stringify([
            { id: 'p_main', name: '主控台', icon: 'home', type: 'dashboard', builtin: true, order: 0, cards: [] },
            { id: 'p_settings', name: '设置', icon: 'cog', type: 'custom', builtin: true, order: 1, cards: [] }
          ]));
          localStorage.setItem('ep.cards', JSON.stringify([
            { id: 'c_mark', pageId: 'p_main', moduleId: 'todoList', title: '老数据标记卡',
              settings: {}, layout: { w: 5, hMode: 'auto', h: 0 }, collapsed: false, order: 0 }
          ]));
        }""")
        pg.reload()
        pg.wait_for_timeout(800)
        list0 = wss(pg)
        act0 = active(pg)
        print("  工作区:", json.dumps(list0, ensure_ascii=False))
        print("  当前:", json.dumps(act0, ensure_ascii=False))
        print("  迁移出默认工作区:", len(list0) == 1 and list0[0]["name"] == "默认工作区")
        print("  老卡片进了默认工作区:", any("老数据标记卡" in c for c in act0["cards"]))
        new_keys = pg.evaluate("""() => Object.keys(localStorage).filter(k => k.indexOf('ep.ws.') === 0)""")
        print("  新命名空间键:", json.dumps(new_keys, ensure_ascii=False))
        print("  老键仍保留（保险）:", pg.evaluate("() => !!localStorage.getItem('ep.cards')"))

        # ---------- 阶段 1：UI 新建工作区 ----------
        print("== 阶段 1：顶栏新建工作区 ==")
        pg.click("#btnWs")
        pg.wait_for_timeout(300)
        print("  菜单里能看到工作区:", menu_click(pg, "新建空白工作区"))
        fill_dialog(pg, "办公")
        pg.wait_for_timeout(500)
        list1 = wss(pg)
        act1 = active(pg)
        print("  工作区:", json.dumps(list1, ensure_ascii=False))
        print("  当前:", json.dumps(act1, ensure_ascii=False))
        print("  新建并切过去了:", len(list1) == 2 and act1["name"] == "办公")
        print("  顶栏胶囊跟着变:", "办公" in (act1["chip"] or ""))
        print("  新工作区是默认 4 张卡:", len(act1["cards"]) == 4, act1["cards"])
        print("  老工作区的卡还在:",
              pg.evaluate("""() => (JSON.parse(localStorage.getItem('ep.ws.ws_default.cards'))||[]).length""") == 1)

        # ---------- 阶段 2：数据隔离 ----------
        print("== 阶段 2：两个工作区的数据互不干扰 ==")
        pg.evaluate("""() => {
          EP.state.cards.push({ id: 'c_office', pageId: 'p_main', moduleId: 'todoList',
            title: '办公专用卡', settings: {}, layout: { w: 5, hMode: 'auto', h: 0 },
            collapsed: false, order: 9 });
          EP.store.saveCards();
        }""")
        pg.reload()
        pg.wait_for_timeout(700)
        in_office = active(pg)
        print("  办公里有 5 张:", len(in_office["cards"]) == 5, in_office["cards"])
        # 切回默认工作区
        pg.evaluate("() => EP.ui.openWsMenu()")
        pg.wait_for_timeout(300)
        menu_click(pg, "默认工作区")
        pg.wait_for_timeout(500)
        in_def = active(pg)
        print("  切回默认:", in_def["name"], "卡片:", in_def["cards"])
        print("  默认工作区只有那张老卡（隔离成功）:",
              len(in_def["cards"]) == 1 and "老数据标记卡" in in_def["cards"][0])
        office_cards = pg.evaluate("""() => JSON.parse(localStorage.getItem('ep.ws.'+EP.store.getWorkspaces()[1].id+'.cards')||'[]').length""")
        print("  办公工作区的 5 张仍在盘上:", office_cards == 5)

        # ---------- 阶段 3：复制当前（必须是深拷贝） ----------
        print("== 阶段 3：复制当前工作区 ==")
        pg.evaluate("() => EP.ui.openWsMenu()")
        pg.wait_for_timeout(300)
        menu_click(pg, "复制当前工作区")
        fill_dialog(pg, "默认副本")
        pg.wait_for_timeout(500)
        dup = active(pg)
        print("  副本:", dup["name"], dup["cards"])
        same_ids = pg.evaluate("""() => {
          const c = EP.state.cards;
          return c.some(x => x.id === 'c_mark');
        }""")
        print("  副本是深拷贝（卡片 id 重新生成）:", not same_ids)
        pg.evaluate("""() => {
          const c = EP.state.cards[0];
          c.title = '副本里改过';
          EP.store.saveCards();
        }""")
        pg.evaluate("() => EP.ui.openWsMenu()")
        pg.wait_for_timeout(300)
        menu_click(pg, "默认工作区")
        pg.wait_for_timeout(500)
        orig = active(pg)
        print("  改副本不影响原工作区:", "副本里改过" not in json.dumps(orig["cards"], ensure_ascii=False))
        print("  原工作区标题:", orig["cards"])

        # ---------- 阶段 4：改名 / 上移下移 / 删除 ----------
        print("== 阶段 4：设置页管理 ==")
        pg.evaluate("() => EP.ui.openPage('p_settings')")
        pg.wait_for_timeout(400)
        ui = pg.evaluate("""() => {
          const box = document.querySelector('#page');
          const rows = [...box.querySelectorAll('.wsrow')];
          return { 有工作区区块: !!box.querySelector('.section h4') &&
                     [...box.querySelectorAll('h4')].some(h => h.textContent === '工作区'),
                   行数: rows.length,
                   名字: rows.map(r => r.querySelector('b').textContent),
                   有当前标记: rows.some(r => r.querySelector('.badge.ok')) };
        }""")
        print("  ", json.dumps(ui, ensure_ascii=False))
        print("  设置页有工作区区块:", ui["有工作区区块"], "行数对得上:", ui["行数"] == 3)
        pg.screenshot(path=str(ROOT / "tests" / "_shot_ws_settings.png"))

        # 用第一行的 ⋯ 改名
        pg.evaluate("""() => {
          document.querySelector('#page .wsrow .ops button:last-child').click();
        }""")
        pg.wait_for_timeout(300)
        menu_click(pg, "重命名")
        fill_dialog(pg, "改过名的工作区")
        pg.wait_for_timeout(400)
        print("  改名后:", json.dumps([w["name"] for w in wss(pg)], ensure_ascii=False))

        # 下移
        pg.evaluate("""() => {
          document.querySelector('#page .wsrow .ops button:last-child').click();
        }""")
        pg.wait_for_timeout(300)
        menu_click(pg, "下移")
        pg.wait_for_timeout(300)
        print("  下移后顺序:", json.dumps([w["name"] for w in wss(pg)], ensure_ascii=False))

        # 删除当前工作区（应该自动切到别的）
        before_ids = pg.evaluate("() => EP.store.getWorkspaces().map(w => w.id)")
        cur_id = pg.evaluate("() => EP.store.getActiveWsId()")
        pg.evaluate("""() => {
          // 找到当前那行
          const rows = [...document.querySelectorAll('#page .wsrow')];
          const i = EP.store.getWorkspaces().findIndex(w => w.id === EP.store.getActiveWsId());
          rows[i].querySelector('.ops button:last-child').click();
        }""")
        pg.wait_for_timeout(300)
        menu_click(pg, "删除")
        menu_click(pg, "确定")
        pg.wait_for_timeout(600)
        after = wss(pg)
        act_after = active(pg)
        print("  删除后工作区:", json.dumps(after, ensure_ascii=False))
        print("  当前切到了别的:", act_after["id"] != cur_id and act_after["id"] in [w["id"] for w in after])
        print("  被删的数据键清掉了:",
              pg.evaluate("""(id) => {
                return ['pages','cards','categories','buttons']
                  .every(x => localStorage.getItem('ep.ws.'+id+'.'+x) === null);
              }""", cur_id))

        # 只剩一个时不允许删
        pg.evaluate("""() => {
          const list = EP.store.getWorkspaces();
          list.slice(1).forEach(w => EP.store.removeWorkspace(w.id));
        }""")
        left = wss(pg)
        can = pg.evaluate("() => EP.store.removeWorkspace(EP.store.getActiveWsId())")
        print("  只剩一个:", len(left) == 1, "再删返回:", can, "（应为 False）")

        # ---------- 阶段 5：刷新持久化 ----------
        print("== 阶段 5：刷新后仍然对得上 ==")
        pg.reload()
        pg.wait_for_timeout(800)
        print("  工作区:", json.dumps(wss(pg), ensure_ascii=False))
        print("  当前:", json.dumps(active(pg), ensure_ascii=False))

        # ---------- 阶段 6：导出结构 ----------
        print("== 阶段 6：导出带上所有工作区 ==")
        exp = pg.evaluate("""() => {
          const d = EP.store.exportAll();
          return { version: d.version, ws: d.workspaces.map(w => ({ name: w.name,
                    cards: (w.data.cards || []).length, pages: (w.data.pages || []).length })),
                   activeWs: d.activeWs };
        }""")
        print("  ", json.dumps(exp, ensure_ascii=False))
        print("  版本升到 4:", exp["version"] == 4)
        print("  每个工作区都带 data:", all(w["pages"] > 0 for w in exp["ws"]))

        pg.screenshot(path=str(ROOT / "tests" / "_shot_ws.png"))
        print("ERRORS:", errs)
        b.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
