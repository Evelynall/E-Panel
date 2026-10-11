/* EPanel 模块：待办清单
 * ------------------------------------------------------------
 * 演示「模块化」：整个功能只靠这一个文件，内核 app.js 与 app.css 都不用改。
 *   - 数据存在卡片自己的 settings 里（ctx.card.settings.items），随配置一起导出/备份
 *   - 样式用模块自带的 <style> 注入，不污染 app.css
 *   - 添加流程：改 id/name → 在 index.html 里补一行 script → 编辑模式「添加卡片」里出现
 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  var U = EP.util;
  var mk = U.mk, esc = U.esc, uid = U.uid;
  var svg = EP.icon;

  /* ---------- 模块自带样式（只在首次挂载时注入一次） ---------- */
  var CSS_ID = 'ep-mod-todolist';
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      '.todo-row{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:.5px solid var(--border);}',
      '.todo-row:first-child{border-top:none;}',
      '.todo-check{width:22px;height:22px;flex:none;margin-top:1px;border-radius:50%;border:2px solid var(--border);background:transparent;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .18s,border-color .18s,transform .14s cubic-bezier(.32,.72,0,1);}',
      '.todo-check:active{transform:scale(.88);}',
      '.todo-check.on{background:var(--ok);border-color:var(--ok);}',
      '.todo-check svg{width:13px;height:13px;color:#fff;opacity:0;transition:opacity .15s;}',
      '.todo-check.on svg{opacity:1;}',
      '.todo-text{flex:1;min-width:0;font-size:14px;line-height:1.45;word-break:break-word;cursor:text;transition:color .18s;}',
      '.todo-row.done .todo-text{color:var(--text-faint);text-decoration:line-through;}',
      '.todo-del{width:22px;height:22px;flex:none;margin-top:1px;border:none;background:transparent;color:var(--text-faint);border-radius:50%;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s,color .18s,background-color .18s;}',
      '.todo-row:hover .todo-del{opacity:1;}',
      '.todo-del:hover{color:var(--err);background:var(--surface-3);}',
      '.todo-del svg{width:13px;height:13px;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  EP.modules.register({
    id: 'todoList',
    name: '待办清单',
    icon: 'check',
    desc: '本地保存的待办事项，可勾选、编辑、删除',
    version: 1,
    layout: { w: 5, h: 2, minW: 2, minH: 1 },

    // 注意：不要把 items 放进 defaultSettings —— 内核的 merge 是浅拷贝，
    // 放数组会让所有「待办清单」卡片共用同一个数组对象。items 在挂载时按需初始化。
    defaultSettings: { showDone: true, newOnTop: false },
    settingsSchema: [
      { key: 'showDone', label: '显示已完成', type: 'switch', default: true, hint: '关掉后，已完成项自动隐藏' },
      { key: 'newOnTop', label: '新项插到顶部', type: 'switch', default: false, hint: '默认追加到末尾' }
    ],

    mount: function (el, ctx) {
      ensureCss();
      el.innerHTML = '';

      var items = Array.isArray(ctx.settings.items) ? ctx.settings.items.slice() : [];
      var filter = 'all';                 // 模块内部状态：全部 / 未完成 / 已完成

      // 写回卡片自己的 settings，随 ep.cards 一起持久化（导出配置时会带上）
      function persist() {
        ctx.card.settings.items = items;
        ctx.settings.items = items;
        EP.store.saveCards();
      }

      /* ---------- 顶部：输入 + 添加 ---------- */
      var addRow = mk('div', 'row');
      addRow.style.marginBottom = '10px';
      addRow.style.flexWrap = 'nowrap';
      addRow.style.alignItems = 'stretch';   // 让按钮和输入框等高
      var input = mk('input', '');
      input.type = 'text';
      input.placeholder = '添加一项…（回车）';
      input.style.flex = '1';
      var addBtn = mk('button', 'btn primary');
      addBtn.style.flex = 'none';
      addBtn.innerHTML = svg('plus') + ' 添加';
      addRow.appendChild(input);
      addRow.appendChild(addBtn);

      /* ---------- 筛选条 ---------- */
      var chips = mk('div', 'chips');
      chips.style.marginBottom = '4px';

      /* ---------- 列表 ---------- */
      var listBox = mk('div', '');

      /* ---------- 底部：统计 + 清除已完成 ---------- */
      var foot = mk('div', 'row');
      foot.style.marginTop = '10px';
      var stat = mk('span', 'hint');
      stat.style.margin = '0';
      var clr = mk('button', 'btn sm');
      clr.textContent = '清除已完成';
      clr.style.marginLeft = 'auto';
      foot.appendChild(stat);
      foot.appendChild(clr);

      function counts() {
        var done = 0;
        items.forEach(function (t) { if (t.done) done++; });
        return { done: done, left: items.length - done, all: items.length };
      }

      function renderChips() {
        var c = counts();
        chips.innerHTML = '';
        function chip(label, id, n) {
          var b = mk('button', 'chip' + (filter === id ? ' active' : ''));
          b.textContent = label + (n == null ? '' : ' ' + n);
          b.onclick = function () { filter = id; renderChips(); renderList(); };
          chips.appendChild(b);
        }
        chip('全部', 'all', c.all);
        chip('未完成', 'active', c.left);
        chip('已完成', 'done', c.done);
      }

      function visible() {
        var showDone = ctx.settings.showDone !== false;
        return items.filter(function (t) {
          if (filter === 'active') return !t.done;
          if (filter === 'done') return t.done;
          return showDone ? true : !t.done;
        });
      }

      function renderList() {
        listBox.innerHTML = '';
        var view = visible();
        if (!view.length) {
          var em = mk('div', 'empty');
          em.style.padding = '26px 12px';
          em.textContent = items.length ? '这个筛选下没有事项' : '还没有待办，上面加一条吧';
          listBox.appendChild(em);
          return;
        }
        view.forEach(function (t) {
          var row = mk('div', 'todo-row' + (t.done ? ' done' : ''));

          var ck = mk('button', 'todo-check' + (t.done ? ' on' : ''));
          ck.innerHTML = svg('check');
          ck.title = t.done ? '标记未完成' : '标记完成';
          ck.onclick = function () { t.done = !t.done; persist(); render(); };

          var tx = mk('div', 'todo-text');
          tx.textContent = t.text;
          tx.title = '双击编辑';
          tx.ondblclick = function () { editItem(t); };

          var del = mk('button', 'todo-del');
          del.innerHTML = svg('close');
          del.title = '删除';
          del.onclick = function () {
            items = items.filter(function (x) { return x.id !== t.id; });
            persist();
            render();
          };

          row.appendChild(ck);
          row.appendChild(tx);
          row.appendChild(del);
          listBox.appendChild(row);
        });
      }

      function renderFoot() {
        var c = counts();
        stat.textContent = c.all
          ? ('剩余 ' + c.left + ' 项 · 已完成 ' + c.done + ' / ' + c.all)
          : '暂无事项';
        clr.style.display = c.done ? '' : 'none';
      }

      function render() {
        renderChips();
        renderList();
        renderFoot();
      }

      /* ---------- 交互 ---------- */
      function add() {
        var text = input.value.trim();
        if (!text) { EP.toast('先写点内容'); input.focus(); return; }
        var t = { id: uid('t'), text: text, done: false, ts: Date.now() };
        if (ctx.settings.newOnTop) items.unshift(t); else items.push(t);
        input.value = '';
        persist();
        render();
        input.focus();
      }
      addBtn.onclick = add;
      input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); add(); }
      };

      function editItem(t) {
        var box = mk('div', '');
        var inp = mk('input', '');
        inp.type = 'text';
        inp.value = t.text;
        box.appendChild(inp);
        EP.dialog.open({
          title: '编辑事项',
          body: box,
          actions: [
            { label: '取消' },
            {
              label: '保存', primary: true, onClick: function () {
                var v = inp.value.trim();
                if (!v) { EP.toast('内容不能为空', 'err'); return false; }
                t.text = v;
                persist();
                render();
              }
            }
          ]
        });
        setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) { /* noop */ } }, 40);
      }

      clr.onclick = function () {
        EP.dialog.confirm('清除所有已完成的事项？').then(function (ok) {
          if (!ok) return;
          items = items.filter(function (t) { return !t.done; });
          if (filter === 'done') filter = 'all';
          persist();
          render();
        });
      };

      el.appendChild(addRow);
      el.appendChild(chips);
      el.appendChild(listBox);
      el.appendChild(foot);
      render();

      return {
        destroy: function () { /* 没有全局监听需要解绑 */ },
        // 卡片设置改了 showDone / newOnTop 后，内核会把新的 settings 传回来
        update: function (s) { ctx.settings = s || {}; render(); }
      };
    }
  });
})();
