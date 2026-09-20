<a id="english"></a>

# Asset Tracker user guide

[English](#english) · [简体中文](#中文) · [README](../README.md)

## Installation

### macOS

1. Download the Apple-silicon macOS archive and `SHA256SUMS.txt` from the same release.
2. In the download directory, compare `shasum -a 256 AssetTracker-v3.2.1-macos-arm64.zip` with its checksum entry.
3. Unzip and move `AssetTracker.app` to Applications if desired. The application is unsigned and not notarized; macOS may require your explicit approval in Privacy & Security.
4. Open the application. A new installation starts with an empty book and default funding categories; it contains no author's ledger.

The native book is outside the application bundle:

```text
~/Library/Application Support/com.qiushan.AssetTracker/AssetTrackerBook.json
```

Before an update, export a full JSON backup, verify the file and close the app.
Replace the application bundle, then confirm that the expected book opens. Do
not delete the Application Support directory to upgrade. The `--preview`
launch option uses a separate temporary book for evaluation:

```sh
open -n /path/to/AssetTracker.app --args --preview
```

### Local web

Serve the extracted web package with `python3 -m http.server 8000 --bind 127.0.0.1`
and open `http://127.0.0.1:8000`. Data belongs to this browser profile and origin.
Changing the port, hostname or browser can show a different, empty book; clearing
site storage can remove it. Export JSON before changing environments.

### NAS

Follow the [NAS guide](../deploy/ugreen/README.md#english). A NAS service account is
separate from the NAS operating-system account. Local and NAS books do not
silently merge. Upload/import creates a separate private NAS book.

## Everyday bookkeeping

### Accounts and balances

Use **资金账户** for where money is held or owed. Use clearly named leaf accounts
when groups contain several similarly named bank accounts. Keep the account
currency distinct from the base display currency.

**净资产** subtracts liabilities from balances; liability overpayments are
handled separately. A historical inventory entry is an anchor/reference for
analysis, not an instruction to fabricate missing transactions. Review the
calculation notes when mixing current-balance reconstruction with anchors.

### Income, expenses and projects

The quick-entry form takes a positive amount with a separate income/expense
choice. Spreadsheet imports use signed values: income positive, expense negative.
Choose the funding account, optional project and project expense category.

Projects can start with a travel template or empty categories. Each project has
its own category tree, up to three levels. Recording on a parent category is
allowed; summaries include descendants while separating direct entries.
Referenced categories cannot be removed casually. Archive a completed project
to preserve its records.

**Set as current project** affects the current app session. After a restart,
entry returns to everyday bookkeeping so a forgotten project does not capture
unrelated purchases. **Save and continue** retains useful account/project choices
and clears amount/description only after a successful save.

### Find and edit a record

Use text search, account/project filters and date bounds. A project filter shows
its full date range; use **清除筛选** if expected records are missing. Lists render
50 records per page. Editing project attribution does not create a second money
movement.

### Analysis and recurring rules

The four analysis tabs share an explicit range and filtering context. Review
rate assumptions and unconverted amounts before interpreting totals. The local
app supports recurring-rule management and catch-up; the NAS service does not
execute those rules in the background. A JSON import preserves rule data, not
a promise of server-side scheduling.

## Import and export

| Format / action | Behavior |
| --- | --- |
| Excel/CSV import | Append after preflight and confirmation; maximum 50,000 rows per import |
| Excel export | Transaction table plus account balances, including stable transaction/account/project/category IDs |
| Full local JSON import | Replace the whole local book after validation and a requested pre-replacement backup |
| NAS JSON import/upload | Create a new personal private book |
| NAS JSON export | Export the selected book; not the service's users or permissions |

Use the downloaded spreadsheet template, or export a current book for a
compatible table. All invalid rows must be corrected before an append. A
content-only duplicate is a warning, not proof that two purchases are the same;
choose whether to retain it. Matching stable IDs with differing content require
manual reconciliation. Old spreadsheets containing only a project label cannot
reconstruct stable project/category IDs; use a full JSON backup instead.

File imports are bounded; the current local file limit is 12 MB. Do not import
untrusted files merely because they have a supported extension. If a browser
starts a backup download, confirm the actual file exists before relying on it.

## NAS books and membership

- **Personal:** owner only, sharing is prohibited.
- **Shared / family:** owner invites editors or viewers. Viewers can export, so
  grant read access only to people allowed to retain a copy.
- **Invitations:** 24-hour, single-use codes. Share a code yourself with the
  intended person; existing users log in and accept it, new users choose
  **凭邀请加入**.
- **Household summary:** select the shared/family books to include. Private
  books are excluded. Totals stay in their original currencies and paired
  internal transfers are excluded from income/spending.

Same-currency transfers between two non-liability accounts save as a pair.
Deleting a transfer removes both sides and reverses their balance effects.
Historical cross-currency entries without original conversion facts cannot be
edited/deleted safely through this NAS interface; reconcile them in the original
book instead of inventing a rate.

## Save failures, conflicts and recovery

| What you see | What to do |
| --- | --- |
| Read-only recovery on local startup | Preserve the original file; use the offered raw export/retry/location actions. Do not reset the book to dismiss an error. |
| NAS version conflict | Keep your draft, refresh, compare the latest records, then submit deliberately. |
| Connection lost after saving | Use **重试未确认操作**. It reuses the original operation ID rather than making a duplicate. |
| Session expired | Reauthenticate in the offered form; pending input is retained. |
| Wrong NAS edit | Use version history; restore creates a new revision and keeps earlier history. |
| Empty local book in another browser | Check the profile, hostname and port. Import your verified JSON only into the intended destination. |

NAS sessions last 12 hours. Tokens remain in page memory rather than localStorage.
Offline logout clears this browser's access, but cannot confirm server revocation
until the connection is available or the session expires.

## Limits and maintenance

The NAS service currently accepts up to 50,000 transactions and an 8 MB serialized
book; requests are bounded separately. Whole-book revisions are retained, so
monitor persistent-volume disk usage. The interface lists the latest 100
revisions, but that is not a server retention limit.

Keep both book exports and periodic full-service backups. There is no password
reset UI in this release; keep credentials in a password manager. Do not delete a
database containing financial records to reset an account.

### Legacy debt and spreadsheet limits

New signed expenses increase a debt balance and positive credits reduce it.
Legacy entries without account IDs retain their original balance-delta convention
when reversed; editing legacy debt entries is refused until their semantics are
reconciled. Excel marks internal transfers and legacy debt deltas; importing
those rows requires full JSON instead of silently losing their meaning.
If you used an earlier NAS preview for debt entries, reconcile the outstanding
balance with the original records. This release does not rewrite existing books.

---

<a id="中文"></a>

## 中文

[English](#english) · [简体中文](#中文) · [返回 README](../README.md#中文)

### 安装与更新

**macOS：**下载同一版本的 Apple 芯片安装包和 `SHA256SUMS.txt`，通过 `shasum -a 256 文件名`核对摘要后解压。应用未签名、未公证，必要时由你在系统“隐私与安全性”中允许打开。

全新安装只有空账本和默认账户分类，不包含作者的真实数据。正式账本位于：

```text
~/Library/Application Support/com.qiushan.AssetTracker/AssetTrackerBook.json
```

更新前导出并核对完整 JSON，关闭应用后替换 `.app`。不要为升级删除 Application Support 数据目录。
想先试用空白隔离账本，可执行：

```sh
open -n /path/to/AssetTracker.app --args --preview
```

**网页：**在解压目录运行 `python3 -m http.server 8000 --bind 127.0.0.1`，浏览器访问 `http://127.0.0.1:8000`。不同浏览器、配置、主机名或端口对应不同存储；清理网站数据可能移除账本，切换环境前先备份。

**NAS：**按[NAS部署说明](../deploy/ugreen/README.md#中文)安装。记账服务账户独立于NAS系统账户。本地和NAS账本不自动合并；上传/导入产生新的NAS私有账本。

### 日常操作

1. **资金账户**管理钱存放或欠款的位置。重名银行账户应使用清楚的末级账户名称；账户原币与显示基准币分开维护。
2. **添加账单**：快捷表单输入正数金额，再选收入/支出；表格导入则使用收入为正、支出为负的金额。
3. **项目账本**：旅行、装修或活动分别建立项目，可套用旅游模板。各项目消费分类独立，最多三级；允许记在父分类，汇总会包含下级并显示本级直接记录。
4. **当前项目**只在本次会话生效，重启恢复日常记账。**保存并继续**只在保存确认后清空金额/备注，保留有用的账户和项目选择。
5. 使用搜索、账户/项目和日期筛选寻找记录，每页50笔。项目筛选会显示项目全部日期；找不到记录时先清除筛选。

项目归属修改不会生成第二笔资金变动。已经使用的分类不能随意删除；完成的项目可归档，历史记录继续保留。

**净资产**会扣除负债，并单独处理负债溢缴。盘点/初始资产是分析参考锚点，不会补造缺失流水。
查看四个分析面板时，应同时查看时间范围、汇率口径与未折算项目。汇率为手动参考值，预测来自已输入数据和假设。
本地自动记账支持规则管理与补记；NAS不会在后台执行导入的规则。

### 导入导出

| 操作 | 结果 |
| --- | --- |
| Excel/CSV导入 | 先预检、预览，再确认追加；单次最多50,000行 |
| Excel导出 | 账单和账户余额表，含稳定记录/账户/项目/分类ID |
| 本地完整JSON导入 | 校验后替换整个本地账本，替换前先请求导出原账本 |
| NAS JSON导入/上传 | 创建新的个人私有账本 |
| NAS JSON导出 | 导出所选账本，不包含账号、成员权限和服务版本历史 |

优先使用下载的模板或新版导出表。错误行必须全部修正后才能追加。“内容相同”不等于确实重复，可明确选择是否保留；相同ID但内容不同则需人工核对。只有项目名称、没有稳定项目ID的旧表不能可靠还原归属，应使用完整JSON。

当前本地导入文件上限12MB。浏览器发起下载后，应确认备份文件已经实际保存。完整JSON才用于完整账本恢复，Excel不是规则、设置及恢复历史的完整备份。

### NAS 共同与家庭账本

- **个人账本：**只有拥有者可见，不能邀请成员。
- **共同/家庭账本：**拥有者管理邀请；编辑者记账；只读成员可查看与导出。只读也允许保留导出副本，请据此分配权限。
- **邀请：**24小时有效、只能用一次。由你把口令发送给指定成员；老用户登录后接受邀请，新用户选择“凭邀请加入”。
- **家庭汇总：**仅合并主动勾选的共同/家庭账本，排除个人私有账本和成对内部转账，按原币显示收支。

转账支持同币种、非负债账户，成对保存；删除时成对撤销。缺少原始换算事实的历史跨币种流水，NAS界面会阻止不可靠的修改/删除，应在原账本核对，不能猜汇率。

### 异常与恢复

| 提示 | 处理方式 |
| --- | --- |
| 本地只读恢复 | 保留原件，使用页面提供的原始导出、重试或打开目录；不要为消除报错而重置账本 |
| NAS版本冲突 | 保留输入，刷新核对他人已保存的记录，再决定提交 |
| 保存后断网、结果未知 | 点击“重试未确认操作”，复用原操作编号，避免重复记账 |
| 会话过期 | 在提示表单重新登录，待提交输入会保留 |
| NAS误修改 | 从版本历史恢复，恢复形成新版本，不撤销成员权限 |
| 换浏览器后账本空白 | 先检查配置、地址和端口，再向正确目标导入已核对的JSON |

NAS会话有效期12小时，令牌只保留在页面内存中。离线退出能清除本机访问，但不能确认服务端已经撤销会话。

### 维护边界

NAS单账本上限50,000笔和8MB序列化内容，采用整本版本保存。界面只列出最近100个版本，但服务保留全部历史，因此要关注数据卷容量。

定期保留账本导出和[NAS全服务备份](../deploy/ugreen/README.md#中文)。本版没有密码重置界面，请妥善保存凭据；不要删除有账目的数据库来重置账户。

### 旧负债记录与表格限制

新支出增加负债，正向入账减少负债。撤销没有稳定账户ID的旧记录时，保留原余额变动记法；旧负债记录在核对迁移前禁止修改，避免静默改变含义。Excel明确标记内部转账及旧负债余额记录，导入时要求改用完整JSON。如果曾用NAS预览版记录负债，请核对实际余额；本版不自动改写既有账本。
