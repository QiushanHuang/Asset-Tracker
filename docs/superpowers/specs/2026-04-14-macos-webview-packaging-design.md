# macOS 非正式版包装设计

## 背景

当前项目是一个以 `index.html`、`styles.css` 和 `script.js` 为核心的本地静态网页应用，主要依赖：

- `localStorage` 保存本地账务数据和备份时间
- `FileReader` 读取用户导入的文件
- `Chart.js` 和 `XLSX` 的 CDN 脚本

用户当前目标已经明确：

- 将现有项目包装成一个可直接运行的 macOS App
- 暂不做正式签名和公证，只做非正式版
- App 内的数据持久化、导入、导出行为要尽量与浏览器版一致
- 尽量不重写现有网页业务逻辑

## 目标

- 产出一个本地可运行的 `.app`
- 尽量原样复用现有网页 UI 与业务逻辑
- 保持本地数据持久化语义与浏览器版一致
- 让导入/导出在 App 内继续可用
- 去除运行时对外部 CDN 的依赖，保证离线可启动
- 提供一条稳定的本地构建和打包路径

## 非目标

- 本阶段不做 Apple Developer Program 签名和 notarization
- 不将现有业务逻辑重构为全原生 SwiftUI 记账应用
- 不引入 Electron、Tauri 或其他桌面框架
- 不重构现有记账规则、图表逻辑或数据模型
- 不把当前 `localStorage` 主存储替换成数据库

## 推荐方案

采用“原生外壳 + 内置网页资源”的方案：

- 原生外壳：`SwiftUI + WKWebView`
- 前端资源：将现有 `index.html`、`styles.css`、`script.js` 作为 App Bundle 资源打包
- 第三方依赖：将 `Chart.js` 和 `XLSX` 下载到本地并改为相对路径引用
- 桥接能力：通过 `WKScriptMessageHandler` 为文件导入/导出补充原生能力

不采用 Electron/Tauri 的原因：

- 当前项目已经是静态前端，Electron/Tauri 引入新的构建链与分发复杂度，但对当前目标没有足够收益
- 使用 `WKWebView` 可以最小改动保留现有前端行为，更适合先做可运行版本

## 系统边界

整体拆为四部分：

### 1. macOS 应用壳

负责窗口、菜单、资源加载、App 生命周期和原生文件面板，不承载记账业务逻辑。

### 2. WebView 容器层

负责加载本地 `index.html`，注入脚本桥接对象，接收网页向原生发起的文件读写请求，并把结果回传给网页。

### 3. 网页业务层

继续使用现有的 `index.html`、`styles.css`、`script.js`。原则上只做必要改动：

- 替换 CDN 资源为本地资源
- 在导入/导出入口处优先调用原生桥接
- 桥接不可用时保留浏览器版兼容逻辑

### 4. 本地资源与打包层

负责组织 `.app` 内的 `Resources` 目录，确保 HTML、CSS、JS、第三方库和静态文件能通过本地路径稳定访问。

## 目录与文件规划

建议在项目内新增独立的 macOS 包装工作区：

```text
可视化记账/
  index.html
  styles.css
  script.js
  vendor/
    chart.umd.js
    xlsx.full.min.js
  macos-app/
    AssetTrackerMac.xcodeproj
    AssetTrackerMac/
      AssetTrackerMacApp.swift
      ContentView.swift
      WebViewContainer.swift
      WebViewCoordinator.swift
      WebBridge.swift
      Resources/
        Web/
          index.html
          styles.css
          script.js
          vendor/
            chart.umd.js
            xlsx.full.min.js
  script/
    build_macos_app.sh
  .codex/
    environments/
      environment.toml
```

### 文件职责

- `vendor/`：项目级第三方前端库原件，作为网页资源单一来源
- `macos-app/`：macOS 原生包装工程
- `Resources/Web/`：打包到 `.app` 内的网页运行资源
- `WebBridge.swift`：网页与原生消息协议
- `script/build_macos_app.sh`：本地构建 `.app` 的统一入口
- `.codex/environments/environment.toml`：在 Codex 桌面里挂出 Run 动作

## 数据与行为一致性设计

### 本地持久化

网页层现有主存储依然保持 `localStorage`，不改变其数据结构和键名。这样可以最大程度保证：

- 原有读写逻辑不需要大改
- 已有页面逻辑和默认值逻辑继续成立
- 数据备份逻辑仍可复用

注意事项：

- `WKWebView` 在本地 App 场景下也支持站点数据存储，但它保存在 App 容器内，不会与浏览器中的同名 `localStorage` 自动共享
- 这意味着“浏览器版数据”和“App 版数据”默认各自独立，这是符合桌面 App 直觉的

