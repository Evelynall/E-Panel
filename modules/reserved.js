/* 预留模块：接口先登记，标记为 comingSoon，在「添加卡片」里灰显。
 * 实现后去掉 comingSoon 并在 index.html 里补一个 script 标签即可。 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.modules) return;

  [['deviceStatus', '通道状态', '显示各通道在线状态'],
   ['clipboardHistory', '剪贴板历史', '记录与回传剪贴板内容'],
   ['fileTransfer', '文件传输', '向远端发送文件'],
   ['webFrame', '嵌入网页', '在卡片里嵌入一个网页'],
   ['statusText', '信息展示', '展示一段文本或数值']].forEach(function (m) {
    EP.modules.register({ id: m[0], name: m[1], desc: m[2], icon: 'grid', comingSoon: true });
  });
})();
