/* EPanel 模块：快捷按钮
 * ------------------------------------------------------------
 * 模块文件只需做一件事：调用 EP.modules.register() 注册自己。
 * 内核不认识任何具体模块，全部通过注册表发现。
 * 可用能力（全部由内核暴露）：
 *   EP.util        mk / esc / uid / merge / fmtTime / iconHtml / copyText / download / $ / $$
 *   EP.icon(name)  内联 SVG 图标
 *   EP.store       数据读写
 *   EP.channels    通道注册表与执行
 *   EP.bus         事件总线（buttons / result / log / channels）
 *   EP.dialog      自绘弹窗（confirm / menu / open）
 *   EP.toast       轻提示
 *   EP.editButton  按钮编辑器
 *   EP.state       内存态数据
 *   EP.ui          外壳状态（page / edit / maximized / kiosk）
 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  var U = EP.util;
  var mk = U.mk, esc = U.esc, uid = U.uid, iconHtml = U.iconHtml, $$ = U.$$;
  var svg = EP.icon;
  var store = EP.store, channels = EP.channels, dialog = EP.dialog, bus = EP.bus;
  var state = EP.state, copyText = U.copyText, openButtonEditor = EP.editButton;

  EP.modules.register({
    id: 'buttonGrid',
    name: '快捷按钮',
    icon: 'layout',
    desc: '按分类展示快捷触发按钮',
    version: 1,
    layout: { w: 7, h: 2, minW: 1, minH: 1 },
    defaultSettings: { categoryId: 'all', size: 88 },
    settingsSchema: [
      { key: 'categoryId', label: '固定分类', type: 'category', hint: '选「全部」则显示分类切换条' },
      { key: 'size', label: '按钮边长', type: 'range', min: 56, max: 200, step: 4, default: 88, live: true, hint: '正方形按钮的边长，同时决定每行个数（拖动即时预览）' }
    ],
    mount: function (el, ctx) {
      el.innerHTML = '';
      var chips = mk('div', 'chips');
      var grid = mk('div', 'btngrid');
      el.appendChild(chips);
      el.appendChild(grid);
      var alive = true;

      // 当前选中的分类是模块内部状态：不写回卡片设置，否则切换后整条切换条会被隐藏
      var activeCat = ctx.settings.categoryId || 'all';

      function fixedCat() {
        var v = ctx.settings.categoryId;
        return (v && v !== 'all') ? v : null;
      }
      function cat() { return fixedCat() || activeCat; }

      function renderChips() {
        chips.innerHTML = '';
        if (fixedCat()) return;               // 只有在卡片设置里固定了分类才隐藏切换条
        function chip(label, id) {
          var b = mk('button', 'chip' + (activeCat === id ? ' active' : ''));
          b.textContent = label;
          b.onclick = function () {
            activeCat = id;
            renderChips();
            renderGrid();
          };
          chips.appendChild(b);
        }
        chip('全部', 'all');
        store.getCategories().forEach(function (c) { chip(c.name, c.id); });
      }

      function btnSize() {
        var n = Number(ctx.settings.size);
        return (!n || n < 56) ? 88 : n;
      }

      function cols() {
        var w = grid.clientWidth || el.clientWidth || 320;
        var s = btnSize();
        return Math.max(2, Math.min(12, Math.floor((w + 8) / (s + 8))));
      }

      // 老 WebView 不支持 aspect-ratio，按实测宽度手动补高度
      function applySquare() {
        var first = grid.querySelector('.pbtn');
        if (!first) return;
        var w = Math.round(first.getBoundingClientRect().width);
        if (!w) return;
        var supported = false;
        try { supported = !!(window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1 / 1')); }
        catch (e) { supported = false; }
        if (supported) return;
        $$('.pbtn', grid).forEach(function (b) { b.style.height = w + 'px'; });
      }

      function renderGrid() {
        grid.innerHTML = '';
        var list = store.getButtons().filter(function (b) {
          return cat() === 'all' || b.categoryId === cat();
        });
        if (!list.length) {
          var em = mk('div', 'empty');
          em.innerHTML = '<div>暂无按钮</div><div style="margin-top:6px">在设置页或点右上角添加</div>';
          grid.appendChild(em);
          return;
        }
        grid.style.gridTemplateColumns = 'repeat(' + cols() + ', minmax(0, 1fr))';
        list.forEach(function (b) {
          var wrap = mk('div', '');
          wrap.style.position = 'relative';
          var btn = mk('button', 'pbtn');
          // 用 backgroundColor 而非 background 简写，否则会清掉 CSS 里的高光渐变
          btn.style.backgroundColor = b.color || '#3b82f6';
          if (b.opacity !== undefined && b.opacity < 100) btn.style.opacity = String(b.opacity / 100);
          if (b.bg && b.bg.type === 'image' && b.bg.url) {
            btn.style.backgroundImage = 'url("' + b.bg.url + '")';
            btn.style.backgroundSize = 'cover';
            btn.style.backgroundPosition = 'center';
          }
          btn.innerHTML = iconHtml(b) + '<span class="pbtn-name">' + esc(b.name) + '</span>';
          btn.onclick = function () { fire(b, btn); };

          var more = null;
          if (ctx.edit) {
            more = mk('button', 'pbtn-more');
            more.style.display = 'flex';
            more.innerHTML = '⋯';
            more.onclick = function (e) {
              e.stopPropagation();
              dialog.menu(b.name, [
                { id: 'edit', label: '编辑', icon: 'edit' },
                { id: 'dup', label: '复制一份', icon: 'copy' },
                { id: 'link', label: '复制为推送直链', icon: 'link' },
                { id: 'del', label: '删除', icon: 'trash', danger: true }
              ]).then(function (act) {
                if (act === 'edit') openButtonEditor(b);
                else if (act === 'dup') {
                  var nb = JSON.parse(JSON.stringify(b));
                  nb.id = uid('b');
                  nb.name = b.name + ' 副本';
                  nb.order = store.getButtons().length;
                  state.buttons.push(nb);
                  store.saveButtons();
                } else if (act === 'link') {
                  var ch = channels.get(b.channel);
                  if (ch && ch.buildUrl) {
                    var url = ch.buildUrl(b.params || {}, store.channelSettings(b.channel));
                    copyText(url);
                    EP.toast('已复制推送直链', 'ok');
                  } else EP.toast('该通道不支持直链', 'err');
                } else if (act === 'del') {
                  dialog.confirm('删除按钮「' + b.name + '」？').then(function (ok) {
                    if (!ok) return;
                    state.buttons = state.buttons.filter(function (x) { return x.id !== b.id; });
                    store.saveButtons();
                  });
                }
              });
            };
          }
          wrap.appendChild(btn);
          if (more) wrap.appendChild(more);   // 放在按钮之后，确保叠在上层可点
          grid.appendChild(wrap);
        });
        applySquare();
      }

      function fire(b, node) {
        function go() {
          node.classList.add('pending');
          channels.run(b).then(function (res) {
            node.classList.remove('pending');
            if (res.ok) EP.toast('已执行：' + b.name, 'ok');
            else EP.toast(b.name + ' 失败：' + (res.errorMessage || '未知错误'), 'err');
          });
        }
        if (b.confirm) dialog.confirm('确定执行「' + b.name + '」？').then(function (ok) { if (ok) go(); });
        else go();
      }

      renderChips();
      renderGrid();

      // 挂载时卡片可能还没量到宽度，插入后再排一次
      setTimeout(function () { if (alive) renderGrid(); }, 0);

      bus.on('buttons', renderGrid);

      return {
        destroy: function () { alive = false; bus.off('buttons', renderGrid); },
        // update 收到的是完整的 settings 对象，必须整体替换而非合并：
        // 否则回滚时旧值里的空字段会被跳过，预览值残留
        update: function (s) { ctx.settings = s || {}; renderGrid(); }
      };
    }
  });
})();
