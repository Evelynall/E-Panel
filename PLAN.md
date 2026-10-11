# EPanel（E 面板）· 开发计划

> 制定日期：2026-09-25（2026-09-26 重构为通用面板工作台）
> 目标目录：`EPanel/`
> 参考：旧版本 `Quicker快捷面板V2.5.1`、Quicker 推送文档 <https://getquicker.net/KC/Manual/Doc/connection>

---

## 一、定位与目标

**EPanel 是一个通用的面板工作台，不是 Quicker 专用遥控器。**

Quicker 只是它接入的**第一个通道**。同样的按钮、同样的卡片界面，以后也能用来触发 HTTP 请求、Home Assistant、MQTT、本地脚本……通道可扩展，界面和交互不变。

- **纯前端、零后端、可离线打开**：浏览器或 APK 直接跑，凭证存本地。
- **页面能在 `file://` 下双击打开**：因此不用 ES module，全部普通 `<script>`（避免 file:// 的模块 CORS 限制）。
- **首版仍以实现 Quicker 通道为主**，但所有数据结构与接口按多通道设计，避免以后返工。
- 首版聚焦"可用 + 好排查"，不追求花哨。

**两个核心抽象**（正交，各自独立扩展）：

| 抽象 | 管什么 | 注册表 |
| --- | --- | --- |
| **Module（模块）** | 界面上怎么呈现 —— 一张卡片 | `EP.modules.register` |
| **Channel（通道）** | 动作怎么执行 —— 发到哪里 | `EP.channels.register` |

按钮 = 外观 + `{ channel, params }`。换个通道，界面不用动；换个模块，执行逻辑不用动。

---

## 二、已确认的技术决策

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 命名 | **EPanel**（工程名 `epanel`，存储前缀 `ep.`，全局对象 `window.EP`） | 取自 Evelynal 的首字母 E，中性、可扩展 |
| 文件形态 | `index.html` + `app.css` + `app.js` + `modules/*.js` + `channels/*.js` | 结构清晰好维护；内核与扩展解耦；不用 ES module 则 file:// 下仍可运行 |
| 外部依赖 | **零 CDN**，全部自包含 | 旧版 Tailwind / FontAwesome CDN 在离线和 APK 内会白屏、图标变方框 |
| 图标方案 | 内联 SVG 图标集 + Emoji + 图片 URL / Base64 | 断网可用；Base64 需做容量限制 |
| 通道抽象 | Module / Channel 两套注册表，按钮按通道执行 | 以后接新通道不用改界面 |
| Quicker 通道请求方式 | **POST JSON 为主，GET 直链为辅** | 旧版纯 GET 拼 URL，长文本和多步骤输入会被长度与编码坑到；GET 只用于生成可分享直链 |
| 弹窗 | 自绘模态框，禁用 `prompt/confirm/alert` | WebView 常禁用系统弹窗，这是旧版"手机端无法保存按钮"最可能的原因 |
| 首版新增功能 | 快速发送条、动作返回值面板、执行日志 | 已确认 |
| 设备列表 | 首版**不做**在线设备拉取面板 | 保留按钮级 `toDevice` 字段，手填设备名即可 |

---

## 三、Quicker 通道的接口事实（2026-09-25 实测，非文档照抄）

> 这一节只描述 `quicker` 这一个通道；其他通道以后各自补自己的接口事实。

| 探测项 | 结果 |
| --- | --- |
| `GET /get/devices` | 200，`Access-Control-Allow-Origin: *` |
| `OPTIONS /to/quicker` | 204，允许 `POST`，允许请求头 `content-type` |
| `POST /to/quicker` | 200，`Access-Control-Allow-Origin: *` |
| Origin 为 `null` / `file://` | 仍返回 `*`（APK 内可用，见第十一节） |

**结论：浏览器可直连，不需要任何代理，且能读取响应体** —— 所以 `wait=true` 取动作返回值是可实现的（旧版完全没用上）。

实测返回体与官方文档不一致，需兼容解析：

```jsonc
// 文档写法：{ "count": 2, "activeDevice": "主机名1", "devices": [...] }
// 实测（失败时）：{ "isSuccess": false, "errorCode": 0, "message": "Email或推送验证码不正确。", "data": null }
```

→ 设备列表解析按优先级猜：`body.data.devices` → `body.devices` → `body.data` 为数组；`activeDevice` 同理。

推送失败响应：

```json
{ "isSuccess": false, "successCount": 0, "errorMessage": "Email或推送验证码不正确", "timeCost": 0, "devices": null }
```

---

## 四、数据模型 v3

存储前缀统一为 `ep.`，全局对象 `window.EP`。

```js
// ep.config
{
  version: 3,
  panelName: 'E 面板',
  theme: 'light',           // light | dark
  gridCols: 0,              // 0=自动响应式
  timeoutMs: 8000,          // 请求超时
  channels: {               // 各通道自己的配置，键为通道 id
    quicker: { toUser: 'xxx@domain.com', code: '推送验证码', defaultDevice: '' }
  },
  chrome: {                 // 顶栏与侧栏显示策略，见 UI-DESIGN.md 第十二节
    topBar: 'always',       // always | auto | never
    sidebar: 'always',
    handlePos: 'br'         // 完全隐藏时唤出把手的位置
  },
  display: {                // 展示模式，见 UI-DESIGN.md 第十三节
    autoKiosk: false,       // 空闲多久自动进入展示模式（默认关）
    idleSec: 10,            // 空闲秒数，范围 5~600
    hideCardTitles: false,
    keepAwake: true
  },
  quickSend: { mode: 'paste', history: [] }   // 快速发送条，最多留 20 条
}

// ep.categories
[{ id, name, order }]

// ep.buttons
{
  id, name, categoryId, order,
  color: '#3b82f6', opacity: 100,
  icon: { type: 'none'|'svg'|'emoji'|'image', value: '' },
  bg:   { type: 'none'|'image', url: '' },
  channel: 'quicker',       // 走哪个通道
  params: {                 // 通道相关参数，字段由该通道的 actionSchema 决定
    operation: 'copy',      // copy|paste|action|open|sendkeys|inputtext|inputscript|downloadfile
    action: '', data: '', toDevice: '', wait: false, maxWaitMs: 3000
  },
  confirm: false,           // 危险动作二次确认
  createdAt, updatedAt
}

// ep.logs（最多 50 条，先进先出）
{ ts, name, channelId, ok, cost, errorMessage, result }

// ep.pages / ep.cards（见 UI-DESIGN.md 第四节）
```

