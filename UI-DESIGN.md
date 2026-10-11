# EPanel（E 面板）· 界面设计规划

> 配套文档：`PLAN.md`（功能与通道约定）
> 设计定位：**卡片式工作台** —— 首页是可自由增删排序的卡片网格，每个功能是一个"模块"；动作走哪个"通道"由按钮自己决定。以后加功能 = 注册模块，加执行方式 = 注册通道，都不动外壳。

---

## 一、设计目标

1. 首屏就是工作台，不是"按钮列表页"。
2. 功能解耦成模块，新增功能不改外壳、不改存储层之外的代码。
3. **界面不绑定任何一个通道** —— Quicker 只是当前唯一可用的通道，界面上不出现"这是个 Quicker 遥控器"的暗示。
4. 同一套布局同时照顾手机单手操作和 PC 大屏。
5. 视觉与交互延续已定原则：零 CDN、自绘弹窗、CSS 变量主题。

---

## 二、三层结构：Shell / Page / Card ← Module

```
┌──────────────────────────────────────────────────────┐
│ AppBar   E 面板   ● 在线   通道 ▾   [主题] [设置]     │
├──────────┬───────────────────────────────────────────┤
│ 侧栏      │  卡片网格（Page = dashboard）             │
│ ▸ 主控台  │  ┌────────────┐ ┌────────────┐           │
│   日志    │  │ 快捷按钮   │ │ 快速发送   │           │
│   设置    │  └────────────┘ └────────────┘           │
│ + 加页面  │  ┌────────────┐ ┌──────────────────────┐ │
│           │  │ 结果面板   │ │ 执行日志             │ │
│           │  └────────────┘ └──────────────────────┘ │
└──────────┴───────────────────────────────────────────┘
```

- **Shell**：顶栏 + 侧栏 + 主区，负责导航、通道状态、主题、全局操作。
- **Page**：一个页面。有两种类型 —— `dashboard`（卡片网格容器）、`custom`（整页自定义，给设置页、将来的文件传输这类功能）。
- **Card**：页面内的最小单元，占网格若干列，由模块提供内容。
- **Module**：界面功能实现体，向注册表声明自己，被卡片引用。

---

## 三、两套注册表：模块与通道

### 3.1 模块（管"怎么呈现"）

```js
EP.modules.register({
  id: 'buttonGrid',               // 唯一标识，存进 card.moduleId
  name: '快捷按钮',
  icon: 'grid',                   // 内联 SVG 图标 id
  desc: '按分类展示快捷触发按钮',
  version: 1,
  comingSoon: false,              // true 表示占位，添加卡片时灰显
  layout: { w: 2, h: 2, minW: 1, minH: 1 },
  defaultSettings: { categoryId: 'all', size: 88 },
  settingsSchema: [               // 声明式生成设置表单，省得每个模块手写 UI
    { key: 'categoryId', label: '固定分类', type: 'category', hint: '选「全部」则显示分类切换条' },
    { key: 'size', label: '按钮边长', type: 'range', min: 56, max: 200, step: 4, default: 88, live: true }
  ],
  mount: function (cardEl, ctx) {
    /* 渲染卡片内容 */
    return {
      destroy: function () { /* 解绑事件、清定时器 */ },
      update: function (settings) { /* 卡片设置实时预览（可选） */ }
    };
  }
});
```

**ctx 交给模块的能力**（内核在挂载前注入）：

| 字段 | 说明 |
| --- | --- |
| `card` / `settings` | 卡片实例与其设置（settings 已被 defaultSettings 兜底） |
| `edit` | 当前是否处于编辑模式 |
| `save(patch)` | 合并并持久化设置；卡片设置变更时触发 |
| `store` | 统一的本地存储读写（带兜底） |
| `toast(msg, type)` | 轻提示 |
| `dialog.confirm(msg)` / `dialog.menu(title, items)` | 自绘确认框 / 菜单，返回 Promise |
| `openPage(id)` / `setTitle(str)` | 页面跳转、改卡片标题 |
| `size` | 卡片当前尺寸 `{ w, hMode, h }` |

