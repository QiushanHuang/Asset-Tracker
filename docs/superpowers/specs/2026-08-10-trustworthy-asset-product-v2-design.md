# 可信资产产品 V2 设计

**状态：** 已批准，进入实施计划  
**决策日期：** 2026-08-10  
**三方批准内容哈希：** `6bb718d33461d89396c207c3eb79b4319658d74d59d1b15ef6229d36f3440f99`（状态标记前）  
**适用范围：** Web 与 macOS App 共享产品和领域模型  
**交付策略：** 旧版风险隔离 + 新版垂直切片重建  

## 1. 决策摘要

当前产品覆盖资产、负债、多币种、交易、周期记录、图表、导入导出和 macOS 包装，但仍是以 `script.js` 中一个 4,326 行 `AssetTracker` 类为中心的原型。页面、账务计算、可变余额、存储、导入、图表和原生桥高度耦合。现有 6 个测试全部通过，只能证明少量适配和初始化行为，不能证明账务准确、保存耐久、迁移可靠或 UI 可用。

本设计选择路线 C：

1. 旧版停止新增产品功能，只修复数据损坏、安全、假成功和不可达导航等发布阻断问题。
2. 新版使用 `Vite + TypeScript + React`，按“账户与账务事件 → 存储与恢复 → 核心旅程 → 洞察与自动化”的垂直切片建设。
3. 新旧系统绝不长期双写。影子阶段旧版是唯一写端；正式切换后旧版永久只读。
4. 新版 v1 使用“资金事件 + 一个或多个账户影响”，不实现完整复式总账、权益科目或正式财务报表。
5. 余额、净资产和历史曲线全部由事件与带时点的绝对余额锚点推导，不再把任意页面中的 `balance` 当作可直接覆盖的最终事实。
6. Web 以 IndexedDB 为唯一实时业务真源；macOS 先通过不可跳过的稳定 origin 门禁，并为每个发布通道一次性选择 IndexedDB 或预授权的原生 SQLite 单主 adapter。这个结果不是运行时 fallback。任何已激活 generation 都固定且只使用一种业务真源；原生恢复分段与快照不成为第二套业务数据库。
7. 跨 PrimaryStore 与原生恢复文件系统不宣称 ACID 原子性，而使用持久 outbox、幂等 commit、连续 sequence 和 hash chain 建立可恢复提交协议。

旧设计 `2026-04-13-local-stable-phase1-design.md` 中关于模块化、稳定 ID、迁移、快照、revision、统一统计口径和 IndexedDB 的方向继续有效。本设计覆盖并修正其中不足：账户与用途分类分离、余额锚点语义、账户事件模型、跨币种事实、macOS 恢复副本、切换协议、响应式信息架构和可验证迭代门禁。

## 2. 已确认的现状与问题

### 2.1 产品可信度

- `calculateTotals()` 把正资产和债务相加，违背需求文档反复确认的“净资产 = 现余额 − 待还款”。证据：`script.js:1799-1847`、`记账/记账111.rtf`。
- 交易引用分类名称而非稳定 ID，默认数据本身已有两个 `ICBC`；改名、重名、删除和多层路径会产生歧义。证据：`script.js:1355-1377, 2412-2422, 2675-2705`。
- `initialAssets` 只保存和展示，不参与总额或趋势。证据：`script.js:3948-4025`。
- 自定义图表和预测使用 `Math.random()`，却以真实分析形式呈现。证据：`script.js:3528-3554, 3730-3748`。
- 多个按钮没有实现，自动规则列表调用不存在的方法。证据：`index.html:221-223, 342-347`、`script.js:3343-3368`。

### 2.2 数据可靠性

- `persistData()` 吞掉异步保存失败，UI 可在落盘前显示成功。证据：`script.js:806-838, 2403-2427`。
- 原生保存使用旧 hash 防止覆盖，但快速连续保存没有全局队列，后续写入可被判定为 stale 后丢失。证据：`AssetTrackerHostBridge.swift:279-305`。
- 损坏 JSON 会静默回退默认账本；下一次保存可能用空状态覆盖损坏原件。证据：`script.js:415-458, 853-872`。
- 当前“自动备份”在 macOS 上只是再次写主文件，在 Web 上写另一个 localStorage key，均没有可靠恢复链。证据：`script.js:1557-1600`。
- Excel 和完整 JSON 导入缺少严格 schema、预检、差异报告和磁盘级回滚。证据：`script.js:3100-3214`。

### 2.3 安全、性能与稳定性

- 导入或用户输入的分类、描述、规则和备忘录直接进入 `innerHTML`，形成持久 XSS；页面同时拥有原生桥能力。证据：`script.js:1430-1444, 3350-3368, 4187-4195`。
- 拖拽后代保护方向错误，可把父节点插入自身后代，导致循环对象、保存失败或递归栈溢出。证据：`script.js:1065-1230`。
- 趋势计算近似 `O(日数 × 交易数²)`，每次 CRUD 又重建主要图表。证据：`script.js:2078-2171`。
- Swift 桥在主线程同步读取、编码、序列化和写盘，大文件会阻塞 UI。证据：`AssetTrackerHostBridge.swift:53-70, 124-145, 271-305`。

### 2.4 布局与可访问性

- `≤768px` 时侧栏被移出视口，但没有菜单按钮或替代导航，除总览外所有页面不可达。证据：`styles.css:581-589`、`index.html:14-26`。
- 页面隐藏横向溢出，header、dashboard 和八列表格在 375、768、812 横屏均出现裁切。
- modal 没有 dialog 语义、Escape、焦点圈闭或内部滚动；多个控件不具备键盘和读屏语义。
- 当前配色中多组文本与状态色未达到 WCAG 2.2 AA 对比度。

## 3. 产品定位与原则

### 3.1 核心用户

主要用户是资产分布在中国、新加坡等不同地区的个人，使用多家银行、电子钱包、现金、投资账户和消费信贷，并希望在本地私密保存数据。

### 3.2 核心 JTBD

产品必须可靠回答：

1. 我现在拥有多少资产、欠多少、净资产是多少？
2. 钱分别在哪些账户和币种？
3. 最近为什么发生变化，能否追溯到具体流水？
4. 如何快速记账、校准余额，并确认这次操作已经安全保存？
5. 数据损坏、版本升级或换机导入时，如何预检、迁移和恢复而不丢账？

### 3.3 产品原则

1. **可信优先于丰富。** 无法解释或验证的数据不进入正式指标。
2. **事实优先于展示。** 原币金额、发生时间和账户身份不可被展示偏好改写。
3. **成功必须耐久。** UI 只有在对应耐久级别达到后才显示该级别的成功。
4. **故障默认保护数据。** 损坏、分叉、版本不兼容或缺失汇率时进入降级或只读状态，不猜测、不清空。
5. **用户使用生活语言。** UI 使用收入、支出、转账、借款、还款、余额校准和更正，不暴露会计术语。
6. **一套语义，多端容器。** 桌面、平板和手机共享信息架构与状态，仅改变导航和布局容器。

## 4. 正式指标词典

### 4.1 账户种类

- **资产账户：** 银行卡、现金、电子钱包、投资账户等用户拥有的余额。
- **负债账户：** 信用卡、花呗、白条、贷款等用户需要偿还的余额。
- **账户组：** 只组织账户，不接收流水，不拥有余额。
- **收支分类：** 解释流水为什么发生，例如餐饮、工资、会员服务；不拥有余额。
- **标签：** 可选的跨分类标记，例如旅行、可报销；不参与账务计算。

### 4.2 核心公式

在正常账户余额范围内：

```text
现余额 = Σ 资产账户原币余额按估值汇率折算
待还款 = Σ 负债账户正常余额按估值汇率折算
净资产（原“总资产”） = 现余额 − 待还款
现金 + 非现金资产（原“数字资产”） = 现余额
```

负债出现负余额时使用以下扩展口径：

```text
待还款 = Σ max(负债账户余额, 0)
负债溢缴 = Σ max(-负债账户余额, 0)
净资产 = 现余额 + 负债溢缴 − 待还款
```

系统不得对负债余额直接取绝对值。负债溢缴单独展示为异常资产权益，要求用户校准或重新分类；正常账本仍保持“净资产 = 现余额 − 待还款”的用户心智。

### 4.3 可支用资金

首个 V2 切换版本不把“可支用资金”作为正式聚合指标，也不在总览展示。`Account.isSpendable` 只作为账户展示与未来建模的属性，不能据此声称某个金额可以安全支用。

手工预留、待结算流出、冻结金额和信用额度需要独立实体、录入路径、投影规则与 golden tests；这些能力在模型完整前进入 V2.x 待办，不以半成品公式上线。

### 4.4 今日开销与趋势

- 今日开销使用账本时区内的**经济净支出**口径：支出事件贡献正开销；其技术 reversal 在原投影槽贡献等额负开销；replacement 按自身支出金额和业务日期贡献。被撤销支出最终贡献 0，支出 80→50 的更正最终贡献 50。业务退款按实际退款日期单独展示，不与技术 reversal 混同，也不并入今日开销；转账、借款、还款和余额校准同样不计入。
- 净资产、现余额和待还款趋势使用同一个 projection engine。
- 每个趋势点显示估值日、使用的汇率覆盖率、余额锚点和组成事件。
- 任何趋势点均可下钻到影响该点的流水与校准记录。

## 5. 领域模型

### 5.1 Book

`Book` 至少包含：

- `id`
- `name`
- `timezone`
- `reportingCurrency`
- `revision`
- `storageSchemaVersion`
- `domainCapabilityVersion`
- `minimumReaderVersion`
- `createdAt`
- `updatedAt`

账本时区决定“今日”、日期边界、周期规则和稳定排序。展示币种可以变更，但不能修改账户或事件原币事实。

### 5.2 AccountGroup 与 Account

`AccountGroup` 只负责层级与排序：

- `id`
- `parentGroupId`
- `name`
- `sortOrder`
- `archivedAt`