### 4.1 多工作区（v4 起）

一个**工作区** = 一套 `pages + cards + categories + buttons`。用途是按场景分开：
家里一版、办公一版、剪片一版，随时切换，互不干扰。

```js
// ep.workspaces —— 只存元信息，顺序就是显示顺序
[{ id: 'ws_default', name: '默认工作区', icon: 'grid' }]

// ep.activeWs —— 当前工作区 id（纯字符串，不套 JSON）
'ws_default'

// 每个工作区自己的那份数据（一个工作区一套键）
ep.ws.<wsId>.pages
ep.ws.<wsId>.cards
ep.ws.<wsId>.categories
ep.ws.<wsId>.buttons
```

**关键设计：当前工作区的那份数据始终放在 `state` 顶层**（`state.pages / state.cards / ...`）。
所以整个应用里读取数据的代码（`store.getCards()`、`state.cards.filter(...)` 等）**完全不用感知工作区的存在**，
只有切工作区那一个函数需要换内存 + 换键：

```js
store.switchWorkspace(id):
  saveWsData()            // 把当前这份写回 ep.ws.<旧 id>.*
  state.activeWs = id
  saveWorkspaces()        // 记下 ep.workspaces / ep.activeWs
  loadWsData(id)          // 把目标那份读进 state 顶层
  → afterWorkspaceSwitch() // 收尾：ui.page 若不在新工作区就回第一页、清最大化、renderAll
```

**哪些是全局的（不随工作区走）**：`ep.config`（面板名、主题、通道配置、chrome/display/quickSend）与 `ep.logs`。
理由：通道凭据、主题、日志本来是"这台设备/这个人"的属性，不是某个场景的属性。

**迁移**：启动时若没有 `ep.workspaces`，就把现有的 `ep.pages/cards/categories/buttons`
收进默认工作区（`ws_default`）写入新命名空间。**老的 `ep.*` 键保留不删**，当保险。
新装的用户直接建 `ws_default` 并填默认页面与卡片。

**复制工作区必须是深拷贝**，并且**卡片 id 要重新生成** ——
模块级的会话缓存（如音乐播放器的 `SESSIONS`）是按卡片 id 存的，两个工作区出现同 id 卡片会串味。
页面 id 不重新生成（`p_main` / `p_settings` 是内核里的内建 id，被硬编码引用）。

**导出/导入**：`exportAll()` 升到 `version: 4`，带上 `workspaces: [{id,name,icon,data}]` + `activeWs`；
同时**顶层仍然带一份当前工作区的数据**，这样老版本的面板导入新备份也能认。
导入老备份（没有 `workspaces`）时，把顶层那份收进第一个工作区。

**迁移规则**（启动时执行，发现旧 key 且新 key 不存在才迁）：

- 旧 key 映射：`quickPanelConfig → ep.config`、`quickPanelButtons → ep.buttons`、`quickPanelCategories → ep.categories`
- `config.toUser / code / defaultDevice` 收进 `config.channels.quicker`
- 按钮平铺的 `operation / action / data / toDevice / wait / maxWaitMs` 收进 `params`，并补 `channel: 'quicker'`
- `iconType/fontIcon/imageIcon` → `icon{type,value}`；`bgType/bgImage` → `bg{type,url}`
- 缺 `order` 按数组下标补；缺 `categoryId` 归到第一个分类
- 迁移前把原始数据备份到 `ep.backup.v2`，出问题能回滚

---

## 五、文件结构

```
EPanel/
├── index.html              # 结构骨架 + 按顺序加载所有 JS
├── app.css                 # CSS 变量主题 + 组件样式 + 响应式
├── app.js                  # 内核：store / channels / ui / 对外 API（window.EP）
├── channels/
│   ├── quicker.js          # Quicker 推送通道
│   └── reserved.js         # 预留通道占位（http / mqtt / homeassistant / script）
├── modules/
│   ├── buttonGrid.js       # 快捷按钮卡片
│   ├── quickSend.js        # 快速发送条
│   ├── resultPanel.js      # 动作返回值面板
│   ├── logList.js          # 执行日志
│   ├── todoList.js         # 待办清单（模块化改造后的首个示例新模块）
│   ├── musicMeta.js        # 辅助库（非模块）：音频元数据与内嵌歌词解析
│   ├── musicPlayer.js      # 音乐播放器（局域网 HTTP 音乐共享）
│   ├── reserved.js         # 预留模块占位
│   └── _模板.js             # 新模块模板（复制改名即可开工）
├── tools/
│   └── music_server.py     # 给音乐目录开的局域网 HTTP 服务（CORS + Range + 曲目清单接口）
├── tests/
│   ├── smoke.py            # 内核冒烟测试
│   ├── test_todo.py        # 待办模块
│   ├── test_music.py       # 音乐播放器（自带 HTTP 服务端到端）
│   ├── test_music_reconnect.py  # 音乐服务"断了又回来"的自动恢复
│   ├── test_music_connect.py    # 失败原因分类（无跨域头/端口不通/黑洞）+ 多候选地址
│   ├── test_tray.py             # 托盘：复制地址进剪贴板 / 关闭服务真退出（Windows）
│   ├── test_input.py       # 软键盘 / 重排回归（输入时页面不能被重建）
│   ├── test_drag.py        # 拖动排序 / 拖动缩放的触摸回归
│   ├── test_workspace.py   # 多工作区（迁移/新建/复制/隔离/删除/持久化/导出）
│   ├── test_kiosk.py       # 空闲自动进入展示模式 + 唤出把手显隐
│   ├── make_fixtures.py    # 生成带内嵌歌词的测试音频
│   └── fixtures/           # 测试素材（生成物，可删）
├── UI-DESIGN.md            # 界面设计：卡片工作台三层结构、模块与通道扩展接口
└── PLAN.md                 # 本文件
```