模块需要用到的其他能力（`EP.util` / `EP.icon` / `EP.channels` / `EP.state` 等）直接从 `window.EP` 读取，不通过 ctx 注入。

**页面扩展**：目前页面不是注册表，而是纯数据（`ep.pages` / `ep.cards`）。自定义整页功能暂由内置设置页承载，后续如需扩展再单独设计 `EP.pages` 注册表。

### 3.2 通道（管"怎么执行"）

```js
EP.channels.register({
  id: 'quicker',
  name: 'Quicker 推送',
  icon: 'bolt',
  desc: '通过 Quicker 推送服务远程触发电脑动作',
  settingsSchema: [...],   // 通道级配置 → 设置页「通道」分区
  actionSchema: [...],     // 动作参数表单 → 按钮编辑器
  run: function (params, settings, ctx) { return Promise.resolve({ ok, cost, result, errorMessage, raw }); },
  test: function (settings) { return Promise.resolve({ ok, devices, active, errorMessage }); },
  buildUrl: function (params, settings) { return '...'; }
});
```

详见 `PLAN.md` 第六节。

### 3.3 两者的交汇点：按钮编辑器

这是通道抽象在界面上最关键的一处体现：

```
┌─ 编辑按钮 ──────────────────┐
│ 名称    [锁屏            ]  │
│ 执行方式 [Quicker 推送   ▾] │ ← 第一项，下拉来自 channels.list()
│ ─────────────────────────── │
│ 操作类型 [paste         ▾]  │ ← 以下全部由该通道的 actionSchema 渲染
│ 数据     [              ]  │   showIf 控制显隐
│ 目标设备 [              ]  │
│ 等待返回值  [○]             │
└─────────────────────────────┘
```

**加一个新通道时，编辑器不会有任何硬编码改动** —— 下拉多一项，下面的字段自动换一套。

---

## 四、数据结构（对 PLAN.md v3 的增补）

```js
// ep.pages
[{ id, name, icon, type: 'dashboard' | 'custom', order, builtin, cards: [cardId], displayDefault }]

// ep.cards
[{ id, pageId, moduleId, title, settings: {}, layout: { w, hMode: 'auto'|'fixed', h }, collapsed, order }]
```

- 按钮仍独立存在 `ep.buttons`，由"快捷按钮"卡片引用 —— 保留旧版手感和迁移路径。
- 新建页面默认给一组卡片；`builtin: true` 的页面不允许删除。
- 卡片与页面都用 `order` 排序，不用数组下标当序号，避免中间插入时全量重写。

---

## 五、布局与响应式

| 断点 | 网格列数 | 侧栏形态 |
| --- | --- | --- |
| ≥ 1024px（PC） | 12 列 | 左侧常驻 200px |
| 640–1023px（平板） | 8 列 | 左侧常驻，可折叠 |
| < 640px（手机） | 4 列 | **底部 Tab 栏**（主控台 / 日志 / 设置 + 更多） |

- 卡片高度**内容自适应**，不锁死行高 —— `layout.h` 只在空卡片时用于占位估算，避免内容溢出被裁切。
- 手机上 `w ≥ 3` 的卡片自动降级为整行，防止挤成一团。
- 顶栏在手机上只留：面板名 + 状态点 + 设置齿轮，通道与设备选择收进设置页。
- 顶栏与侧栏都支持隐藏（常驻 / 自动 / 完全隐藏），详见第十二节。

---

## 六、编辑模式

- 顶栏「布局」开关 → 进入编辑态：卡片显示拖拽把手、宽度 ±、移除按钮，主区底部出现虚线「+ 添加卡片」。
- 添加卡片：自绘弹窗列出**已注册模块**（图标 + 名称 + 描述），点击插入到当前页末尾并立即持久化。
- 手机端：**长按卡片**进入编辑，避免误触；编辑态顶部出现「完成」。
- 拖拽排序用 Pointer Events 实现（不用 HTML5 draggable，后者在移动端 WebView 不支持）。
- 所有改动即时写入，不做"保存/取消"两步 —— 工作台类界面即时反馈更符合直觉。

### 卡片尺寸调整

尺寸模型：`layout: { w, hMode, h }`