v1 最多支持三层账户组，再挂接叶子账户。更深的 legacy 路径在迁移报告中保留完整原路径，但 UI 映射为三层以内的建议结构，避免继续承诺不可维护的“无限层级”。

`Account` 是唯一余额容器：

- `id`
- `groupId`
- `kind: asset | liability`
- `name`
- `nativeCurrency`
- `assetClass: cash | nonCash | null`
- `isSpendable`
- `sortOrder`
- `revision`
- `archivedAt`
- `createdAt`
- `updatedAt`

已有事件的账户不能修改原币、物理删除或转换资产/负债种类，只能改名、移动、调整展示属性或归档。

`assetClass` 只对资产账户必填；负债账户必须为 `null`，不会进入现金/非现金资产聚合。

### 5.3 LedgerEvent

`DraftEvent` 与已记账的 `LedgerEvent` 是两类不同实体。`DraftEvent` 可编辑、可删除且永不参与余额投影；提交命令校验通过后，才原子生成不可变的 `LedgerEvent`。

`DraftEvent` 至少包含 `id`、`bookId`、`intendedKind`、候选 payload、`draftRevision`、`source`、`occurrenceKey`、`createdAt` 和 `updatedAt`。草稿 ID 不复用为已记账事件 ID。提交命令必须携带 `expectedDraftRevision`，并在同一 PrimaryStore 事务中 CAS 校验 revision、创建唯一 `DraftConsumption(draftId, draftRevision, eventId, commandId)`、生成 LedgerEvent 与移除活动草稿。`LedgerEvent.sourceDraftId` 建立非空唯一索引；同一草稿即使用不同 commandId 再次提交，也幂等返回已存在 event/commit，不能产生第二笔影响。

`LedgerEvent` 是一次已记账、用户可理解且不可原地修改的资金事实：

- `id`
- `bookId`
- `kind: income | expense | transfer | borrowing | repayment | refund | reversal | balanceAssertion | legacy`
- `postingStatus: posted`，仅作持久类型判别，不允许变更
- `effectiveAt`
- `recordedAt`
- `timezone`
- `stableOrderKey`
- `projectionSuborder`
- `purposeCategoryId`
- `tagIds`
- `description`
- `reversesEventId`
- `replacesEventId`
- `refundOfEventId`
- `supersedesAssertionId`
- `correctionGroupId`
- `source: user | legacy | import | automation`
- `sourceNamespace`
- `sourceDraftId`
- `sourceExternalId`
- `occurrenceKey`
- `fxExecution`
- `createdAt`

所有包含 `AccountImpact` 的 `LedgerEvent` 都永久参与投影；`BalanceAssertion` 是唯一例外，投影前按 supersession chain 只选择有效断言。只有 `DraftEvent` 不影响余额。`corrected`、`voided` 是查询层从更正链派生的展示状态，不写回原事件，也不决定普通事件是否参与投影。

`effectiveAt` 决定业务时间。根事件的 `stableOrderKey` 是 `(bookId, effectiveAt)` 内唯一、按无符号整数比较的规范化排序号，`projectionSuborder` 默认为 0；同一逻辑槽的更正事实复用 key 并用递增 suborder 紧邻求值。完整投影顺序为 `effectiveAt ASC, stableOrderKey ASC, projectionSuborder ASC, id ASC`，不依赖 recordedAt 或数据库游标顺序。

### 5.4 AccountImpact

普通事件包含一个或多个账户影响：

- `accountId`
- `direction: increase | decrease`
- `amountMinor`
- `currency`
- `fxQuoteId`
- `impactOrder`

金额必须使用整数最小货币单位或可靠 Decimal，不使用 JavaScript 浮点数作为账务真值。用户只输入正数金额，领域层根据事件意图生成方向。

每个 `amountMinor` 必须为严格正整数，`currency` 必须等于目标账户不可变的 `nativeCurrency`；余额断言的 currency 也必须等于目标账户原币。任何命令都不能向同一账户写入混合单位。同一事件的 impacts 使用显式 `impactOrder` 稳定排序。事件 kind 与账户种类、影响数量和方向必须通过下表的领域校验，不能由 UI 自由拼装任意组合。

### 5.5 事件影响矩阵

| 用户意图 | 账户影响 | 净资产影响 |
|---|---|---|
| 收入到账 | 资产增加 | 增加 |
| 资产账户支出 | 资产减少 | 减少 |
| 信用账户消费 | 负债增加 | 减少 |
| 同币转账 | 来源资产减少、目标资产增加 | 不变 |
| 借款到账 | 资产增加、负债增加 | 不变 |
| 偿还负债 | 资产减少、负债减少 | 不变 |
| 退款 | 原支出影响的反向事件 | 增加或恢复 |
| 余额校准 | 在指定时点设置绝对余额锚点 | 以校准影响单独解释 |
| 撤销普通事件 | 新增原事件的反向事件，原事件仍保留 | 两者抵消 |
| 更正普通事件 | 原子新增原事件的反向事件与替代事件 | 以替代结果为准 |
| 更正余额锚点 | 新增 superseding assertion，不生成反向 delta | 以新断言为准 |

跨币转账保存来源原币、目标原币、成交汇率和可选手续费。无手续费时，两端在交易时点的估值必须在最小货币单位容差内一致。手续费是同一事件中的附加支出影响。

### 5.6 绝对余额锚点

余额校准不是普通 delta，而是 `LedgerEvent(kind=balanceAssertion)` 的特殊 payload：

- 继承 `LedgerEvent` 的 `id`、`bookId`、`postingStatus`、`effectiveAt`、`recordedAt`、`stableOrderKey`、`projectionSuborder`、`source` 与更正链字段
- `accountId`
- `assertionAction: set | retire`
- `assertedBalanceMinor`
- `currency`
- `observedAt`
- `note`

余额断言不包含 `AccountImpact`。`assertionAction=set` 必须包含余额，`retire` 不包含余额。所有 assertion revision 永久保存，但投影前先解析 `supersedesAssertionId` 链：使用 leaf payload **替换根 assertion 的 payload，并始终在根 assertion 的 effectiveAt/stableOrderKey 槽求值**；leaf 为 `retire` 时整条根断言不参与重置。更正数值只追加同槽 superseding assertion，不创建反向 delta，也不会移动到同一时刻后续流水之后。

链必须同账户、同 currency、同根 effectiveAt/stableOrderKey、无循环且每个 revision 最多有一个直接后继；出现 fork、跨账户、跨币、跨槽引用或循环时 projection 返回 invalid 并进入只读保护。`observedAt` 表示用户实际查看/盘点余额的时刻，`effectiveAt` 表示该余额在账务时间线上生效的时刻，两者不得互换。修改生效时间是显式“移动锚点”命令：同一 UnitOfWork 追加旧链的 retire leaf；若目标时点没有同账户 root，则创建新根；若已有 root，则以移动后的 payload supersede 目标时点当前 leaf。提交前展示跨越区间，不能通过普通 supersession 静默改时间或在目标时点制造第二根。

首次建账 UI 可以称为“期初余额”，领域层仍统一保存为第一个余额断言，不再存在语义重叠的 `opening` 事件。

投影规则：

1. 事件按 `effectiveAt ASC + stableOrderKey ASC + projectionSuborder ASC + id ASC` 排序，锚点把时间线切成独立区间。
2. 区间左侧存在锚点时，从左侧绝对余额向前累计事件。
3. 区间只有右侧锚点时，从右侧绝对余额逆序撤销事件，反向重建更早历史。这正是 legacy 当前余额反推历史曲线的正式算法。
4. 区间两侧都有锚点时，先从左侧向前投影；到达右侧时以右侧断言值重置。两者差异作为该锚点的校准影响单独解释，不改写此前事件。
5. 锚点之后的事件从该绝对值继续累计。
6. 修改、更正或撤销锚点之前的流水，只改变锚点之前或相邻锚点区间内的历史，不穿透后续锚点影响当前余额。
7. 多个锚点按时间分段；任何日期的现余额、待还款和净资产都必须由同一双向 projection engine 生成。
8. 普通用户在同一账户、同一 `effectiveAt` 再次校准时，必须 supersede 当时最后一个有效 root 的 leaf，不得无意创建第二条独立根链。迁移兼容输入若已有多个独立根断言，则按 `stableOrderKey ASC + id ASC` 依次重置，最后一条唯一胜出，并在 migration manifest 报告。

首次建账余额是第一个绝对余额锚点。迁移中的当前余额和旧 `initialAssets` 也使用同一语义。

### 5.7 更正与归档

`CorrectionGroup` 是与更正事实同事务写入的不可变 envelope，包含 `id`、`bookId`、`targetEventId`、`reversalEventId`、可选 `replacementEventId`、`commandId` 和 `createdAt`。

- `DraftEvent` 可以编辑或删除；提交后产生的 `LedgerEvent` 不允许原地修改金额、账户、日期、币种或任何账务字段。
- 用户撤销普通已记账事件时，系统追加一个 posted 反向事件；目标只能是包含 AccountImpact 的普通非 reversal、非 assertion 事件。其 impacts 必须逐项复用目标事件的 account、currency、amount 与 impactOrder，仅交换 direction，任何不精确反向都原子拒绝。原事件永久保留并继续参与投影。
- 用户更正普通已记账事件时，系统在同一个 UnitOfWork 中追加一个精确 posted reversal 和一个 posted replacement。`CorrectionGroup` 的基数固定为一个 target、恰好一个 reversal，以及撤销时零个 replacement、更正时恰好一个 replacement；replacement 显式保存 `replacesEventId`。
- reversal 继承目标事件的 `effectiveAt` 和 `stableOrderKey`，占用同一逻辑投影槽的下一 `projectionSuborder`。replacement 若业务时间未改，也继承该槽并排在 reversal 之后；若用户显式修改业务时间，则以新 `effectiveAt` 创建新根槽，提交预览必须显示它跨越了哪些余额锚点。
- `recordedAt` 记录更正实际发生时间，但永不决定历史投影位置。原事件、反向事件和替代事件由 `correctionGroupId` 关联。
- 查询层把已存在有效反向事件的原事件显示为“已撤销”，把同时存在替代事件的原事件显示为“已更正”；展示状态不改变投影集合。
- 每个非 reversal 事件最多允许一个直接 `reversesEventId` 后继；重复撤销或更正必须幂等返回现有 correction group。继续修正时针对当前替代事件建立下一组链，不能给同一原事件叠加第二次反冲。
- 业务退款不是技术 reversal：它使用实际退款 `effectiveAt` 的新根槽和 `refundOfEventId`，允许多次部分退款；领域层按原账户/币种限制累计退款不超过原支出尚未退款的影响。若更正会使原支出低于已退款累计额，命令必须阻断并要求先更正退款链，不能留下超额退款或自动重分类。
- 余额断言遵循 supersession 规则，不使用普通反向事件。
- 有历史的账户只允许归档；归档不改变任何历史报表。

