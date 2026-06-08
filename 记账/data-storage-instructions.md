# 数据文件存储功能使用说明

## 功能概述
已为你的资产追踪系统添加了数据文件存储功能，可以将数据保存到本地JSON文件中，而不仅仅依赖浏览器的localStorage。

## 主要修改

### 1. 自动导出功能
- 每次保存数据时，会自动检查是否开启了自动导出设置
- 如果开启，会自动下载最新的数据文件到下载文件夹
- 文件名格式：`asset-tracker-data-YYYY-MM-DD.json`

### 2. 手动导入导出
- 添加了专门的数据文件导入导出功能
- 导出：将所有数据（分类、交易、设置等）保存为JSON文件
- 导入：从JSON文件恢复数据，会自动备份当前数据到localStorage

## 需要在HTML中添加的按钮

请在导入导出界面添加以下按钮：

```html
<!-- 在现有的导入导出按钮区域添加 -->

<!-- 数据文件导出按钮 -->
<button id="export-data-btn" class="btn btn-primary">
    <i class="fas fa-download"></i> 导出数据文件
</button>

<!-- 数据文件导入按钮 -->
<input type="file" id="import-data-file" accept=".json" style="display: none;">
<button id="import-data-btn" class="btn btn-success">
    <i class="fas fa-upload"></i> 导入数据文件
</button>

<!-- 自动导出设置 -->
<div class="form-group">
    <label>
        <input type="checkbox" id="toggle-auto-export">
        自动导出数据文件（每次保存时自动下载）
    </label>
</div>
```

## 使用方式

### 导出数据
1. 点击"导出数据文件"按钮
2. 文件会自动下载到你的下载文件夹
3. 文件包含所有分类、交易记录、设置等数据

### 导入数据
1. 点击"导入数据文件"按钮
2. 选择之前导出的JSON文件
3. 系统会验证文件格式并导入数据
4. 原有数据会自动备份到localStorage

### 自动导出设置
1. 勾选"自动导出数据文件"复选框
2. 之后每次添加交易、修改分类等操作都会自动导出最新数据文件
3. 这样可以确保数据文件始终是最新的

## 数据安全
- 每次导入数据前，系统会自动备份当前数据
- localStorage仍作为备份存储方式
- 建议定期手动导出数据文件作为备份

## 文件格式
导出的JSON文件包含以下数据：
- categories: 分类结构
- transactions: 交易记录
- settings: 系统设置
- memo: 备忘录
- automationRules: 自动记账规则
- transactionTemplates: 交易模板
- exportTime: 导出时间
- version: 数据版本

现在你可以：
1. 将数据文件保存在程序文件夹中
2. 在不同设备间同步数据
3. 定期备份数据文件
4. 版本控制你的财务数据