界面采用 **Shell / Page / Card ← Module** 三层结构（卡片式工作台），详细布局、两套注册契约、响应式断点见 `UI-DESIGN.md`。

`app.js` 是内核，**不再认识任何具体通道或模块**，只暴露：

- `EP.modules` —— 模块注册表
- `EP.channels` —— 通道注册表与调度器 `EP.channels.run(button)`
- `EP.util` —— 小工具（mk / esc / uid / merge / fmtTime / $ / $$ / iconHtml / copyText / download）
- `EP.net` —— 网络层（Quicker 专属；非 Quicker 通道可复用也可自己实现）
- `EP.store`、`EP.bus`、`EP.dialog`、`EP.toast`、`EP.editButton`、`EP.state`

`index.html` 中所有扩展脚本必须 **放在 `app.js` 之后**，顺序建议：通道先、模块后。因为脚本为普通 `<script>`，执行顺序即文件声明顺序。

---

## 六、通道（Channel）约定

### 注册契约

```js
EP.channels.register({
  id: 'quicker',
  name: 'Quicker 推送',
  icon: 'bolt',
  desc: '通过 Quicker 推送服务远程触发电脑动作',
  version: 1,

  settingsSchema: [          // 通道级配置 → 渲染在设置页「通道」分区
    { key: 'toUser', label: '账号邮箱', type: 'text', required: true },
    { key: 'code', label: '推送验证码', type: 'password', required: true },
    { key: 'defaultDevice', label: '默认设备', type: 'text', hint: '留空 = 当前活动主机' }
  ],

  actionSchema: [            // 每个动作的参数表单 → 渲染在按钮编辑器
    { key: 'operation', label: '操作类型', type: 'select', default: 'copy', options: [...] },
    { key: 'action', label: '动作 ID 或名称', type: 'text', showIf: { operation: 'action' } },
    { key: 'data', label: '数据', type: 'textarea', showIf: { operation: ['copy','paste','action','open','sendkeys','inputtext','inputscript','downloadfile'] } },
    { key: 'toDevice', label: '目标设备', type: 'text', hint: '支持 * 与 !Computer' },
    { key: 'wait', label: '等待返回值', type: 'switch', default: false },
    { key: 'maxWaitMs', label: '最长等待毫秒', type: 'number', default: 3000, showIf: { wait: true } }
  ],

  run: function (params, settings, ctx) { /* 执行，返回 Promise<归一化结果> */ },
  test: function (settings) { /* 连接测试，返回 Promise */ },
  health: function (settings) { /* 可选：探测在线设备 */ },
  buildUrl: function (params, settings) { /* 可选：生成 GET 直链，用于分享 / 捷径 */ }
});
```

`showIf` 做字段联动，**替代旧版在代码里硬编码 if** —— 这是"加通道不用改编辑器"的关键。

### 归一化返回（所有通道统一）

```js
{ ok: true, channelId: 'quicker', cost: 219, result: '...', errorMessage: null, raw: {...} }
```

### 调度

```js
EP.channels.run(button)  // 按 button.channel 找通道 → run(button.params) → 归一化 → 写日志
```

### quicker 通道实现要点

- 主路径：`POST https://push.getquicker.cn/to/quicker`，`Content-Type: application/json`
- 超时：`AbortController`，默认 `timeoutMs`；`wait=true` 时取 `maxWaitMs + 5000`
- 降级：POST 网络异常时改用 GET 直链重试一次
- `wait=true` 时把结果渲染进返回值面板

错误提示映射（该通道专属）：

| 情况 | 文案 |
| --- | --- |
| `errorMessage` 含"验证码"/"Email" | 邮箱或推送验证码不正确，请检查设置 |
| `isSuccess=true` 但 `successCount=0` | 目标设备不在线或未建立长连接 |
| `wait=true` 且 `timeCost >= maxWaitMs` | 动作执行超时，可增大 maxWaitMs |
| 网络层失败 | 网络异常，已尝试 GET 重试 |

### 未来通道（接口先留，暂不实现）

`http` 自定义 HTTP 请求 · `mqtt` · `homeassistant` · `script` 本地脚本 · `clipboard` 剪贴板同步

---

## 七、首版功能清单（P0）

1. **设置页**（custom 页面，分「通用 / 通道 / 外观」三组）—— 面板名、主题、超时；通道区由 `settingsSchema` 自动生成，带**连接测试**
2. **按钮网格** —— 分类切换、响应式列数（手机 3 / 平板 4 / PC 6）、悬浮或长按出编辑菜单（编辑 / 复制 / 删除）、空状态引导
3. **按钮编辑器** —— 第一项选通道，其余字段由该通道 `actionSchema` 动态渲染；实时预览卡片，「试发一次」，危险动作二次确认开关
4. **快速发送条** —— 输入框 + 模式切换（复制 / 粘贴 / 模拟输入）+ 历史记录，回车即发
5. **动作返回值面板** —— `wait=true` 时展示返回内容、耗时、设备明细；可复制结果
6. **执行日志** —— 最近 50 条，含通道、成功失败、耗时、错误、返回内容；支持清空与导出
7. **导入导出** —— JSON 文件、文本粘贴；单个按钮可导出为 GET 直链（可存书签 / iOS 捷径）
8. **卡片尺寸调整** —— 宽度按列、高度 `auto`/`fixed` 两档；拖拽手柄 + 尺寸按钮 + 预设档位三种改法（见 UI-DESIGN.md 第六节）
9. **展示模式** —— 顶栏侧栏全隐藏 + 屏幕常亮 + 防误触，含退出热区设计（见 UI-DESIGN.md 第十三节）

Quicker 通道的 operation 与字段矩阵：

| operation | data | action | 说明 |
| --- | --- | --- | --- |
| copy / paste / inputtext | 必填 | — | 复制 / 粘贴 / 原样输入 |
| sendkeys（旧名 input） | 必填 | — | 模拟按键语法，1.27.3+ 推荐用此名 |
| open | 必填 | — | 网址或文件路径 |
| action | 可选 | 必填 | 动作 ID 或名称，名称不能重复 |
| inputscript | 必填 | — | 多步骤键鼠输入 |
| downloadfile | 必填 | — | 单个文件网址 |