### 导入

浏览器版已有 `FileReader` 读取逻辑。App 版改为：

- 用户点击导入
- 网页先尝试调用原生桥接，请求打开 `NSOpenPanel`
- 原生选择文件后，将文件内容以文本或 Base64 回传给网页
- 网页继续复用现有解析逻辑

如果桥接不可用，则保留浏览器版原始导入路径，保证同一套前端文件仍可在浏览器打开。

### 导出

浏览器版的导出通常依赖 Blob 下载或链接下载。App 版改为：

- 网页生成待导出的文本或二进制内容
- 通过桥接把文件名、MIME 类型和数据发送给原生
- 原生用 `NSSavePanel` 让用户选择保存位置
- 原生实际写盘

同样保留浏览器环境的原始导出逻辑作为回退路径。

## 资源内置设计

当前 HTML 依赖：

- `https://cdn.jsdelivr.net/npm/chart.js`
- `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`

这些外链在 App 中不是理想依赖，原因包括：

- 离线时无法启动完整功能
- CDN 故障会影响 App 可用性
- 分发给他人时运行行为不稳定

因此必须改为本地资源：

- 将 `Chart.js` 固定到 `vendor/chart.umd.js`
- 将 `XLSX` 固定到 `vendor/xlsx.full.min.js`
- 修改 HTML 引用为相对本地路径
- 打包时将整个 Web 资源目录复制进 App Bundle

## 原生桥接协议

桥接协议保持最小集合，不去侵入业务本身。

### 网页到原生

- `openImportPanel`
  - 输入：允许的扩展名、是否多选
  - 输出：文件名、文件内容、错误信息

- `saveExportFile`
  - 输入：建议文件名、MIME 类型、文本内容或 Base64 数据
  - 输出：是否成功、保存路径、错误信息

### 原生到网页

- `window.AssetTrackerNative`
  - `isAvailable`
  - `openImportPanel()`
  - `saveExportFile(payload)`

网页侧逻辑采用特征检测：

- 存在桥接对象时走原生
- 否则回退到浏览器原逻辑

## 构建与运行

### 本地开发

- 使用 Xcode 打开 `macos-app/AssetTrackerMac.xcodeproj`
- 运行 Debug 版本，确认 WebView 能正常加载本地页面

### 命令行构建

统一通过 `script/build_macos_app.sh`：

1. 同步最新网页资源到 `Resources/Web/`
2. 构建 macOS app target
3. 在 `dist/` 目录产出 `.app`
4. 执行一次基础启动验证

### Codex 运行入口

写入 `.codex/environments/environment.toml`，让当前工作区可以直接点击 Run 来完成构建与启动。

## 分发形态

本阶段产物为未签名或临时签名的 `.app`。用户和其他安装者可能遇到以下限制：

- 第一次打开会被 Gatekeeper 拦截
- 需要右键选择“打开”，或在系统设置中允许运行
- 不能宣称是正式分发版

这一点要在 README 或交付说明中明确写清楚。

## 验收标准

满足以下条件即可视为本阶段完成：

- 生成一个可双击启动的 macOS `.app`
- App 启动后能完整显示现有主界面
- 图表功能正常工作
- 本地数据在 App 中关闭重开后仍存在
- 导入功能可从本地选择文件并导入
- 导出功能可保存到用户指定位置
- 断网环境下仍可启动并使用核心功能
- 同一套网页资源仍能在浏览器模式下运行，不强依赖原生桥接

## 风险与约束

### 1. WebView 与浏览器存储隔离

App 内的 `localStorage` 与浏览器中的 `localStorage` 不共享。用户如果希望迁移旧数据，需要通过导入/导出流程完成。

### 2. 现有脚本体量较大

`script.js` 体量很大，导入/导出逻辑可能散落在多个函数里。实现时需要只做最小侵入修改，避免引发业务回归。

### 3. 文件桥接需要兼容文本和二进制

导出 Excel 时可能需要 Base64 或二进制桥接，不能只按纯文本处理。

### 4. 非正式版分发体验有限

没有签名和 notarization，就不能提供完全无告警的安装体验。这是当前阶段接受的限制，不应误报为缺陷。

## 实施顺序

建议按以下顺序实现：

1. 下载并本地化第三方前端依赖
2. 新建 macOS `SwiftUI + WKWebView` 工程
3. 让 App 先成功加载本地网页资源
4. 验证 `localStorage` 在 App 内可持久化
5. 为导入实现原生文件选择桥接
6. 为导出实现原生保存桥接
7. 增加统一构建脚本与 `dist` 产物
8. 补充交付说明，明确非正式版安装方式
