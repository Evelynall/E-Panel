/* EPanel 通道：Quicker 推送
 * ------------------------------------------------------------
 * 通道负责"动作怎么执行"。注册后：
 *   - 设置页「通道」分区按 settingsSchema 自动生成配置表单
 *   - 按钮编辑器按 actionSchema 动态渲染参数表单（showIf 控制显隐）
 *   - EP.channels.run() 统一调度、写日志、广播 result 事件
 * 内核暴露的网络能力：EP.net（QPUSH / requestJson / normPush / quickerBuild）
 */
(function () {
  'use strict';
  var EP = window.EP;
  if (!EP || !EP.channels) return;

  var net = EP.net, store = EP.store;
  var QPUSH = net.QPUSH, requestJson = net.requestJson,
      normPush = net.normPush, quickerBuild = net.quickerBuild;

  EP.channels.register({
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
})();