---

## 八、实施步骤

1. `index.html` 骨架 + `app.css` 主题变量与基础组件
2. **外壳与模块注册表**：AppBar / 侧栏 / 卡片网格容器 / 编辑模式 / `EP.modules.register` 与页面列表骨架；先用两个占位模块跑通"添加卡片 → 持久化 → 刷新还原"闭环
3. **store**：读写、旧 key→`ep.*` 迁移（含 pages / cards）、导入导出骨架
4. **通道注册表** + `quicker` 通道实现 + 连接测试；用一个占位通道验证"换通道 → 编辑器字段跟着变"（最终 `quicker` 拆出到 `channels/quicker.js`）
5. UI：设置页（三组分区，通道区自动生成）+ 按钮网格渲染 + 空状态
6. UI：按钮编辑器（通道切换 → 字段联动 + 预览 + 试发）
7. UI：快速发送条 + 返回值面板 + 执行日志
8. 展示模式 + 卡片尺寸调整
9. 移动端适配与自测（真实凭证联调）

---

## 九、自测清单

- [ ] 本地起静态服务器（`http://`）打开，无控制台报错
- [ ] 直接 `file://` 双击打开，功能一致（验证无 ES module 问题）
- [ ] 断网打开：页面样式与图标正常（验证零 CDN）
- [ ] 从旧版导出配置导入：按钮、分类、图标、背景全部迁移正确，且变成 `channel + params` 结构
- [ ] `copy` 一条文本：电脑剪贴板收到
- [ ] `action` + `wait=true`：结果面板显示动作返回值
- [ ] 错误凭证：提示"邮箱或验证码不正确"
- [ ] 手机浏览器打开：能添加/编辑/保存按钮（验证自绘弹窗替代 prompt）
- [ ] 关闭页面再打开：按钮与配置都在

---

## 十、风险与注意

- **本地存储容量约 5MB**：图片图标走 Base64 时需限制单张 ≤100KB，接近上限弹提示
- **Quicker 通道请求体上限 30KB**（含返回消息），超长 `data` 要拦截并提示
- **Quicker 免费版限制**：同时只能一台电脑连接（文档已更新为"运行动作/等待响应已支持"）
- **PWA / Service Worker 需 `http(s)`**，`file://` 下无法注册 —— 仅影响"网页托管 + 添加到桌面"这条路线；**打包成 APK 不受此限制**（资源已在包内，天然离线，不需要 SW 缓存）。详见第十一节
- 凭证明文存在浏览器本地，页面仅限自用，不要部署到公开域名后分享给他人

---

## 十一、APK 打包适配清单

结论：**PWA 那条风险不会被 APK 触发**，但 APK 有它自己的一批坑，需要在代码层面处理。

| # | 事项 | 结论 | 处理 |
| --- | --- | --- | --- |
| 1 | null origin 的 CORS | **实测通过**（2026-09-25） | 服务器对 `Origin: null` / `file://` / `https://…` 一律返回 `Access-Control-Allow-Origin: *`，且无 `Allow-Credentials`，wildcard 可匹配 opaque origin。无需特殊处理 |
| 2 | ES module | APK 内同样不可用 | 已规避：全部用普通 `<script>`，`app.js` 挂 `window.EP`，不使用 `import/export` |
| 3 | 系统弹窗 `prompt/confirm/alert` | 5+ WebView 中不可靠，可能不阻塞或直接返回 false | 已规避：全部自绘弹窗。这是旧版"手机端无法保存按钮"的最大嫌疑 |
| 4 | `file://` 下的本地存储 | 依赖 WebView `setDomStorageEnabled`，个别机型会丢 | **待实现**：存储层全部读写包 `try/catch`；写入失败降级到内存态并弹提示"当前环境无法持久化，请导出配置备份"；启动时做一次读写自检 |
| 5 | Android 物理返回键 | 默认直接退出 App，不会关闭弹窗 | **待实现**：监听 `backbutton`（`document` 事件 + `plus.key`），优先关闭最上层弹窗，无弹窗时才退出 |
| 6 | 输入法顶掉弹窗 | `fixed` 弹窗 + 软键盘会遮挡输入框 | **待实现**：弹窗用可滚动容器（非 `100vh` 锁死），输入框 `focus` 时 `scrollIntoView({block:'center'})` |
| 7 | 打包配置文件混淆 | 旧目录里的 `manifest.json` 是 **5+ 打包配置**（应用名/图标/权限/模块），不是 PWA 的 `manifest.webmanifest` | 新版不引入 PWA manifest，也不注册 Service Worker（在 `file://` 下注册会直接抛错） |
| 8 | 改完不生效 | 打包后资源在包内，改 HTML 必须重新打包或出 wgt | 调试期用"真机运行"，定版再打包；`app.js` 里可加版本号显示在设置页，便于确认跑的是哪一版 |
| 9 | 网络权限 | APK 需 `INTERNET` 权限 | 5+ 默认已带，若自定义 manifest 需确认 |
| 10 | 明文流量 | Android 9+ 默认禁 HTTP | 全部走 HTTPS，无影响 |

---

## 十二、音乐播放器模块：局域网音乐共享怎么接

场景：局域网里有台设备（PC / NAS / 路由器）用 HTTP 静态服务共享了音乐文件夹，音乐文件的内嵌元数据里带歌词。

### 服务端要求

| # | 要求 | 为什么 |
| --- | --- | --- |
| 1 | 目录可列出 | 要能发现有哪些歌。nginx `autoindex on`、Apache、`python -m http.server` 默认都行 |
| 2 | 响应带 `Access-Control-Allow-Origin: *` | 面板可能是 `file://` 打开的，没有这个头浏览器会拒绝读取目录与文件头 |
| 3 | 支持 `Range` | 拖动进度条；读歌词只取文件头而不是整首歌 |
| 4 | 可选：`/__epanel/list` 接口 | 一个请求拿到全部曲目，省掉逐目录爬 HTML |

