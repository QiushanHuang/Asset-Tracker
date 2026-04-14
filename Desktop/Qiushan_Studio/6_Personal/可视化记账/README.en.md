# Asset Tracker

[![简体中文](https://img.shields.io/badge/语言-简体中文-1677ff)](./README.md)
[![English](https://img.shields.io/badge/Language-English-24292f)](./README.en.md)
[![Version](https://img.shields.io/badge/version-v0.2.0-2f855a)](./CHANGELOG.md)

Asset Tracker is a local-first multi-currency ledger focused on four things:
- reliable local storage backed by `IndexedDB`
- historical asset anchors with backward reconstruction
- recurring bookkeeping, templates, import/export, and dated FX rules
- one consistent accounting model shared by the dashboard and analytics views

The main app lives in [`app/`](/Users/joshua/.config/superpowers/worktrees/asset-tracker/codex-phase1-foundation/Desktop/Qiushan_Studio/6_Personal/可视化记账/app) and uses `Vite + TypeScript + IndexedDB`. The root static page and [`记账/`](/Users/joshua/.config/superpowers/worktrees/asset-tracker/codex-phase1-foundation/Desktop/Qiushan_Studio/6_Personal/可视化记账/记账) are kept as legacy references for migration work.

## Current Release

`v0.2.0` highlights:
- category trees now start folded, with expand-all / collapse-all controls
- templates can omit the amount and prefill the rest of the transaction form
- recurring rules support monthly dates, month-end, and daily time-of-day
- asset state anchors are editable and older transactions do not overwrite the current anchor
- exchange rates are effective-date based, with inline historical FX entry during comparisons
- the dashboard now includes recent transactions, memo, overview chart, and currency summary
- the analytics screen includes income, expense, net-income, forecast, composition, pie, heat-zone, radar, and tree snapshot panels
- the analytics layout has been rebalanced around a main-chart area plus aligned side columns

See [`CHANGELOG.md`](/Users/joshua/.config/superpowers/worktrees/asset-tracker/codex-phase1-foundation/Desktop/Qiushan_Studio/6_Personal/可视化记账/CHANGELOG.md) for the full change history.

## Feature Overview

### Assets and Transactions
- Multi-currency categories and transactions: `CNY`, `USD`, `SGD`, `MYR`
- Asset / liability / group categories with hierarchy and drag-and-drop sorting
- Transaction create, edit, delete, filtering, and sorting
- Purpose categories, fuzzy purpose search, and fuzzy note search

### Templates and Recurring Rules
- Reusable templates for quick entry
- Amountless templates that leave the final amount to the user
- Recurring rules that can be filled forward to today
- Support for monthly dates, end-of-month, and daily times

### Historical Assets and FX
- Accurate asset states can be anchored at specific timestamps
- Older transactions only affect the past and do not overwrite the current anchor
- FX rates are managed by effective date
- Historical comparison can be unblocked by entering missing dated FX rates inline

### Import/Export and Storage
- Local structured database powered by `IndexedDB`
- JSON snapshot import/export
- Automatic migration from legacy browser data
- Local-first architecture designed for future NAS / sync support

### Visual Analytics
- Dashboard overview, recent transactions, and memo
- Income / expense / net-income trend charts
- Forecast curve for recurring salary and deductions
- Category composition, pie composition, and recurring cashflow heat-zone
- Structural radar, category-tree snapshot, and historical asset comparison

## Repository Layout

```text
.
├── app/                # Main app (Vite + TypeScript + IndexedDB)
├── docs/               # Specs and implementation plans
├── legacy/             # Migration notes
├── 记账/              # Older static implementation
├── LICENSE             # MIT License
├── README.md           # Chinese README
└── README.en.md        # English README
```

## Run Locally

```bash
cd app
npm install
npm run dev -- --host 127.0.0.1 --strictPort
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Common Commands

```bash
cd app
npm test
npm run build
```

## Roadmap

- finish visual and interaction polish for the local single-user build
- add multi-user books and permissions
- add NAS-backed service and multi-device sync
- improve mobile responsiveness
- extend PWA/offline and backup behavior

## License

MIT License. See [LICENSE](./LICENSE).

**Author**: Qiushan  
**Last Updated**: 2026-04-14  
**Version**: v0.2.0