### 5.8 存储级幂等与唯一性

PrimaryStore 使用统一 `DeduplicationClaim(scope, scopedKey, payloadHash, targetType, targetId)` 表/对象库，并在与业务事实相同的事务中写入。以下非空 key 必须由数据库唯一约束保证，不能只做写前查询：

- draft consumption：`(bookId, sourceDraftId)`
- 外部导入：`(bookId, sourceNamespace, sourceExternalId)`；`sourceNamespace` 使用稳定的 provider/account/importDefinitionId，不能只写粗粒度 `import`
- 自动周期：`(bookId, occurrenceKey)`，跨 `AutomationOccurrence`、DraftEvent 和 LedgerEvent 唯一
- 技术反向：`(bookId, reversesEventId)`
- 余额断言后继：`(bookId, supersedesAssertionId)`；相同 payload 幂等返回已有 successor，不同 payload 返回显式并发冲突，禁止先提交 fork 再依赖 projection 冻结
- 持久命令：`(bookId, commandId)`
- 根投影槽：`(bookId, effectiveAt, stableOrderKey)` 在 `projectionSuborder=0` 的根事件中唯一；完整事件槽 `(bookId, effectiveAt, stableOrderKey, projectionSuborder)` 唯一

唯一冲突且 canonical payloadHash 相同时，返回已有 target/commit，视为幂等成功；同 key 不同 payloadHash 必须返回显式 conflict，导入项进入 quarantine，不能覆盖或再创建一笔。业务退款只使用 `refundOfEventId`，不占用技术 reversal 的唯一槽。

### 5.9 自动记账

`AutomationRuleSeries` 持有不可变的 schedule identity，并带有每次 occurrence 状态变化都会递增的 `seriesOccurrenceRevision`：

- `id`、`bookId`
- `timezone`、`startLocalDateTime`
- `frequency: daily | weekly | monthly | yearly`、`interval`
- 可选 `weekday` 或 `monthDay`
- `monthEndPolicy: lastValidDay | skip`
- `dstGapPolicy: nextValidInstant`、`dstOverlapPolicy: firstOccurrence`
- 可选 `endAt`、`replacesRuleSeriesId`、`retiredAt`

`AutomationRuleVersion` 只保存可版本化意图：`id`、`ruleSeriesId`、`intentTemplate`、`ruleVersion`、UTC instant `effectiveFrom`、`effectiveTo` 和 `isActive`。同一 series 的版本形成连续、不重叠的 `[effectiveFrom, effectiveTo)` 区间，编辑金额、账户、分类或启停时原子关闭旧区间并创建新版本。

timezone、DTSTART、频率、weekday/monthDay、月末或 DST policy **不能在同一 series 内修改**。日历变更命令必须携带 `expectedSeriesOccurrenceRevision`，并在一个 UnitOfWork 中：

1. CAS 校验 revision，读取旧 series 的最后 posted occurrence；若存在，则计算 `handoverNotBefore` 为旧日历在该 occurrence 之后的下一计划时点；从未 posted 时没有该下界。
2. 退休旧 series，把全部未 posted occurrence/draft 标为 `skipped(scheduleReplaced)` 并保留 claims。
3. 创建带 `replacesRuleSeriesId` 的新 series；存在 `handoverNotBefore` 时，其 DTSTART 不得早于该边界。

旧草稿提交会在同一 PrimaryStore 事务递增 `seriesOccurrenceRevision`。若它先赢，日历变更 CAS 必须返回显式并发冲突且**不得自动重试或创建新 series**；用户刷新后，新 series 首次发生不得早于旧日历的下一个未占用计划时点。若日历变更先赢，旧草稿已 skipped，随后提交必须拒绝。已经 posted 的事实永不改变。未来 occurrence 只作 query preview，直到到期或用户手工补齐时才持久化。

scheduler 先按不可变 series calendar 枚举 local occurrence，再按 series 固定 DST policy 转为 UTC `scheduledAt`，最后选择满足 `effectiveFrom <= scheduledAt < effectiveTo` 的唯一 intent version。series 生命周期内出现 version 区间重叠、空洞或多个候选时规则为 invalid，不生成草稿或 posted；`isActive=false` 的唯一版本显式跳过该 occurrence。月度 29/30/31 日严格按 `monthEndPolicy` 处理，禁止依赖 JavaScript Date 自动溢出。

- 每个实例先原子占用 `AutomationOccurrence(ruleSeriesId, selectedRuleVersionId, scheduledAt, occurrenceKey, state, draftEventId, postedEventId)`；occurrence key 是 `(bookId, ruleSeriesId, scheduledAt)` 的 canonical hash，**不包含 ruleVersion**。提交草稿时在同一事务把 occurrence 从 draft link 更新为 posted link，唯一 claim 始终保留。
- 阶段 3 交付规则 CRUD、确定性 occurrence 生成、待确认草稿和用户触发的手工补齐，默认不改变余额。
- 阶段 4 只增加显式授权的自动 posted、故障恢复与发布硬化；未授权规则仍生成草稿。
- 重启、补齐、并发 scheduler 和重复点击命中同一 occurrence claim，不会重复生成；草稿提交后再次调度返回既有事件。
- 删除自动生成草稿会把 occurrence 标为 `skipped` 并保留 claim；恢复时恢复同一 occurrence/draft 关系，不生成新 key。
- 本地 App 关闭期间不承诺后台运行；重开时按规则补齐。

## 6. 多币种契约

### 6.1 原币事实与报告币估值

- 账户已有事件后，`nativeCurrency` 不可更改。
- 事件保存账户原币金额。
- `reportingCurrency` 只影响展示与投影。
- 更改报告币不能改写账户、事件、锚点或原币金额。

### 6.2 FXQuote

汇率记录至少包含：

- `id`
- `pairBaseCurrency`
- `pairQuoteCurrency`
- `canonicalRate`
- `inputBaseCurrency`、`inputQuoteCurrency`、`inputRate`（仅审计）
- `effectiveAt`
- `quotedAt`
- `source: manual | import | service`
- `purpose: execution | valuation`

币对先按 ISO currency code 的 Unicode code point 顺序规范为与查询方向无关的 `(pairBaseCurrency, pairQuoteCurrency)`，并保存 `1 pairBaseCurrency = canonicalRate pairQuoteCurrency`。反向录入先取倒数再形成同一 canonical pair；原始方向和字符串只作审计，不参与选择。

`canonicalRate` 使用正的 Decimal128-compatible 值，最多 34 个有效数字、最多 18 位小数，不允许浮点。反向输入取倒数与第 34 位规范化固定使用同一个 decimal128 context 和 round-half-even，保证不同 adapter 产生相同 canonical bytes。金额换算在 Decimal 精度内完成，只在最终目标币种的 minor unit 按 round-half-even 舍入一次；中间不按报告币小数位逐步舍入。round-trip 不作为严格可逆不变量，UI 与测试分别披露两次最终舍入造成的 minor-unit 差异。

估值选择规则必须完全确定：

1. 同币估值恒等为 1，不创建 FXQuote；异币估值只考虑 `purpose=valuation` 且 `effectiveAt <= asOf` 的 quote，禁止使用未来或 execution quote。
2. 对 canonical pair 按 `effectiveAt DESC, quotedAt DESC, id ASC` 先选择唯一经济事实，选择过程与请求方向无关；最后才按请求方向使用 `canonicalRate` 或其倒数。
3. v1 不进行隐式三角或多跳换算。
4. 找不到合格 canonical pair 时结果为 `Unavailable`。

交易汇率锁定跨币事件的两端事实；估值汇率用于某个 `asOf` 时点的报表。缺失必要估值汇率时：

1. 已知币种小计可以显示。
2. 完整现余额、待还款和净资产返回 `Unavailable`。
3. UI 列出受影响账户和补充汇率入口。
4. 不允许静默使用 1:1。

## 7. 旧数据迁移契约

### 7.1 迁移真源

macOS 构建实际复制根目录 `index.html`、`styles.css`、`script.js`，而旧实施计划曾把 `记账/` 目录视为 legacy 真源。正式迁移前必须冻结“根目录运行资源 + 当前 Application Support 账本文件”为实际来源，`记账/` 只作为历史参考，不能混合读取。

### 7.2 迁移原则