`Range` 是 CORS 安全请求头（简单区间写法 `bytes=N-M`），**不会触发 OPTIONS 预检**，所以只要服务端肯返回 `Allow-Origin` 就够了，不用额外配 `Allow-Headers`。

### 最快路径

在音乐文件所在的那台机器上：

```bash
python tools/music_server.py --dir "D:\Music"
# 也可以指定端口
python tools/music_server.py --dir "D:\Music" --port 8080
# 只想验证"没有 /__epanel 接口"时的回退路径
python tools/music_server.py --dir "D:\Music" --plain
```

脚本会打印本机与局域网地址，把**局域网那一行**填进面板卡片的「音乐目录地址」即可。

### 已有静态服务怎么办

nginx：

```nginx
location /music/ {
    alias /srv/music/;
    autoindex on;
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Expose-Headers "Content-Range, Content-Length, Accept-Ranges";
}
```

Apache：`<Directory>` 里 `Options +Indexes` + `Header set Access-Control-Allow-Origin "*"`。

### 歌词读取策略（实现要点）

- 只读文件头：默认 1.5MB；ID3 标签比窗口大时才按精确长度补一次（需要 Range）
- 服务端忽略 Range（返回 200 全量）时，拿到的就是整个文件，同样能解析
- 播放时按需读歌词，不会预读全部歌曲的歌词
- 「自动预读曲目信息」只读每首前 64KB（补标题/歌手），上限 200 首、并发 3；**仅在探测到 Range 支持时才启用**，否则会变成整库下载

### 支持的歌词来源

| 容器 | 帧 / 字段 | 说明 |
| --- | --- | --- |
| MP3 | `USLT`（v2.2 叫 `ULT`） | 非同步歌词，最常见 |
| MP3 | `SYLT`（`SLT`） | 同步歌词，时间戳格式为毫秒时可直接逐句 |
| MP3 | `TXXX` 描述含 `lyric` | 部分打标工具把歌词放这里 |
| FLAC | Vorbis comment `LYRICS` / `UNSYNCEDLYRICS` | |
| 其它（m4a / ogg / wav…） | — | 暂不解析，但能正常播放 |

歌词文本是 LRC（`[mm:ss.xx]`）时逐句滚动高亮，否则整段显示。文本编码支持 ISO-8859-1 / UTF-16(BOM) / UTF-16BE / UTF-8。

### 连不上怎么办（2026-09-27 补齐）

**扫描失败后会自动重试**，退避 5s → 10s → 20s → 30s → 60s（最后一档封顶），连上就重置。
`destroy` 里会 `cancelRetry()`。错误文案会明确告诉用户"面板会自动重试，服务恢复后自动连上"。

⚠️ 以前是**没有自动重试**的：失败后永久停在错误态，而卡片只在挂载时才重新扫描，
页面又不会自己重挂载 —— 所以"服务没开 → 后来开了"看起来像"失败被记住了"。
排查时先写复现脚本跑一遍，别凭猜。

其它两条恢复路径：

- 页签那一行右侧有个**「重新扫描目录」**按钮（`refresh` 图标）——手动强推，也能刷新新增的歌
- 挂载时若 `state==='done' && 距上次扫描 > 60 秒 && 音频暂停`，会补扫一次
  （否则服务端关了 / 加了新歌，面板会一直显示旧列表）

**重新扫描不打断播放**：扫描前记下当前曲目 url，扫完若那首还在且音频没坏
（`!audio.error && readyState >= 1`）就只更新列表、不重新加载音频。

**播放中断要区分原因**（`audio.onerror`）：

| `audio.error.code` | 含义 | 处理 |
| --- | --- | --- |
| 2 | MEDIA_ERR_NETWORK | 当成"连接失败"：进错误态 + 自动重试（服务被关了/断网） |
| 3 / 4 | 解码失败 / 格式不支持 | 只标记这首坏 + 提示，不当成连接问题 |

### 手机连不上：先查网络，再怀疑代码（2026-09-27 最终定位）

用户反馈"连不上、换了地址也不行"，最后按下面两步定位到**真实原因在服务端的地址探测**：

1. **手机浏览器直接打开那个地址** → 「该地址未发送任何数据」
2. **服务端日志一条请求都没有** → 请求根本没到电脑

⇒ 不是跨域、不是面板，是**手机到电脑这条路没通**。然后跑 `tools/net_check.py` 看到：

```
以太网  192.168.1.5
WLAN   192.168.10.138      ← 两张真网卡，在不同网段
```

**根因**：`music_server.py` 原来的 `lan_ips()` 只做「默认路由 IP + `gethostname()` 解析」，
**只会拿到主网卡的地址**。这台机器默认路由走网线（192.168.1.5），
于是面板里填的就是它；而手机连的是 WiFi（192.168.10.x 网段），永远连不上 ——
而且因为请求压根没到，服务端日志里一条都没有。

**修法**：`lan_ips()` 改成枚举**全部网卡**（借 `net_check.list_adapters()`，能拿到网卡名），
并给出建议等级：

| 类别 | 判断依据 | 建议 |
| --- | --- | --- |
| 局域网 | 私网地址 + 网卡名像物理网卡（以太网/WLAN） | ✓ 手机填这个 |
| 自动私有地址 | 169.254.x.x | ✗ 没拿到 IP |
| 虚拟网卡 / VPN | 网卡名含 vmware/virtualbox/vEthernet/wsl/tun/clash/… | ✗ 手机连不上 |
| 代理假 IP | 198.18/198.19（Clash 之类 TUN 用的） | ✗ 手机永远连不上 |
| 回环 | 127.x | ✗ 只有本机 |

启动横幅现在会把每个地址配上网卡名和建议，并且**多网卡时额外给一行"整段复制"的多地址**
（配合面板的多候选地址功能，粘进去就自动试）。

### tools/net_check.py —— 连不上时先跑这个

```bash
python tools/net_check.py --port 8000
```

