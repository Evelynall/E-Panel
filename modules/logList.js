/* EPanel 模块：执行日志 —— 最近 50 条执行记录 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  var U = EP.util;
  var mk = U.mk, esc = U.esc, fmtTime = U.fmtTime, download = U.download;
  var store = EP.store, dialog = EP.dialog, bus = EP.bus;

  EP.modules.register({
    id: 'logList',
    name: '执行日志',
    icon: 'list',
    desc: '最近 50 条执行记录',
    version: 1,
    layout: { w: 7, h: 2, minW: 2, minH: 1 },
    defaultSettings: {},
    settingsSchema: [],
    mount: function (el, ctx) {
      el.innerHTML = '';
      var listBox = mk('div', '');
      var bar = mk('div', 'row');
      bar.style.marginBottom = '8px';
      var exp = mk('button', 'btn sm');
      exp.textContent = '导出';
      exp.onclick = function () {
        download('epanel-logs.json', JSON.stringify(store.getLogs(), null, 2));
      };
      var clr = mk('button', 'btn sm danger');
      clr.textContent = '清空';
      clr.onclick = function () {
        dialog.confirm('清空全部日志？').then(function (ok) { if (ok) store.clearLogs(); });
      };
      bar.appendChild(exp); bar.appendChild(clr);

      function render() {
        listBox.innerHTML = '';
        var logs = store.getLogs();
        if (!logs.length) {
          var em = mk('div', 'empty');
          em.textContent = '暂无日志';
          listBox.appendChild(em);
          return;
        }
        logs.slice(0, 30).forEach(function (l) {
          var r = mk('div', 'logrow');
          r.innerHTML = '<span class="t">' + fmtTime(l.ts) + '</span>' +
            '<span class="n">' + esc(l.name) + '</span>' +
            '<span class="s">' + (l.ok
              ? '<span style="color:var(--ok)">成功</span> ' + (l.cost || 0) + 'ms'
              : '<span style="color:var(--err)">' + esc(l.errorMessage || '失败') + '</span>') + '</span>';
          listBox.appendChild(r);
        });
      }
      render();
      el.appendChild(bar);
      el.appendChild(listBox);
      bus.on('log', render);
      return { destroy: function () { bus.off('log', render); } };
    }
  });
})();
