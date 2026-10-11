# EPanel（E 面板）

> 一个通用的面板工作台 —— 纯前端、零后端、离线可用。

把常用动作做成按钮卡片摆在页面上，点一下就能触发。默认接入 **Quicker** 通道，
但架构上通道是可插拔的：同一套界面和交互，以后也能用来触发 HTTP 请求、
Home Assistant、MQTT、本地脚本……**换个通道，界面不用动。**

## 特性

- **纯前端、零依赖** —— 没有 CDN、没有构建步骤，`index.html` 双击就能在浏览器里跑
- **可离线** —— 图标全部内联 SVG，断网不会白屏、图标不会变成方框
- **可打包 Android APK** —— 用 DCloud 5+ 外壳，一条命令出包（`python tools/build_apk.py`）
- **多工作区** —— 按场景（家里 / 办公 / 剪片…）分开管理各自的页面与卡片
- **可扩展架构** —— `Module`（卡片怎么呈现）与 `Channel`（动作怎么执行）两套正交注册表，
  加新功能 = 新增一个文件 + `index.html` 里加一行 `<script>`

## 快速开始

**方式一：直接在浏览器打开**

双击 `index.html` 即可。所有数据存在浏览器 `localStorage`（前缀 `ep.`），凭证不离开本机。

**方式二：打包成 Android APK**

```bash
python tools/build_apk.py
```

需要本机有 JDK；构建工具链（`apksigner` / `zipalign` / `aapt2`）见 `PLAN.md` 的打包章节。
首次打包会生成签名证书，**请务必备份并保管好**（丢失后无法覆盖安装升级）。

**方式三：局域网音乐共享（配套工具）**

在音乐所在的机器上运行：

```bash
python tools/music_server.py --dir "D:\Music"
```

手机与电脑同一局域网即可播放。带托盘图标（零第三方依赖，纯 ctypes），
排障顺序见 `PLAN.md`。

## 架构

```
Shell / Page / Card  ←  Module（卡片怎么呈现）
                     ←  Channel（动作怎么执行）
```

内核 `app.js` 不认识任何具体的模块或通道，只认两张注册表：

| 注册表 | 管什么 | 目录 |
| --- | --- | --- |
| `EP.modules.register` | 界面上一张卡片怎么画、怎么交互 | `modules/*.js` |
| `EP.channels.register` | 点下去之后动作发到哪里、怎么发 | `channels/*.js` |

按钮 = 外观 + `{ channel, params }`。

### 目录结构

```
EPanel/
├── index.html          入口
├── app.css  app.js     内核（Shell / Page / Card / 存储 / 弹窗 / 日志）
├── modules/            模块：卡片怎么呈现
├── channels/           通道：动作怎么执行
├── tests/              Playwright + Python 回归测试
├── tools/              打包脚本、局域网音乐服务
├── PLAN.md             开发计划与技术决策记录
└── UI-DESIGN.md        界面设计说明
```

## 文档

- [PLAN.md](PLAN.md) —— 开发计划、技术决策、Quicker 接口实测、打包与排障记录
- [UI-DESIGN.md](UI-DESIGN.md) —— 界面设计说明
