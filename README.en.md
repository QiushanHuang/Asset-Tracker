# Asset Tracker

[![简体中文](https://img.shields.io/badge/语言-简体中文-1677ff)](./README.md)
[![English](https://img.shields.io/badge/Language-English-24292f)](./README.en.md)

This repository maintains a local-first asset tracking and ledger system with multi-currency balances, historical asset states, recurring bookkeeping, import/export, and analytics dashboards.

The current main application lives in `app/` and uses `Vite + TypeScript + IndexedDB`. The root static page and the `记账/` directory are preserved as legacy implementations and migration references.

## Core Features

### Asset Management
- Multi-currency support for CNY, SGD, USD, and MYR
- Time-based exchange rates with manual configuration
- Deep hierarchical categories with drag-and-drop sorting
- Separate handling for assets and liabilities

### Ledger and Automation
- Transaction create, edit, delete, and filtering
- Recurring bookkeeping rules with monthly days and end-of-month support
- Historical asset state anchors with backward reconstruction
- Template-based quick entry

### Analytics and Visualization
- Asset trend charts and composition charts
- Historical comparison with dated FX support
- Dashboard summaries and recent transactions
- Forecast-style curves for recurring salary and expenses

### Data and Storage
- IndexedDB as the local structured database
- JSON snapshot import/export
- Legacy browser-state migration support
- Local-first architecture prepared for future sync

## Repository Structure

```text
.
├── app/                # Current main app (Vite + TypeScript + IndexedDB)
├── docs/               # Specs and implementation plans
├── legacy/             # Legacy migration notes
├── 记账/              # Older static implementation
├── LICENSE             # MIT license
├── index.html          # Root legacy page entry
├── styles.css          # Root legacy styles
├── script.js           # Root legacy logic
├── README.md           # Chinese README
└── README.en.md        # English README
```

## Run the Current App

```bash
cd app
npm install
npm run dev -- --host 127.0.0.1 --strictPort
```

Then open `http://127.0.0.1:5173`.

## Run the Legacy Static Page

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Roadmap

- Improve the recurring rule engine
- Add predictive analytics
- Add multi-device sync
- Improve mobile responsiveness
- Add PWA offline support
- Add encrypted local storage

## License

MIT License. See the [LICENSE](./LICENSE) file.

**Author**: Qiushan  
**Last Updated**: 2026-04-14  
**Version**: v3.0