1. 迁移前创建只读原始快照并记录 SHA-256。
2. 叶子余额节点迁为 `Account`，非叶节点迁为 `AccountGroup`。
3. 账户资产/负债和现金/非现金使用稳定属性，不再根据名称推断。
4. dry-run 明确记录 `includedInCutoverBalance` 集合。旧版在录入时立即修改余额，因此默认所有现存 legacy 流水都已被当前余额吸收；迁移器必须用控制总额验证，不能仅按日期猜测。
5. 当前余额在 cutover 时刻迁为绝对余额锚点。所有 `effectiveAt <= cutoverAt` 且已被吸收的 legacy 流水必须排序在该锚点之前；同一时刻先按确定的 legacy source order 分配 stableOrderKey，cutover assertion 使用严格更晚的 key，避免再次向前累计。
6. `effectiveAt > cutoverAt` 的已吸收流水不能直接留在未调整锚点之后。若其账户原币影响可精确证明，迁移器从 cutover assertion 中扣除该影响并保留未来 posted event，差异分类为 `expected-fix`；无法精确补偿则 quarantine。date-only 值先按账本时区的本地午夜规范化，再与 cutoverAt 比较。
7. 旧 `initialAssets` 按各自时点迁为绝对余额锚点。
8. legacy 交易币种与目标账户原币相同时，才能精确迁为单账户 `legacy` impact；债务 impact 保持负债方向，但无法证明是借款还是信用消费时不得伪造业务类型。
9. legacy 跨币流水只有在原始记录包含明确历史 FX 证据时才能转换为账户原币 impact。缺少证据时保留 raw amount/currency 并 quarantine；可生成冻结汇率的 `legacyEstimate` 提案，但批准只允许其以 `Estimated` 状态展示，无历史 FX 证据时永远不能升级为 Verified。cutover assertion 可以证明当前余额，不能自动证明估算历史曲线。
10. 重名路径无法唯一映射时进入 quarantine，阻断正式切换。
11. 导入或周期记录使用存储级唯一 external ID/occurrence claim，重复执行不产生重复事件。
12. dry-run 必须检测非叶节点的直接余额与直接引用流水；存在时，在该组下生成由输入 hash 派生稳定 ID 的“旧版直接余额”账户并迁入。
13. 非叶节点若无法同时保持逐币种余额、流水数和控制总额，则进入 quarantine 并阻断切换，禁止把余额或流水静默丢给父组或任一子账户。

### 7.3 Migration manifest

dry-run 报告至少包含：

- 输入文件 hash、来源和版本
- cutover 时间
- 旧路径到新账户 ID 的映射
- 各实体迁移、拒绝和歧义数量
- 各账户原币余额与各币种控制总额
- 现余额、待还款和净资产的前后差异
- 锚点与历史流水的分段结果
- expected-fix 与 migration-defect 的差异分类
- 未解决项与原因
- 目标 schema、domain capability、迁移器版本和输出 hash
- 非叶节点直接余额账户清单、原路径、流水数、原币余额、处理结果与 quarantine 原因
- `includedInCutoverBalance` 事件清单、同槽排序、未来流水补偿和 date-only 时区规范化结果
- legacy 跨币流水数量、raw amount/currency、历史 FX 证据、冻结估算 rate、转换后金额、估算标记和未解决差异

正式迁移以获批账务契约和 golden dataset 为真值，不复制旧公式、外币回滚或趋势算法中的已知错误。

### 7.4 切换协议

`CutoverControlPort` 保存以下显式状态机：

```text
legacyWritable
→ freezeRequested
→ legacyFrozen(finalSnapshotHash, leaseEpoch)
→ v2Staged(generationId, migrationId, outputHash)
→ v2RecoveryReady(baseSnapshotHash, migrationHeadSequence)
→ v2Active(generationId)
→ v2FirstWrite(generationId, firstCommitId)
```

- `BootstrapControlStore` 持久保存 `activeGeneration`、`primaryStoreKind`、`domainCapabilityVersion` 和 `cutoverEpoch`。IndexedDB 路线使用稳定 origin 下的 bootstrap store；SQLite 路线使用原生控制数据库或与 SQLite PrimaryStore 同一事务域，绝不依赖另一候选 adapter。`primaryStoreKind` 对已激活 generation 不可自动改变，并参与每次启动、恢复与激活校验。
- macOS legacy 通过 Application Support 中仅当前用户可写的控制接口读取 cutover 状态；Web legacy 使用同一稳定 origin 的控制接口。stop-loss 旧版在**每个持久化命令前**重新读取状态，而不是只在启动时检查。
- `freezeRequested` 通过 CAS 增加 `leaseEpoch` 并立即拒绝所有新 legacy writer lease。freeze coordinator 等待所有旧 epoch lease 释放或可靠过期、确认在途持久命令为零，再取得独占 finalization lease。最终 v1 snapshot/manifest 只在该屏障内生成；完成后再次核对 source revision、文件 hash 和 leaseEpoch，任一变化即废弃并重跑。持有过期 epoch 的旧实例恢复后也不得保存。只有排空屏障与最终产物全部验证后才进入 `legacyFrozen`。
- 新版迁移写入独立 `generationId` 的 staging，旧 active generation 在验证期间保持不变。领域不变量、逐账户/逐币种控制总额、canonical hash 与 manifest 全部通过后，staging 才成为激活候选，但此时仍不更新 active pointer。
- 每个平台在激活 V2 generation 前都必须从已验证 staging 生成迁移后的 canonical base snapshot，记录 `generationId`、`migrationId`、`cutoverEpoch`、`migrationHeadSequence`、`outputHash` 和 `domainCapabilityVersion`。Web 把应用级 base snapshot 重新读取并恢复到一次性 staging generation 验证，但不把它称为独立备份；macOS 还必须让独立 recovery snapshot 达到 native durable、重新读取与实际恢复演练。只有 base 与 migration manifest 一致才进入 `v2RecoveryReady`。legacy v1 原始 snapshot 只用于取证/重新迁移，不能作为 V2 recovery chain 的 base；SQLite 路线也不能把 PrimaryStore SQLite 文件本身冒充恢复副本。
- staging 在 `v2RecoveryReady` 前于所选 PrimaryStore 内创建 `CutoverWriteFence(cutoverEpoch, state=accepting)`。达到该状态后才允许 `v2Active` 或首笔 post-cutover command。
- 达到 `v2RecoveryReady` 后，“原子激活”才更新所选 `BootstrapControlStore` 中单个 pointer；它不跨越 PrimaryStore 与 recovery filesystem。pointer 更新失败时继续使用旧 generation；新 generation 至少保留到一次完整启动与恢复验证通过后才可清理。
- 首笔 V2 command 与 abort 必须由同一个 PrimaryStore fence 事务串行决定胜者。首笔提交在事务中断言 fence=`accepting`，CAS 为 `firstWriteCommitted(firstCommitId)`，并同时写入带 `cutoverEpoch`、`firstPostCutoverCommit=true` 的 CommitRecord；fence 已为 `abortRequested` 时拒绝。后续 V2 command 只在 `firstWriteCommitted` 下继续。
- abort 在 PrimaryStore 事务中仅能把 `accepting` CAS 为 `abortRequested`，并在同一事务重查当前 cutoverEpoch 无 post-cutover CommitRecord；fence 已为 `firstWriteCommitted` 时 abort 拒绝。不能先在一个存储检查、再去另一个存储解冻。
- abort 胜出后才依次恢复/清除 bootstrap pointer、解冻 legacy，最后清理候选 generation；候选 fence=`abortRequested` 后永久拒绝 V2 写。任一步崩溃时，启动流程按 fence 恢复：pointer 仍指候选则继续 abort，pointer 已回退但 legacy 仍冻结则完成解冻，legacy 已解冻但候选尚存则保持候选封存并最后清理。abort 完成后此前 final v1 snapshot/manifest 标记为已消费失效，下次切换必须重新生成。
- “是否已产生新版写入”的权威证据是 `CutoverWriteFence=firstWriteCommitted` 与同事务 CommitLog，不是 cutover 控制状态缓存。`v2FirstWrite` marker 是可重建投影，更新失败时从二者幂等修复。legacy 在 `v2Active` 和 `v2FirstWrite` 都保持只读。
- 一旦产生 `v2FirstWrite`，切换不可逆：legacy 永久只读，不能重新成为写端。回滚目标只能是理解相同账务 capability 的上一稳定新轨构建。

## 8. 信息架构与核心旅程

### 8.1 一级信息架构

1. **总览**：净资产、现余额、待还款、今日开销、期间变化、变化解释、数据风险与最近流水。
2. **账户**：资产/负债账户、原币与折算值、账户详情、归档和余额校准。
3. **流水**：待确认、已记账、已更正、搜索、筛选、周期记录审核和更正历史。
4. **更多**：数据安全中心置顶，其后是自动规则、常用模板、收支分类与标签、备忘录、币种汇率、导入导出和偏好设置。

“记一笔”是所有端一致的全局动作，不是第五个页面。可信洞察嵌入总览的变化桥和流水详情；在真实使用证据表明存在高频独立分析任务前，不设置一级“数据分析”。

### 8.2 首次建账

```text
新建或导入
→ 选择账本时区与报告币
→ 说明本地保存和备份语义
→ 添加资产/负债账户
→ 为每个账户设置期初余额和生效时间
→ 核对现余额、待还款和净资产
→ 创建首个已验证恢复点
```

首次建账允许跳过模板、标签和高级分析，但不能跳过账本时区、账户币种和数据保存说明。

### 8.3 记一笔

用户先选择：

- 收入
- 支出
- 转账
- 借款
- 还款
- 余额校准

然后输入正数金额和账户。只有跨币、手续费、周期规则等相关字段才渐进展开。提交前显示所有账户影响和净资产影响；提交后先进入保存中，达到对应耐久级别后才显示完成。

“支出”选择资产账户时生成资产减少；选择负债账户时生成负债增加，界面明确显示为“信用消费”。退款从原支出详情发起，不增加新的一级意图，并展示将被恢复的账户影响。

流水默认显示账本时区内最近一个自然月，并按投影顺序的严格逆序 `effectiveAt DESC, stableOrderKey DESC, projectionSuborder DESC, id DESC` 展示。筛选、搜索和翻页不改变账务顺序；Excel/CSV/JSON 导出同时保留 UTC ISO `effectiveAt`、账本时区和本地展示时间，避免往返后日期漂移。

### 8.4 数据安全中心

固定展示：

