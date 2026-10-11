/* EPanel · app.js
 * 通用面板工作台：模块（呈现）与通道（执行）两套注册表，互不耦合。
 * 全程 ES5 写法 + Promise 兜底，兼容老旧 Android WebView 与 file:// 环境。
 */
(function () {
  'use strict';

  var EP = window.EP = window.EP || {};
  EP.version = '0.1.0';

  /* ---------- Promise 兜底（老 WebView 没有原生 Promise） ---------- */
  if (typeof window.Promise !== 'function') {
    window.Promise = function (fn) {
      var self = this, st = 'p', v = null, cbs = [];
      function settle(s, x) { if (st !== 'p') return; st = s; v = x; cbs.forEach(function (c) { c(); }); cbs = []; }
      function then(onF, onR) {
        return new window.Promise(function (res, rej) {
          function run() {
            var cb = st === 'f' ? onF : onR, r;
            if (typeof cb !== 'function') { (st === 'f' ? res : rej)(v); return; }
            try { r = cb(v); } catch (e) { rej(e); return; }
            if (r && typeof r.then === 'function') r.then(res, rej); else res(r);
          }
          if (st !== 'p') run(); else cbs.push(run);
        });
      }
      self.then = then;
      self['catch'] = function (f) { return then(null, f); };
      try { fn(function (x) { settle('f', x); }, function (e) { settle('r', e); }); }
      catch (e) { settle('r', e); }
    };
    window.Promise.resolve = function (x) { return new window.Promise(function (r) { r(x); }); };
    window.Promise.reject = function (x) { return new window.Promise(function (r, j) { j(x); }); };
  }

  /* ---------- fetch 兜底（老 WebView 没有 fetch） ---------- */
  if (typeof window.fetch !== 'function') {
    window.fetch = function (url, opt) {
      return new window.Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        opt = opt || {};
        try { xhr.open(opt.method || 'GET', url, true); } catch (e) { reject(e); return; }
        if (opt.headers) {
          for (var k in opt.headers) {
            if (Object.prototype.hasOwnProperty.call(opt.headers, k)) xhr.setRequestHeader(k, opt.headers[k]);
          }
        }
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          resolve({
            status: xhr.status,
            text: function () { return window.Promise.resolve(xhr.responseText || ''); }
          });
        };
        xhr.onerror = function () { reject(new Error('网络异常')); };
        try { xhr.send(opt.body || null); } catch (e2) { reject(e2); }
      });
    };
  }

  /* ---------- 小工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (b[k] !== undefined && b[k] !== null) o[k] = b[k];
    return o;
  }
  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function fmtTime(ts) {
    var d = new Date(ts), p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  var ICONS = {
    menu: 'M3 6h18M3 12h18M3 18h18',
    home: 'M3 11l9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M5 19l1.5-1.5',
    moon: 'M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z',
    layout: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    more: 'M6 12h.01M12 12h.01M18 12h.01',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    edit: 'M4 20h4l10-10-4-4L4 16v4z',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    check: 'M5 13l4 4L19 7',
    send: 'M3 12l18-8-8 18-2-7-8-3z',
    term: 'M6 8l4 4-4 4M13 16h5',
    list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
    resize: 'M14 20h6v-6',
    grid: 'M4 4h16v16H4zM4 10h16M4 16h16M10 4v16',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    link: 'M9 15l6-6M8 12l-2 2a3 3 0 0 0 4 4l2-2M16 12l2-2a3 3 0 0 0-4-4l-2 2'
  };
  function svg(name) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="' + (ICONS[name] || '') + '"/></svg>';
  }
  EP.icon = svg;

  /* ---------- 事件总线 ---------- */
  var bus = EP.bus = {
    _m: {},
    on: function (k, f) { (this._m[k] = this._m[k] || []).push(f); },
    off: function (k, f) {
      var a = this._m[k] || [];
      var i = a.indexOf(f);
      if (i >= 0) a.splice(i, 1);
    },
    emit: function (k, p) {
      (this._m[k] || []).slice().forEach(function (f) {
        try { f(p); } catch (e) { if (window.console) console.error(e); }
      });
    }
  };

  /* ================= 存储层 ================= */

  var KEYS = {
    config: 'ep.config', categories: 'ep.categories', buttons: 'ep.buttons',
    pages: 'ep.pages', cards: 'ep.cards', logs: 'ep.logs', backup: 'ep.backup.v2'
  };
  var OLD = {
    config: 'quickPanelConfig', categories: 'quickPanelCategories', buttons: 'quickPanelButtons'
  };

  var state = EP.state = { config: null, categories: [], buttons: [], pages: [], cards: [], logs: [] };
  var persistOk = true;
  var mem = {};

  function rawGet(k) {
    try { return localStorage.getItem(k); }
    catch (e) { persistOk = false; return mem[k] != null ? mem[k] : null; }
  }
  function rawSet(k, v) {
    mem[k] = v;
    try { localStorage.setItem(k, v); }
    catch (e) { persistOk = false; }
  }
  function getJSON(k) {
    var v = rawGet(k);
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  function setJSON(k, v) { rawSet(k, JSON.stringify(v)); }

  function selfCheck() {
    try {
      localStorage.setItem('ep.__probe', '1');
      persistOk = localStorage.getItem('ep.__probe') === '1';
      localStorage.removeItem('ep.__probe');
    } catch (e) { persistOk = false; }
    return persistOk;
  }

  function defaultConfig() {
    return {
      version: 3,
      panelName: 'E 面板',
      theme: 'light',
      gridCols: 0,
      timeoutMs: 8000,
      channels: { quicker: { toUser: '', code: '', defaultDevice: '' } },
      chrome: { topBar: 'always', sidebar: 'always', handlePos: 'br' },
      display: { enabled: false, autoIdleSec: 0, hideCardTitles: false, keepAwake: true },
      quickSend: { mode: 'paste', history: [] }
    };
  }
  function defaultPages() {
    return [
      { id: 'p_main', name: '主控台', icon: 'home', type: 'dashboard', builtin: true, order: 0, cards: [] },
      { id: 'p_settings', name: '设置', icon: 'cog', type: 'custom', builtin: true, order: 1, cards: [] }
    ];
  }
  function defaultCards() {
    return [
      { id: uid('c'), pageId: 'p_main', moduleId: 'buttonGrid', title: '快捷按钮', settings: { categoryId: 'all', cols: 0 }, layout: { w: 7, hMode: 'auto', h: 0 }, collapsed: false, order: 0 },
      { id: uid('c'), pageId: 'p_main', moduleId: 'quickSend', title: '快速发送', settings: {}, layout: { w: 5, hMode: 'auto', h: 0 }, collapsed: false, order: 1 },
      { id: uid('c'), pageId: 'p_main', moduleId: 'resultPanel', title: '动作返回值', settings: {}, layout: { w: 5, hMode: 'auto', h: 0 }, collapsed: false, order: 2 },
      { id: uid('c'), pageId: 'p_main', moduleId: 'logList', title: '执行日志', settings: {}, layout: { w: 7, hMode: 'auto', h: 0 }, collapsed: false, order: 3 }
    ];
  }

  function migrateOld() {
    var oldCfg = getJSON(OLD.config);
    var oldBtns = getJSON(OLD.buttons);
    var oldCats = getJSON(OLD.categories);
    if (!oldCfg && !oldBtns && !oldCats) return false;

    try {
      rawSet(KEYS.backup, JSON.stringify({
        config: oldCfg, buttons: oldBtns, categories: oldCats, at: Date.now()
      }));
    } catch (e) { /* 备份失败不阻断 */ }

    var cfg = defaultConfig();
    if (oldCfg) {
      cfg.panelName = oldCfg.panelName || cfg.panelName;
      cfg.channels.quicker = {
        toUser: oldCfg.toUser || '',
        code: oldCfg.code || '',
        defaultDevice: oldCfg.defaultDevice || ''
      };
    }
    var cats = (oldCats && oldCats.length) ? oldCats : [{ id: 'cat_default', name: '默认分类', order: 0 }];
    cats.forEach(function (c, i) { if (c.order === undefined) c.order = i; });

    var btns = (oldBtns || []).map(function (b, i) {
      var icon = { type: 'none', value: '' };
      if (b.iconType === 'font' && b.fontIcon) { icon = { type: 'svg', value: 'bolt' }; }
      else if (b.iconType === 'image' && b.imageIcon) { icon = { type: 'image', value: b.imageIcon }; }
      var bg = { type: 'none', url: '' };
      if (b.bgType === 'image' && b.bgImage) bg = { type: 'image', url: b.bgImage };
      return {
        id: b.id || uid('b'),
        name: b.name || ('按钮' + (i + 1)),
        categoryId: b.categoryId || cats[0].id,
        order: b.order === undefined ? i : b.order,
        color: b.color || '#3b82f6',
        opacity: b.opacity === undefined ? 100 : b.opacity,
        icon: icon,
        bg: bg,
        channel: 'quicker',
        params: {
          operation: b.operation || 'copy',
          action: b.action || '',
          data: b.data || '',
          toDevice: b.toDevice || '',
          wait: !!b.wait,
          maxWaitMs: b.maxWaitMs || 3000
        },
        confirm: false,
        createdAt: b.createdAt || Date.now(),
        updatedAt: Date.now()
      };
    });

    state.config = cfg;
    state.categories = cats;
    state.buttons = btns;
    state.pages = defaultPages();
    state.cards = defaultCards();
    state.logs = [];
    saveAll();
    return true;
  }

  function saveAll() {
    setJSON(KEYS.config, state.config);
    setJSON(KEYS.categories, state.categories);
    setJSON(KEYS.buttons, state.buttons);
    setJSON(KEYS.pages, state.pages);
    setJSON(KEYS.cards, state.cards);
    setJSON(KEYS.logs, state.logs);
  }

  function load() {
    selfCheck();
    var cfg = getJSON(KEYS.config);
    var migrated = false;
    if (!cfg) migrated = migrateOld();
    if (!state.config) state.config = cfg || defaultConfig();

    var c = state.config;
    c.channels = c.channels || {};
    if (!c.channels.quicker) c.channels.quicker = { toUser: '', code: '', defaultDevice: '' };
    c.chrome = merge({ topBar: 'always', sidebar: 'always', handlePos: 'br' }, c.chrome || {});
    c.display = merge({ enabled: false, autoIdleSec: 0, hideCardTitles: false, keepAwake: true }, c.display || {});
    c.quickSend = merge({ mode: 'paste', history: [] }, c.quickSend || {});

    if (!migrated) {
      state.pages = getJSON(KEYS.pages) || defaultPages();
      state.cards = getJSON(KEYS.cards) || defaultCards();
      state.buttons = getJSON(KEYS.buttons) || [];
      state.categories = getJSON(KEYS.categories) || [{ id: 'cat_default', name: '默认分类', order: 0 }];
      state.logs = getJSON(KEYS.logs) || [];
    }
    if (!state.categories.length) state.categories = [{ id: 'cat_default', name: '默认分类', order: 0 }];
  }

  var store = EP.store = {
    keys: KEYS,
    get: function () { return state.config; },
    saveConfig: function () { setJSON(KEYS.config, state.config); },
    channelSettings: function (id) {
      var c = state.config.channels[id];
      return c || {};
    },
    saveChannel: function (id, obj) {
      state.config.channels[id] = obj;
      setJSON(KEYS.config, state.config);
    },
    getCategories: function () {
      return state.categories.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    },
    saveCategories: function () { setJSON(KEYS.categories, state.categories); },
    addCategory: function (name) {
      var c = { id: uid('cat'), name: name, order: state.categories.length };
      state.categories.push(c);
      setJSON(KEYS.categories, state.categories);
      return c;
    },
    removeCategory: function (id) {
      if (state.categories.length <= 1) return false;
      state.categories = state.categories.filter(function (c) { return c.id !== id; });
      var first = state.categories[0];
      state.buttons.forEach(function (b) { if (b.categoryId === id) b.categoryId = first.id; });
      setJSON(KEYS.categories, state.categories);
      setJSON(KEYS.buttons, state.buttons);
      return true;
    },
    getButtons: function () {
      return state.buttons.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    },
    findButton: function (id) {
      for (var i = 0; i < state.buttons.length; i++) if (state.buttons[i].id === id) return state.buttons[i];
      return null;
    },
    saveButtons: function () { setJSON(KEYS.buttons, state.buttons); bus.emit('buttons'); },
    getPages: function () {
      return state.pages.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    },
    findPage: function (id) {
      for (var i = 0; i < state.pages.length; i++) if (state.pages[i].id === id) return state.pages[i];
      return null;
    },
    savePages: function () { setJSON(KEYS.pages, state.pages); },
    getCards: function (pageId) {
      return state.cards.filter(function (c) { return c.pageId === pageId; })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    },
    findCard: function (id) {
      for (var i = 0; i < state.cards.length; i++) if (state.cards[i].id === id) return state.cards[i];
      return null;
    },
    saveCards: function () { setJSON(KEYS.cards, state.cards); },
    getLogs: function () { return state.logs.slice(); },
    pushLog: function (e) {
      state.logs.unshift(e);
      if (state.logs.length > 50) state.logs.length = 50;
      setJSON(KEYS.logs, state.logs);
      bus.emit('log');
    },
    clearLogs: function () { state.logs = []; setJSON(KEYS.logs, state.logs); bus.emit('log'); },
    exportAll: function () {
      return {
        app: 'epanel', version: 3, exportedAt: new Date().toISOString(),
        config: state.config, categories: state.categories, buttons: state.buttons,
        pages: state.pages, cards: state.cards
      };
    },
    importAll: function (data) {
      if (!data) throw new Error('数据为空');
      if (data.config) state.config = merge(defaultConfig(), data.config);
      if (data.categories) state.categories = data.categories;
      if (data.buttons) state.buttons = data.buttons;
      if (data.pages) state.pages = data.pages;
      if (data.cards) state.cards = data.cards;
      saveAll();
    },
    isPersistent: function () { return persistOk; }
  };

  /* ================= 通道注册表 ================= */

  var QPUSH = 'https://push.getquicker.cn';

  function netError(detail) {
    var msg = detail || '网络异常';
    try {
      if (window.self !== window.top) {
        msg = '请求被拦截：页面正嵌在预览面板中，受内容安全策略限制。请用浏览器直接打开 index.html';
      }
    } catch (e) { /* noop */ }
    return new Error(msg);
  }

  function requestJson(url, opt, timeout) {
    return new window.Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('请求超时'));
      }, timeout || 8000);
      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var init = { method: opt.method || 'GET' };
      if (opt.headers) init.headers = opt.headers;
      if (opt.body) init.body = opt.body;
      if (ctrl) init.signal = ctrl.signal;
      fetch(url, init).then(function (r) {
        return r.text().then(function (t) { return { status: r.status, text: t }; });
      }).then(function (o) {
        if (done) return;
        done = true; clearTimeout(timer);
        var j = null;
        try { j = JSON.parse(o.text); } catch (e) { j = null; }
        if (j) resolve(j);
        else if (/^SUCCESS/i.test(o.text)) resolve({ isSuccess: true, successCount: 1, timeCost: 0, devices: null });
        else if (/^ERROR/i.test(o.text)) resolve({ isSuccess: false, errorMessage: o.text.replace(/^ERROR:?\s*/i, '') });
        else resolve({ isSuccess: false, errorMessage: '响应无法解析' });
      })['catch'](function (e) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (ctrl) { try { ctrl.abort(); } catch (x) { /* noop */ } }
        reject(netError());
      });
    });
  }

  function normPush(r) {
    r = r || {};
    var ok = !!r.isSuccess;
    var msg = r.errorMessage || (r.message && !r.isSuccess ? r.message : null);
    if (ok && r.successCount === 0) msg = msg || '目标设备不在线或未建立长连接';
    var result = null;
    if (r.devices) {
      try { result = JSON.stringify(r.devices, null, 2); } catch (e) { result = String(r.devices); }
    }
    return {
      ok: ok, cost: r.timeCost || 0, result: result,
      errorMessage: msg, devices: r.devices || null, raw: r
    };
  }

  function quickerBuild(params, settings) {
    var q = [];
    function add(k, v) { q.push(k + '=' + encodeURIComponent(v == null ? '' : v)); }
    add('toUser', settings.toUser);
    add('code', settings.code);
    if (params.toDevice) add('toDevice', params.toDevice);
    add('operation', params.operation || 'copy');
    if (params.operation === 'action' && params.action) add('action', params.action);
    if (params.data) add('data', params.data);
    if (params.wait) { add('wait', 'true'); add('maxWaitMs', params.maxWaitMs || 3000); }
    return QPUSH + '/to/quicker?' + q.join('&');
  }

  var channels = EP.channels = {
    _m: {},
    register: function (def) { this._m[def.id] = def; bus.emit('channels'); },
    get: function (id) { return this._m[id]; },
    list: function () {
      var a = [], k;
      for (k in this._m) if (!this._m[k].comingSoon) a.push(this._m[k]);
      return a;
    },
    all: function () {
      var a = [], k;
      for (k in this._m) a.push(this._m[k]);
      return a;
    },
    firstId: function () {
      var l = this.list();
      return l.length ? l[0].id : null;
    },
    run: function (button) {
      var self = this;
      var ch = this._m[button.channel];
      var name = button.name || '动作';
      if (!ch) {
        var r0 = { ok: false, channelId: button.channel, cost: 0, result: null, errorMessage: '通道不存在：' + button.channel };
        store.pushLog({ ts: Date.now(), name: name, channelId: button.channel, ok: false, cost: 0, errorMessage: r0.errorMessage, result: null });
        return window.Promise.resolve(r0);
      }
      var settings = store.channelSettings(button.channel);
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      function finish(res) {
        var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
        res.cost = res.cost != null ? res.cost : Math.round(t1 - t0);
        res.channelId = ch.id;
        res.ok = !!res.ok;
        store.pushLog({
          ts: Date.now(), name: name, channelId: ch.id, ok: res.ok,
          cost: res.cost, errorMessage: res.errorMessage || null,
          result: typeof res.result === 'string' ? res.result : (res.result == null ? null : String(res.result))
        });
        bus.emit('result', res);
        return res;
      }
      try {
        return window.Promise.resolve(ch.run(button.params || {}, settings, {}))
          .then(finish)
          ['catch'](function (e) {
            return finish({ ok: false, errorMessage: (e && e.message) ? e.message : String(e), result: null });
          });
      } catch (e) {
        return window.Promise.resolve(finish({ ok: false, errorMessage: e.message || String(e), result: null }));
      }
    }
  };

  channels.register({
    id: 'quicker',
    name: 'Quicker 推送',
    icon: 'bolt',
    desc: '通过 Quicker 推送服务远程触发电脑动作',
    version: 1,
    settingsSchema: [
      { key: 'toUser', label: '账号邮箱', type: 'text', placeholder: 'Quicker 账号 Email' },
      { key: 'code', label: '推送验证码', type: 'password', placeholder: '会员中心设置的验证码' },
      { key: 'defaultDevice', label: '默认设备', type: 'text', hint: '留空 = 当前活动主机；* = 所有主机；!电脑名 = 排除某台' }
    ],
    actionSchema: [
      {
        key: 'operation', label: '操作类型', type: 'select', default: 'copy', options: [
          { value: 'copy', label: '复制到剪贴板' },
          { value: 'paste', label: '粘贴到当前窗口' },
          { value: 'action', label: '运行动作' },
          { value: 'open', label: '打开网址/文件' },
          { value: 'sendkeys', label: '模拟按键（sendkeys 语法）' },
          { value: 'inputtext', label: '模拟输入文本' },
          { value: 'inputscript', label: '多步骤输入' },
          { value: 'downloadfile', label: '下载文件' }
        ]
      },
      { key: 'action', label: '动作 ID 或名称', type: 'text', showIf: { operation: 'action' }, hint: '使用名称时不能有重复' },
      {
        key: 'data', label: '数据', type: 'textarea',
        showIf: { operation: ['copy', 'paste', 'action', 'open', 'sendkeys', 'inputtext', 'inputscript', 'downloadfile'] }
      },
      { key: 'toDevice', label: '目标设备', type: 'text', hint: '留空用默认设备' },
      { key: 'wait', label: '等待返回值', type: 'switch', default: false },
      { key: 'maxWaitMs', label: '最长等待毫秒', type: 'number', default: 3000, showIf: { wait: true } }
    ],
    buildUrl: quickerBuild,
    run: function (params, settings) {
      var timeout = params.wait
        ? (Number(params.maxWaitMs) || 3000) + 5000
        : (store.get().timeoutMs || 8000);
      var body = {
        toUser: settings.toUser || '',
        code: settings.code || '',
        operation: params.operation || 'copy'
      };
      if (params.toDevice) body.toDevice = params.toDevice;
      if (params.operation === 'action') body.action = params.action || '';
      if (params.data) body.data = params.data;
      if (params.wait) { body.wait = true; body.maxWaitMs = Number(params.maxWaitMs) || 3000; }
      if (!body.toUser || !body.code) {
        return window.Promise.resolve({ ok: false, errorMessage: '尚未配置 Quicker 通道的邮箱与验证码' });
      }
      return requestJson(QPUSH + '/to/quicker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, timeout).then(normPush)['catch'](function (e) {
        return requestJson(quickerBuild(params, settings), { method: 'GET' }, timeout).then(normPush);
      });
    },
    test: function (settings) {
      if (!settings.toUser || !settings.code) {
        return window.Promise.resolve({ ok: false, errorMessage: '请先填写邮箱与验证码' });
      }
      var url = QPUSH + '/get/devices?email=' + encodeURIComponent(settings.toUser) +
        '&code=' + encodeURIComponent(settings.code);
      return requestJson(url, { method: 'GET' }, 8000).then(function (r) {
        var d = r && r.data ? r.data : r;
        var devices = [];
        if (d && Array.isArray(d.devices)) devices = d.devices;
        else if (Array.isArray(d)) devices = d;
        var ok = r && r.isSuccess !== false;
        return {
          ok: ok,
          devices: devices,
          active: (d && d.activeDevice) || (r && r.activeDevice) || '',
          errorMessage: ok ? null : ((r && (r.message || r.errorMessage)) || '连接失败')
        };
      })['catch'](function (e) {
        return { ok: false, devices: [], active: '', errorMessage: e.message || '网络异常' };
      });
    }
  });

  /* 预留通道：接口先留，标记为 comingSoon */
  [['http', 'HTTP 请求', '自定义 HTTP / Webhook'],
   ['mqtt', 'MQTT', '物联网消息'],
   ['homeassistant', 'Home Assistant', '智能家居实体控制'],
   ['script', '本地脚本', '运行本地命令或脚本']].forEach(function (c) {
    channels.register({ id: c[0], name: c[1], desc: c[2], comingSoon: true, icon: 'link' });
  });

  /* ================= 弹窗 / Toast ================= */

  var dialogStack = [];

  var dialog = EP.dialog = {
    open: function (opt) {
      var root = $('#modalRoot');
      var mask = mk('div', 'mask');
      var box = mk('div', 'dialog' + (opt.wide ? ' wide' : ''));
      var hd = mk('div', 'dialog-hd');
      hd.innerHTML = '<h3>' + esc(opt.title || '') + '</h3>';
      var closeBtn = mk('button', 'iconbtn');
      closeBtn.innerHTML = svg('close');
      closeBtn.style.marginLeft = 'auto';
      hd.appendChild(closeBtn);
      var bd = mk('div', 'dialog-bd');
      if (opt.body) bd.appendChild(opt.body);
      else bd.innerHTML = opt.html || '';
      box.appendChild(hd); box.appendChild(bd);

      var ft = mk('div', 'dialog-ft');
      var handle = {
        el: box, body: bd,
        close: function () {
          var i = dialogStack.indexOf(handle);
          if (i >= 0) dialogStack.splice(i, 1);
          if (mask.parentNode) mask.parentNode.removeChild(mask);
          if (opt.onClose) { try { opt.onClose(); } catch (e) { /* noop */ } }
        }
      };
      (opt.actions || []).forEach(function (a) {
        var b = mk('button', 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''));
        b.textContent = a.label;
        b.onclick = function () {
          if (!a.onClick || a.onClick(handle) !== false) handle.close();
        };
        ft.appendChild(b);
      });
      if (!opt.actions || !opt.actions.length) {
        var okb = mk('button', 'btn primary');
        okb.textContent = '关闭';
        okb.onclick = function () { handle.close(); };
        ft.appendChild(okb);
      }
      box.appendChild(ft);

      closeBtn.onclick = function () { handle.close(); };
      mask.onclick = function (e) { if (e.target === mask && opt.dismiss !== false) handle.close(); };

      mask.appendChild(box);
      root.appendChild(mask);
      dialogStack.push(handle);

      var first = bd.querySelector('input, textarea, select');
      if (first) { try { first.focus(); } catch (e) { /* noop */ } }
      return handle;
    },
    closeTop: function () {
      if (!dialogStack.length) return false;
      dialogStack[dialogStack.length - 1].close();
      return true;
    },
    confirm: function (msg, title) {
      return new window.Promise(function (resolve) {
        var d = dialog.open({
          title: title || '确认',
          html: '<p style="margin:0">' + esc(msg) + '</p>',
          actions: [
            { label: '取消', onClick: function () { resolve(false); } },
            { label: '确定', primary: true, onClick: function () { resolve(true); } }
          ],
          onClose: function () { resolve(false); }
        });
        d.closeConfirm = true;
      });
    },
    menu: function (title, items) {
      return new window.Promise(function (resolve) {
        var body = mk('div', '');
        items.forEach(function (it) {
          var b = mk('button', 'btn');
          b.style.display = 'block';
          b.style.width = '100%';
          b.style.marginBottom = '8px';
          b.style.textAlign = 'left';
          if (it.danger) b.className = 'btn danger';
          b.innerHTML = (it.icon ? svg(it.icon) + ' ' : '') + esc(it.label);
          b.onclick = function () { resolve(it.id); d.close(); };
          body.appendChild(b);
        });
        var d = dialog.open({ title: title, body: body, onClose: function () { resolve(null); } });
      });
    }
  };

  EP.toast = function (msg, type) {
    var root = $('#toastRoot');
    var t = mk('div', 'toast' + (type ? ' ' + type : ''));
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, type === 'err' ? 4200 : 2400);
  };

  /* ================= 表单渲染（schema 驱动） ================= */

  function showIfMatch(rule, values) {
    if (!rule) return true;
    for (var k in rule) {
      var want = rule[k];
      var got = values[k];
      var ok = Array.isArray(want) ? want.indexOf(got) >= 0 : (want === got);
      if (!ok) return false;
    }
    return true;
  }

  function buildForm(schema, values, container, onChange) {
    function render() {
      container.innerHTML = '';
      (schema || []).forEach(function (f) {
        if (f.showIf && !showIfMatch(f.showIf, values)) return;
        var wrap = mk('div', 'field');
        var skipAppend = false;
        var lab = mk('label', '');
        lab.textContent = f.label || f.key;
        wrap.appendChild(lab);

        var input;
        if (f.type === 'textarea') {
          input = mk('textarea', '');
          input.value = values[f.key] == null ? '' : values[f.key];   // 与其它类型一致，回填已有值
        } else if (f.type === 'select' || f.type === 'category') {
          input = mk('select', '');
          var opts = f.options || [];
          if (f.type === 'category') {
            opts = [{ value: 'all', label: '全部' }].concat(store.getCategories().map(function (c) {
              return { value: c.id, label: c.name };
            }));
          }
          opts.forEach(function (o) {
            var op = mk('option', '');
            op.value = o.value;
            op.textContent = o.label;
            if (String(values[f.key]) === String(o.value)) op.selected = true;
            input.appendChild(op);
          });
        } else if (f.type === 'switch') {
          var lb = mk('label', 'switch');
          input = mk('input', '');
          input.type = 'checkbox';
          input.checked = !!values[f.key];
          lb.appendChild(input);
          lb.appendChild(document.createTextNode(' ' + (f.hint || '')));
          wrap.appendChild(lb);
        } else if (f.type === 'range') {
          input = mk('input', '');
          input.type = 'range';
          if (f.min !== undefined) input.min = f.min;
          if (f.max !== undefined) input.max = f.max;
          input.step = f.step || 1;
          input.value = values[f.key] == null ? (f.default || f.min || 0) : values[f.key];
          var valLab = mk('span', 'hint');
          valLab.style.marginLeft = '8px';
          valLab.style.whiteSpace = 'nowrap';
          valLab.textContent = input.value + ' px';
          input.oninput = function () { valLab.textContent = input.value + ' px'; };
          var rrow = mk('div', 'row');
          rrow.appendChild(input);
          rrow.appendChild(valLab);
          wrap.appendChild(rrow);
          skipAppend = true;
        } else if (f.type === 'number') {
          input = mk('input', '');
          input.type = 'number';
          if (f.min !== undefined) input.min = f.min;
          if (f.max !== undefined) input.max = f.max;
          input.value = values[f.key] == null ? '' : values[f.key];
        } else {
          input = mk('input', '');
          input.type = (f.type === 'password') ? 'password' : 'text';
          if (f.placeholder) input.placeholder = f.placeholder;
          input.value = values[f.key] == null ? '' : values[f.key];
        }

        if (f.type !== 'switch' && !skipAppend) wrap.appendChild(input);

        if (f.type === 'switch') {
          input.onchange = function () { onChg(f, input.checked); };
        } else if (f.type === 'number') {
          input.onchange = function () { onChg(f, input.value === '' ? '' : Number(input.value)); };
        } else if (f.type === 'range') {
          input.onchange = function () { onChg(f, Number(input.value)); };
          if (f.live) {
            input.oninput = function () {
              valLab.textContent = input.value + ' px';
              onChg(f, Number(input.value));   // 实时预览
            };
          }
        } else {
          input.oninput = input.onchange = function () { onChg(f, input.value); };
        }

        input.onfocus = function () {
          setTimeout(function () {
            try { input.scrollIntoView({ block: 'center' }); } catch (e) { /* noop */ }
          }, 120);
        };

        if (f.hint && f.type !== 'switch') {
          var hp = mk('div', 'hint');
          hp.textContent = f.hint;
          wrap.appendChild(hp);
        }
        container.appendChild(wrap);
      });
    }

    function onChg(f, val) {
      values[f.key] = val;
      var needRebuild = (schema || []).some(function (o) {
        return o !== f && o.showIf && Object.prototype.hasOwnProperty.call(o.showIf, f.key);
      });
      if (needRebuild) render();
      if (onChange) onChange(f.key, val);
    }

    render();
  }
  EP.buildForm = buildForm;

  /* ================= 模块注册表 ================= */

  var modules = EP.modules = {
    _m: {},
    register: function (def) { this._m[def.id] = def; },
    get: function (id) { return this._m[id]; },
    list: function () {
      var a = [], k;
      for (k in this._m) if (!this._m[k].comingSoon) a.push(this._m[k]);
      return a;
    },
    all: function () {
      var a = [], k;
      for (k in this._m) a.push(this._m[k]);
      return a;
    }
  };

  function iconHtml(btn) {
    var ic = btn.icon || { type: 'none', value: '' };
    if (ic.type === 'svg' && ic.value) return '<span class="pbtn-icon">' + svg(ic.value) + '</span>';
    if (ic.type === 'emoji' && ic.value) return '<span class="pbtn-icon">' + esc(ic.value) + '</span>';
    if (ic.type === 'image' && ic.value) return '<span class="pbtn-icon"><img src="' + esc(ic.value) + '" style="width:22px;height:22px;object-fit:contain"></span>';
    return '';
  }

  /* ---------- 模块：快捷按钮 ---------- */
  modules.register({
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
          btn.style.background = b.color || '#3b82f6';
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
                if (act === 'edit') openButtonEditor(b, ctx);
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
            wrap.appendChild(more);
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

      // 挂载时卡片尚未插入文档，宽度量不到（会退回兜底值），插入后再排一次
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

  /* ---------- 模块：快速发送 ---------- */
  modules.register({
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

  /* ---------- 模块：动作返回值 ---------- */
  modules.register({
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

  /* ---------- 模块：执行日志 ---------- */
  modules.register({
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

  /* 预留模块 */
  [['deviceStatus', '通道状态', '显示各通道在线状态'],
   ['clipboardHistory', '剪贴板历史', '记录与回传剪贴板内容'],
   ['fileTransfer', '文件传输', '向远端发送文件'],
   ['webFrame', '嵌入网页', '在卡片里嵌入一个网页'],
   ['statusText', '信息展示', '展示一段文本或数值']].forEach(function (m) {
    modules.register({ id: m[0], name: m[1], desc: m[2], icon: 'grid', comingSoon: true });
  });

  /* ================= 通用动作 ================= */

  function copyText(text) {
    try {
      var ta = mk('textarea', '');
      ta.value = text;
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }

  function download(filename, text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = mk('a', '');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { EP.toast('导出失败', 'err'); }
  }

  /* ---------- 按钮编辑器 ---------- */
  function openButtonEditor(button, ctx) {
    var isNew = !button;
    var b = button ? JSON.parse(JSON.stringify(button)) : {
      id: uid('b'), name: '', categoryId: store.getCategories()[0].id,
      color: '#3b82f6', opacity: 100, icon: { type: 'none', value: '' }, bg: { type: 'none', url: '' },
      channel: channels.firstId() || 'quicker', params: { operation: 'copy', data: '', wait: false, maxWaitMs: 3000 },
      confirm: false
    };

    var body = mk('div', '');
    var basics = mk('div', '');
    var fields = mk('div', '');

    buildForm([
      { key: 'name', label: '名称', type: 'text', placeholder: '例如：锁屏' },
      { key: 'categoryId', label: '分类', type: 'category' },
      { key: 'color', label: '颜色', type: 'text' },
      { key: 'iconType', label: '图标类型', type: 'select', options: [
        { value: 'none', label: '无' }, { value: 'svg', label: '内置图标' },
        { value: 'emoji', label: 'Emoji' }, { value: 'image', label: '图片链接' } ] },
      { key: 'iconValue', label: '图标值', type: 'text', hint: '内置图标填名称（如 bolt），Emoji 直接输入，图片填 URL' },
      { key: 'confirm', label: '执行前二次确认', type: 'switch' }
    ], {
      name: b.name, categoryId: b.categoryId, color: b.color,
      iconType: b.icon.type, iconValue: b.icon.value, confirm: b.confirm
    }, basics, function (k, v) {
      if (k === 'name') b.name = v;
      else if (k === 'categoryId') b.categoryId = v;
      else if (k === 'color') b.color = v;
      else if (k === 'confirm') b.confirm = v;
      else if (k === 'iconType') { b.icon.type = v; b.icon.value = ''; buildBasics(); }
      else if (k === 'iconValue') b.icon.value = v;
    });

    function buildBasics() {
      buildForm([
        { key: 'name', label: '名称', type: 'text', placeholder: '例如：锁屏' },
        { key: 'categoryId', label: '分类', type: 'category' },
        { key: 'color', label: '颜色', type: 'text' },
        { key: 'iconType', label: '图标类型', type: 'select', options: [
          { value: 'none', label: '无' }, { value: 'svg', label: '内置图标' },
          { value: 'emoji', label: 'Emoji' }, { value: 'image', label: '图片链接' } ] },
        { key: 'iconValue', label: '图标值', type: 'text', hint: '内置图标填名称（如 bolt），Emoji 直接输入，图片填 URL' },
        { key: 'confirm', label: '执行前二次确认', type: 'switch' }
      ], {
        name: b.name, categoryId: b.categoryId, color: b.color,
        iconType: b.icon.type, iconValue: b.icon.value, confirm: b.confirm
      }, basics, function (k, v) {
        if (k === 'name') b.name = v;
        else if (k === 'categoryId') b.categoryId = v;
        else if (k === 'color') b.color = v;
        else if (k === 'confirm') b.confirm = v;
        else if (k === 'iconType') { b.icon.type = v; b.icon.value = ''; buildBasics(); }
        else if (k === 'iconValue') b.icon.value = v;
      });
    }

    var chSel = mk('select', '');
    channels.list().forEach(function (c) {
      var o = mk('option', '');
      o.value = c.id;
      o.textContent = c.name;
      if (c.id === b.channel) o.selected = true;
      chSel.appendChild(o);
    });

    function buildActionFields() {
      var ch = channels.get(b.channel);
      fields.innerHTML = '';
      if (!ch || !ch.actionSchema) return;
      var vals = merge({}, b.params);
      if (vals.operation === undefined) vals.operation = 'copy';
      buildForm(ch.actionSchema, vals, fields, function () {
        b.params = vals;
      });
      b.params = vals;
    }
    chSel.onchange = function () {
      b.channel = chSel.value;
      var ch = channels.get(b.channel);
      b.params = {};
      if (ch && ch.actionSchema) {
        ch.actionSchema.forEach(function (f) { if (f.default !== undefined) b.params[f.key] = f.default; });
      }
      buildActionFields();
    };

    body.appendChild(basics);
    var chWrap = mk('div', 'field');
    var chLab = mk('label', '');
    chLab.textContent = '执行方式（通道）';
    chWrap.appendChild(chLab);
    chWrap.appendChild(chSel);
    body.appendChild(chWrap);
    body.appendChild(fields);
    buildActionFields();

    var testBtn = mk('button', 'btn sm');
    testBtn.textContent = '试发一次';
    testBtn.style.marginTop = '4px';
    testBtn.onclick = function () {
      channels.run({ name: b.name || '试发', channel: b.channel, params: b.params }).then(function (res) {
        if (res.ok) EP.toast('试发成功', 'ok');
        else EP.toast('试发失败：' + (res.errorMessage || '未知错误'), 'err');
      });
    };
    body.appendChild(testBtn);

    dialog.open({
      title: isNew ? '添加按钮' : '编辑按钮',
      body: body,
      wide: true,
      actions: [
        { label: '取消' },
        {
          label: '保存', primary: true, onClick: function () {
            if (!b.name.trim()) { EP.toast('请填写名称', 'err'); return false; }
            b.name = b.name.trim();
            if (isNew) {
              b.order = store.getButtons().length;
              b.createdAt = Date.now();
              state.buttons.push(b);
            } else {
              for (var i = 0; i < state.buttons.length; i++) {
                if (state.buttons[i].id === b.id) { b.updatedAt = Date.now(); state.buttons[i] = b; break; }
              }
            }
            store.saveButtons();
            EP.toast('已保存', 'ok');
          }
        }
      ]
    });
  }

  /* ================= 外壳 ================= */

  var ui = EP.ui = {
    page: 'p_main',
    edit: false,
    maximized: null,
    kiosk: false,
    instances: {}      // cardId -> 模块实例（用于实时预览局部更新）
  };

  function cols() {
    var w = window.innerWidth;
    return w < 640 ? 4 : (w < 1024 ? 8 : 12);
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', store.get().theme || 'light');
  }

  function applyChrome() {
    var app = $('#app');
    var ch = store.get().chrome;
    app.setAttribute('data-topbar', ch.topBar);
    app.setAttribute('data-sidebar', ch.sidebar);
    var handle = $('#chromeHandle');
    handle.hidden = (ch.topBar !== 'never');
    handle.setAttribute('data-pos', ch.handlePos || 'br');
    $('#kioskExit').hidden = !ui.kiosk;
  }

  function renderAppbar() {
    var cfg = store.get();
    $('#brand').textContent = cfg.panelName || 'E 面板';
    $('#btnMenu').innerHTML = svg('menu');
    $('#btnTheme').innerHTML = svg(cfg.theme === 'dark' ? 'sun' : 'moon');
    $('#btnEdit').innerHTML = svg('layout');
    $('#btnMore').innerHTML = svg('more');
    $('#btnEdit').className = 'iconbtn' + (ui.edit ? ' active' : '');
    $('#app').className = $('#app').className.replace(/\s*editing/g, '');
    if (ui.edit) $('#app').className += ' editing';
  }

  function renderNav() {
    var pages = store.getPages();
    var sb = $('#sidebar');
    var tb = $('#tabbar');
    sb.innerHTML = '';
    tb.innerHTML = '';
    pages.forEach(function (p) {
      var a = mk('div', 'navitem' + (ui.page === p.id ? ' active' : ''));
      a.innerHTML = svg(p.icon || 'grid') + '<span>' + esc(p.name) + '</span>';
      a.onclick = function () { openPage(p.id); };
      sb.appendChild(a);

      var t = mk('button', 'tab' + (ui.page === p.id ? ' active' : ''));
      t.innerHTML = svg(p.icon || 'grid') + '<span>' + esc(p.name) + '</span>';
      t.onclick = function () { openPage(p.id); };
      tb.appendChild(t);
    });
  }

  function openPage(id) {
    ui.page = id;
    renderNav();
    renderPage();
  }
  EP.ui.openPage = openPage;

  function cardSpan(card) {
    var w = Math.max(1, Math.min(card.layout.w || 4, cols()));
    if (cols() === 4 && w >= 3) w = 4;
    return w;
  }

  function renderPage() {
    unmountAll();
    var host = $('#page');
    host.innerHTML = '';
    var page = store.findPage(ui.page);
    if (!page) { host.innerHTML = '<div class="empty">页面不存在</div>'; return; }

    if (page.type === 'custom') {
      if (page.id === 'p_settings') renderSettings(host);
      else host.innerHTML = '<div class="empty">该页面尚未实现</div>';
      return;
    }

    var grid = mk('div', 'grid');
    host.appendChild(grid);          // 先入 DOM，模块挂载时才量得到真实宽度（否则会闪一下错误尺寸）
    var cards = store.getCards(page.id);
    cards.forEach(function (card) { renderCard(card, grid); });

    if (ui.edit) {
      var add = mk('button', 'addcard');
      add.style.gridColumn = 'span ' + cols();
      add.innerHTML = svg('plus') + ' 添加卡片';
      add.onclick = openAddCard;
      grid.appendChild(add);
    }
    if (!cards.length) {
      var em = mk('div', 'empty');
      em.style.gridColumn = 'span ' + cols();
      em.innerHTML = '<div>这个页面还没有卡片</div><div style="margin-top:6px">打开右上角「布局」添加</div>';
      grid.appendChild(em);
    }
    host.appendChild(grid);
  }

  function renderCard(card, grid) {
    var mod = modules.get(card.moduleId);
    var wrap = mk('div', 'card' + (card.collapsed ? ' collapsed' : ''));
    wrap.setAttribute('data-id', card.id);
    wrap.setAttribute('data-hmode', (card.layout.hMode || 'auto'));
    wrap.style.gridColumn = 'span ' + cardSpan(card);
    if (card.layout.hMode === 'fixed' && card.layout.h > 0) {
      var body = null;
      wrap.style.height = (card.layout.h + 40) + 'px';
    }
    if (ui.maximized === card.id) wrap.className += ' maximized';
    grid.appendChild(wrap);     // 先入 DOM 再挂载模块，否则量不到宽度会闪一下错误尺寸

    var hd = mk('div', 'card-hd');
    hd.innerHTML = svg(mod ? (mod.icon || 'grid') : 'grid');
    var title = mk('span', 'card-title');
    title.textContent = card.title || (mod ? mod.name : card.moduleId);
    hd.appendChild(title);

    var acts = mk('div', 'card-actions');

    // 拖动：常驻，不依赖编辑模式。拖动层只做视觉提示（pointer-events:none），
    // 事件挂在标题栏上，命中按钮时不启动拖拽
    var grip = mk('div', 'grip');
    grip.title = '拖动排序';
    wrap.appendChild(grip);

    hd.addEventListener('pointerdown', function (e) {
      var n = e.target;
      while (n && n !== hd) {
        if (n.tagName === 'BUTTON') return;
        n = n.parentNode;
      }
      startDrag(e, wrap, grid);
    });

    if (ui.edit) {
      [['-', function () { resizeW(card, -1); }], ['+', function () { resizeW(card, 1); }]]
        .forEach(function (p) {
          var b = mk('button', 'iconbtn');
          b.textContent = p[0];
          b.style.width = '22px';
          b.style.height = '22px';
          b.title = '宽度';
          b.onclick = p[1];
          acts.appendChild(b);
        });

      var sizeBtn = mk('button', 'iconbtn');
      sizeBtn.innerHTML = svg('grid');
      sizeBtn.title = '尺寸与更多';
      sizeBtn.onclick = function () {
        dialog.menu(card.title || '卡片', [
          { id: 'w3', label: '宽度：1/3', icon: 'grid' },
          { id: 'w2', label: '宽度：1/2', icon: 'grid' },
          { id: 'w23', label: '宽度：2/3', icon: 'grid' },
          { id: 'w1', label: '宽度：整行', icon: 'grid' },
          { id: 'hauto', label: '高度：自适应', icon: 'grid' },
          { id: 'hfix', label: '高度：固定并加高 80px', icon: 'grid' },
          { id: 'collapse', label: card.collapsed ? '展开' : '折叠', icon: 'grid' },
          { id: 'setting', label: '卡片设置', icon: 'cog' },
          { id: 'remove', label: '移除卡片', icon: 'trash', danger: true }
        ]).then(function (act) {
          if (!act) return;
          var c = cols();
          if (act === 'w3') { card.layout.w = Math.max(1, Math.round(c / 3)); store.saveCards(); renderPage(); }
          else if (act === 'w2') { card.layout.w = Math.max(1, Math.round(c / 2)); store.saveCards(); renderPage(); }
          else if (act === 'w23') { card.layout.w = Math.max(1, Math.round(c * 2 / 3)); store.saveCards(); renderPage(); }
          else if (act === 'w1') { card.layout.w = c; store.saveCards(); renderPage(); }
          else if (act === 'hauto') { card.layout.hMode = 'auto'; card.layout.h = 0; store.saveCards(); renderPage(); }
          else if (act === 'hfix') {
            card.layout.hMode = 'fixed';
            card.layout.h = (card.layout.h || 120) + 80;
            store.saveCards(); renderPage();
          } else if (act === 'collapse') { card.collapsed = !card.collapsed; store.saveCards(); renderPage(); }
          else if (act === 'setting') openCardSettings(card);
          else if (act === 'remove') {
            dialog.confirm('移除卡片「' + (card.title || '') + '」？').then(function (ok) {
              if (!ok) return;
              state.cards = state.cards.filter(function (x) { return x.id !== card.id; });
              store.saveCards();
              renderPage();
            });
          }
        });
      };
      acts.appendChild(sizeBtn);
    }

    // 缩放：常驻，不依赖编辑模式（仅视觉上平时半透明、hover 时显现）
    var rz = mk('div', 'resize');
    rz.innerHTML = svg('resize');
    rz.title = '拖动调整尺寸';
    rz.addEventListener('pointerdown', function (e) { startResize(e, card, wrap, grid); });
    wrap.appendChild(rz);

    hd.appendChild(acts);

    // 最大化 / 还原：常显，不依赖 hover（触屏没有 hover）
    var isMax = (ui.maximized === card.id);
    var maxBtn = mk('button', 'iconbtn');
    maxBtn.innerHTML = svg(isMax ? 'close' : 'grid');
    maxBtn.title = isMax ? '还原' : '最大化';
    maxBtn.onclick = function () {
      ui.maximized = isMax ? null : card.id;
      renderPage();
    };
    hd.appendChild(maxBtn);

    wrap.appendChild(hd);

    var bodyEl = mk('div', 'card-body');
    wrap.appendChild(bodyEl);

    if (mod && !card.collapsed) {
      var ctx = {
        card: card,
        settings: merge(mod.defaultSettings || {}, card.settings || {}),
        edit: ui.edit,
        save: function (patch) {
          card.settings = merge(card.settings || {}, patch);
          store.saveCards();
          renderPage();
        },
        store: store,
        toast: EP.toast,
        dialog: dialog,
        openPage: openPage,
        setTitle: function (t) { card.title = t; store.saveCards(); renderPage(); },
        size: { w: card.layout.w, hMode: card.layout.hMode, h: card.layout.h }
      };
      try {
        var inst = mod.mount(bodyEl, ctx);
        if (inst) ui.instances[card.id] = inst;
      } catch (e) {
        bodyEl.innerHTML = '<div class="empty">模块加载失败：' + esc(e.message) + '</div>';
      }
    }
    return wrap;
  }

  function unmountAll() {
    for (var k in ui.instances) {
      var m = ui.instances[k];
      if (m && m.destroy) { try { m.destroy(); } catch (e) { /* noop */ } }
    }
    ui.instances = {};
  }

  // 局部更新：只让对应模块重排，不整页重渲染（实时预览用）
  function liveUpdate(cardId, patch) {
    var card = store.findCard(cardId);
    if (!card) return;
    card.settings = merge(card.settings || {}, patch);
    var inst = ui.instances[cardId];
    if (inst && inst.update) {
      try { inst.update(card.settings); } catch (e) { /* noop */ }
    }
  }

  function resizeW(card, d) {
    card.layout.w = Math.max(1, Math.min(cols(), (card.layout.w || 4) + d));
    store.saveCards();
    renderPage();
  }

  function closestCard(node) {
    while (node && node !== document) {
      if (node.classList && node.classList.contains('card')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function startDrag(e, el, grid) {
    // 拖动现在常驻，必须等位移超过阈值才真正启动，否则会抢走点击与页面滚动
    var sx = e.clientX, sy = e.clientY;
    var engaged = false;
    var move = function (ev) {
      if (!engaged) {
        if (Math.abs(ev.clientX - sx) < 6 && Math.abs(ev.clientY - sy) < 6) return;
        engaged = true;
        el.classList.add('dragging');
      }
      ev.preventDefault();
      var t = document.elementFromPoint(ev.clientX, ev.clientY);
      var c = closestCard(t);
      if (c && c !== el) {
        var r = c.getBoundingClientRect();
        var after = ev.clientY > r.top + r.height / 2;
        grid.insertBefore(el, after ? c.nextSibling : c);
      }
    };
    var cleanup = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    var up = function () {
      cleanup();
      if (!engaged) return;
      el.classList.remove('dragging');
      var ids = $$('.card[data-id]', grid).map(function (n) { return n.getAttribute('data-id'); });
      ids.forEach(function (id, i) {
        var c = store.findCard(id);
        if (c) c.order = i;
      });
      store.saveCards();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startResize(e, card, el, grid) {
    e.preventDefault();
    e.stopPropagation();
    var startX = e.clientX, startY = e.clientY;
    var startW = card.layout.w || 4;
    var startH = card.layout.h || 120;
    var gw = grid.clientWidth || 800;
    var cw = gw / cols();
    var move = function (ev) {
      var dx = ev.clientX - startX;
      var dw = Math.round(dx / cw);
      var nw = Math.max(1, Math.min(cols(), startW + dw));
      if (nw !== card.layout.w) {
        card.layout.w = nw;
        el.style.gridColumn = 'span ' + cardSpan(card);
      }
      var dy = ev.clientY - startY;
      if (card.layout.hMode === 'fixed' || Math.abs(dy) > 12) {
        card.layout.hMode = 'fixed';
        var nh = Math.max(60, startH + dy);
        card.layout.h = nh;
        el.setAttribute('data-hmode', 'fixed');
        el.style.height = (nh + 40) + 'px';
      }
    };
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.saveCards();
      renderPage();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
  }

  function openCardSettings(card) {
    var mod = modules.get(card.moduleId);
    var body = mk('div', '');
    if (!mod || !mod.settingsSchema || !mod.settingsSchema.length) {
      body.innerHTML = '<div class="empty">该模块没有可配置项</div>';
    } else {
      var orig = JSON.parse(JSON.stringify(card.settings || {}));
      var vals = merge(mod.defaultSettings || {}, card.settings || {});
      // 滑块拖动时即时预览（只重排本卡片，不动其它模块），取消则回滚
      buildForm(mod.settingsSchema, vals, body, function (k, v) {
        if (k === 'size') liveUpdate(card.id, { size: v });
      });
    }
    dialog.open({
      title: (card.title || '卡片') + ' 设置',
      body: body,
      actions: [
        {
          label: '取消', onClick: function () {
            card.settings = orig;
            liveUpdate(card.id, {});
          }
        },
        {
          label: '保存', primary: true, onClick: function () {
            card.settings = vals;
            store.saveCards();
            renderPage();
          }
        }
      ]
    });
  }

  function openAddCard() {
    var body = mk('div', '');
    modules.all().forEach(function (m) {
      var b = mk('button', 'btn');
      b.style.display = 'block';
      b.style.width = '100%';
      b.style.marginBottom = '8px';
      b.style.textAlign = 'left';
      b.innerHTML = svg(m.icon || 'grid') + ' <b>' + esc(m.name) + '</b>' +
        '<div class="hint" style="margin:0">' + esc(m.desc || '') + '</div>';
      if (m.comingSoon) { b.disabled = true; b.style.opacity = '.5'; }
      b.onclick = function () {
        var card = {
          id: uid('c'), pageId: ui.page, moduleId: m.id, title: m.name,
          settings: merge({}, m.defaultSettings || {}),
          layout: { w: m.layout ? (m.layout.w || 4) : 4, hMode: 'auto', h: 0 },
          collapsed: false, order: store.getCards(ui.page).length
        };
        state.cards.push(card);
        store.saveCards();
        d.close();
        renderPage();
      };
      body.appendChild(b);
    });
    var d = dialog.open({ title: '添加卡片', body: body });
  }

  /* ---------- 设置页 ---------- */
  function renderSettings(host) {
    var cfg = store.get();
    var wrap = mk('div', 'settings');

    /* 通用 */
    var s1 = mk('div', 'section');
    s1.innerHTML = '<h4>通用</h4>';
    var f1 = mk('div', '');
    var v1 = { panelName: cfg.panelName, timeoutMs: cfg.timeoutMs };
    buildForm([
      { key: 'panelName', label: '面板名称', type: 'text' },
      { key: 'timeoutMs', label: '请求超时（毫秒）', type: 'number', min: 1000, max: 60000 }
    ], v1, f1, function () {
      cfg.panelName = v1.panelName || 'E 面板';
      cfg.timeoutMs = Number(v1.timeoutMs) || 8000;
      store.saveConfig();
      renderAppbar();
    });
    s1.appendChild(f1);
    var addBtn = mk('button', 'btn primary');
    addBtn.innerHTML = svg('plus') + ' 添加按钮';
    addBtn.onclick = function () { openButtonEditor(null, null); };
    s1.appendChild(addBtn);
    wrap.appendChild(s1);

    /* 通道 */
    var s2 = mk('div', 'section');
    s2.innerHTML = '<h4>通道</h4>';
    channels.list().forEach(function (ch) {
      var blk = mk('div', 'channel-block');
      var h5 = mk('div', 'row');
      h5.innerHTML = '<b>' + esc(ch.name) + '</b>';
      var st = mk('span', 'hint');
      st.style.marginLeft = 'auto';
      h5.appendChild(st);
      blk.appendChild(h5);
      if (ch.desc) {
        var dp = mk('div', 'hint');
        dp.textContent = ch.desc;
        blk.appendChild(dp);
      }
      var vals = merge({}, store.channelSettings(ch.id));
      var form = mk('div', '');
      if (ch.settingsSchema) {
        buildForm(ch.settingsSchema, vals, form, function () { store.saveChannel(ch.id, vals); });
      }
      blk.appendChild(form);
      if (ch.test) {
        var tb = mk('button', 'btn sm');
        tb.textContent = '连接测试';
        tb.onclick = function () {
          st.textContent = '测试中…';
          ch.test(vals).then(function (r) {
            if (r.ok) {
              st.textContent = '已连接' + (r.devices && r.devices.length ? '（' + r.devices.length + ' 台设备）' : '');
              EP.toast('连接成功', 'ok');
              setStatus('on', '已连接');
            } else {
              st.textContent = '失败：' + (r.errorMessage || '未知错误');
              EP.toast('连接失败：' + (r.errorMessage || ''), 'err');
              setStatus('off', '未连接');
            }
          });
        };
        blk.appendChild(tb);
      }
      s2.appendChild(blk);
    });
    var soon = channels.all().filter(function (c) { return c.comingSoon; });
    if (soon.length) {
      var sp = mk('div', 'hint');
      sp.style.marginTop = '10px';
      sp.textContent = '预留通道（未实现）：' + soon.map(function (c) { return c.name; }).join('、');
      s2.appendChild(sp);
    }
    wrap.appendChild(s2);

    /* 外观 */
    var s3 = mk('div', 'section');
    s3.innerHTML = '<h4>外观</h4>';
    var f3 = mk('div', '');
    var v3 = {
      theme: cfg.theme,
      topBar: cfg.chrome.topBar,
      sidebar: cfg.chrome.sidebar,
      hideCardTitles: cfg.display.hideCardTitles,
      keepAwake: cfg.display.keepAwake
    };
    buildForm([
      { key: 'theme', label: '主题', type: 'select', options: [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }] },
      { key: 'topBar', label: '顶栏', type: 'select', options: [
        { value: 'always', label: '常驻' }, { value: 'auto', label: '滚动时自动隐藏' }, { value: 'never', label: '完全隐藏' } ] },
      { key: 'sidebar', label: '侧栏', type: 'select', options: [
        { value: 'always', label: '常驻' }, { value: 'auto', label: '悬停展开' }, { value: 'rail', label: '折叠为图标条' }, { value: 'never', label: '完全隐藏' } ] },
      { key: 'hideCardTitles', label: '展示模式隐藏卡片标题', type: 'switch' },
      { key: 'keepAwake', label: '展示模式保持屏幕常亮', type: 'switch' }
    ], v3, f3, function () {
      cfg.theme = v3.theme;
      cfg.chrome.topBar = v3.topBar;
      cfg.chrome.sidebar = v3.sidebar;
      cfg.display.hideCardTitles = !!v3.hideCardTitles;
      cfg.display.keepAwake = !!v3.keepAwake;
      store.saveConfig();
      applyTheme();
      applyChrome();
    });
    s3.appendChild(f3);
    var kioskBtn = mk('button', 'btn');
    kioskBtn.textContent = ui.kiosk ? '退出展示模式' : '进入展示模式';
    kioskBtn.onclick = function () { if (ui.kiosk) exitKiosk(); else enterKiosk(); };
    s3.appendChild(kioskBtn);
    wrap.appendChild(s3);

    /* 数据 */
    var s4 = mk('div', 'section');
    s4.innerHTML = '<h4>数据</h4>';
    var row = mk('div', 'row');
    var exp = mk('button', 'btn');
    exp.textContent = '导出配置';
    exp.onclick = function () {
      download('epanel-config-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(store.exportAll(), null, 2));
    };
    var imp = mk('button', 'btn');
    imp.textContent = '导入配置';
    imp.onclick = function () {
      var inp = mk('input', '');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            store.importAll(JSON.parse(fr.result));
            applyTheme(); applyChrome(); renderAll();
            EP.toast('导入成功', 'ok');
          } catch (e) { EP.toast('导入失败：' + e.message, 'err'); }
        };
        fr.readAsText(f);
      };
      inp.click();
    };
    var cls = mk('button', 'btn danger');
    cls.textContent = '清空所有按钮';
    cls.onclick = function () {
      dialog.confirm('清空全部按钮？此操作不可恢复。').then(function (ok) {
        if (!ok) return;
        state.buttons = [];
        store.saveButtons();
        renderPage();
      });
    };
    row.appendChild(exp); row.appendChild(imp); row.appendChild(cls);
    s4.appendChild(row);
    var info = mk('div', 'hint');
    info.style.marginTop = '10px';
    info.innerHTML = '版本 ' + EP.version +
      ' · 存储' + (store.isPersistent() ? '正常' : '<b style="color:var(--err)">不可用（改动不会被保存，请及时导出）</b>') +
      ' · 按钮 ' + state.buttons.length + ' 个 · 通道 ' + channels.list().length + ' 个';
    s4.appendChild(info);
    wrap.appendChild(s4);

    host.appendChild(wrap);
  }

  /* ---------- 顶栏菜单 ---------- */
  function openMoreMenu() {
    dialog.menu('更多', [
      { id: 'add', label: '添加按钮', icon: 'plus' },
      { id: 'edit', label: ui.edit ? '完成布局编辑' : '编辑布局', icon: 'layout' },
      { id: 'kiosk', label: ui.kiosk ? '退出展示模式' : '进入展示模式', icon: 'grid' },
      { id: 'settings', label: '设置', icon: 'cog' }
    ]).then(function (a) {
      if (a === 'add') openButtonEditor(null, null);
      else if (a === 'edit') { ui.edit = !ui.edit; renderAll(); }
      else if (a === 'kiosk') { if (ui.kiosk) exitKiosk(); else enterKiosk(); }
      else if (a === 'settings') openPage('p_settings');
    });
  }

  function setStatus(cls, text) {
    var s = $('#status');
    s.className = 'status ' + cls;
    $('#statusText').textContent = text;
  }

  /* ---------- 展示模式 ---------- */
  var wakeLock = null;
  function requestWake() {
    if (!store.get().display.keepAwake) return;
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; })['catch'](function () { });
        return;
      }
    } catch (e) { /* noop */ }
    try {
      if (window.plus && plus.device && plus.device.setWakelock) plus.device.setWakelock(true);
    } catch (e) { /* noop */ }
  }
  function releaseWake() {
    try { if (wakeLock && wakeLock.release) wakeLock.release(); } catch (e) { /* noop */ }
    wakeLock = null;
    try { if (window.plus && plus.device && plus.device.setWakelock) plus.device.setWakelock(false); } catch (e) { /* noop */ }
  }

  function enterKiosk() {
    ui.kiosk = true;
    ui.edit = false;
    $('#app').className += ' kiosk';
    if (store.get().display.hideCardTitles) $('#app').className += ' hide-titles';
    $('#kioskExit').hidden = false;
    $('#chromeHandle').hidden = true;
    requestWake();
    renderAll();
    EP.toast('已进入展示模式，长按右上角退出');
  }
  function exitKiosk() {
    ui.kiosk = false;
    $('#app').className = $('#app').className.replace(/\s*kiosk/g, '').replace(/\s*hide-titles/g, '');
    $('#kioskExit').hidden = true;
    releaseWake();
    applyChrome();
    renderAll();
  }

  function bindKioskExit() {
    var zone = $('#kioskExit');
    var timer = null, taps = 0, tapTimer = null;
    zone.addEventListener('pointerdown', function () {
      timer = setTimeout(function () {
        timer = null;
        dialog.confirm('退出展示模式？').then(function (ok) { if (ok) exitKiosk(); });
      }, 1500);
    });
    zone.addEventListener('pointerup', function () { if (timer) { clearTimeout(timer); timer = null; } });
    zone.addEventListener('click', function () {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { taps = 0; }, 1500);
      if (taps >= 3) { taps = 0; exitKiosk(); }
    });
  }

  /* ---------- 滚动自动隐藏 ---------- */
  function bindAutoHide() {
    var main = $('#main');
    var last = 0;
    main.addEventListener('scroll', function () {
      var mode = store.get().chrome.topBar;
      if (mode !== 'auto') return;
      var y = main.scrollTop;
      var d = y - last;
      if (Math.abs(d) < 8) return;
      last = y;
      var app = $('#app');
      if (d > 0 && y > 60) app.className += ' chrome-hidden';
      else app.className = app.className.replace(/\s*chrome-hidden/g, '');
      $('#chromeHandle').hidden = !app.className.match(/chrome-hidden/);
    }, { passive: true });
  }

  /* ---------- 键盘 ---------- */
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (ui.kiosk) { exitKiosk(); return; }
        if (dialog.closeTop()) return;
        if (ui.maximized) { ui.maximized = null; renderPage(); }
        return;
      }
      if (e.altKey && (e.key === 'b' || e.key === 'B')) {
        var c = store.get().chrome;
        c.sidebar = (c.sidebar === 'always') ? 'rail' : 'always';
        store.saveConfig(); applyChrome(); e.preventDefault();
      }
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        var c2 = store.get().chrome;
        var order = ['always', 'auto', 'never'];
        c2.topBar = order[(order.indexOf(c2.topBar) + 1) % 3];
        store.saveConfig(); applyChrome(); e.preventDefault();
      }
      if (e.altKey && (e.key === 'k' || e.key === 'K')) {
        if (ui.kiosk) exitKiosk(); else enterKiosk();
        e.preventDefault();
      }
    });
  }

  /* ---------- 返回键（APK） ---------- */
  function onBack() {
    if (ui.kiosk) { exitKiosk(); return true; }
    if (dialog.closeTop()) return true;
    if (ui.edit) { ui.edit = false; renderAll(); return true; }
    if (ui.page !== 'p_main') { openPage('p_main'); return true; }
    return false;
  }
  function bindBack() {
    document.addEventListener('backbutton', function () { if (!onBack() && window.plus) { /* 交给系统 */ } });
    if (window.plus && plus.key) {
      try { plus.key.addEventListener('backbutton', function () { onBack(); }); } catch (e) { /* noop */ }
    }
  }

  /* ---------- 初始化 ---------- */
  function renderAll() {
    renderAppbar();
    renderNav();
    renderPage();
  }

  function init() {
    load();
    applyTheme();
    applyChrome();

    $('#btnTheme').onclick = function () {
      var cfg = store.get();
      cfg.theme = (cfg.theme === 'dark') ? 'light' : 'dark';
      store.saveConfig();
      applyTheme();
      renderAppbar();
    };
    $('#btnEdit').onclick = function () { ui.edit = !ui.edit; renderAll(); };
    $('#btnMore').onclick = openMoreMenu;
    $('#btnMenu').onclick = function () {
      var c = store.get().chrome;
      c.sidebar = (c.sidebar === 'always') ? 'rail' : 'always';
      store.saveConfig();
      applyChrome();
    };
    $('#chromeHandle').onclick = function () {
      var c = store.get().chrome;
      $('#app').className = $('#app').className.replace(/\s*chrome-hidden/g, '');
      if (c.topBar === 'never') { c.topBar = 'always'; store.saveConfig(); }
      applyChrome();
    };

    bindAutoHide();
    bindKeys();
    bindBack();
    bindKioskExit();

    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { renderPage(); }, 200);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) releaseWake();
      else if (ui.kiosk) requestWake();
    });

    bus.on('result', function (r) { EP.lastResult = r; });

    if (!store.isPersistent()) {
      EP.toast('当前环境无法保存数据，请及时导出配置', 'err');
    }
    try {
      if (window.self !== window.top) {
        EP.toast('页面嵌在预览面板中，外部请求会被内容安全策略拦截；请用浏览器直接打开 index.html', 'err');
      }
    } catch (e) { /* noop */ }

    var qs = (location.search || '').replace(/^\?/, '');
    if (/(^|&)kiosk=1(&|$)/.test(qs)) setTimeout(enterKiosk, 60);

    renderAll();

    // 启动时若已配置 quicker 凭证，后台探测一次并更新顶栏状态
    var qch = channels.get('quicker');
    var qcfg = store.channelSettings('quicker');
    if (qch && qch.test && qcfg.toUser && qcfg.code) {
      setStatus('busy', '检测中');
      qch.test(qcfg).then(function (r) {
        if (r && r.ok) {
          setStatus('on', '已连接' + ((r.devices && r.devices.length) ? ' · ' + r.devices.length + ' 台' : ''));
        } else {
          setStatus('off', '未连接');
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