- `w`：列跨度，1 ~ 网格总列数（PC 12 / 平板 8 / 手机 4），受模块声明的 `minW` 约束。
- `hMode`：`auto`（默认，内容自适应）/ `fixed`（固定高度，`h` 为像素值，内容区内部滚动，不撑破布局）。
- 模块通过 `ctx.size` 读取当前尺寸，并可注册 `onResize` 回调做重排 —— 例如"快捷按钮"按宽度重算每行按钮数。

**三种改法都要有**（不同场景各有最优解）

| 方式 | 平台 | 说明 |
| --- | --- | --- |
| 拖拽手柄 | PC | 卡片右下角 16px 手柄，Pointer Events 实现；水平按列吸附、垂直按 40px 步进，拖动时显示尺寸气泡 |
| 尺寸按钮 | 全部 | 卡片菜单里「宽度 −/+」「高度 −/+」，每次 ±1 列 / ±40px —— **手机上主要靠它**，拖拽手柄在触屏上太难点 |
| 预设档位 | 全部 | 小(1/3) · 中(1/2) · 大(2/3) · 整行，一键铺满，省得反复点 |

约束与反馈：

- 不小于模块声明的 `minW` / `minH`，拖到边界时手柄变色提示。
- 手机端"`w ≥ 3` 自动降级整行"（第五节）优先于用户设置。
- 改动即时持久化；卡片「最大化」是临时态，**不覆盖**已保存的 w/h。
- 非编辑态隐藏手柄，防误触。

---

## 七、卡片外观规范

- 卡片：圆角 12px、1px 边框、内容区 padding 12px。
- 标题栏高 40px：SVG 图标 16px + 标题 13px/500 + 右侧菜单按钮；标题栏与内容区分隔线。
- 支持 `collapsed`（折叠只留标题栏）与「最大化」（临时铺满主区，再点还原）。
- 字号只用 13 / 12 两档，字重只用 400 / 500。
- 状态色：在线绿、离线灰、错误红、告警黄；**不用渐变、不用堆叠阴影**。

---

## 八、卡片与页面清单

**首版模块（4 个）**

| 模块 id | 名称 | 默认占位 |
| --- | --- | --- |
| `buttonGrid` | 快捷按钮 | w4 h2 |
| `quickSend` | 快速发送 | w2 h2 |
| `resultPanel` | 动作返回值 | w2 h2 |
| `logList` | 执行日志 | w4 h2 |

**接口先留、暂不实现**（注册为 `comingSoon`，在「添加卡片」里灰显）

`deviceStatus` 通道状态 · `clipboardHistory` 剪贴板历史 · `fileTransfer` 文件传输 · `webFrame` 嵌入网页 · `statusText` 信息展示 · `buttonGroup` 按钮分组小卡

**页面**

| 页面 id | 类型 | 说明 |
| --- | --- | --- |
| `dashboard` | dashboard | 主控台，默认页 |
| `settings` | custom | 设置页，分「通用 / 通道 / 外观」三组 |
| `logs` | custom | 执行日志整页（日志卡片之外的另一入口） |

设置页的「通道」分区由各通道 `settingsSchema` 自动生成，**加通道不需要改设置页**。

---

## 九、主题

CSS 变量集中定义，切换 `data-theme` 即换肤：

```
--bg  --surface  --surface-2  --border  --text  --text-dim  --accent
--ok  --warn  --err  --radius  --gap
```

默认 light，支持 dark，跟随系统 `prefers-color-scheme` 作为首次打开时的默认值。

---

## 十、交互细节

- 弹窗全部自绘：打开时焦点锁在弹窗内，Esc 关闭；Android 物理返回键关闭最上层弹窗（见 PLAN.md 第十一节）。
- 输入框聚焦时 `scrollIntoView({ block: 'center' })`，防软键盘遮挡。
- 危险动作（如清空按钮、清空日志）二次确认；按钮级可开 `confirm` 开关。
- PC 上支持键盘 Tab 导航、Enter 触发。
- 通道执行失败时，Toast 里带上通道名（例如"Quicker 推送失败：…"），多通道时便于区分。

---

