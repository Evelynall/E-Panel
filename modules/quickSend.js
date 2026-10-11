/* EPanel 模块：快速发送 —— 输入文本直接发送到远端 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  var U = EP.util;
  var mk = U.mk, $$ = U.$$, svg = EP.icon;
  var store = EP.store, channels = EP.channels;

  EP.modules.register({
    id: 'quickSend',
    name: '快速发送',
    icon: 'send',
    desc: '输入文本直接发送到远端，支持历史记录',
    version: 1,
    layout: { w: 5, h: 2, minW: 2, minH: 1 },
    defaultSettings: {},
    settingsSchema: [],
    mount: function (el, ctx) {
      el.innerHTML = '';
      var cfg = store.get().quickSend;
      var input = mk('textarea', '');
      input.rows = 2;
      input.placeholder = '输入文字，回车发送（Shift+回车换行）';
      var chips = mk('div', 'chips');
      var hist = mk('select', '');
      var modes = [
        { value: 'copy', label: '复制' },
        { value: 'paste', label: '粘贴' },
        { value: 'inputtext', label: '输入' }
      ];
      modes.forEach(function (m) {
        var b = mk('button', 'chip' + (cfg.mode === m.value ? ' active' : ''));
        b.textContent = m.label;
        b.onclick = function () { cfg.mode = m.value; store.saveConfig(); render(); };
        chips.appendChild(b);
      });
      var sendBtn = mk('button', 'btn primary');
      sendBtn.innerHTML = svg('send') + ' 发送';

      var histWrap = mk('div', 'row');

      function render() {
        $$('.chip', chips).forEach(function (b) {
          b.className = 'chip' + (b.textContent === ({ copy: '复制', paste: '粘贴', inputtext: '输入' })[cfg.mode] ? ' active' : '');
        });
        hist.innerHTML = '';
        var op = mk('option', '');
        op.textContent = '历史记录…';
        op.value = '';
        hist.appendChild(op);
        (cfg.history || []).forEach(function (t) {
          var o = mk('option', '');
          o.value = t;
          o.textContent = t.length > 28 ? t.slice(0, 28) + '…' : t;
          hist.appendChild(o);
        });
      }

      hist.onchange = function () {
        if (hist.value) { input.value = hist.value; hist.value = ''; }
      };

      function send() {
        var text = input.value.trim();
        if (!text) { EP.toast('请输入内容'); return; }
        var chId = channels.firstId();
        if (!chId) { EP.toast('没有可用通道', 'err'); return; }
        var pseudo = { name: '快速发送', channel: chId, params: { operation: cfg.mode || 'paste', data: text } };
        sendBtn.disabled = true;
        channels.run(pseudo).then(function (res) {
          sendBtn.disabled = false;
          if (res.ok) {
            cfg.history = [text].concat((cfg.history || []).filter(function (t) { return t !== text; })).slice(0, 20);
            store.saveConfig();
            render();
            input.value = '';
            EP.toast('已发送', 'ok');
          } else EP.toast('发送失败：' + (res.errorMessage || '未知错误'), 'err');
        });
      }

      input.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      };
      sendBtn.onclick = send;

      histWrap.appendChild(hist);
      histWrap.appendChild(sendBtn);
      el.appendChild(input);
      el.appendChild(chips);
      el.appendChild(histWrap);
      render();
      return { destroy: function () { } };
    }
  });
})();