- 当前实时账本位置和 revision
- 最近一次本地提交
- 原生恢复副本 head 和验证状态
- 已验证快照列表
- 最近一次恢复演练
- 浏览器持久存储授权状态
- 导入预检、迁移状态和隔离记录
- 诊断包导出

Web 版只能显示“浏览器本地已保存”，不能把站点数据称为已备份。macOS 只有原生恢复副本已确认后才显示“安全保存”。

## 9. 三端布局与可访问性

### 9.1 Desktop

- `≥1200px` 使用约 240px 左侧 rail。
- rail 包含四个一级入口、全局“记一笔”和底部数据健康摘要。
- topbar 显示账本、估值日、报告币和全局耐久状态。
- 主内容使用 12 列网格，必要时使用右侧 inspector。

### 9.2 Tablet

- `768–1199px` 使用约 80px 常驻 navigation rail，不隐藏导航。
- 横屏账户和流水使用 master-detail；竖屏自动变为单列。
- “记一笔”打开 420–480px side sheet。

### 9.3 Phone

- `<768px` 使用四项底部导航：总览、账户、流水、更多。
- 导航外使用带文字的全局记账 FAB；它是动作，不具备 tab 选中态。
- 详情使用 push 页面；记账使用大 bottom sheet 或全屏表单。
- 只读保护时禁用全局记账动作并直接展示恢复路径。

### 9.4 可访问性门槛

- 320–1440px 和 200% 字号下无非意图横向滚动、裁切或不可达操作。
- 所有触控目标至少 44×44 CSS px，间距至少 8px。
- 正常文字对比度至少 4.5:1，非文本和大字至少 3:1。
- 键盘可以完成导航、记账、取消、更正、导入预检和错误恢复。
- modal 使用正确 dialog 语义、Escape、焦点圈闭和焦点恢复。
- 支持 `prefers-reduced-motion`；信息不只依赖红/绿。
- 每个图表都有文字摘要和可访问数据表。

### 9.5 视觉语言

- 基础画布使用安静的中性色，重要操作使用高对比靛蓝，成功、警告和危险分别使用可访问的绿、琥珀和红，并始终配合文字或图标。
- 净资产等主要数字使用等宽数字和清晰单位，不用装饰渐变制造重要性。
- 信息层级依次为：全局耐久状态、核心指标、变化解释、账户与流水详情、辅助设置。
- 卡片只用于真正独立的指标或交互区域，不把每一行数据包成悬浮卡片。
- 使用统一 spacing、圆角、边框、焦点和表单 token；不继续散落 raw hex 与重复组件样式。
- 品牌目标是“年轻、清晰、专业”，而不是优先添加玻璃效果、阴影、Emoji 导航和装饰动画。
- 流水颜色表达经济影响，而不是输入数值正负：资产增加/负债减少是正向，资产减少/负债增加是负向，转账是中性；颜色始终同时配合方向文字或图标。

## 10. 目标架构

```text
React UI + Global Durability State
                ↓
Application Commands / Queries
  · persistent commandId
  · serial command handling
  · idempotency
  · expected book revision
                ↓
Pure Domain
  · Accounts / Groups
  · LedgerEvents / AccountImpacts
  · BalanceAssertions
  · Currency Valuation
  · Automation
  · NetWorth / History Projections
                ↓
Storage Ports
  · UnitOfWork
  · LedgerRepository
  · Snapshot
  · Migration
  · CommitLog
  · RecoveryReplica
                ↓
Primary Store Atomic Commit
  · IndexedDB when 2A passes
  · native SQLite when 2A fails
  · domain changes
  · bookRevision
  · CommitRecord
  · ReplicaOutbox
                ↓
macOS Replica Drainer
                ↓
Native Atomic Segments + Verified Snapshots
```

React 只负责 UI。领域与存储不依赖 React、DOM、Dexie、SQLite 或 WKWebView。组件只能派发 typed command 和读取 typed query，不能直接修改持久对象或调用具体数据库。

## 11. 提交、恢复与快照协议

本节以 `PrimaryStore` 表示阶段 2A 为发布通道选定的唯一主存储：Web 固定为 IndexedDB；macOS 在 origin 门禁通过时为 IndexedDB，失败时为原生 SQLite。选择写入 `BootstrapControlStore.primaryStoreKind`，对已激活 generation 不可在运行时自动改变。两种 adapter 必须通过相同 UnitOfWork、幂等、恢复和 kill-point contract tests。

### 11.1 主存储原子提交

同一个 IndexedDB transaction 或 SQLite transaction 必须写入：

- 领域实体或账务事件
- `bookRevision`
- `CommitRecord`
- macOS 环境下的 `ReplicaOutboxItem(status=pending)`

`CommitRecordBody` 包含连续 sequence、commitId、commandId、domain version、cutoverEpoch、可选 `firstPostCutoverCommit`、previousCommitHash、payloadHash 和规范化 delta。`commitChainHash = SHA-256(canonical CommitRecordBody bytes)`；PrimaryStore 的 `headHash` 就是该值。账务实体是业务事实，CommitRecord 是事务恢复与审计 envelope；两者不能保存相互竞争的业务语义。

原生 operation segment 保存**完全相同的 canonical CommitRecordBody bytes**，所以 native `segmentHash` 与 Primary `commitChainHash/headHash` 是同一 hash 身份，可以直接比较；文件系统或 manifest 自身若另有 checksum，必须使用不同字段名，不能拿来参与 commit chain 判断。

### 11.2 规范化编码与哈希

Migration output、`CommitRecord`、snapshot、projection fixture 和原生恢复分段统一使用一个 canonical encoder：

- 字节编码为 UTF-8；所有字符串先验证并规范为 Unicode NFC。
- 对象 key 按 Unicode code point 排序；schema 未声明的 key 拒绝，不依赖 JavaScript 对象插入顺序。
- 数组保持领域定义顺序；实体集合必须先按显式 stable key/ID 排序，不能依赖数据库游标的偶然顺序。
- 时间统一编码为 UTC ISO-8601 固定毫秒精度 `YYYY-MM-DDTHH:mm:ss.SSSZ`；账本时区作为独立字段保留。
- minor units 与 `stableOrderKey` 使用无前导零的十进制整数字符串并按整数语义比较；Decimal 使用非指数、无多余尾零的规范字符串；拒绝 `NaN`、`Infinity` 和 `-0`。
- 每个 schema 固定“缺失字段”与 `null` 的不同语义，禁止编码器自行互换。
- hash 算法统一使用 SHA-256；不得使用运行时默认 `JSON.stringify` 顺序或旧版 FNV hash。

迁移的原始输入 hash 直接针对只读输入文件字节；迁移生成 ID 时使用 `SHA-256(inputHash + entityKind + legacyStablePath)` 派生的确定性命名空间，并使用固定 `migrationClock` 与显式 `cutoverAt`。相同输入、迁移器、clock 与 cutoverAt 必须产生相同 canonical bytes 和输出 hash。

### 11.3 原生恢复分段

macOS 每个 commit 使用独立分段文件：

```text
Recovery/
  snapshots/
  operations/
  manifest.json
```

`operations/` 中的连续 segment 是原生恢复链的权威记录，`manifest.json` 只是可重建索引。`Native Durable` 的严格定义是：在目标目录创建临时文件、写入 canonical bytes、文件 `fsync`、原子 rename、父目录 `fsync`、重新读取目标文件并通过 SHA-256 校验。仅完成 rename 不算 durable。

manifest 使用同样的 temp → file-fsync → rename → directory-fsync 流程。manifest 更新失败不否定已经验证的 segment；启动时扫描连续 segment 并验证 hash chain 后重建 manifest。native ACK 返回 `commitId`、`sequence`、`previousCommitHash` 和 `segmentHash/commitChainHash`；应用收到 ACK 后，在独立 PrimaryStore 事务中把对应 outbox 标记为 acked。若崩溃发生在 ACK 与 ack 标记之间，重启后以同一 commitId/hash 幂等补记。

sequence 规则：

- 恰好是下一连续 sequence：允许写入。
- sequence 与 commitId 已存在且 hash 相同：返回同一 ACK，视为幂等成功。
- sequence 有间隙：拒绝写入并请求缺失 commit。
- 相同 sequence 或 commitId 对应不同 hash：认定分叉，立即只读且不得自动选边。

### 11.4 耐久状态机

```text
Prepared in PrimaryStore
→ PrimaryStore Committed
→ Native Replica Pending
→ Native Durable
→ Fully Acknowledged
```

这不是跨存储 ACID 事务，而是可恢复提交协议。

- 业务命令在 PrimaryStore 中只有“原子提交”或“未提交”两种业务结果；domain changes、revision、CommitRecord 和 outbox 同成同败。
- PrimaryStore 已提交后，命令事实已经存在，即使恢复副本尚未 ACK 也不能向用户宣称“整笔失败”并创建第二个命令。未知结果或重试必须复用已经持久化的 `commandId`，幂等返回原 commit，不产生第二次账务影响。
- macOS 显示“安全保存”必须到达 `Fully Acknowledged`。
- PrimaryStore 已提交但原生副本未完成时，显示“已存入本机账本，安全副本待确认”的黄色降级状态。
- macOS 在上一条 persistent commit 到达 `Fully Acknowledged` 前不执行下一条 persistent domain command；30 秒超时或明确 replica failure 后进入全局只读保护。
- 冻结范围包括所有会产生 `CommitRecord` 的命令：账户、流水、余额断言、汇率、自动规则、模板、导入、账本与业务设置。仅不进入账本的纯 UI 偏好可以继续变化。
- Web 版没有原生状态，只显示浏览器本地持久化级别。

### 11.5 全局单写者

- IndexedDB adapter 在事务内部校验 `expectedBookRevision`；Web Locks 提供 book writer lease，BroadcastChannel 广播 revision，不支持 Web Locks 时仍以事务内 revision 为最终保护。
- SQLite adapter 在同一数据库事务中校验 revision，并由原生进程锁与数据库锁保证单写者。
- macOS 默认阻止第二个写实例。
- 原生分段使用文件协调或锁。
- outbox 只由一个 lease owner drain。

