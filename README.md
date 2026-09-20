<a id="english"></a>

<p align="center">
  <img src="assets/asset-tracker-logo-v3.png" width="116" alt="Asset Tracker logo: two ledger leaves forming an A">
</p>

# Asset Tracker

[![English](https://img.shields.io/badge/Language-English-24292f)](#english)
[![简体中文](https://img.shields.io/badge/语言-简体中文-1677ff)](#中文)

[![Release](https://img.shields.io/github/v/release/QiushanHuang/Asset-Tracker)](https://github.com/QiushanHuang/Asset-Tracker/releases)
[![CI](https://github.com/QiushanHuang/Asset-Tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/QiushanHuang/Asset-Tracker/actions/workflows/ci.yml)
[![macOS 14+](https://img.shields.io/badge/macOS-14%2B-5146b5)](#install)
[![Web and NAS](https://img.shields.io/badge/Web-%2B%20NAS-627088)](#choose-where-your-book-lives)
[![Maintainer](https://img.shields.io/badge/Maintainer-Qiushan-5146b5)](https://github.com/QiushanHuang)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A local-first asset ledger, with optional shared books on your own NAS.**
Keep accounts, everyday spending and travel projects organized. Understand your
balances with four analysis workspaces, or invite family members to a separate
NAS book while keeping personal books private.

## Why choose Asset Tracker

Choose it when recording a payment is only the start: you also want to know
**which account changed, what the money was for, and who should be able to see it**.
Local use needs no hosted account; shared books run on a NAS you control.

| If your current workflow has this problem… | What changes here |
| --- | --- |
| Balances, daily spending and trip costs live in separate sheets, so you keep reconciling them manually | One transaction can identify its funding account, project and expense category; the local analysis reads those records together |
| A broad “travel” category cannot explain one particular trip or renovation | Each project gets its own category tree and drill-down totals, while your funding accounts keep their own meaning |
| Sharing a household book makes personal privacy an ongoing chore | Personal NAS books stay private; shared/family books use explicit invitations and roles, and household summaries include only selected shared books |
| Importing or saving leaves you unsure what changed, whether a row was duplicated, or whether a save completed | Import previews show errors and duplicates; native saves have confirmation; NAS conflicts retain drafts and unknown-result retries do not create a second write |
| A converted total looks precise but the rate or forecast assumptions are unclear | Original currencies remain visible, missing rates stay unconverted, and analysis states its calculation assumptions |

The advantage is the combination: **clear bookkeeping structure, ownership of
your data, deliberate sharing, and visible import/save outcomes** in one
open-source workflow. The comparison describes workflow trade-offs; use the scope table below to decide whether this approach fits your needs.

### Where it fits

- **Everyday and multi-currency life:** record expenses across cash and bank
  accounts, keep original currencies, and inspect changes in net assets.
- **A trip, event or renovation:** create one project, record transport/food/
  accommodation separately, then see where that particular budget went.
- **A household with personal boundaries:** keep individual records private,
  invite family into a common NAS book, and review selected household spending.
- **Moving away from a collection of spreadsheets:** preview Excel/CSV before
  adding records and keep complete, portable JSON backups afterward.

![Asset overview with synthetic demonstration data](docs/images/overview.png)

*All published screenshots and examples use fictional demonstration data.*

## Install

Download **v3.2.1** from [Releases](https://github.com/QiushanHuang/Asset-Tracker/releases/latest).

| Download | Use it for |
| --- | --- |
| `AssetTracker-v3.2.1-macos-arm64.zip` | macOS 14 or newer on Apple silicon |
| `AssetTracker-v3.2.1-web.zip` | The complete local web interface, including bundled chart and spreadsheet libraries |
| `AssetTracker-v3.2.1-nas.zip` | NAS application sources, Docker configuration and deployment instructions |
| `AssetTracker-v3.2.1-nas-linux-amd64.tar.gz` | Prebuilt image for an x86-64 NAS; useful when the NAS cannot pull build images |
| `SHA256SUMS.txt` | SHA-256 checksums for these downloads |

The application interface currently uses Simplified Chinese; the README and guides are bilingual.

The macOS application is **unsigned and not notarized**. Verify the checksum,
unzip the application, and use the macOS security controls to allow it if
required. Installation instructions and data locations are in the
[user guide](docs/user-guide.md#installation). Intel macOS binaries and native
Windows/Linux applications are not included in this release.

### Run the local web interface

Extract the web archive, open a terminal in its directory, then run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000`. Use a local server rather than opening `index.html`
directly. Each browser profile and origin has its own local book.

### Build the macOS application

With Xcode Command Line Tools and Node.js 24.11.0 installed:

```sh
git clone https://github.com/QiushanHuang/Asset-Tracker.git
cd Asset-Tracker
npm ci --prefix app
ASSET_TRACKER_CONFIGURATION=release ./script/build_and_run.sh --stage-only
open dist/AssetTracker.app
```

The `app/` directory contains the separate TypeScript/IndexedDB development
track. It is not the default web or macOS interface distributed here.

## Start here

1. Open **Funding accounts / 资金账户** and set up where money is held.
2. Use **Add transaction / 添加账单** to record an income or expense. The quick
   form accepts a positive amount and a separate income/expense choice.
3. For a trip, renovation or event, create a **Project book / 项目账本**. Choose
   its purpose categories separately from the account used to pay.
4. Use **Save and continue / 保存并继续** for the next item; the form clears only
   after the save is acknowledged.
5. Review **Data analysis / 数据分析**, then export a complete JSON backup.

| Term | Meaning |
| --- | --- |
| Funding account | Where money is stored or owed |
| Project | Which trip, event or activity a transaction belongs to |
| Expense category | What the money was spent on, within that project |
| Personal/shared/family book | A NAS book's membership and visibility boundary |

A project is not a security boundary. Use separate NAS books and membership
permissions when records must be private.

<details>
<summary>See a project bookkeeping example</summary>

![Project expense breakdown with fictional records](docs/images/projects.png)

</details>

## Four analysis workspaces

- **History & trends** — balances, net assets, currencies and historical comparisons.
- **Income & spending** — category/project breakdowns and daily or periodic cash flow.
- **Future & scenarios** — deterministic forecasts from recorded rules and explicit assumptions.
- **Structure & inventory** — composition, inventory anchors, category trees and summaries.

Rates are entered by the user; this is not a live exchange-rate feed. Historical
reference rates and calculation assumptions are shown explicitly. Missing rates
remain unconverted. Forecasts are estimates derived from your inputs, not
verified future results.

<details>
<summary>See the local analysis workspace</summary>

![Local analysis with fictional records](docs/images/analytics.png)

</details>

## Choose where your book lives

| Capability | Local macOS / local web | NAS collaboration |
| --- | --- | --- |
| Personal asset book | Yes | Yes, with a separate service account |
| Project/category management and four analysis workspaces | Full local interface | Select categories from imported projects; full editors/analysis are not yet ported |
| Recurring rules | Local rule management and catch-up | Rule data can be retained in JSON; no NAS scheduling engine |
| Members and shared books | No | Owner, editor and viewer roles; private books cannot be shared |
| Import/export | Excel, CSV and full JSON | Full JSON, imported as a new private book |
| Storage | Native macOS ledger / browser localStorage | SQLite on your NAS's persistent Docker volume |
| Synchronization | No automatic synchronization with NAS books | Online shared service; conflict detection and idempotent retries |

### Personal, shared and family books

Personal NAS books are visible only to their owner. Shared and family books
require an invitation. Owners manage members, editors can change records, and
viewers can read and export. Invitations expire after 24 hours and can be used
once; removed members lose service access immediately.

Household summaries include only the shared/family books you select. They keep
currencies separate and exclude paired internal transfers. A household summary
is a cash-flow summary, not a consolidated net-worth statement or an IOU/AA
settlement system. Transfers currently support two non-liability accounts in
the same currency within one book.

### Open from a UGREEN NAS

Use the [NAS deployment guide](deploy/ugreen/README.md#english) to deploy the
service and create a **Family Ledger / 家庭记账** Docker desktop shortcut.
The shortcut may open the system browser. No purchased domain is required for
the explicitly configured **trusted-LAN** setup.

The LAN template enables HTTP only for the NAS's configured private IPv4
address and the page served from that same origin. **HTTP traffic is not
encrypted.** Use this mode only on a trusted local network; do not forward its
port to the public internet. HTTPS remains the default for other remote
connections. No Tailscale, domain or public endpoint is created automatically.

The NAS module is an early collaboration release. Phone layouts have been
checked at a narrow viewport; that does not establish physical-phone or
UGREENlink remote-access compatibility on every device.

## Import, export and recovery

- **Excel / CSV append:** review the preview first. Invalid dates, amounts,
  missing/ambiguous accounts and invalid project references block the import.
  Identical stable IDs are skipped; changed content under the same ID is a conflict.
  Content-only duplicates require an explicit choice.
- **Excel export:** intended for inspection and transaction round trips. It is
  not a complete backup of rules, settings, members or recovery history. Internal
  transfers and legacy debt balance-delta records require full JSON import.
- **Full JSON:** preserves the local book's accounts, transactions, projects,
  rules and settings. Local replacement first requests an export of the current
  book. Confirm that the backup file was actually saved.
- **NAS JSON:** imports into a new private book. Full service backups use the
  [SQLite backup procedure](deploy/ugreen/README.md#backup-and-restore), which also
  preserves users, memberships and revision history.

macOS saves use a serialized queue and durable native receipts. Corrupt or
unsupported books enter a recovery state rather than being silently replaced.
NAS writes compare revisions: conflicts keep the draft, and a retry after an
unknown response reuses its operation ID. Restoring a NAS revision creates a new
revision; it does not roll back membership permissions.

## What's new in v3.2.1

Project bookkeeping, four complete local analysis workspaces, safer import
review, responsive layouts, durable interaction feedback, optional family books
on a NAS, and a new ledger-inspired identity. This release also updates the
bundled spreadsheet parser from SheetJS 0.18.5 to 0.20.3.

See [release notes](docs/releases/v3.2.1.md#english), the [changelog](CHANGELOG.md)
and the [user guide](docs/user-guide.md#english) for details and limitations.

## Develop and contribute

```sh
npm ci --prefix app
./script/sync_web_assets.sh
ASSET_TRACKER_VERIFY_STAGED=1 node --test tests/*.test.js
node --test tests/nas/*.test.cjs
npm --prefix app test
npm --prefix app run build
swift build --package-path macos-app --product AssetTrackerFaultHarness
ASSET_TRACKER_FAULT_HARNESS="$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness" \
  swift test --package-path macos-app
```

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
[Third-party notices](THIRD_PARTY_NOTICES.md) · [Branding](docs/branding.md)

Created and maintained by **[Qiushan / @QiushanHuang](https://github.com/QiushanHuang)**.
See [contributors](CONTRIBUTORS.md). Licensed under the [MIT License](LICENSE).

---

<a id="中文"></a>

## 中文

[![English](https://img.shields.io/badge/Language-English-24292f)](#english)
[![简体中文](https://img.shields.io/badge/语言-简体中文-1677ff)](#中文)

**以本地存储为基础的资产账本，也可以在自己的 NAS 上记共同账、家庭账。**
把资金账户、日常收支和旅行项目分清楚，用四个分析面板理解资产变化。
需要一起记账时，再邀请家人加入单独的 NAS 账本，个人账本默认私有。

### 为什么选它

当你不满足于“记下一笔花了多少钱”，还想同时看清**钱从哪里出、花在什么事情上、谁可以看到这笔账**时，这个软件就有了价值。
本地使用不需要注册云端账户；共同账本可以放在自己的 NAS 上。

| 现有记账方式让你遇到的麻烦 | Asset Tracker 的对应优势 |
| --- | --- |
| 余额、日常流水和旅行费用散在不同表格里，经常需要手工对账 | 一笔记录分别关联资金账户、项目和消费分类，本地分析直接使用同一批数据 |
| 一个笼统的“旅游”分类，算不清某次旅行、装修或活动具体花在哪里 | 每个项目有自己的分类树和逐层汇总，不把用途和银行账户混在一起 |
| 想共同记家庭账，又不想把全部个人记录给家人看 | NAS个人账本默认私有，共同/家庭账本通过邀请分配权限，家庭汇总只包含主动选择的共享账本 |
| 导入怕重复、保存后不知道是否成功，多人修改又担心相互覆盖 | 先预览错误与重复项；原生保存有确认；NAS冲突保留输入，结果未知时重试同一操作 |
| 折算总额和预测看起来很精确，却不知道汇率或计算假设 | 保留原币，缺失汇率明确标成未折算，分析展示计算口径和假设 |

主要优势是把**账目结构清楚、数据自己掌握、共享边界明确、导入保存有反馈**放在同一套开源流程里。
上表比较的是记账流程的取舍，可以结合下方功能范围判断是否适合你。

### 快速看看适不适合你

- **日常生活与多币种收支：**现金、银行卡分别记录，原币保留，回看净资产变化。
- **旅行、活动或装修：**建一个项目，分清交通、餐饮、住宿等用途，结束后算清这一件事的开销。
- **家庭共同记账：**个人账目保持私有，邀请家人记录共同支出，再按所选账本查看家庭汇总。
- **从多份表格迁移：**先检查 Excel/CSV 预览，再追加记录，并用完整 JSON 保留可迁移的备份。

![使用虚构演示数据的资产概览](docs/images/overview.png)

*公开截图和示例全部使用虚构数据，不包含个人真实账目。*

### 下载安装

从 [Releases](https://github.com/QiushanHuang/Asset-Tracker/releases/latest) 下载 **v3.2.1**：

| 文件 | 用途 |
| --- | --- |
| `AssetTracker-v3.2.1-macos-arm64.zip` | macOS 14 及以上、Apple 芯片 Mac |
| `AssetTracker-v3.2.1-web.zip` | 完整本地网页界面，图表和表格库已随包提供 |
| `AssetTracker-v3.2.1-nas.zip` | NAS 程序源码、Docker 配置与操作说明 |
| `AssetTracker-v3.2.1-nas-linux-amd64.tar.gz` | x86-64 NAS 的预构建镜像，可免去 NAS 上的在线构建 |
| `SHA256SUMS.txt` | 下载文件的 SHA-256 校验值 |

macOS 应用**未签名、未公证**。核对校验值、解压应用，必要时通过 macOS 的安全设置允许打开。
详细步骤见[使用手册](docs/user-guide.md#中文)。本次未提供 Intel Mac、Windows 或 Linux 的原生安装包。

网页包解压后，在目录内运行：

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

浏览器打开 `http://127.0.0.1:8000`。不要直接双击 `index.html`；不同浏览器、用户配置和访问地址拥有各自独立的本地账本。

从源码构建 macOS 版（需要 Xcode Command Line Tools 和 Node.js 24.11.0）：

```sh
git clone https://github.com/QiushanHuang/Asset-Tracker.git
cd Asset-Tracker
npm ci --prefix app
ASSET_TRACKER_CONFIGURATION=release ./script/build_and_run.sh --stage-only
open dist/AssetTracker.app
```

`app/` 是单独的 TypeScript/IndexedDB 演进实现，并非本次默认网页和 macOS 安装包的入口。

### 从第一笔账开始

1. 在**资金账户**中设置钱存放或欠款的位置。
2. 点击**添加账单**，在快捷表单中选择收入/支出并输入正数金额。
3. 旅行、装修或活动可以新建**项目账本**；消费用途与付款账户分别选择。
4. 连续记录时使用**保存并继续**，只有保存确认后才会清空当前金额和备注。
5. 在**数据分析**查看结果，并定期导出完整 JSON 备份。

**资金账户**回答“钱在哪里”，**项目**回答“属于哪件事”，**消费分类**回答“花在什么地方”。
NAS 的个人/共同/家庭**账本**才是成员权限边界；同一本账里的项目不提供隐私隔离。

### 四个分析面板

- **历史与趋势**：资产、负债、净资产、多币种变化和历史对比。
- **收支去向**：消费类别、项目、每日与周期现金流。
- **未来与假设**：根据已记录规则与明确假设进行确定性推演。
- **结构与盘点**：资产构成、盘点锚点、分类树及自定义汇总。

汇率由使用者维护，不是实时行情服务。历史参考汇率、计算口径会明确显示；缺少汇率的金额保留为未折算项。
预测来自输入数据和假设，不代表已验证的未来结果。

### 本地账本与 NAS 共同记账

| 能力 | macOS / 本地网页 | NAS 协作版 |
| --- | --- | --- |
| 个人资产记账 | 支持 | 支持，使用单独的记账服务账户 |
| 项目分类管理与四大分析 | 完整本地界面 | 可选择导入项目的分类；完整编辑器和分析尚未迁移 |
| 自动记账规则 | 本地规则管理与补记 | JSON 可保留规则数据，暂无 NAS 定时执行器 |
| 多人成员权限 | 无 | 拥有者、可记账、只读；个人账本禁止共享 |
| 导入导出 | Excel、CSV、完整 JSON | 完整 JSON，导入为新的个人私有账本 |
| 存储位置 | Mac 原生账本 / 浏览器 localStorage | NAS 独立 Docker 数据卷中的 SQLite |
| 同步方式 | 不自动与 NAS 账本互相同步 | 在线共享服务，版本冲突保护与幂等重试 |

个人 NAS 账本仅拥有者可见；共同和家庭账本通过邀请加入。拥有者管理成员，编辑者记账，只读成员可查看与导出。
邀请口令 24 小时有效，只能使用一次；移除成员后会立即撤销其服务端访问权限。

家庭汇总仅包含你主动勾选的共同/家庭账本，按原币分别计算，排除成对的内部转账。
它是**收支汇总**，不是合并净资产报表，也不是 AA 债务结算。
转账目前支持同一本账中两个同币种、非负债账户之间的资金移动。

按照 [NAS 部署说明](deploy/ugreen/README.md#中文)部署后，在绿联 Docker 中创建“**家庭记账**”桌面快捷方式。
点击后可能由系统浏览器打开；明确配置的**可信局域网**模式不要求购买域名。

局域网模板只允许 NAS 指定的私有 IPv4 地址和当前同源页面使用 HTTP。**HTTP 传输不加密**，只用于可信内网，不能把端口直接映射到公网。
其他远程地址仍要求 HTTPS。程序不会自动设置域名、公网入口或 Tailscale。

NAS 模块属于早期协作版本。窄屏布局已检查，但不能据此声称所有真实手机或 UGREENlink 外网访问方式均已验证。

### 导入、导出与恢复

- **Excel / CSV 追加**：先看预览。无效日期/金额、缺失或歧义账户、错误项目引用会阻止写入。
  相同稳定 ID 的重复项跳过；同 ID 内容不同则报告冲突。只有内容相同、没有相同 ID 的疑似重复项需要你明确选择。
- **Excel 导出**：用于查看与账单回导，不是规则、设置、成员权限及恢复历史的完整备份；内部转账及旧负债余额记录须用完整JSON导入。
- **完整 JSON**：保留本地账本的账户、账单、项目、规则与设置。替换当前账本前会先请求导出原账本，请确认备份文件确实已经保存。
- **NAS JSON**：导入为新私有账本；服务账号、成员权限和版本历史需通过 [SQLite 全服务备份](deploy/ugreen/README.md#中文)保留。

macOS 使用串行保存队列和原生耐久保存回执；损坏或不兼容的账本进入恢复界面，不会静默替换为空账本。
NAS 并发修改通过版本号检查；冲突和刷新保留输入，结果未知的保存使用同一操作编号重试。
恢复旧版本会生成新版本，不回滚成员权限。

### v3.2.1 更新

新增项目记账、完整本地分析、导入预览、自适应布局和保存反馈，以及可选的 NAS 家庭账本与新版 Logo。
同时将内置 SheetJS 表格解析库从 0.18.5 更新至官方 0.20.3。

详见[本版更新说明](docs/releases/v3.2.1.md#中文)、[更新日志](CHANGELOG.md)和[完整操作手册](docs/user-guide.md#中文)。
开发与检查命令见本页[英文开发部分](#develop-and-contribute)。

### 贡献者与许可

由 **[Qiushan / @QiushanHuang](https://github.com/QiushanHuang)** 创建与维护。
[贡献者](CONTRIBUTORS.md) · [参与开发](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [第三方许可](THIRD_PARTY_NOTICES.md)

使用 [MIT License](LICENSE)，保留原作者版权声明。

[![Back to English](https://img.shields.io/badge/Back_to-English-24292f)](#english)
