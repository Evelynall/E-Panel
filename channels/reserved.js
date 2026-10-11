/* 预留通道：接口先登记，标记为 comingSoon，设置页里显示为"未实现"。
 * 实现后去掉 comingSoon 并在 index.html 里补一个 script 标签即可。 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.channels) return;

  [['http', 'HTTP 请求', '自定义 HTTP / Webhook'],
   ['mqtt', 'MQTT', '物联网消息'],
   ['homeassistant', 'Home Assistant', '智能家居实体控制'],
   ['script', '本地脚本', '运行本地命令或脚本']].forEach(function (c) {
    EP.channels.register({ id: c[0], name: c[1], desc: c[2], comingSoon: true, icon: 'link' });
  });
})();