输出三块：**① 本机监听情况**（有没有绑到 0.0.0.0）、
**② 手机上该填哪个地址**（逐张网卡分类，给出推荐地址 + 可以用手机浏览器开的
`/__epanel/ping` 自测链接）、**③ Windows 防火墙**（当前网络被认成 公用/专用、
默认入站策略、有没有 python 的放行规则），最后给一串可直接复制、需要管理员权限的修复命令
（`netsh advfirewall firewall add rule …` / `Set-NetConnectionProfile … -NetworkCategory Private`），
外加两条常见坑：路由器 **AP 隔离**、电脑开着 **Clash 等 TUN 模式代理**。

⚠️ 写这类脚本注意：**中文 Windows 上 PowerShell 默认按 GBK 输出**，
Python 里 `text=True` 直接按 utf-8 解码会抛 `UnicodeDecodeError`。
`net_check.ps()` 的做法是先让 PowerShell `[Console]::OutputEncoding=UTF8`，
再按 utf-8 → mbcs → cp936 逐种编码兜底。



### 启动方式：批处理 / 双击 / 托盘（2026-09-28）

三种启动方式，日常用前两种：

| 方式 | 有没有黑框 | 说明 |
| --- | --- | --- |
| 双击 `tools/启动音乐服务.bat` | 闪一下 | 批处理只负责把 `.pyw` 用 pythonw 拉起来，自己立刻退出 |
| 双击 `tools/music_server.pyw` | **完全不闪** | 最安静；可以右键发到桌面快捷方式 / 开始菜单 |
| `python tools/music_server.py` | 有控制台 | 要看实时日志 / 调参数时用；`--tray` 额外给托盘 |

**托盘图标**（`--tray`，`.pyw` 默认开）右键菜单：

- **复制地址** —— 直接把 `http://192.168.1.5:8000/` 放进剪贴板，省得手抄（还会弹个气泡确认）
- **在浏览器里打开** —— 顺手验证服务通不通
- **打开日志** —— 没有黑框时日志写在 `tools/music_server.log`
- **关闭服务** —— 等价于 Ctrl+C

实现要点（`run_tray`，**纯 ctypes 调 Win32，零第三方依赖**）：

- 窗口用隐藏的 `WS_POPUP`（不用 message-only 窗口）—— 这样 `FindWindowW(类名)` 找得到，
  自动化测试才好写
- `TrackPopupMenu` 之前**必须先 `SetForegroundWindow`**，否则点到菜单外面菜单不消失
- 消息循环用 `PeekMessageW` 轮询 + `sleep(0.05)`，不用阻塞的 `GetMessageW` —— 这样 Ctrl+C 才生效
- 回调函数必须留引用（`_KEEP`），否则被 GC 掉直接崩
- ⚠️ **托盘只是锦上添花，出任何错都不能把服务带崩**：`run_tray` 外面包了 try/except，
  失败就打印原因并退回普通 `serve_forever`

### ⚠️ ctypes 的坑：必须声明 argtypes / restype

这次踩了两次同样的坑：**不声明 `argtypes`，ctypes 会把 Python int 按 32 位处理**，
传 64 位句柄就出事：

- `CreateWindowExW(..., hInstance)` → `ctypes.ArgumentError: argument 11: OverflowError: int too long to convert`
- `GlobalAlloc` 不声明 `restype` → 返回的句柄被截成 32 位 → `GlobalLock` 拿到野指针 →
  `OSError: access violation writing 0x0000000000000000`

写 Win32 的 ctypes 代码时，**凡是涉及句柄/指针的函数，argtypes 和 restype 都要写全**。

### 面板侧的失败分类（2026-09-27）

⚠️ **浏览器出于安全不会告诉 JS「连接被拒」和「被跨域挡」的区别**（两种情况 XHR 都只给一个
`onerror`，`status` 都是 0）。实测 `fetch(url, {mode:'no-cors'})` 在 `file://` 页面上**两种情况都
reject**，也区分不了。所以只能靠两样东西判断：

**一、耗时**（`classifyScanError`）

| 表现 | 结论 | 提示里让用户查什么 |
| --- | --- | --- |
| 等到超时才失败（~8 秒） | 地址根本不通 | IP / 端口、同一 WiFi、防火墙、路由器 AP 隔离 |
| 秒失败（几十毫秒~2 秒） | 那边有东西响应但读不到 | 用手机浏览器打开这个地址；能看到文件列表 = 跨域头问题 |

**二、服务端日志**（最可靠）：`music_server.py` 默认打印每条请求。
- 有请求行 = 请求到了，是跨域头的问题
- 一条都没有 = 请求根本没到，查 IP / 防火墙 / AP 隔离

**性能上的修正**：`scanBase` 里 helper 请求超时从 20 秒降到 **8 秒**，而且
**网络层失败时不再退回爬目录页**（同一个源不可能爬得到，白等一次超时）。
以前输错地址要干等 40 秒，现在最坏 8 秒。

**支持填多个候选地址**（`splitBases`，空格/逗号/分号/换行分隔）：
电脑常有多张网卡（有线 + 无线 + 虚拟机网卡），服务端会打印好几行地址。
面板按顺序挨个试，哪个通用哪个，成功后 `sess.live` 记住它（**不回写用户配置**，
所以不会因为回写触发重挂载）。切到了备用地址会 toast 提示一次。

`music_server.py` 启动横幅也跟着改了：第一个地址（按默认路由选出来的）标上
**「<- 手机优先填这个」**，多于一个地址时再给一行**可以整段复制**的多地址，
并说明"服务端日志能证明请求有没有到"。

**「连接诊断」按钮**（设置区）现在会：逐个候选地址打一次 `/__epanel/list`，
分别报「可用 / 有响应但没接口 / 秒失败 / 超时」+ 耗时，给出结论用哪个地址，
最后附三条自查步骤（手机浏览器打开、看服务端日志、多个地址一起填）。

### 歌词版式

**卡片里的顺序（从上到下）**：页签（播放列表 / 歌词）→ 主区域 → 曲目信息 → 进度 → 控件。
主区域就是"歌词区/列表区"，放在卡片上方并用 flex 撑满剩余高度，曲目信息和控件沉到底部。

- 高度：`.mp-main` 是 flex 列，`.mp-panel{flex:1}`。卡片高度设成「固定」时主区域自动填满卡片
  （模块给 `.card-body` 加 `mp-fill` 类，让它变成可伸缩列）；卡片是自适应高度时用卡片设置里的
  「区域高度」（默认 420px）。
