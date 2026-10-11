/* 新模块模板 —— 复制这个文件改写成你的模块，然后：
 *   1. 改 id / name / icon / desc
 *   2. 在 index.html 里加一行 <script src="modules/你的文件.js"></script>
 *   3. 刷新页面，编辑模式 → 添加卡片 里就能看到它
 * 内核不需要任何改动。
 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  var mk = EP.util.mk, esc = EP.util.esc, svg = EP.icon;

  EP.modules.register({
    id: 'myModule',              // 唯一标识，会存进 card.moduleId
    name: '我的模块',
    icon: 'grid',                // 图标名，见 app.js 的 ICONS
    desc: '一句话说明这个模块做什么',
    version: 1,

    layout: { w: 4, h: 2, minW: 1, minH: 1 },   // 默认占位与最小尺寸

    // 卡片设置：内核会自动生成表单，字段类型见 app.js 的 buildForm
    defaultSettings: { text: '你好' },
    settingsSchema: [
      { key: 'text', label: '显示文字', type: 'text' }
    ],

    // ctx 提供：card / settings / save(patch) / edit / store / channels /
    //          toast / dialog / openPage / setTitle
    mount: function (el, ctx) {
      el.innerHTML = '';
      var box = mk('div', 'empty');
      box.textContent = ctx.settings.text || '（未设置）';
      el.appendChild(box);

      // 可选：返回 update 让"卡片设置"里的 live 字段能实时预览
      return {
        update: function (s) { ctx.settings = s || {}; box.textContent = ctx.settings.text || '（未设置）'; },
        destroy: function () { /* 解绑事件、清定时器 */ }
      };
    }
  });
})();