## 十一、对实施步骤的影响

在 `PLAN.md` 第八节里，外壳与两套注册表要**先于**真实模块实现：

> **步骤 2 外壳与模块注册表** + **步骤 4 通道注册表** —— 先用占位模块和占位通道跑通"添加卡片 → 持久化 → 刷新还原"和"切换通道 → 编辑器字段跟着变"两个闭环，再填真实内容。

好处是扩展点先验证通，后面四个模块和一个通道就是往里填，不会返工。

---

## 十二、顶栏与侧栏的显示控制

使用场景：手机上想把整屏都留给按钮、平板挂墙当触控面板、以及全屏展示。

**三个档位**（顶栏、侧栏各自独立设置）

| 档位 | 行为 |
| --- | --- |
| `always` | 常驻显示（PC 默认） |
| `auto` | 滚动时自动隐藏：下滚收起、上滚唤出。PC 侧栏改为"悬停左边缘 200ms 展开" |
| `never` | 完全隐藏，只保留唤出入口 |

**唤出入口（关键，防止把自己困住）**

- 顶栏隐藏 → 右下角一个 28px 半透明圆点把手，点击唤出，**长按可拖动到任意角落**；把手上带一个状态小点，隐藏时也能看到通道在线状态。
- 侧栏隐藏 → PC 上默认折叠成 **48px 图标条（rail）**而不是彻底消失，永远留入口；选「完全隐藏」时靠顶栏菜单按钮唤出。
- 手机底部 Tab 隐藏 → 底部保留 4px 高的指示条，点击或上滑唤出。

**配套规则**

- **编辑模式下强制显示**顶栏与侧栏，避免改布局时找不到出口。
- 卡片「最大化」时自动隐藏两者，退出最大化后还原。
- 状态存 `config.chrome`，改动即时生效，刷新保持。
- PC 键盘：默认 `Alt+B` 切侧栏、`Alt+T` 切顶栏（避开浏览器占用的 `Ctrl+B` / `Ctrl+H`），设置页可改。

**实现要点**

- 用 CSS 变量 `--appbar-h` / `--sidebar-w` 驱动网格尺寸，隐藏时置 0 —— 布局不会跳动或留白。
- 顶栏用 `position: sticky` + `transform` 位移实现收起，**不用 `fixed`**（APK WebView 里 fixed 元素与软键盘会打架，见 PLAN.md 第十一节）。
- 滚动方向需设阈值（位移 > 8px 才响应）并防抖，否则手指微抖会导致反复伸缩。
- 完全隐藏且无卡片最大化时，页面顶部保留 12px 安全区，防止误触状态栏。

---

## 十三、展示模式（挂墙触控面板）

定位：把面板变成一块"只能点、不能改"的触控屏 —— 旧平板挂墙、或放桌面上当遥控器。

**进入方式**：顶栏菜单「展示模式」/ URL 参数 `?kiosk=1` / 页面级开关（指定某页默认以此打开）/ 空闲 N 秒自动进入（可选）。

**进入后**

- 顶栏、侧栏、编辑入口全部隐藏（复用第十二节的机制）
- 卡片标题栏可选隐藏（`display.hideCardTitles`），整屏只剩按钮
- **禁用拖拽、卡片菜单、长按编辑** —— 防误触；按钮点击仍正常
- 按钮点击保留按下反馈（缩放 0.96 + 颜色变化），否则触控屏点上去没手感

**屏幕常亮**

- 优先用 Web Screen Wake Lock API（`navigator.wakeLock.request('screen')`）
- 该 API 需要安全上下文，`file://` 与 APK 内可能不可用 → 降级：APK 场景调 5+ 的 `plus.device.setWakelock(true)`；浏览器场景提示"请自行关闭系统休眠"
- 切到后台会自动释放，`visibilitychange` 里回前台需重新申请

**退出方式（必须显式设计，否则挂墙上就退不出来）**

- 长按右上角 40×40 透明热区 1.5 秒 → 弹出确认
- PC：`Esc` 或 `Alt+K`
- 兜底：连续点击同一热区 3 次
- 可选密码（防家人同事误退，默认关闭）