- **不要用 `max-height` 限死面板高度**，否则 flex 撑不起来；面板用 `min-height:64px` 兜底。
- 水平居中 + 当前句停在面板正中间（`LYRIC_ANCHOR = 0.5`），当前句 `scale(1.12)` + 强调色，
  其它行 `opacity .62` 淡显；换句时面板用 rAF 缓动（easeOutCubic，480ms）平滑滚动，
  当前句带上浮淡入动画。
- **字号**：默认 16px，卡片设置里有「歌词字号」滑块（12~30px，`live: true` 拖动即时预览，
  取消则还原）。字号是**写在 `.mp-ly` 容器的 inline style 上**、由逐句 `<p>` 继承的，
  比 CSS 变量兼容性更好；改字号后要重新对齐当前句（行高变了）。
- 配置项 `live: true` 是通用能力：`openCardSettings` 会按 schema 里的这个标记决定哪些字段
  实时预览（早期是把字段名写死成 `size` 的，已泛化）。
- ⚠️ 当前句的 `transform: scale()` 会撑大滚动区域，**必须给面板 `overflow-x:hidden`**，
  否则歌词区会冒出一条横向滚动条。（注意：`overflow-x:hidden` 之后 `scrollWidth` 仍会大于
  `clientWidth`，判断"有没有横向滚动条"要看 `getComputedStyle().overflowX` 和
  `offsetHeight - clientHeight`，不能看 scrollWidth。）
- 用户手动滚动歌词后 4 秒内不抢位置。注意滑动检测必须区分"程序滚动"和"用户滚动"
  （`sess.animating` / `sess.progTop`），否则自己会把自己的自动滚动锁死。
- ⚠️ 后台任务（预读标题、切歌、播放失败）想重画列表时，必须走 `refreshList()`（只在当前是列表页
  时才重画），**不能直接调 `renderList()`**，否则会把用户正在看的歌词页顶掉——表现为
  "标签高亮在歌词、内容却是列表"。

---

## 十三、打包 APK

### 13.1 两条路线

| 路线 | 谁来做 | 结果 | 依赖 |
| --- | --- | --- | --- |
| **A. 官方云打包** | 你在 HBuilderX 里点一下 | 正式包：名字/图标/权限都由 HBuilderX 管理，后续能持续升级 | 装 HBuilderX + DCloud 账号 |
| **B. 本地重打包**（已实现） | `python tools/build_apk.py` 一条命令 | 把新面板塞进旧 DCloud 5+ 外壳并重新签名，立刻能装 | 只要 JDK + build-tools |

路线 B 的原理：旧 APK 本身就是 DCloud 5+ 运行外壳，网页资源在 `assets/apps/H551BFC19/www/`。
所以只要换掉 www、改掉 `resources.arsc` 里的应用名、换掉启动图标、重新签名即可，
**不需要 Android SDK，也不需要 HBuilderX**。

### 13.2 用法

```bash
# 一条命令出包
python tools/build_apk.py
# 想改名字 / 换外壳
python tools/build_apk.py --name "E 面板" --base "D:\path\to\shell.apk"
# 只看重打包结果、不签名（调试）
python tools/build_apk.py --no-sign
```

产物：

```
build/EPanel-3.0.0-<日期>.apk     ← 直接装
build/www/                        ← 打进 APK 的网页资源（可单独检查）
build/hbuilder/EPanel/            ← 标准 HBuilderX 工程（走路线 A 时直接打开这个目录）
build/keystore/epanel.keystore    ← 签名证书，务必留好，以后升级要用同一个
```

签名证书：密码 `epanel2026`，别名 `epanel`。**换掉证书就没法覆盖安装旧版本。**

### 13.3 tools/build_apk.py 干了什么

1. 用 Pillow 生成应用图标（渐变圆角底 + 白色粗体 E），缩到 hdpi/xhdpi/xxhdpi/xxxhdpi 四档
2. 把 `index.html / app.css / app.js / channels/ modules/` 收进 `build/www`，并补上 5+ 需要的
   `manifest.json`（只改 name）和 `androidPrivacy.json`
3. **`resources.arsc` 改应用名**：解析全局字符串池，定位唯一一条 `Quicker快捷面板`，
   在原地写入新名字并用 0 补齐 —— 池大小、字符串偏移、其它 1329 条字符串全部不动。
   改完会重新解析一遍做复核（逐条比对，只有目标那条允许不同）。
4. 重打 zip：换 www、换图标、换 arsc，删掉旧的 `META-INF/*.SF|RSA|DSA|EC`，
   **保留每个条目的原压缩方式**（`resources.arsc` 必须保持 STORED）
5. `zipalign -p -f 4` → `apksigner sign`（v1+v2+v3）→ `apksigner verify`
6. 顺手生成一份 HBuilderX 工程

### 13.4 这次打包的实测结果

```
package            quickerPanel.Evelynal  versionCode 100  targetSdk 28  minSdk 19
application label  E 面板
launchable-activity io.dcloud.PandoraEntry
native-code        arm64-v8a
zipalign -c 4      Verification succesful
apksigner verify   v1 true / v2 true / v3 true，签名者 CN=EPanel
```

### 13.5 两个已知限制

1. **只有 arm64-v8a**（外壳自带的就是这个），32 位设备装不上。
2. 应用名改了，但 **包名 `quickerPanel.Evelynal` 和 versionCode 还是旧的** —— 改这两样要动
   二进制 `AndroidManifest.xml`，风险大收益小，没做。想换包名走路线 A。

### 13.6 APK 里需要处理的适配（跟着一起做完了）

- 物理返回键：优先关最上层弹窗 → 退出编辑模式 → 回主控台 → 没有可返回的层级才退出应用；
  同时监听 `document` 的 `backbutton`（5+ 会派发）与 `plus.key`，`plusready` 不派发时用轮询兜底
- 软键盘：`plus.webview.currentWebview().setStyle({ softinputMode: 'adjustResize' })`
  让 WebView 压缩视口而不是把页面顶飞；再配一个 `focusin` 处理器把输入框滚进弹窗可视区
