/* EPanel 模块：音乐播放器
 * ------------------------------------------------------------
 * 场景：局域网里有台设备用 HTTP 静态服务共享了音乐文件夹。
 *   扫描目录 → 播放 → 读取音频文件内嵌的歌词并同步滚动高亮。
 *
 * 服务端只要满足两点就能用：
 *   1. 目录可列出（nginx autoindex / apache / python -m http.server 默认都可以）
 *   2. 响应带 Access-Control-Allow-Origin: *（否则浏览器读不到目录与元数据）
 *   最好再带上 Range 支持（拖动进度条 / 精准预读歌词）。仓库里的
 *   tools/music_server.py 三样都满足，推荐直接用它。
 *
 * 依赖同目录的 musicMeta.js（内嵌歌词解析）。
 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  var U = EP.util;
  var mk = U.mk, esc = U.esc;
  var svg = EP.icon;

  /* ================= 模块自带图标 ================= */
  var PATHS = {
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    play: 'M7 4l13 8-13 8z',
    pause: 'M9 5v14M15 5v14',
    prev: 'M19 5v14l-11-7zM5 5v14',
    next: 'M5 5v14l11-7zM19 5v14',
    shuffle: 'M16 3h5v5M21 3l-7.5 7.5M16 21h5v-5M21 21l-7.5-7.5M3 7h3.5L10 10.5M3 17h3.5L10 13.5',
    repeat: 'M17 2l4 4-4 4M21 6H7a4 4 0 0 0-4 4v2M7 22l-4-4 4-4M3 18h14a4 4 0 0 0 4-4v-2',
    repeatOne: 'M17 2l4 4-4 4M21 6H7a4 4 0 0 0-4 4v2M7 22l-4-4 4-4M3 18h14a4 4 0 0 0 4-4v-2M11.2 10.6l1.3-.9V15',
    vol: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
    mute: 'M11 5L6 9H2v6h4l5 4zM16 10l5 5M21 10l-5 5',
    refresh: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5'
  };
  if (svg && svg.register) svg.register('music', PATHS.music);

  function ic(name, fill) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="' + (PATHS[name] || '') + '"/></svg>';
  }

  /* ================= 模块自带样式 ================= */
  var CSS_ID = 'ep-mod-musicplayer';
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      // 歌词区在卡片上方、高度自适应填满：靠 flex 撑，所以卡片 body 要是可伸缩的列
      '.card-body.mp-fill{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column;}',
      '.mp-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px;}',
      '.mp-now{display:flex;gap:12px;align-items:center;flex:none;}',
      '.mp-cover{width:60px;height:60px;flex:none;border-radius:10px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;background-size:cover;background-position:center;color:var(--text-faint);box-shadow:0 2px 10px rgba(0,0,0,.10);}',
      '.mp-cover svg{width:26px;height:26px;}',
      '.mp-meta{min-width:0;flex:1;}',
      '.mp-title{font-size:15px;font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.mp-sub{font-size:13px;color:var(--text-dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.mp-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;}',
      '.mp-tags .badge{font-size:11px;padding:1px 7px;}',
      '.mp-bar{display:flex;align-items:center;gap:9px;flex:none;}',
      '.mp-t{font-size:12px;color:var(--text-faint);font-variant-numeric:tabular-nums;flex:none;min-width:36px;}',
      '.mp-t2{text-align:right;}',
      '.mp-ctrl{display:flex;align-items:center;gap:2px;flex:none;}',
      '.mp-ctrl .spacer{flex:1;}',
      '.mp-btn{width:34px;height:34px;border-radius:50%;}',
      '.mp-btn svg{width:18px;height:18px;}',
      '.mp-btn.on{color:var(--accent);background:var(--accent-soft);}',
      '.mp-play{width:42px;height:42px;background:var(--accent-grad);color:#fff;box-shadow:0 3px 10px var(--accent-soft);}',
      '.mp-play:hover{background:var(--accent-grad);color:#fff;filter:brightness(1.05);}',
      '.mp-play svg{width:20px;height:20px;}',
      'input.mp-seek,input.mp-vol{height:24px;}',
      'input.mp-vol{width:88px;flex:none;}',
      'input.mp-seek::-webkit-slider-thumb,input.mp-vol::-webkit-slider-thumb{width:14px;height:14px;margin-top:-5px;}',
      'input.mp-seek::-webkit-slider-runnable-track,input.mp-vol::-webkit-slider-runnable-track{height:4px;}',
      'input.mp-vol::-moz-range-thumb{width:14px;height:14px;}',
      '.mp-tabs{margin-bottom:0;flex:none;}',
      '.mp-count{margin-left:auto;font-size:12px;}',
      // 主区域：flex 撑满剩余高度；横向裁掉（当前句放大后会产生横向溢出，别让它长滚动条）
      '.mp-panel{flex:1 1 auto;min-height:64px;overflow-x:hidden;overflow-y:auto;position:relative;',
        'border-radius:10px;background:var(--surface-2);padding:8px 14px;overscroll-behavior:contain;}',
      '.mp-item{display:flex;gap:9px;align-items:baseline;padding:8px 0;border-top:.5px solid var(--border);cursor:pointer;font-size:13px;}',
      '.mp-item:first-child{border-top:none;}',
      '.mp-item:hover{color:var(--accent);}',
      '.mp-item .i{color:var(--text-faint);flex:none;min-width:22px;font-variant-numeric:tabular-nums;font-size:12px;}',
      '.mp-item .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.mp-item .a{color:var(--text-faint);flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;}',
      '.mp-item.cur{color:var(--accent);font-weight:600;}',
      '.mp-item.cur .i::before{content:"▶";font-size:10px;}',
      '.mp-item.cur .i{font-size:0;}',
      '.mp-item.bad .n{text-decoration:line-through;color:var(--text-faint);}',
      '.mp-ly{font-size:16px;color:var(--text-faint);text-align:center;}',
      '.mp-ly p{margin:0;padding:3px 4px;line-height:1.75;transform-origin:center center;opacity:.62;',
        'transition:color .3s,opacity .3s,transform .45s cubic-bezier(.22,.61,.36,1);}',
      '.mp-ly p.on{color:var(--accent);font-weight:600;opacity:1;transform:scale(1.12);',
        'animation:mpLineIn .5s cubic-bezier(.22,.61,.36,1);}',
      '@keyframes mpLineIn{from{opacity:.3;transform:translateY(10px) scale(.93);}to{opacity:1;transform:translateY(0) scale(1.12);}}',
      '.mp-ly.synced p{cursor:pointer;}',
      '.mp-ly.plain{white-space:pre-wrap;text-align:center;color:var(--text-dim);line-height:1.9;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ================= 小工具 ================= */

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60), x = Math.floor(s % 60);
    return m + ':' + (x < 10 ? '0' : '') + x;
  }

  function normBase(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    if (u.charAt(u.length - 1) !== '/') u += '/';
    return u;
  }

  /* 一个卡片可以填多个候选地址（空格 / 逗号 / 分号 / 换行分隔）。
   * 电脑常有多张网卡（有线 + 无线 + 虚拟机网卡），服务端会打印好几个地址，
   * 面板自己一个个试，哪个通用哪个，不用人去猜。 */
  function splitBases(v) {
    var out = [], seen = {};
    String(v || '').split(/[\s,;，、]+/).forEach(function (s) {
      var b = normBase(s);
      if (b && !seen[b]) { seen[b] = 1; out.push(b); }
    });
    return out;
  }

  /* 把失败翻译成人话 —— 不同原因要检查的东西完全不一样。
   * 浏览器出于安全不给 JS 区分「连接被拒」和「被跨域挡」，所以按耗时判断：
   *   · 等到超时才失败 = 地址根本不通（IP/端口错、防火墙、AP 隔离）
   *   · 秒失败         = 那边有东西响应，但读不到内容（跨域头 / 端口没服务）
   */
  function classifyScanError(base, err, elapsedMs, limitMs) {
    var msg = (err && err.message) || '';
    var ms = Math.max(1, Math.round(elapsedMs));
    if (msg.indexOf('超时') >= 0 || elapsedMs >= limitMs - 400) {
      return new Error('连不上 ' + base + '：等了 ' + Math.round(elapsedMs / 1000) +
        ' 秒没有任何响应。检查 IP / 端口对不对、手机和电脑是不是同一个 WiFi、' +
        '电脑防火墙有没有放行（路由器的「AP 隔离」也会挡）。');
    }
    return new Error('在 ' + base + ' 上读不到内容（' + ms + ' 毫秒就失败了）。' +
      '可能这个端口上没有服务在监听，也可能服务在跑但没返回跨域头。' +
      '自查：用手机浏览器打开这个地址 —— 能看到文件列表 = 服务是通的，' +
      '问题出在跨域头 Access-Control-Allow-Origin，改用 tools/music_server.py 启动就行；' +
      '浏览器也打不开 = IP 或端口不对。');
  }

  // 只编码"非 ASCII 与空格"，已存在的 %XX 转义原样保留（目录页可能已编码过）
  function encPath(p) {
    return String(p).replace(/[^\x00-\x7F]+/g, function (chunk) {
      var out = '', i = 0;
      while (i < chunk.length) {
        var code = chunk.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < chunk.length) {
          out += encodeURIComponent(chunk.substr(i, 2));
          i += 2;
        } else {
          out += encodeURIComponent(chunk.charAt(i));
          i += 1;
        }
      }
      return out;
    }).replace(/ /g, '%20');
  }

  function resolveUrl(base, rel) {
    if (/^https?:\/\//i.test(rel)) return rel;
    var proto = /^(https?):/i.exec(base);
    proto = proto ? proto[1] : 'http';
    if (rel.indexOf('//') === 0) return proto + ':' + rel;
    var m = /^(https?:\/\/[^\/]*)/i.exec(base);
    var origin = m ? m[1] : '';
    var path = rel.charAt(0) === '/' ? rel : (base.slice(origin.length) + rel);
    var stack = [];
    path.split('/').forEach(function (s) {
      if (!s || s === '.') return;
      if (s === '..') { stack.pop(); return; }
      stack.push(s);
    });
    var tail = /\/$/.test(path) ? '/' : '';
    return encPath(origin + '/' + stack.join('/') + tail);
  }

  function unescapeHtml(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  function linksFrom(html) {
    var out = [], m;
    var re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;
    while ((m = re.exec(html))) out.push(m[1]);
    if (!out.length) {
      re = /href\s*=\s*([^\s>"']+)/gi;
      while ((m = re.exec(html))) out.push(m[1]);
    }
    return out;
  }

  function decodeSafe(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function fmtName(n) {
    var s = String(n || '').replace(/\.[a-z0-9]+$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
    return s || String(n || '');
  }

  function getText(url, timeout) {
    return new window.Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      try { xhr.open('GET', url, true); } catch (e) { reject(e); return; }
      xhr.timeout = timeout || 12000;
      xhr.onload = function () {
        resolve({
          status: xhr.status,
          text: xhr.responseText || '',
          type: (xhr.getResponseHeader && xhr.getResponseHeader('Content-Type')) || ''
        });
      };
      xhr.onerror = function () { reject(new Error('连不上音乐服务：地址不通 / 服务没开 / 被跨域(CORS)拒绝')); };
      xhr.ontimeout = function () { reject(new Error('请求超时：服务在，但一直没有响应')); };
      try { xhr.send(null); } catch (e2) { reject(e2); }
    });
  }

  function sortTracks(list) {
    return list.sort(function (a, b) {
      try { return a.url.localeCompare(b.url, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }); }
      catch (e) { return a.url < b.url ? -1 : (a.url > b.url ? 1 : 0); }
    });
  }

  // 老 WebView 没有 Element.closest，自己往上找
  function matches(node, sel) {
    var f = node.matches || node.msMatchesSelector || node.webkitMatchesSelector;
    try { return f ? f.call(node, sel) : false; } catch (e) { return false; }
  }
  function up(node, sel) {
    while (node && node.nodeType === 1) {
      if (matches(node, sel)) return node;
      node = node.parentNode;
    }
    return null;
  }

  // 老 WebView 的前缀兼容
  var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
    function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var caf = window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout;

  // 歌词定位：0.5 = 当前句停在面板正中间（0 = 贴顶，1 = 贴底）
  var LYRIC_ANCHOR = 0.5;

  /* ================= 扫描：先问 EPanel 服务，再退回解析目录 HTML ================= */

  function crawl(base, opt) {
    opt = opt || {};
    var maxDepth = opt.maxDepth || 4, maxDirs = opt.maxDirs || 80, maxFiles = opt.maxFiles || 1500;
    var out = [], queue = [{ url: base, depth: 0 }], seen = {}, dirs = 0;
    var rootError = null;                     // 根目录都拿不到，就是地址/跨域问题，不能当"空目录"
    var origin = /^(https?:\/\/[^\/]*)/i.exec(base);
    origin = origin ? origin[1].toLowerCase() : '';

    function step() {
      var node = null;
      while (queue.length && !node) {
        var cand = queue.shift();
        if (!seen[cand.url]) { seen[cand.url] = 1; node = cand; }
      }
      if (!node || dirs >= maxDirs || out.length >= maxFiles) return window.Promise.resolve();
      dirs++;
      return getText(node.url).then(function (r) {
        if (r.status >= 400) {
          if (node.depth === 0 && !rootError) rootError = new Error('目录返回 HTTP ' + r.status + '，地址可能不对');
          return;
        }
        linksFrom(r.text).forEach(function (raw) {
          var h = unescapeHtml(String(raw).trim());
          if (!h || /^(#|javascript:|mailto:|data:)/i.test(h)) return;
          if (h.charAt(0) === '?') return;
          if (/^https?:\/\//i.test(h)) {
            var mo = /^(https?:\/\/[^\/]*)/i.exec(h);
            if (!mo || mo[1].toLowerCase() !== origin) return;      // 只收同源
          }
          if (/\/$/.test(h)) {
            if (node.depth + 1 <= maxDepth) queue.push({ url: resolveUrl(node.url, h), depth: node.depth + 1 });
            return;
          }
          var url = resolveUrl(node.url, h);
          var name = decodeSafe(url.split('/').pop() || '').split('#')[0];
          if (!EP.musicMeta.isAudio(name)) return;
          out.push({
            name: name, url: url, size: 0,
            dir: decodeSafe(node.url.slice(base.length)).replace(/\/$/, '')
          });
        });
      })['catch'](function (e) {
        if (node.depth === 0 && !rootError) rootError = e;          // 子目录失败不中断，根目录失败要留证
      })
        .then(step);
    }
    return step().then(function () {
      if (!out.length && rootError) throw rootError;
      return {
        tracks: sortTracks(out),
        via: 'html',
        dirs: dirs,
        truncated: (dirs >= maxDirs || out.length >= maxFiles)
      };
    });
  }

  function scanBase(base, opt) {
    var t0 = Date.now();
    var LIMIT = 8000;
    return getText(base + '__epanel/list', LIMIT).then(function (r) {
      if (r.status !== 200) return null;
      var j = null;
      try { j = JSON.parse(r.text); } catch (e) { return null; }
      if (!j || !j.tracks || !j.tracks.length) return null;
      return sortTracks(j.tracks.map(function (t) {
        // 服务端给的是相对路径，必须相对 base 解析成绝对地址
        var u = /^https?:\/\//i.test(t.url) ? t.url : resolveUrl(base, t.url);
        return { name: t.name, url: u, size: t.size || 0, dir: t.dir || '' };
      }));
    })['catch'](function (e) {
      // 网络层就没成功（超时 / 被拒 / 被跨域挡）。同一个源，目录页也一样读不到，
      // 再爬一遍只会白等一次超时 —— 直接带上原因返回。
      throw classifyScanError(base, e, Date.now() - t0, LIMIT);
    }).then(function (list) {
      if (list) return { tracks: list, via: 'helper', dirs: 0, truncated: false };
      // 走到这里说明服务有响应、只是没有 /__epanel 接口，那就退回去爬目录 HTML
      return crawl(base, opt);
    });
  }

  /* ================= 会话（按卡片缓存，跨重挂载保活） ================= */
  // 面板重渲染（编辑模式、改尺寸）会 destroy + mount，若把 audio 放在 mount 里
  // 就会每次重新加载、播放中断。所以音频与播放状态挂在会话上，由卡片 id 索引。
  var SESSIONS = {};

  function newSession(base) {
    var audio = new Audio();
    audio.preload = 'metadata';
    return {
      base: base,           // 卡片里配的（第一个候选），用来判断要不要重建会话
      live: base,           // 最近一次真正连上的地址（多个候选里试出来的那个）
      bases: base ? [base] : [],
      audio: audio,
      tracks: [],
      cur: -1,
      tab: 'list',
      order: [],
      shuffle: false,
      repeat: 'off',
      muted: false,
      lastVol: 0.8,
      cache: {},            // url -> { title, artist, album, track, duration, full }
      lrc: null,
      lrcFor: null,
      lrcDone: false,
      lrcLoading: false,
      lrcErr: '',
      lyLines: [],
      lyNodes: null,
      lastLine: -1,
      coverOrder: [],
      rangeOk: null,
      scan: { state: base ? 'scanning' : 'idle', msg: '', via: '', count: 0, truncated: false },
      prefetch: { running: false, done: 0, total: 0 },
      seekLock: false,
      progTop: -1,          // 最近一次「程序写入」的 scrollTop
      animating: false,     // 平滑滚动进行中
      userScrollAt: 0,      // 用户手动滚动的时刻，之后 4 秒不抢他的位置
      err: null,
      savedVol: false
    };
  }

  function clearCoverOf(sess, url) {
    sess.tracks.forEach(function (t) { if (t.url === url) t.cover = null; });
  }
  function clearCoversExcept(sess, keepUrl) {
    sess.tracks.forEach(function (t) { if (t.url !== keepUrl) t.cover = null; });
  }

  /* ================= 模块注册 ================= */

  EP.modules.register({
    id: 'musicPlayer',
    name: '音乐播放器',
    icon: 'music',
    desc: '连接局域网 HTTP 音乐共享，播放并同步显示内嵌歌词',
    version: 1,
    layout: { w: 6, h: 3, minW: 3, minH: 2 },

    // 数组/大对象不要放 defaultSettings（内核 merge 是浅拷贝，会同模块共享）
    defaultSettings: {
      baseUrl: '',
      autoNext: true,
      prefetch: true,
      showCover: true,
      lyricOffset: 0,
      lyricSize: 16,
      bodyHeight: 420
    },
    settingsSchema: [
      { key: 'baseUrl', label: '音乐目录地址', type: 'text', placeholder: 'http://192.168.1.10:8000/', hint: '局域网服务地址（推荐用 tools/music_server.py 启动，它自带跨域头）。可以填多个用空格隔开，面板会挨个试' },
      { key: 'lyricSize', label: '歌词字号', type: 'range', min: 12, max: 30, step: 1, default: 16, live: true, hint: '拖动即时预览，点保存才生效；取消则还原' },
      { key: 'bodyHeight', label: '区域高度（像素）', type: 'number', min: 240, max: 1400, hint: '卡片高度设成「固定」时此项忽略，歌词区会自动填满卡片' },
      { key: 'autoNext', label: '播完自动下一首', type: 'switch', default: true, hint: '关闭后播完停在当前曲目' },
      { key: 'prefetch', label: '自动预读曲目信息', type: 'switch', default: true, hint: '需服务端支持 Range；只读每首前 64KB' },
      { key: 'showCover', label: '显示封面', type: 'switch', default: true, hint: '读取内嵌封面图' },
      { key: 'lyricOffset', label: '歌词偏移（毫秒）', type: 'number', default: 0, hint: '歌词比人声早出现就填正数，晚出现填负数' }
    ],

    mount: function (el, ctx) {
      ensureCss();
      el.innerHTML = '';
      el.classList.add('mp-fill');     // 让卡片 body 变成可伸缩的列，主区域才能填满高度
      var card = ctx.card;
      var base = normBase(ctx.settings.baseUrl);

      // 会话复用 / 地址变了就重建
      var sess = SESSIONS[card.id];
      if (sess && sess.base !== base) {
        try { sess.audio.pause(); } catch (e) { /* noop */ }
        sess = null;
      }
      if (!sess) { sess = SESSIONS[card.id] = newSession(base); }
      var audio = sess.audio;
      // 候选地址：每次挂载都按当前配置刷新一遍
      sess.bases = splitBases(ctx.settings.baseUrl);
      if (!sess.live || sess.bases.indexOf(sess.live) < 0) sess.live = sess.bases[0] || '';

      var alive = true;
      var saveTimer = null;
      var tick = 0;
      var st = card.settings.state || {};

      function saveState() {
        card.settings.state = {
          url: sess.cur >= 0 ? sess.tracks[sess.cur].url : '',
          pos: (audio.currentTime || 0),
          vol: audio.volume,
          tab: sess.tab
        };
        EP.store.saveCards();
      }
      function saveSoon() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { saveTimer = null; if (alive) saveState(); }, 1500);
      }

      /* ---------- 骨架 ---------- */
      el.innerHTML = [
        '<div class="mp-setup" hidden>',
          '<div class="field"><label>音乐目录地址</label>',
            '<input type="text" class="mp-url" placeholder="http://192.168.1.10:8000/　（可填多个，空格隔开）"></div>',
          '<div class="row"><button class="btn primary mp-connect">连接</button>',
            '<button class="btn sm mp-diag">诊断</button>',
            '<span class="hint mp-setup-msg" style="margin:0"></span></div>',
          '<div class="hint">服务端要返回 <b>Access-Control-Allow-Origin</b>（否则浏览器读不到目录与元数据），' +
            '建议再支持 <b>Range</b>（拖动进度条、只读文件头取歌词）。<br>' +
            '最省事的做法：在音乐所在的那台机器上跑 ' +
            '<code>python tools/music_server.py --dir "音乐目录"</code>，' +
            '它同时满足这两点，并把地址打印出来。</div>',
        '</div>',
        '<div class="mp-main">',
          '<div class="chips mp-tabs">',
            '<button class="chip" data-tab="list">播放列表</button>',
            '<button class="chip" data-tab="lyrics">歌词</button>',
            '<span class="mp-count hint" style="margin:0"></span>',
            '<button class="iconbtn mp-rescan" title="重新扫描目录">' + ic('refresh') + '</button>',
          '</div>',
          '<div class="mp-panel"><div class="mp-view"></div></div>',
          '<div class="mp-now">',
            '<div class="mp-cover">' + ic('music') + '</div>',
            '<div class="mp-meta">',
              '<div class="mp-title">未选择曲目</div>',
              '<div class="mp-sub">—</div>',
              '<div class="mp-tags"></div>',
            '</div>',
          '</div>',
          '<div class="mp-bar">',
            '<span class="mp-t mp-t1">0:00</span>',
            '<input type="range" class="mp-seek" min="0" max="1000" step="1" value="0">',
            '<span class="mp-t mp-t2">0:00</span>',
          '</div>',
          '<div class="mp-ctrl">',
            '<button class="iconbtn mp-btn" data-act="shuffle" title="随机播放">' + ic('shuffle') + '</button>',
            '<button class="iconbtn mp-btn" data-act="prev" title="上一首">' + ic('prev') + '</button>',
            '<button class="iconbtn mp-btn mp-play" data-act="toggle" title="播放 / 暂停">' + ic('play', true) + '</button>',
            '<button class="iconbtn mp-btn" data-act="next" title="下一首">' + ic('next') + '</button>',
            '<button class="iconbtn mp-btn" data-act="repeat" title="循环">' + ic('repeat') + '</button>',
            '<span class="spacer"></span>',
            '<button class="iconbtn mp-btn" data-act="mute" title="静音">' + ic('vol') + '</button>',
            '<input type="range" class="mp-vol" min="0" max="100" step="1">',
          '</div>',
        '</div>'
      ].join('');

      var setupBox = el.querySelector('.mp-setup');
      var mainBox = el.querySelector('.mp-main');
      var urlInput = el.querySelector('.mp-url');
      var setupMsg = el.querySelector('.mp-setup-msg');
      var coverEl = el.querySelector('.mp-cover');
      var titleEl = el.querySelector('.mp-title');
      var subEl = el.querySelector('.mp-sub');
      var tagsEl = el.querySelector('.mp-tags');
      var seekEl = el.querySelector('.mp-seek');
      var t1El = el.querySelector('.mp-t1');
      var t2El = el.querySelector('.mp-t2');
      var volEl = el.querySelector('.mp-vol');
      var tabsEl = el.querySelector('.mp-tabs');
      var countEl = el.querySelector('.mp-count');
      var panelEl = el.querySelector('.mp-panel');
      var viewEl = el.querySelector('.mp-view');
      var playBtn = el.querySelector('.mp-play');

      /* ---------- 顶部信息 ---------- */
      function curTrack() { return sess.cur >= 0 ? sess.tracks[sess.cur] : null; }

      function renderInfo() {
        var t = curTrack();
        var tags = t ? (sess.cache[t.url] || {}) : {};
        titleEl.textContent = t ? (tags.title || t.title || fmtName(t.name)) : '未选择曲目';
        var sub = t ? ([tags.artist || t.artist || '', tags.album || t.album || ''] .filter(function (x) { return x; }).join(' · ') || (t.dir || '') ) : '—';
        subEl.textContent = sub || '—';

        var chips = [];
        if (t) {
          if (t.container) chips.push(t.container === 'id3' ? 'MP3/ID3' : t.container.toUpperCase());
          if (sess.lrcLoading) chips.push('读取歌词中…');
          else if (sess.lrc && sess.lrc.lines.length) chips.push('歌词 ' + (sess.lrc.synced ? '逐句' : '整段') + (t.lyricsSource ? ' · ' + t.lyricsSource : ''));
          else if (sess.lrcErr) chips.push(sess.lrcErr);
          else if (t && !EP.musicMeta.canReadTags(t.name)) chips.push('该格式暂不支持读歌词');
        }
        tagsEl.innerHTML = chips.map(function (c) { return '<span class="badge">' + esc(c) + '</span>'; }).join('');

        if (ctx.settings.showCover !== false && t && t.cover) {
          coverEl.style.backgroundImage = 'url("' + t.cover + '")';
          coverEl.innerHTML = '';
        } else {
          coverEl.style.backgroundImage = '';
          coverEl.innerHTML = ic('music');
        }

        var act = audio.paused ? 'play' : 'pause';
        playBtn.innerHTML = ic(act, act === 'play');
        playBtn.title = audio.paused ? '播放' : '暂停';
      }

      function renderControls() {
        var bS = el.querySelector('[data-act="shuffle"]');
        var bR = el.querySelector('[data-act="repeat"]');
        var bM = el.querySelector('[data-act="mute"]');
        bS.className = 'iconbtn mp-btn' + (sess.shuffle ? ' on' : '');
        bR.className = 'iconbtn mp-btn' + (sess.repeat !== 'off' ? ' on' : '');
        bR.innerHTML = ic(sess.repeat === 'one' ? 'repeatOne' : 'repeat');
        bR.title = sess.repeat === 'off' ? '不循环' : (sess.repeat === 'all' ? '列表循环' : '单曲循环');
        bM.innerHTML = ic((sess.muted || audio.volume === 0) ? 'mute' : 'vol');
        volEl.value = String(Math.round((sess.muted ? 0 : audio.volume) * 100));
      }

      function renderProgress() {
        var d = audio.duration;
        if (!sess.seekLock) {
          seekEl.value = String(isFinite(d) && d > 0 ? Math.round(audio.currentTime / d * 1000) : 0);
        }
        t1El.textContent = fmtTime(audio.currentTime || 0);
        t2El.textContent = fmtTime(isFinite(d) ? d : 0);
      }

      function renderCount() {
        var s = sess.scan;
        if (s.state === 'scanning') countEl.textContent = '扫描中…';
        else if (s.state === 'error') countEl.textContent = '扫描失败';
        else if (sess.prefetch.running) countEl.textContent = '预读 ' + sess.prefetch.done + '/' + sess.prefetch.total;
        else countEl.textContent = s.count ? (s.count + ' 首' + (s.via === 'helper' ? '' : ' · 目录解析')) : '';
      }

      /* ---------- 播放列表 ---------- */
      function renderList() {
        var h = [];
        if (sess.scan.state === 'scanning') {
          h.push('<div class="empty" style="padding:26px 12px">正在扫描音乐目录…</div>');
        } else if (!sess.tracks.length) {
          h.push('<div class="empty" style="padding:26px 12px">' +
            (sess.scan.state === 'error' ? esc(sess.scan.msg || '扫描失败') : '目录里没有找到音频文件') + '</div>');
        } else {
          sess.tracks.forEach(function (t, i) {
            var tags = sess.cache[t.url] || {};
            var cls = 'mp-item' + (i === sess.cur ? ' cur' : '') + (t.bad ? ' bad' : '');
            h.push('<div class="' + cls + '" data-i="' + i + '" data-url="' + esc(t.url) + '">' +
              '<span class="i">' + (i + 1) + '</span>' +
              '<span class="n">' + esc(tags.title || t.title || fmtName(t.name)) + '</span>' +
              '<span class="a">' + esc(tags.artist || t.artist || '') + '</span>' +
              '</div>');
          });
          if (sess.scan.truncated) h.push('<div class="hint" style="padding:8px 0">目录太多，只列出了前 ' + sess.tracks.length + ' 首</div>');
        }
        viewEl.innerHTML = '<div class="mp-list">' + h.join('') + '</div>';
      }

      /* ---------- 歌词 ---------- */
      function lyricSize() {
        var n = Number(ctx.settings.lyricSize);
        if (!n || n < 10) return 16;
        return Math.max(10, Math.min(40, Math.round(n)));
      }

      // 字号写在容器上，逐句 <p> 继承（比 CSS 变量兼容性更好）
      function applyLyricSize(reanchor) {
        var ly = viewEl.querySelector('.mp-ly');
        if (!ly) return;
        ly.style.fontSize = lyricSize() + 'px';
        if (reanchor) { sess.lastLine = -1; updateLyricLine(true); }
      }

      function computeLyLines() {
        if (!sess.lrc) return [];
        var src = sess.lrc.lines || [];
        var out = [];
        for (var i = 0; i < src.length; i++) {
          if (!String(src[i].text).trim()) continue;
          if (sess.lrc.synced && src[i].t === null) continue;
          out.push(src[i]);
        }
        return out;
      }

      function renderLyrics() {
        sess.lyNodes = null;
        if (sess.lrcLoading) {
          sess.lyLines = [];
          viewEl.innerHTML = '<div class="empty" style="padding:26px 12px">正在读取内嵌歌词…</div>';
          return;
        }
        var t = curTrack();
        if (!t) { sess.lyLines = []; viewEl.innerHTML = '<div class="empty" style="padding:26px 12px">还没有播放曲目</div>'; return; }
        if (sess.lrcErr) { sess.lyLines = []; viewEl.innerHTML = '<div class="empty" style="padding:26px 12px">' + esc(sess.lrcErr) + '</div>'; return; }
        sess.lyLines = computeLyLines();
        if (!sess.lyLines.length) {
          viewEl.innerHTML = '<div class="empty" style="padding:26px 12px">这首歌的元数据里没有歌词</div>';
          return;
        }
        if (sess.lrc.synced) {
          viewEl.innerHTML = '<div class="mp-ly synced">' + sess.lyLines.map(function (l) {
            return '<p data-t="' + l.t + '">' + esc(l.text) + '</p>';
          }).join('') + '</div>';
        } else {
          viewEl.innerHTML = '<div class="mp-ly plain">' + esc(sess.lyLines.map(function (l) { return l.text; }).join('\n')) + '</div>';
        }
        sess.lyNodes = viewEl.querySelectorAll('.mp-ly p');
        applyLyricSize(true);
      }

      function activeIndex(sec) {
        var L = sess.lyLines;
        if (!L || !L.length) return -1;
        var lo = 0, hi = L.length - 1, ans = -1;
        while (lo <= hi) {
          var mid = (lo + hi) >> 1;
          if (L[mid].t <= sec) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (ans < 0) ans = 0;
        return ans;
      }

      function updateLyricLine(instant) {
        if (!sess.lrc || !sess.lrc.synced || sess.tab !== 'lyrics' || !sess.lyNodes || !sess.lyNodes.length) return;
        var off = Number(ctx.settings.lyricOffset) || 0;
        var idx = activeIndex((audio.currentTime || 0) + off / 1000);
        var changed = (idx !== sess.lastLine);
        if (changed) {
          sess.lastLine = idx;
          var ps = sess.lyNodes;
          for (var i = 0; i < ps.length; i++) ps[i].className = (i === idx) ? 'on' : '';
        }
        if (idx < 0) return;
        // 用户自己滚过歌词，4 秒内不要抢他的滚动位置
        if (!instant && sess.userScrollAt && (Date.now() - sess.userScrollAt) < 4000) return;
        // 没换句、动画还在跑，就别打断它
        if (!changed && !instant && sess.scrollAnim) return;
        scrollToLine(sess.lyNodes[idx], !!instant);
      }

      // 让当前句停在面板「偏上」的位置，并且是平滑移动过去的
      function scrollToLine(node, instant) {
        if (!node || !panelEl) return;
        var h = panelEl.clientHeight;
        var maxTop = Math.max(0, panelEl.scrollHeight - h);
        var target = node.offsetTop - h * LYRIC_ANCHOR + node.offsetHeight / 2;
        target = Math.max(0, Math.min(target, maxTop));
        if (sess.scrollAnim) { try { caf(sess.scrollAnim); } catch (e) { /* noop */ } sess.scrollAnim = null; }
        if (instant) {
          sess.animating = false;
          try { panelEl.scrollTop = target; } catch (e1) { /* noop */ }
          sess.progTop = panelEl.scrollTop;
          return;
        }
        var from = panelEl.scrollTop;
        if (Math.abs(from - target) < 1.5) { sess.progTop = from; return; }
        sess.animating = true;
        var t0 = null, dur = 480;
        function ease(t) { return 1 - Math.pow(1 - t, 3); }
        function frame(ts) {
          if (t0 === null) t0 = ts;
          var t = Math.min(1, (ts - t0) / dur);
          try { panelEl.scrollTop = from + (target - from) * ease(t); } catch (e2) { /* noop */ }
          sess.progTop = panelEl.scrollTop;
          if (t < 1) {
            sess.scrollAnim = raf(frame);
          } else {
            sess.scrollAnim = null;
            sess.animating = false;
          }
        }
        sess.scrollAnim = raf(frame);
      }

      /* ---------- 面板切换 ---------- */
      function renderTabs() {
        var chips = tabsEl.querySelectorAll('.chip');
        for (var i = 0; i < chips.length; i++) {
          chips[i].className = 'chip' + (chips[i].getAttribute('data-tab') === sess.tab ? ' active' : '');
        }
      }
      function renderPanel() {
        renderTabs();
        if (sess.tab === 'list') renderList(); else renderLyrics();
        renderCount();
      }

      // 后台动作（预读标题、切歌）会想重画列表，但不能把正在看的歌词页顶掉
      function refreshList() { if (sess.tab === 'list') renderList(); }

      // 主区域高度：卡片高度设成"固定"时自动填满卡片，否则用模块自己的高度
      function applyHeight() {
        var sz = ctx.size || {};
        var fixed = (sz.hMode === 'fixed') && Number(sz.h) > 0;
        if (fixed) mainBox.style.height = '';
        else mainBox.style.height = Math.max(240, Number(ctx.settings.bodyHeight) || 420) + 'px';
      }

      /* ---------- 扫描 ---------- */
      /* ---------- 连不上就自己重试 ----------
       * 老版本一旦扫描失败就永久停在错误态，只有手动点「连接」或刷新页面才会再试一次，
       * 所以"服务没开 → 后来开了"这个场景看起来就像"失败被记住了"。
       */
      var retryTimer = null, retryStep = 0;
      var RETRY_STEPS = [5, 10, 20, 30, 60];     // 秒，最后一档封顶

      function cancelRetry() {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      }

      function scheduleRetry() {
        cancelRetry();
        if (!alive || sess.scan.state !== 'error' || !(sess.bases || []).length) return;
        var i = Math.min(retryStep, RETRY_STEPS.length - 1);
        sess.scan.retryIn = RETRY_STEPS[i];
        retryStep = i + 1;
        retryTimer = setTimeout(function () {
          retryTimer = null;
          if (!alive || sess.scan.state !== 'error') return;
          doScan();
        }, sess.scan.retryIn * 1000);
      }

      function doScan() {
        sess.bases = splitBases(ctx.settings.baseUrl);
        if (!sess.bases.length) { renderSetup(); return; }
        cancelRetry();
        sess.scan = { state: 'scanning', msg: '', via: '', count: 0, truncated: false,
                      retryIn: 0, tried: 0, total: sess.bases.length };
        renderAll();
        tryScanAt(0);
      }

      // 多个候选地址依次试；哪个成功就把它记成"当前可用地址"（不改用户填的配置）
      function tryScanAt(i) {
        var cands = sess.bases || [];
        if (i >= cands.length) return;
        var cand = cands[i];
        sess.scan.tried = i + 1;
        scanBase(cand, {}).then(function (r) {
          if (!alive) return;
          onScanOk(cand, r);
        })['catch'](function (e) {
          if (!alive) return;
          if (i + 1 < cands.length) {
            sess.scan = { state: 'scanning', msg: '', via: '', count: 0, truncated: false,
                          retryIn: 0, tried: i + 2, total: cands.length };
            renderAll();
            tryScanAt(i + 1);
            return;
          }
          onScanFail(e);
        });
      }

      function onScanOk(cand, r) {
        retryStep = 0;                       // 连上了就把退避重置
        var switched = sess.live && sess.live !== cand;
        sess.live = cand;
        sess.scan = { state: 'done', msg: '', via: r.via, count: r.tracks.length,
                      truncated: r.truncated, retryIn: 0, tried: 0,
                      total: (sess.bases || []).length, at: Date.now(), using: cand };
        if (switched) EP.toast('已自动切到可用地址：' + cand);
        // 重新扫描（手动刷新 / 失败重试）时尽量留在同一首上
        var keep = (sess.cur >= 0 && sess.tracks[sess.cur]) ? sess.tracks[sess.cur].url : (st.url || '');
        var keepOk = keep && !audio.error && audio.src && audio.readyState >= 1;
        sess.tracks = r.tracks;
        buildOrder();
        renderAll();
        if (!r.tracks.length) return;
        EP.musicMeta.probeRange(r.tracks[0].url).then(function (ok) {
          sess.rangeOk = ok;
          if (!alive) return;
          if (ctx.settings.prefetch !== false && ok) runPrefetch();
        });
        // 恢复上次播放的曲目（不自动播放，浏览器会拦）
        if (!keep) return;
        for (var i = 0; i < sess.tracks.length; i++) {
          if (sess.tracks[i].url === keep) {
            if (keepOk) { sess.cur = i; renderInfo(); }                 // 同一首且没坏：别打断播放
            else loadTrack(i, { play: false, seek: st.pos || 0 });
            return;
          }
        }
      }

      function onScanFail(e) {
        sess.scan = { state: 'error', msg: e.message || '扫描失败', via: '', count: 0,
                      truncated: false, retryIn: 0, tried: 0, total: (sess.bases || []).length };
        renderAll();
        scheduleRetry();
      }

      function buildOrder() {
        var n = sess.tracks.length, i;
        sess.order = [];
        for (i = 0; i < n; i++) sess.order.push(i);
        if (sess.shuffle) {
          for (i = n - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1)), tmp = sess.order[i];
            sess.order[i] = sess.order[j]; sess.order[j] = tmp;
          }
        }
      }

      /* ---------- 预读标题（只读头部 64KB） ---------- */
      function runPrefetch() {
        var list = [];
        for (var i = 0; i < sess.tracks.length && list.length < 200; i++) {
          var t = sess.tracks[i];
          if (!sess.cache[t.url] && EP.musicMeta.canReadTags(t.name)) list.push(t);
        }
        if (!list.length) return;
        sess.prefetch = { running: true, done: 0, total: list.length };
        renderCount();
        var next = 0;
        function worker() {
          if (!alive || !sess.prefetch.running || next >= list.length) {
            if (next >= list.length) { sess.prefetch.running = false; if (alive) { renderCount(); refreshList(); } }
            return;
          }
          var t = list[next++];
          EP.musicMeta.read(t.url, { lyrics: false, cover: false, headBytes: 65536 }).then(function (tags) {
            if (!alive) return;
            if (!sess.cache[t.url]) {
              sess.cache[t.url] = { title: tags.title, artist: tags.artist, album: tags.album, track: tags.track };
              sess.tracks.forEach(function (x) { if (x.url === t.url) { x.title = tags.title; x.artist = tags.artist; } });
            }
          })['catch'](function () { /* 读不到就算了，不影响播放 */ })
            .then(function () {
              sess.prefetch.done++;
              if (!alive) return;
              renderCount();
              if (sess.prefetch.done % 5 === 0) refreshList();
              worker();
            });
        }
        for (var c = 0; c < 3; c++) worker();
      }

      /* ---------- 歌词读取 ---------- */
      function loadLyrics(t) {
        if (!t) return;
        if (sess.lrcFor === t.url && sess.lrcDone) return;
        sess.lrcFor = t.url;
        sess.lrcDone = false;
        sess.lrc = null;
        sess.lrcErr = '';
        sess.lyLines = [];
        sess.lyNodes = null;
        sess.lastLine = -1;
        if (!EP.musicMeta.canReadTags(t.name)) {
          sess.lrcDone = true;
          sess.lrcLoading = false;
          sess.lrcErr = '该格式（' + (EP.musicMeta.extOf(t.name) || '未知') + '）暂不支持读取内嵌歌词';
          renderInfo(); if (sess.tab === 'lyrics') renderLyrics();
          return;
        }
        sess.lrcLoading = true;
        renderInfo();
        if (sess.tab === 'lyrics') renderLyrics();

        var cached = sess.cache[t.url];
        var p = (cached && cached.full) ? window.Promise.resolve(cached.full)
          : EP.musicMeta.read(t.url, { cover: ctx.settings.showCover !== false });
        p.then(function (tags) {
          if (!alive || sess.lrcFor !== t.url) return;
          var c = sess.cache[t.url] || {};
          c.title = tags.title || c.title; c.artist = tags.artist || c.artist;
          c.album = tags.album || c.album; c.track = tags.track || c.track;
          c.duration = tags.duration || c.duration; c.full = tags;
          sess.cache[t.url] = c;
          t.title = c.title; t.artist = c.artist; t.album = c.album;
          t.container = tags.container; t.lyricsSource = tags.lyricsSource;
          if (tags.cover) {
            t.cover = tags.cover.dataUrl;
            sess.coverOrder.push(t.url);
            while (sess.coverOrder.length > 3) clearCoverOf(sess, sess.coverOrder.shift());
            clearCoversExcept(sess, t.url);
          }
          sess.lrc = tags.lrc;
          sess.lrcLoading = false;
          sess.lrcDone = true;
          renderInfo(); refreshList();
          if (sess.tab === 'lyrics') renderLyrics();
        })['catch'](function (e) {
          if (!alive || sess.lrcFor !== t.url) return;
          sess.lrcLoading = false;
          sess.lrcDone = true;
          sess.lrcErr = e.message || '读取元数据失败';
          renderInfo(); if (sess.tab === 'lyrics') renderLyrics();
        });
      }

      /* ---------- 播放控制 ---------- */
      function loadTrack(i, o) {
        o = o || {};
        if (i < 0 || i >= sess.tracks.length) return;
        sess.cur = i;
        var t = sess.tracks[i];
        sess.lrc = null; sess.lrcFor = null; sess.lrcErr = ''; sess.lastLine = -1;
        try { audio.src = t.url; } catch (e) { /* noop */ }
        audio.onloadedmetadata = null;
        if (o.seek) {
          audio.onloadedmetadata = function () {
            try { audio.currentTime = o.seek; } catch (e) { /* noop */ }
            audio.onloadedmetadata = null;
            renderProgress();
          };
        }
        loadLyrics(t);
        renderInfo(); refreshList(); renderProgress();
        if (o.play !== false) {
          var pr = audio.play();
          if (pr && pr['catch']) pr['catch'](function (e) { EP.toast('播放失败：' + (e.message || ''), 'err'); });
        }
        saveSoon();
      }

      function playIndex(i) { loadTrack(i, { play: true }); }

      function step(delta) {
        if (!sess.tracks.length) return;
        if (!sess.order.length) buildOrder();
        var pos = sess.order.indexOf(sess.cur);
        if (pos < 0) pos = 0;
        var np = pos + delta;
        if (np < 0) np = sess.order.length - 1;
        if (np >= sess.order.length) {
          if (sess.repeat === 'off') {
            if (delta > 0) { try { audio.pause(); } catch (e) { /* noop */ } renderInfo(); return; }
            np = 0;
          } else np = 0;
        }
        playIndex(sess.order[np]);
      }

      function next(auto) {
        if (sess.repeat === 'one' && auto) { try { audio.currentTime = 0; audio.play(); } catch (e) { /* noop */ } return; }
        if (auto && ctx.settings.autoNext === false && sess.repeat === 'off') { try { audio.pause(); } catch (e2) { /* noop */ } renderInfo(); return; }
        step(1);
      }

      function togglePlay() {
        if (sess.cur < 0) {
          if (sess.tracks.length) playIndex(sess.order.length ? sess.order[0] : 0);
          return;
        }
        if (audio.paused) {
          var pr = audio.play();
          if (pr && pr['catch']) pr['catch'](function (e) { EP.toast('播放失败：' + (e.message || ''), 'err'); });
        } else audio.pause();
      }

      /* ---------- 音频事件 ---------- */
      audio.onplay = function () { if (alive) renderInfo(); };
      audio.onpause = function () { if (alive) { renderInfo(); saveState(); } };
      audio.onended = function () { if (alive) next(true); };
      audio.onerror = function () {
        if (!alive) return;
        var t = curTrack();
        var code = audio.error ? audio.error.code : 0;
        // code 2 = MEDIA_ERR_NETWORK：多半是服务被关了/断网了。
        // 这种情况要落到"连接失败"那条路上，交给自动重试去恢复，而不是当成坏文件跳过。
        if (code === 2) {
          sess.scan = { state: 'error', msg: '播放中断：连不上音乐服务（服务可能被关了）',
                        via: '', count: 0, truncated: false, retryIn: 0 };
          renderAll();
          scheduleRetry();
          return;
        }
        if (t) t.bad = true;
        EP.toast('无法播放：' + (t ? (t.title || fmtName(t.name)) : '') + '（文件可能损坏或格式不支持）', 'err');
        refreshList();
      };
      audio.ontimeupdate = function () {
        if (!alive) return;
        renderProgress();
        updateLyricLine();
        if (++tick % 24 === 0) saveSoon();
      };

      /* ---------- 诊断 ---------- */
      function diagnose() {
        var body = mk('div', '');
        body.innerHTML = '<div class="empty" style="padding:10px">检测中…（每个地址最多等 8 秒）</div>';
        EP.dialog.open({ title: '连接诊断', body: body });
        var cands = splitBases(ctx.settings.baseUrl);
        if (!cands.length) {
          body.innerHTML = '<div class="result-box">还没填「音乐目录地址」。</div>';
          return;
        }

        var rows = [];
        function add(k, ok, d) { rows.push({ k: k, ok: ok, d: d || '' }); }

        // 逐个候选地址打一次 /__epanel/list，记下耗时和结果
        function tryOne(i, acc) {
          if (i >= cands.length) return window.Promise.resolve(acc);
          var cand = cands[i], t0 = Date.now();
          return getText(cand + '__epanel/list', 8000).then(function (r) {
            acc.push({ cand: cand, ms: Date.now() - t0, status: r.status, body: r.text });
            return tryOne(i + 1, acc);
          })['catch'](function (e) {
            acc.push({ cand: cand, ms: Date.now() - t0, err: e });
            return tryOne(i + 1, acc);
          });
        }

        tryOne(0, []).then(function (results) {
          var good = null;
          add('候选地址', true, cands.length + ' 个，挨个试');
          results.forEach(function (r) {
            var list = null;
            if (r.body) { try { list = JSON.parse(r.body); } catch (e) { list = null; } }
            var n = (list && list.tracks) ? list.tracks.length : 0;
            if (r.status !== undefined) {
              if (n) { if (!good) good = r; add(r.cand, true, '可用，找到 ' + n + ' 首（' + r.ms + ' 毫秒）'); }
              else add(r.cand, false, '有响应，但没有 /__epanel 接口（HTTP ' + r.status + '，' + r.ms +
                ' 毫秒）—— 面板会退回去解析目录页，能用但慢一点');
            } else {
              var slow = r.ms >= 7600;
              add(r.cand, false, (slow ? '超时，完全没有响应（' + r.ms + ' 毫秒）' : '立刻失败（' + r.ms +
                ' 毫秒）') + '：' + ((r.err && r.err.message) || '未知'));
            }
          });
          if (good) {
            add('结论', true, '用 ' + good.cand + ' 就行' +
              (sess.live && sess.live !== good.cand ? '（当前用的是 ' + sess.live + '）' : ''));
            var url = (function () {
              var list = null;
              try { list = JSON.parse(good.body); } catch (e) { return ''; }
              return (list.tracks && list.tracks[0]) ? resolveUrl(good.cand, list.tracks[0].url) : '';
            })();
            if (url) {
              return EP.musicMeta.probeRange(url).then(function (ok) {
                add('Range 支持', ok, ok ? '可以拖动进度条、精准预读歌词' : '服务端忽略 Range，会影响预读与拖进度');
                return null;
              });
            }
          } else {
            add('结论', false, '所有候选地址都不行，按下面三条自查');
          }
          return null;
        }).then(function () {
          var h = rows.map(function (r) {
            return '<div class="kv"><span>' + esc(r.k) + '</span><span style="text-align:right">' +
              '<span class="badge ' + (r.ok ? 'ok' : 'err') + '">' + (r.ok ? '通过' : '注意') + '</span>' +
              '<div class="hint" style="margin:2px 0 0">' + esc(r.d) + '</div></span></div>';
          }).join('');
          body.innerHTML = h + '<div class="hint" style="margin-top:12px">还连不上就按顺序试：<br>' +
            '1) <b>用手机浏览器打开上面那个地址</b>，能看到文件列表 = 服务是通的，' +
            '问题在服务端没返回跨域头（换 tools/music_server.py 启动）；打不开 = 地址或端口不对。<br>' +
            '2) <b>看服务端那个黑窗口里有没有刷出请求行</b>。有 = 请求到了、是跨域头的问题；' +
            '没有 = 请求根本没到，检查 IP、防火墙、路由器「AP 隔离」。<br>' +
            '3) 电脑常有多张网卡，服务端启动时会打印好几行「局域网」。' +
            '拿不准就把它们全填进地址框（空格隔开），面板会挨个试。</div>';
        })['catch'](function (e) {
          body.innerHTML = '<div class="result-box" style="color:var(--err)">' +
            esc(e.message || '检测失败') + '</div>';
        });
      }

      /* ---------- 交互绑定 ---------- */
      el.querySelector('.mp-connect').onclick = function () {
        var v = normBase(urlInput.value);
        if (!v) { EP.toast('请填写音乐目录地址', 'err'); return; }
        ctx.save({ baseUrl: v });        // 内核会持久化并重挂载
      };
      el.querySelector('.mp-diag').onclick = diagnose;
      el.querySelector('.mp-rescan').onclick = function () {
        if (!splitBases(ctx.settings.baseUrl).length) { EP.toast('先填音乐目录地址', 'err'); return; }
        EP.toast('正在重新扫描目录…');
        retryStep = 0;
        cancelRetry();
        doScan();
      };

      tabsEl.onclick = function (e) {
        var b = up(e.target, '.chip');
        if (!b) return;
        sess.tab = b.getAttribute('data-tab');
        saveSoon();
        renderPanel();
      };

      el.querySelector('.mp-ctrl').onclick = function (e) {
        var b = up(e.target, '[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'toggle') togglePlay();
        else if (act === 'next') step(1);
        else if (act === 'prev') {
          if (audio.currentTime > 3) { try { audio.currentTime = 0; } catch (er) { /* noop */ } renderProgress(); }
          else step(-1);
        } else if (act === 'shuffle') {
          sess.shuffle = !sess.shuffle;
          buildOrder();
          renderControls();
          EP.toast(sess.shuffle ? '随机播放已开' : '随机播放已关');
        } else if (act === 'repeat') {
          sess.repeat = sess.repeat === 'off' ? 'all' : (sess.repeat === 'all' ? 'one' : 'off');
          renderControls();
          EP.toast(sess.repeat === 'off' ? '不循环' : (sess.repeat === 'all' ? '列表循环' : '单曲循环'));
        } else if (act === 'mute') {
          sess.muted = !sess.muted;
          audio.volume = sess.muted ? 0 : (sess.lastVol || 0.8);
          if (!sess.muted) sess.lastVol = audio.volume;
          renderControls();
          saveSoon();
        }
      };

      viewEl.onclick = function (e) {
        var node = up(e.target, '.mp-item');
        if (node) { playIndex(Number(node.getAttribute('data-i'))); return; }
        var p = up(e.target, '.mp-ly p');
        if (p && sess.lrc && sess.lrc.synced) {
          var t = parseFloat(p.getAttribute('data-t'));
          if (isFinite(t)) { try { audio.currentTime = Math.max(0, t - (Number(ctx.settings.lyricOffset) || 0) / 1000); } catch (er) { /* noop */ } }
        }
      };

      // 用户手动滚歌词时让位，别跟他抢。
      // 注意：平滑滚动是自己写的 scrollTop，不能当用户操作，否则自己把自己锁死。
      panelEl.addEventListener('scroll', function () {
        if (sess.animating) return;
        if (sess.progTop >= 0 && Math.abs(panelEl.scrollTop - sess.progTop) < 2) return;
        sess.userScrollAt = Date.now();
      }, false);

      volEl.oninput = function () {
        var v = Number(volEl.value) / 100;
        audio.volume = v;
        sess.muted = (v === 0);
        sess.lastVol = v || sess.lastVol;
        renderControls();
        saveSoon();
      };

      seekEl.oninput = function () {
        sess.seekLock = true;
        var d = audio.duration;
        if (isFinite(d) && d > 0) {
          try { audio.currentTime = Number(seekEl.value) / 1000 * d; } catch (e) { /* noop */ }
          t1El.textContent = fmtTime(audio.currentTime);
        }
      };
      seekEl.onchange = function () { sess.seekLock = false; };
      seekEl.onpointerup = function () { sess.seekLock = false; };

      /* ---------- 初始化 ---------- */
      function renderAll() {
        applyHeight();
        renderInfo(); renderControls(); renderProgress(); renderPanel(); renderSetup();
      }
      function renderSetup() {
        var show = (!sess.bases.length || sess.scan.state === 'error');
        setupBox.hidden = !show;
        mainBox.style.display = show ? 'none' : '';
        if (show) {
          if (!urlInput.value) urlInput.value = ctx.settings.baseUrl || '';
          if (sess.scan.state === 'error') {
            setupMsg.textContent = (sess.scan.msg || '连接失败') +
              (sess.bases.length ? '　面板会自动重试，服务恢复后自动连上' : '');
          } else {
            setupMsg.textContent = '填写局域网音乐目录地址，例如 http://192.168.1.10:8000/　' +
              '（可以填多个，用空格隔开，面板会挨个试）';
          }
        }
      }

      // 音量 / 标签页 / 循环状态从卡片里恢复
      if (!sess.savedVol) {
        audio.volume = (typeof st.vol === 'number') ? st.vol : 0.8;
        sess.lastVol = audio.volume || 0.8;
        sess.savedVol = true;
      }
      if (st.tab) sess.tab = st.tab;

      // 挂载时决定要不要重新扫：没扫过必扫；扫过但已经过去 60 秒、而且没在放歌，也补扫一次。
      // 不补的话，服务端关了或者往目录里加了新歌，面板会一直显示那份旧列表。
      var stale = sess.scan.state === 'done' && sess.scan.at &&
        (Date.now() - sess.scan.at > 60000) && audio.paused;
      if (sess.bases.length && (!sess.tracks.length || stale)) doScan();
      renderAll();
      renderProgress();
      // 兜底：万一挂载时容器还没量到尺寸（页面隐藏等），下一帧重新对齐一次当前句
      setTimeout(function () {
        if (alive && sess.tab === 'lyrics') applyLyricSize(true);
      }, 0);

      return {
        destroy: function () {
          alive = false;
          cancelRetry();
          if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
          if (sess.scrollAnim) { try { caf(sess.scrollAnim); } catch (e) { /* noop */ } sess.scrollAnim = null; }
          sess.animating = false;
          sess.progTop = -1;
          if (sess.prefetch) sess.prefetch.running = false;
          // 面板重渲染会走到这里，所以不能停播放；只有卡片被删掉才收摊
          var stillThere = false;
          var cards = EP.state.cards || [];
          for (var i = 0; i < cards.length; i++) { if (cards[i].id === card.id) { stillThere = true; break; } }
          if (!stillThere) {
            try { sess.audio.pause(); } catch (e) { /* noop */ }
            sess.audio.src = '';
            delete SESSIONS[card.id];
          } else {
            saveState();
          }
        },
        update: function (s) {
          // 卡片设置里的实时预览（滑块拖动）走这里：只应用外观，不整块重画，
          // 否则拖字号的时候整段歌词会被反复重建、还会闪
          ctx.settings = s || {};
          applyHeight();
          renderInfo();
          if (sess.tab === 'lyrics') applyLyricSize(true);
          renderCount();
        }
      };
    }
  });
})();