**存储**：`config.display = { enabled, autoIdleSec, hideCardTitles, keepAwake }`；页面级 `page.displayDefault = true` 指定该页默认以展示模式打开。

---

## 十四、新增模块 / 通道的扩展流程

内核已完全与具体功能解耦。新增能力只需两步：

### 14.1 新增一个通道

1. 复制 `channels/reserved.js` 或新建 `channels/<id>.js`。
2. 调用 `EP.channels.register({...})`，填写 `id/name/icon/desc/settingsSchema/actionSchema/run/test/buildUrl`。
3. 在 `index.html` 的「通道」区域加一行 `<script src="channels/<id>.js"></script>`（必须在 `app.js` 之后）。
4. 无需改 `app.js`、无需改编辑器、无需改按钮数据结构；设置页和按钮编辑器会自动根据 schema 渲染。

### 14.2 新增一个模块

1. 复制 `modules/_模板.js` → `modules/<id>.js`。
2. 填写 `id/name/icon/desc/layout/defaultSettings/settingsSchema/mount`。
3. 在 `index.html` 的「模块」区域加一行 `<script src="modules/<id>.js"></script>`（必须在 `app.js` 之后）。
4. 无需改 `app.js`；添加卡片弹窗会自动列出该模块。

> 占位：先把模块/通道注册为 `comingSoon: true`，UI 会灰显，接口先定下来，实现可延后。

### 14.3 模块可用能力

每个模块文件里都能访问 `window.EP` 的：

- `EP.util.mk / esc / uid / merge / fmtTime / $ / $$ / iconHtml / copyText / download`
- `EP.icon(name)` 内联 SVG 图标
- `EP.store` 数据读写
- `EP.channels` 通道注册表与 `EP.channels.run(button)`
- `EP.bus` 事件总线（`buttons` / `result` / `log` / `channels`）
- `EP.dialog.open / confirm / menu`
- `EP.toast`
- `EP.editButton` 按钮编辑器入口
- `EP.state` 内存态数据
- `EP.ui` 外壳状态（`page` / `edit` / `maximized` / `kiosk`）

详见 `modules/_模板.js` 顶部注释。

### 14.4 两个坑（写模块时容易踩）

1. **`defaultSettings` 里不要放数组/对象**。内核的 `merge` 是浅拷贝，放数组会让同一模块的所有卡片共用同一个数组对象，改一张卡片会串到其它卡片上。
   正确做法：数组类数据在 `mount` 里按需初始化，再写回 `ctx.card.settings.xxx` 并 `EP.store.saveCards()`。
2. **模块自带样式用模块文件内的 `<style>` 注入**（用固定 id 做幂等判断，只注入一次），不要去改 `app.css` —— 这样"新模块 = 新文件"才成立。

参考实现：`modules/todoList.js`（数据存卡片 settings、自带样式、卡片设置自动生成两个开关）。

### 14.5 图标：可以注册自己的

内核的图标表只有一小撮通用图标。模块要用自己的图标（比如音乐播放器的音符），**不用改内核**：

```js
EP.icon.register('music', 'M9 18V5l11-2v13…');   // 注册一次
EP.icon('music');                                 // 之后内核各处（含「添加卡片」列表）都能用
```

路径数据用和内核一致的 24×24 线框风格（`fill:none; stroke:currentColor; stroke-width:1.8`）。

### 14.6 长耗时 / 有状态的模块要留意

卡片在任何一次 `renderPage`（切编辑模式、改尺寸、改设置）时都会 **destroy + 重新 mount**。
如果模块持有跨渲染需要存活的东西（音乐播放器的 `<audio>`、正在跑的定时器），
要么存到模块文件级的会话表里按卡片 id 复用（`modules/musicPlayer.js` 的 `SESSIONS`），
要么在 `destroy` 里接受中断。`destroy` 里不要无条件停掉播放，否则改个卡片宽度歌就断了。

## 十五、待定项

1. 手机端导航：底部 Tab（当前默认）还是顶部下拉切换 —— 等你实际在手机上试过再定。
2. 是否允许同一模块在同一页面出现多次：默认**允许**（便于放两组不同分类的按钮）。
