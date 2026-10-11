/* EPanel 模块：动作返回值 —— 展示最后一次执行的返回值与耗时 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  var U = EP.util;
  var mk = U.mk, esc = U.esc, copyText = U.copyText;
  var bus = EP.bus;

  EP.modules.register({
    id: 'resultPanel',
    name: '动作返回值',
    icon: 'term',
    desc: '展示最后一次执行的返回值与耗时',
    version: 1,
    layout: { w: 5, h: 2, minW: 2, minH: 1 },
    defaultSettings: {},
    settingsSchema: [],
    mount: function (el, ctx) {
      el.innerHTML = '';
      function render(res) {
        el.innerHTML = '';
        if (!res) {
          var em = mk('div', 'empty');
          em.textContent = '还没有执行记录';
          el.appendChild(em);
          return;
        }
        var line = mk('div', 'row');
        line.style.marginBottom = '8px';
        line.innerHTML = '<span class="badge ' + (res.ok ? 'ok' : 'err') + '">' + (res.ok ? '成功' : '失败') + '</span>' +
          '<span class="badge">' + esc(res.channelId || '') + '</span>' +
          '<span class="hint" style="margin:0">' + (res.cost || 0) + ' ms</span>';
        el.appendChild(line);
        if (res.errorMessage) {
          var e1 = mk('div', 'result-box');
          e1.style.color = 'var(--err)';
          e1.textContent = res.errorMessage;
          el.appendChild(e1);
        }
        if (res.result) {
          var box = mk('div', 'result-box');
          box.textContent = res.result;
          el.appendChild(box);
          var cp = mk('button', 'btn sm');
          cp.style.marginTop = '8px';
          cp.textContent = '复制结果';
          cp.onclick = function () { copyText(res.result); EP.toast('已复制', 'ok'); };
          el.appendChild(cp);
        }
      }
      render(EP.lastResult);
      bus.on('result', render);
      return { destroy: function () { bus.off('result', render); } };
    }
  });
})();