### 11.6 快照与压缩

- 快照使用一致性只读事务或 command queue barrier 固定 `snapshotHead=N`。
- N 之后的提交由恢复分段重放。
- 新快照原子写入并重新读取验证后才更新 `latestSnapshot`。
- 至少保留两个已验证快照；每 500 个 commit 或 24 小时创建一次，并在迁移、导入、清空和切换前强制创建。
- Web 只有在应用级 snapshot N 已重新读取验证、`sequence <= N` 无 pending application task，且至少保留一个更早的已验证 generation/snapshot 时，才允许压缩应用 CommitLog。
- macOS 除上述条件外，还必须验证 recovery segment 连续覆盖到 N、`sequence <= N` 无 pending outbox，且保留至少一个更早的原生已验证 snapshot，才允许删除旧恢复分段。IndexedDB 与 SQLite 路线都把 PrimaryStore snapshot 和独立 recovery snapshot 分开验证。
- Web 应用级 snapshot 用于导入、迁移和命令失败恢复，不是浏览器站点数据的独立备份；macOS 原生 snapshot 才用于 PrimaryStore 丢失后的恢复。UI 必须明确区分两者。

### 11.7 恢复决策与 generation 激活

| PrimaryStore 状态 | Native recovery 状态 | 唯一允许行为 |
|---|---|---|
| schema、hash chain、领域不变量均有效且 head 一致 | 有效且一致 | 正常启动；若仅 outbox ACK 状态落后，对照 segment 幂等补记 ack |
| 有效且更新 | 缺段、损坏或较旧 | 保留较新的 PrimaryStore 真源；从当前验证状态生成 base snapshot 并补齐/重建 native，绝不回滚业务真源 |
| 有效但较旧，且 head hash 是 native chain 的严格祖先 | native 从共同 head 以连续已验证 segments 延伸到更高 sequence | 从当前 PrimaryStore head + native 连续 segments 恢复到**新 staging generation**，完整验证后激活到 native head；不得在原库就地重放 |
| 有效但较旧，无法证明 head 是 native ancestor | native 看似更新或不同 | 认定分叉并强制只读，不按 sequence 大小自动选边 |
| 损坏、丢失或不兼容 | snapshot 与连续 segments 有效 | 恢复到新的 staging generation，完整验证后激活 |
| 同一 sequence 对应不同 hash | 任一方存在冲突 head | 强制只读，不自动选边或覆盖 |
| 两端均有损坏但存在共同验证 head | 存在共同 snapshot 与其后的连续 segments | 从最近共同验证 snapshot + 连续分段恢复到 staging |
| 仅 ACK 标记落后 | 对应 native segment 已验证 | 保留业务状态，幂等标记 ack，不重放业务命令 |
| 两端都不存在任何历史数据证据 | 同样无 snapshot、segment、marker 或旧账本 | 仅此情况允许创建空账本 |

恢复永远不能用较旧副本覆盖一个已经通过 schema、hash chain 和领域不变量验证的较新真源。任何需要重建业务库的恢复都写入独立 `generationId` 的 staging；旧 active generation 保持不变，直到 staging 完成 schema、capability、余额、事件数、sequence 与 canonical hash 校验。

激活只更新已选 `BootstrapControlStore` 中单一 `activeGeneration` pointer，并同时校验持久的 `primaryStoreKind`、capability 与 cutoverEpoch。pointer 更新失败继续使用旧 generation；被替换 generation 至少保留到新 generation 完成一次冷启动、一次 recovery drill 和一次 snapshot 验证后才可清理。

若启动时选定的 PrimaryStore 缺失、不可读、origin 改变，或控制元数据与 adapter 不匹配，应用进入只读恢复，绝不自动初始化另一 adapter 或空库。IndexedDB 与 SQLite 之间的任何转换都必须经过显式 migration、独立 staging generation、manifest、cutover 和恢复演练；SQLite 构建不得残留可写 IDB 业务 adapter，IndexedDB 构建也不得在故障时自动创建 SQLite 业务库。

## 12. WKWebView 持久化门禁

当前 App 使用 `loadFileURL`。IndexedDB 能否在覆盖安装、移动、重签、隔离和 Debug/Release 间保持稳定 origin 是正式切换阻断项。

阶段 2 的第一个不可跳过子门禁是 **2A Origin Spike**。2A 结束前不得实现依赖具体主存储的 UnitOfWork、outbox、snapshot 或 recovery segment。必须执行：

1. 写入固定 database ID、100 条事件和内容 hash。
2. 覆盖安装和版本升级。
3. 移动 App bundle 与安装路径。
4. 测试隔离/App Translocation、重新签名和重新打包。
5. 重启 App、macOS 和 WKWebView process。
6. 中断 IndexedDB schema upgrade。
7. 比较所有支持场景的 database ID、head 和内容 hash。

通过标准是全部支持矩阵 100% 找回相同 database ID、sequence 和 canonical content hash。若稳定应用 origin 方案仍失败，该 macOS 发布通道在构建期选择已预授权的原生 SQLite 单主 adapter，并针对同一 Repository/UnitOfWork contract 跑完整套件；这不是启动时的动态 fallback。不得先建设半套 IndexedDB 恢复协议再返工，也不得同时保留两套业务写端。任何后续 adapter 转换都是正式迁移并生成新 generation 与 migration record。

## 13. 安全设计

### 13.1 Web 与 React

