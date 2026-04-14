# Asset Tracker

[![简体中文](https://img.shields.io/badge/语言-简体中文-1677ff)](./README.md)
[![English](https://img.shields.io/badge/Language-English-24292f)](./README.en.md)
[![Version](https://img.shields.io/badge/version-v0.2.0-2f855a)](./CHANGELOG.md)

本项目是一个本地优先的多币种资产记账系统，重点解决以下几件事：
- 本地稳定运行，数据落在 `IndexedDB`
- 历史资产状态可锚定，旧账单可反算过去时点
- 自动记账、模板、导入导出、汇率时间线一体化
- 资产概览与数据分析大屏统一走同一套账务口径

当前主应用在 [`app/`](/Users/joshua/.config/superpowers/worktrees/asset-tracker/codex-phase1-foundation/Desktop/Qiushan_Studio/6_Personal/可视化记账/app)，使用 `Vite + TypeScript + IndexedDB`。根目录静态页面和 [`记账/`](/Users/joshua/.config/superpowers/worktrees/asset-tracker/codex-phase1-foundation/Desktop/Qiushan_Studio/6_Personal/可视化记账/记账) 保留为旧版实现与迁移参考。

## 当前版本

`v0.2.0` 的重点更新：
- 分类管理默认折叠，支持一键展开/折叠
- 模板支持“无预设金额”，可到账单页后再填金额
- 自动记账支持每月几日、月末、每日几点
- 历史资产状态可编辑，且不会被更早账单覆盖当前盘点值
- 汇率支持按日期生效，历史资产对比可直接补录历史汇率
- 资产概览增加最近账单、备忘录、图表概况、币种汇总
- 数据分析页补齐收入、支出、净收入、未来预计、分类构成、饼图构成、热区、雷达、分类树快照
- 分析页布局已按“主图 + 左右列”重新整理，适配当前信息密度

完整变更见 [`CHANGELOG.md`](/Users/joshua/.config/superpowers/worktrees/asset-tracker/codex-phase1-foundation/Desktop/Qiushan_Studio/6_Personal/可视化记账/CHANGELOG.md)。

## 功能概览

### 资产与账单
- 多币种分类与账单：`CNY`、`USD`、`SGD`、`MYR`
- 资产 / 负债 / 分组分类，支持层级管理和拖拽排序
- 账单新增、编辑、删除、筛选、排序
- 用途分类、用途模糊搜索、备注模糊搜索

### 模板与自动记账
- 常用模板快速套用
- 模板可不带金额，只预填分类、方向、用途、备注
- 自动记账支持周期补齐到今天
- 支持月内指定日期、月末、每日指定时间

### 历史资产与汇率
- 可设置某个时点的准确资产状态
- 更早账单只影响历史回放，不冲掉当前锚点
- 汇率按生效日期管理，支持历史汇率补录
- 历史资产对比支持不同时间点折算

### 导入导出与存储
- 本地数据库：`IndexedDB`
- JSON 快照导入导出
- 旧版浏览器数据自动迁移
- 本地优先架构，后续可接 NAS / 多端同步

### 可视化分析
- 资产概览、最近账单、备忘录
- 收入 / 支出 / 净收入趋势
- 未来预计曲线
- 分类构成、饼图构成、周期现金流热区
- 结构分布雷达、分类树快照、历史资产对比

## 项目结构

```text
.
├── app/                # 当前主应用（Vite + TypeScript + IndexedDB）
├── docs/               # 设计文档与阶段计划
├── legacy/             # 旧版迁移说明
├── 记账/              # 旧版静态实现
├── LICENSE             # MIT License
├── README.md           # 中文说明
└── README.en.md        # English README
```

## 本地启动

```bash
cd app
npm install
npm run dev -- --host 127.0.0.1 --strictPort
```

浏览器打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

## 常用命令

```bash
cd app
npm test
npm run build
```

## 路线图

- 本地单用户版继续做视觉和交互收口
- 多人账本与权限模型
- NAS 服务端与多终端同步
- 更完整的移动端适配
- PWA 离线增强与备份策略

## 许可证

MIT License，详见 [LICENSE](./LICENSE)。

**作者**: Qiushan  
**更新时间**: 2026-04-14  
**版本**: v0.2.0