- 屏幕常亮：展示模式优先用 Web Wake Lock，`file://` / APK 下退回 `plus.device.setWakelock`
- 本地存储：读写全包 try/catch，失败降级内存态并提示导出配置

### 13.7 软键盘一弹就被收回（真机上踩到的坑，已修）

**现象**：点输入框 → 软键盘弹出来 → 马上又被收回 → 打不了字。

**根因**（不是键盘的问题，是页面自己被重建了）：

```
点输入框 → 软键盘弹出
        → adjustResize 让 WebView 视口变矮
        → window 触发 resize
        → 我们的 resize 处理器 200ms 后调 renderPage()
        → renderPage() 里 host.innerHTML = '' 把 #page 整个重建
        → 正在聚焦的输入框被销毁 → 失焦
        → Android 把软键盘收回去
```

**修法**（两道）：

1. **resize 只认宽度变化**。卡片列数只跟宽度有关，软键盘只改高度 —— 高度变化一律忽略：
   ```js
   if (Math.abs(window.innerWidth - lastW) < 2) return;
   ```
2. **`renderPage()` 加锁**：`#page` 里有输入框聚焦时只挂起（`pendingRender = true`），
   不重建 DOM；在 `focusout` 和弹窗关闭时再补一次。
   弹窗里的输入框在 `#modalRoot`、不在 `#page` 内，所以不受影响（编辑器的保存路径照旧立即重排）。

⚠️ **以后写任何"窗口尺寸变了就重排"的逻辑都要先想一下软键盘**：
它会让 WebView 触发 resize，而重建 DOM = 输入框失焦 = 键盘收回。
配套回归测试 `tests/test_input.py`：只改视口高度 → 断言输入框没被重建、焦点还在、能继续打字；
聚焦时改宽度 → 断言被挂起、失焦后补上。

### 13.8 拖动排序/缩放触摸端失灵（真机上踩到的坑，已修）

**现象**：手机上卡片完全拖不动；拖右下角缩放"勉强能用但很奇怪"。

**三个原因**：

1. **缺 `touch-action: none`**。触摸端浏览器会把手势当成页面滚动，
   拖动刚开始就发 `pointercancel` 打断 → 表现为"拖不动"。
   指针事件时代，`pointerdown` 里的 `preventDefault()` **不能**阻止滚动，只有 `touch-action` 能。
   → `.card-hd`（拖动把手）和 `.resize` 都加 `touch-action: none`，
   再配 `user-select: none` + `-webkit-touch-callout: none` 防长按选中/菜单抢手势。
2. **缩放没处理 `pointercancel`，也没收尾**。手势被系统打断后监听器一直挂在 `window` 上，
   之后手指随便动一下都还在改尺寸 —— 这就是"很奇怪"的来源。
   → 补 `cancel()`：还原尺寸 + `cleanup()`。
3. **缩放手柄只有 22×22**，触摸端太小。→ 触摸设备上放大到 30×30。

顺手补的：拖动/缩放都加了 `pointerId` 校验（多指不打架）、只认鼠标左键、
拖动被取消时还原到原位、拖动/缩放期间给 `body` 挂类禁掉文字选中。

⚠️ **代价（已知取舍）**：`.card-hd` 设了 `touch-action: none` 之后，
**从卡片标题栏往下滑不再能滚动页面**（拖动常驻的必要代价）。卡片正文、卡片间隙、
页面留白都还能滚。展示模式下拖动是关掉的，所以那里把 `touch-action` 还回 `auto`。
如果以后觉得标题栏不能滚很难受，可以把拖动把手收到标题栏左侧一小块，其余部分还给滚动。

回归测试 `tests/test_drag.py`（用 `pointerType: 'touch'` 的真实 PointerEvent 走完整手势）：
- `touch-action` 计算值必须是 `none`
- 拖动排序：被拖卡片跑到第一位 + 顺序持久化
- 拖动中 `pointercancel` → 顺序还原（且断言中途确实变过，避免假阳性）
- 缩放：宽度变大 + 高度转 fixed
- 缩放中 `pointercancel` → 尺寸还原，且之后再动手指不会再改尺寸（无残留监听）

---

## 十四、空闲自动进入展示模式

设置页「外观」区块里两项：**空闲自动进入展示模式**（开关，默认关）+ **空闲时长（秒）**
（默认 10，范围 5~600，只在开关打开时显示）。

行为：

- 计时器在 `pointerdown / keydown / wheel / touchstart / 滚动` 时重置（**捕获阶段**监听，
  免得被模块的 `stopPropagation` 挡掉）
- 到点后满足以下任一条件就**不进入**，但会继续重新计时（等条件解除还能触发）：
  已经在展示模式里 / 正在编辑布局 / 有弹窗打开 / 页面里有输入框聚焦
- 进入用 `enterKiosk()`，退出还是老规矩：长按右上角（或 Esc / Alt+K），退出后会重新计时
- 切到后台（`visibilitychange` → hidden）时取消计时，回前台重新开始
- 配置改了（开关或秒数）立刻按新设置重新计时，不用等下一轮

配套回归 `tests/test_kiosk.py`：默认关闭且 10 秒；开关与时长字段（含 `showIf` 联动）；
静止到点自动进入且顶栏侧栏真的隐藏；Esc 退出后下一轮还会进；弹窗开着时不进、关掉后会进；
操作会重置计时；关掉开关后不再触发。

### 附：一个 CSS 坑（顺手修的）

右下角那个圆球是**顶栏完全隐藏时的「唤出把手」**（`#chromeHandle`）。
它本来只在 `topBar === 'never'`（或滚动自动隐藏后）出现，但**作者样式里的
`.chrome-handle { display: flex }` 会盖掉 UA 样式表的 `[hidden] { display: none }`**，
所以设了 `hidden` 也照样显示 —— 看着就像一个"永远在那儿的没用圆球"。

修法：在 `app.css` 里显式加一条

```css
[hidden] { display: none !important; }
```

⚠️ 这是通用坑：**只要给元素写了 `display`，`hidden` 属性就失效了**，
以后加新元素要么别写死 `display`，要么记得补这条兜底。