- 不使用 `dangerouslySetInnerHTML` 或内联事件。
- CSP 基线必须由自动化测试精确验证：

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
worker-src 'self' blob:;
```

- CSP 不包含 `unsafe-inline` 或 `unsafe-eval`。未来若启用汇率服务，只对固定的精确 HTTPS endpoint 开放 `connect-src`，不得宽泛允许 `https:`。
- Web 通过 HTTP response header 交付完整 CSP；不能依赖 HTML meta 实现 `frame-ancestors`。WKWebView 文件/本地页除可生效的 CSP 外，还必须用 navigation allowlist、main-frame 校验和禁止新窗口补足容器边界；实施计划与 E2E 分别验证实际 header 和容器策略。
- 第三方资源本地固定版本并校验构建 hash。
- 页面禁止远程 script、fetch 和 navigation。
- 用户数据通过 React 默认转义和领域 schema 双重保护。

### 13.2 原生桥

- 验证 `message.frameInfo.isMainFrame` 和精确允许页面 URL。
- 每个 method 使用严格 DTO、大小限制、速率限制和状态白名单。
- 禁止远程页面和子 frame 获得桥能力。
- `javaScriptCanOpenWindowsAutomatically = false`。
- 原生读文件前先检查大小、扩展名和 MIME。
- 大文件不在主线程同步读取、base64 和 JSON 序列化。
- 恢复目录与文件权限限制为当前用户读写，并拒绝固定恢复路径中的 symlink 跳转。
- 日志不记录账户名、描述、金额或完整账本 payload；诊断包默认脱敏，若选择包含真实账本必须显著提示并二次确认。
- 当前版本没有账本静态加密时，数据安全中心必须如实说明，不能用“安全保存”暗示已加密；“安全”只表示已验证的耐久副本。

主 frame、origin 或 capability token 不能阻止同页面 XSS；真正边界是安全 DOM、CSP、无远程脚本、严格 DTO 和领域校验。

### 13.3 导入导出

- JSON/XLSX 进入 staging DB，在 Worker 中解析。
- 限制文件大小、sheet 数、行列数、嵌套深度、字符串长度和解析时间。
- 防御 XLSX/ZIP bomb、prototype pollution、非有限金额和非法日期。
- Excel/CSV 导出转义以 `= + - @` 开头的用户文本，防止公式注入。
- 导入提供逐行错误、重复检测、差异摘要和预恢复点。
- 完整替换、重置和恢复放入明确 danger zone。

## 14. 性能预算

固定代表数据集：50,000 笔事件、500 个账户/组、10 年历史。

发布基准机器固定为 2021 14 英寸 MacBook Pro（Apple M1 Pro 10-core CPU、16GB RAM、接通电源、关闭低电量模式）。每个候选版本把 `primaryStoreKind`、确切 macOS、Safari/WebKit 与 Chromium 版本写入 benchmark manifest；浏览器使用全新固定 profile，不安装扩展。冷启动定义为终止 App/浏览器进程后重新启动并首次打开账本，不人工清除 OS file cache。每项至少运行 30 个独立样本并报告 p50/p95；native durability 测试启用真实 file `fsync` 与 parent-directory `fsync`，不得用 mock 或关闭同步写来达标。

| 指标 | 发布硬预算 |
|---|---:|
| Web/macOS 冷启动 p95 | ≤2 秒 |
| Web/IDB PrimaryStore commit p95 | ≤100ms |
| macOS/IDB PrimaryStore commit p95 | ≤100ms |
| macOS/SQLite transaction p95（条件路径） | ≤100ms |
| macOS 完全确认 p95 | ≤250ms |
| 筛选/分页首屏 p95 | ≤100ms |
| 总览 projection p95 | ≤200ms |
| 10 年趋势计算 p95 | ≤500ms，放入 Worker |
| 首屏业务 JS | ≤250KB gzip |
| 50,000 笔流水滚动 | ≥55 FPS |
| 恢复 50,000 笔已确认记录 | ≤60 秒 |

XLSX 和图表库按路由懒加载。趋势按一次时间排序与增量累计生成，不按每日重复扫描全量事件。

## 15. 功能处置矩阵

| 现有或需求能力 | 新版处置 | 交付阶段 | 切换阻断 |
|---|---|---:|:---:|
| 资产分类树 | 拆分为账户组、账户、收支分类与标签 | 2–3 | 是 |
| 新增/编辑/删除账单 | 改为意图式事件；已记账使用不可变更正链 | 2–3 | 是 |
| 账户余额直接编辑 | 改为带时点的绝对余额断言与 supersession | 2–3 | 是 |
| 多币种 | 阶段 2 交付确定性手工估值、缺失状态和交易 FX；阶段 4 增加来源、批量维护和过期提示 | 2、4 | 是 |
| 常用账单模板 | 保留，使用稳定账户和分类 ID；旧数据完整迁移 | 3 | 是 |
| 周期记账 | 保留，默认生成待确认草稿并幂等补齐；自动执行在阶段 4 | 3–4 | 是 |
| 备忘录 | 保留到“更多”，安全文本渲染并迁移 | 3 | 是 |
| 资产趋势/历史分析 | 合并为统一 projection 与确定性变化解释 | 3 | 是 |
| 今日开销 | 纳入总览，使用支出事件口径 | 3 | 是 |
| 资产分布与外币明细 | 保留，显示原币、折算值、汇率时间与覆盖率 | 3 | 是 |
| 可信图表导出 | 仅在图表通过底层流水对账后，按当前筛选口径导出可访问数据表/CSV 和 PNG | 3 | 是 |
| 自由图表选择器 | 延后，先交付确定性变化桥和趋势 | V2.x | 否 |
| 未来预测 | 下线；只有显式假设、确定性输出和不确定性说明具备后才恢复 | V2.x | 否 |
| 固定格式账单接口 | 提供版本化 XLSX/CSV/JSON 行级 schema、字段说明、预检、外部唯一键和错误报告 | 3 | 是 |
| 完整账本导入导出 | 重做为 staging、预检、去重、快照、差异报告和 round-trip | 3 | 是 |
| 拖拽任意层级 | 首版改为账户组内排序与显式移动，禁止循环 | 3 | 否 |
| 浏览器/localStorage 备份 | 停止称为备份，改为持久存储状态与显式导出 | 1、3 | 是 |
| macOS 主 JSON 文件 | 作为 legacy 输入；新版改为原生恢复副本目录 | 1–2 | 是 |
| 可支用资金 | 首个切换版本不展示；等待 Reserve/Pending 完整模型与 golden 后交付 | V2.x | 否 |

## 16. 四阶段交付

### 阶段 1：旧版风险隔离

范围：

- 固定根目录为实际运行真源。
- 损坏账本进入只读恢复，不回退空账本覆盖。
- 串行保存并让成功提示等待 durable ACK。
- 修复外币删除反冲、拖拽循环和日期边界。
- 安全 DOM、CSP、桥导航白名单。
- 隐藏随机分析、死入口和未验证的高风险动作。
- 提供最小可达窄屏导航与 macOS 合理最小尺寸。
- 实现 `CutoverControlPort` 的 legacy 检查点；每个持久化命令前都能因 freeze marker 进入只读。
- 建立 freeze 排空测试：双标签同时写、macOS 第二实例持旧 lease、命令在 marker 检查后/落盘前暂停，以及 lease owner 崩溃后的 TTL/epoch 接管。

阶段门槛：损坏账本 hash 不变；连续快速修改不丢失；恶意文本不执行；320–1440px 核心入口可达；golden 基础公式精确到最小货币单位。

### 阶段 2：可信账务与存储首切片

范围：

- `/app` 中建立 Vite/TS/React。
- **2A 首先完成 WKWebView origin spike。** 通过后选择 IndexedDB；失败即选择原生 SQLite 单主 adapter。2A 未通过前不建设依赖具体主存储的 outbox、snapshot 或 recovery segment。
- 在统一 storage contract 上实现 Account、DraftEvent、不可变 LedgerEvent、AccountImpact 和 BalanceAssertion。
- 实现收入、支出、信用消费、转账、借款、还款、更正与校准。
- 实现草稿原子消费、CorrectionGroup、投影槽与所有存储级 DeduplicationClaim 唯一约束。
- 实现基础 FX：手工 quote、确定性 direct/inverse 选择、缺失 `Unavailable` 和跨币交易事实。
- 按 2A 结果实现主 adapter、revision、CommitLog、outbox、原生恢复分段和快照。
- 建立只读迁移 dry-run、golden dataset 和 adapter contract tests。

阶段门槛：核心不变量 100% 通过；200 条确定性命令和至少 20 个 kill point 后，所有完全确认命令可恢复；相同迁移输入 100 次得到一致 hash；重名歧义不猜测。

### 阶段 3：Adaptive Shell 与完整核心旅程

范围：

- 总览、账户、流水、更多和全局记账。
- 首次建账、账户管理、流水筛选、更正、模板，以及 AutomationRule CRUD、确定性 occurrence、周期草稿与手工补齐。
- 数据安全中心、导入预检、版本快照和恢复预览。
- 桌面/平板/手机布局、键盘路径和 WCAG 2.2 AA。
- 今日开销、净资产/现余额/待还趋势和变化桥。
- 最近一月稳定排序、版本化 XLSX/CSV/JSON 账单导入、完整 round-trip，以及已对账图表的数据表/CSV/PNG 导出。

阶段门槛：320/375/768/812 横屏/1024/1440 均无裁切；键盘完成核心流程；所有聚合金额可下钻；导入和恢复 round-trip 对账一致。

### 阶段 4：自动化、切换与发布硬化

范围：

- 自动规则幂等执行与待确认审核。
- FX 批量维护、来源覆盖与过期提示；不改变阶段 2 的确定性选择契约。
- legacy 最终迁移、cutover、只读归档和新轨回滚构建。
- 激活前生成并演练独立 V2 canonical base recovery snapshot，验证 freeze 排空屏障与 post-cutover CommitLog 证据。
- 50k 性能、崩溃恢复、安全语料、依赖审计和发布构建。
- 完成 7 次整体闭环和 7 次可靠性专项循环。

阶段门槛：无 P0/P1；golden、迁移、恢复、性能、安全、无障碍和发布矩阵全部通过；7 天自然 soak 无无法解释对账差异、commit gap 或数据丢失。

## 17. 多代理迭代治理

### 17.1 三轮前置设计迭代

已经完成：

1. 产品、UX、工程独立审计与交叉质询。
2. 账务契约、迁移架构、跨端设计独立制定与互评。
3. 产品与可靠性反方审核，修正完整复式过度设计、绝对余额锚点和跨存储伪原子性。

### 17.2 每个实施任务的审核结构

每个任务使用两批 5.6-sol xhigh 代理，避免共享编辑冲突：

1. **制定组：** 产品/领域与架构代理共同冻结验收行为。
2. **执行组：** 独立实现代理按 TDD 完成任务。
3. **规格审核：** 代理只检查是否符合本设计与任务要求。
4. **质量审核：** 另一代理检查正确性、安全、性能、测试与可维护性。
5. **主代理整合：** 复核 diff、运行全量测试、解决冲突后才提交。

### 17.3 七次整体闭环

每次都运行完整应用链路，但关注不同新增证据：

1. **账务正确性闭环：** 公式、事件矩阵、锚点、FX、golden。
2. **核心旅程闭环：** 建账、记账、更正、校准、模板、周期草稿。
3. **跨端体验闭环：** 三端布局、键盘、读屏、错误状态。
4. **迁移与数据交换闭环：** dry-run、quarantine、导入导出、round-trip。
5. **恢复与回滚闭环：** 快照、分段、staging、cutover、回滚构建。
6. **性能与安全闭环：** 50k 数据、Worker、XSS、桥、恶意文件、依赖。
7. **发布候选闭环：** 完整回归、真实构建、升级矩阵和 soak。

如果某轮发现缺陷，修复后必须重跑该轮及所有受影响的前序门禁；不能用“重复次数已完成”替代新证据。

### 17.4 七次可靠性专项循环

功能完成后，由五个角色在两批代理中完成：持久化故障调查、数据完整性、性能、安全和最终验证。

1. 写入队列、revision、Web Locks、乱序 ACK 和重复命令。
2. IndexedDB/条件 SQLite adapter、outbox、native rename、ACK、快照和激活的 kill-point 矩阵；包含 abort/first-write fence 竞态以及 fence、pointer、legacy unfreeze、candidate cleanup 后的逐点崩溃。
3. 配额、磁盘满、只读目录、损坏快照、hash chain 断裂和权限变化。
4. JSON/XLSX 恶意输入、重复导入、迁移歧义、公式注入和回滚。
5. 50k 流水、500 账户、10 年趋势、内存、启动和交互预算。
6. macOS 升级、移动、重签、隔离、双实例、origin 和桥权限。
7. 全量回归、发布包、恢复演练和 7 天 soak。

每轮输出问题清单、证据、修复提交、复测结果和剩余风险。停止条件不是“跑满七次”，而是七类威胁均有独立证据且最终回归全部通过。

## 18. Golden dataset 与验收任务

### 18.1 必过基础案例

1. 现金 0、负债 100：现余额 0、待还款 100、净资产 −100。
2. 资产账户 `+100`：现余额和净资产均增加 100。
3. 负债账户 `+100`：待还款增加 100，净资产减少 100。
4. **Projection 公式 fixture：** 负债从 100 执行单账户 decrease 100，待还款 `100→0`，净资产相对增加 100；它不代表一个独立用户命令。
5. **Projection 公式 fixture：** 负债从 0 执行单账户 decrease 100，待还款仍为 0、负债溢缴 `0→100`、净资产增加 100，绝不对余额取绝对值；E2E 使用合法退款或余额断言路径到达该状态。
6. 同币转账前后净资产不变。
7. 借款使资产和负债同时增加，净资产不变。
8. 还款使资产和负债同时减少，净资产不变。
9. 余额锚点为 T 时刻 1,000；更正 T 前流水后，T 后余额仍从 1,000 开始。
10. 错误支出 80 更正为 50：原事件、精确 reversal 和 replacement 都参与投影，最终余额只减少 50，不是增加 30 或减少 130。
11. T/key1 原支出、T/key2 锚点=1,000，后来在同一业务日期更正；reversal/replacement 仍在 key1 逻辑槽，锚点后余额保持 1,000。
12. T/key10 锚点=1,000、T/key20 支出=100，后来把锚点值 supersede 为 900；leaf payload 在 key10 根槽替换，最终余额为 800。
13. assertion fork、循环、跨账户、跨币或跨槽 supersession 均返回 invalid 并只读；重复投影 100 次结果一致。
14. 同一 Draft 用两个不同 commandId 顺序或并发提交，只产生一个 DraftConsumption、一个 LedgerEvent 和一笔余额影响。
15. 自动 occurrence 生成 Draft 并提交后再次运行 scheduler，命中同一 claim 并返回既有事件，不产生新草稿。
16. 同一原事件并发撤销与更正时，`reversesEventId` 唯一约束只允许一个 correction group；另一命令幂等返回或明确冲突。
17. reversal 的任一 account、currency、amount、direction 或 impactOrder 不是逐项精确反向时，整个 UnitOfWork 原子拒绝。
18. 删除必要估值汇率后，完整净资产为 `Unavailable`，不按 1:1 计算。
19. 同时存在互相矛盾的 USD/CNY 与 CNY/USD quote 时，两者先规范为同一 canonical pair；正反查询选择同一 quote ID，再决定是否取倒数。
20. CNY 0.01 按 `1 USD = 7.2 CNY` 换算并 round-trip 时因最终 minor-unit 舍入回到 CNY 0.00；差 1 个 minor unit 被明确披露，不伪称严格可逆。
21. 账户改名和归档不改变任何历史余额。
22. legacy 非叶节点同时含直接余额与流水时，迁入专用稳定账户或 quarantine，迁移后账户/币种控制总额与流水数不静默减少。
23. legacy 当前余额已含明日 +100 时，cutover assertion 先减去可证明的未来影响；今日不重复，明日事件执行后只增加一次 100。
24. legacy 跨币流水缺少历史 FX 时保留 raw source 并 quarantine，不生成混币 AccountImpact 或 Verified 历史。
25. 相同 external ID 与相同 payload 重复导入为幂等成功；相同 external ID、不同 payload 返回 conflict 且不覆盖。
26. 与 cutoverAt 同时的 legacy 流水和 date-only 本地午夜流水按账本时区规范化，全部被吸收事件严格排在 cutover assertion 之前。
27. 月度规则 v1 金额 10、v2 从 3 月生效金额 20：3 月 occurrence 只选择 v2，唯一 key 不含 version，最终只产生一笔 20；版本重叠或空洞不生成账务事实。
28. 两个 commandId 并发 supersede 同一 assertion leaf：相同 payload 返回同一 successor，不同 payload 返回并发冲突，永不先写出 fork。
29. 今日支出 80 更正为 50：余额减少 50、今日开销为 50；再撤销当前 replacement 后，整条 correction chain 对余额与今日开销的贡献均为 0。
30. 月度 series 已有未提交的 3 月 1 日草稿，同时把日历改为 3 月 5 日：若日历变更先赢，旧 occurrence 原子 skipped，新 series 最终最多 posted 一笔；若旧草稿提交先赢，变更因 `seriesOccurrenceRevision` 冲突且不自动重试，刷新后新 DTSTART 最早为旧日历下一未占用周期，3 月仍只有一笔 posted。两种顺序以及事务后崩溃/同 commandId 重试都保持交接周期最多一笔经济影响。
31. reversal 以 reversal 或 balanceAssertion 为目标时整个命令原子拒绝，不写 CorrectionGroup 或 CommitRecord。
32. 支出 100 已累计退款 80 后，更正原支出为 50 必须阻断；先把退款链更正到不超过 50 后才能提交。
33. 分别以 `1 USD=7.2 CNY` 和数学等价的 CNY/USD 反向字符串录入，在 IndexedDB 与条件 SQLite adapter 中得到字节一致的 canonicalRate 和 commitChainHash。
34. 移动锚点到已有同账户、同 effectiveAt 的 root 时，旧链 retire，移动 payload supersede 目标当前 leaf，不创建第二根；投影结果唯一。
35. abort 与 V2 首笔写并发：abort fence 先赢则首写拒绝；首写先赢则 abort 拒绝且 legacy 永久只读。在 fence、pointer、legacy unfreeze 和 candidate cleanup 后逐点崩溃，重启均收敛到同一胜者。
36. PrimaryStore 合法回退到较旧 head：能证明其为 native chain 祖先时恢复到新 staging 后前进到 native head；不能证明共同 hash 时只读分叉，不按 sequence 猜测。
37. Web 应用 base snapshot 与 macOS 独立 recovery base snapshot 分别完成重新读取和一次性 staging 恢复演练；legacy v1 snapshot 或 PrimaryStore SQLite 文件均不能冒充 V2 recovery base。

### 18.2 必过用户任务

1. 建立现金、银行卡和信用账户，设置期初余额并核对公式。
2. 完成收入、支出、信用消费、转账、借款、还款和余额校准：业务命令在主库原子提交或不提交；macOS 已提交但副本待确认时显示耐久降级，复用同一 commandId 重试且不重复记账。
3. 修改锚点前后不同日期的流水，验证历史曲线与当前余额边界。
4. 迁移旧 JSON/Excel，验证备份、逐账户/逐币种对账、去重和 round-trip。
5. 在桌面、平板和手机完成全局记账、筛选、更正、查看趋势和恢复演练。

### 18.3 数据与可靠性门槛

- 所有金额误差不超过最小货币单位。
- 同一输入经 §11.2 canonical encoder 始终产生字节级一致的 projection 结果与 SHA-256。
- 完全确认的 macOS commit 恢复率 100%，RPO 为 0 个已确认 commit。
- migration/import 失败产生 0 个部分激活实体。
- 损坏或不兼容数据从不自动变为空账本。
- 同一导入或 occurrence key 重复执行不产生重复账务影响。

## 19. 测试策略

- **Domain 单元与属性测试：** 草稿原子消费、不可变已记账事实、事件矩阵、精确 reversal/correction 基数、锚点 supersession/槽位、canonical FX/舍入、币种、最小单位、归档和不变量。
- **Projection golden tests：** 现余额、待还款、净资产、今日开销、趋势、变化桥。
- **Repository contract tests：** IndexedDB 与条件 SQLite adapter、revision、事务、并发唯一 claims、CommitLog、outbox、staging generation。
- **Native contract tests：** Primary headHash/native segmentHash 同一身份、分段幂等、sequence/hash、快照、manifest、文件锁和 DTO 限制。
- **Migration tests：** 重名、多个锚点、同槽/cutover 后流水、date-only 时区、跨币缺证据、双计、非法日期、重复导入、quarantine、freeze/fence race、V2 base recovery 和 rollback。
- **Automation calendar tests：** 时区、DST gap/overlap、月末 29/30/31、series version 重叠/空洞/交界、skipped 草稿恢复、补齐、并发 scheduler 和草稿提交后重跑。
- **Security tests：** DOM XSS、prototype pollution、ZIP bomb、公式注入、远程导航、子 frame 和超限桥 payload。
- **E2E：** 首次建账、记账、更正、校准、导入、恢复、跨端导航和错误注入。
- **Visual/a11y：** 320–1440px、200% 字号、键盘、VoiceOver、axe critical/serious 为 0。
- **Performance：** 固定 50k/500/10 年数据集，并在固定硬件记录 p50/p95、内存和包体。

## 20. 发布、回滚与版本能力

版本必须分离：

- `storageSchemaVersion`
- `domainCapabilityVersion`
- `minimumReaderVersion`
- `exportFormatVersion`
- `migrationId`

上一稳定回滚构建必须完整理解所有可能影响账户余额、余额断言、FX、事件参与状态和 projection 的 domain capability。只有经过显式登记、完全不影响账务或恢复结果的纯展示元数据可以忽略。

若 `domainCapabilityVersion > supportedCapabilityVersion` 或 `minimumReaderVersion` 高于当前构建，应用必须进入只读兼容保护：禁止 projection、持久写入、迁移激活和恢复覆盖，不能展示一个看似正常但可能少算事件的总览。每个候选发布都必须用新版本实际写入每类 capability 后的数据库 fixture 启动上一稳定构建；未通过时关闭该构建的回滚窗口，并保留理解新 capability 的稳定版本。

任一条件触发停止写入和发布阻断：

- 无法解释的最小货币单位差异
- checksum、revision、sequence 或 hash chain 断裂
- 已确认命令重启后缺失
- migration、恢复或导入部分提交
- 重复 command 产生重复账务影响
- P0/P1 安全缺陷
- WKWebView origin 门禁失败且替代 adapter 未验证
- 性能连续超过发布硬预算

## 21. 非目标

本轮明确不实现：

- 完整复式总账、试算平衡、正式损益表、现金流量表或税务报表
- 银行 API、自动抓取账单或可靠后台同步
- 多用户、家庭账本、NAS、远程访问和冲突合并
- 证券成本基础、税务归因和复杂投资收益分析
- 权责发生制、应收应付和摊销
- 任意图表编辑器或机器学习预测
- 暗色主题、品牌插画和装饰动画优先级高于数据可信度

## 22. 最终完成定义

只有同时满足以下条件，V2 才可取代旧版：

1. 四阶段硬门槛全部通过。
2. 七次整体闭环与七次可靠性专项均有独立证据。
3. 所有 golden、迁移、导入导出和恢复结果精确到最小货币单位。
4. 无未解决 P0/P1，无 axe critical/serious。
5. 代表数据集满足性能预算。
6. macOS/Web 构建、升级、恢复和回滚矩阵通过。
7. legacy 已冻结并永久只读，不存在双写路径。
8. 发布候选经过 7 天 soak，无数据丢失、commit gap、分叉或无法解释的净资产差异。
9. §15 功能处置矩阵中所有“切换阻断=是”的能力均已通过对应阶段验收，未以“已设计”代替“已交付”。
