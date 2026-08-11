# Asset Tracker

[![简体中文](https://img.shields.io/badge/语言-简体中文-1677ff)](./README.md)
[![English](https://img.shields.io/badge/Language-English-24292f)](./README.en.md)

Asset Tracker is a local-first personal asset ledger and visualization application with multi-currency balances, hierarchical categories, transaction history, recurring bookkeeping, import/export, and analytics.

The current formal release is **v3.1.0**. It adds durable native macOS saves, crash recovery, versioned snapshots, dual-domain recovery health, and strict bridge receipts. See the [changelog](./CHANGELOG.md) and [v3.1.0 release notes](./docs/releases/v3.1.0.md).

## Main capabilities

- Multi-currency asset and transaction management
- Hierarchical categories and drag-and-drop ordering
- Historical balance reconstruction and visual analytics
- Recurring bookkeeping rules and reusable transaction templates
- JSON/Excel import and export
- Durable macOS storage with exact receipts, recovery, and snapshots

## Repository layout

```text
.
├── index.html          # Current static front-end entry
├── styles.css          # Current front-end styles
├── script.js           # Current front-end logic
├── macos-app/          # Swift/AppKit/WKWebView shell and durable storage
├── app/                # TypeScript + IndexedDB evolution track
├── tests/              # Web and cross-layer acceptance tests
├── docs/               # Designs, plans, completion logs, release notes
└── script/             # Build, resource sync, and local-run scripts
```

## Build the unsigned macOS app

```bash
./script/build-macos-unofficial.sh
```

Outputs:

- `dist/AssetTracker.app`
- `dist/AssetTracker-unofficial.zip`

Run and perform a local startup check:

```bash
./script/build_and_run.sh --verify
```

The distributed app is intentionally unsigned and not notarized. macOS may require opening it from the context menu or removing the quarantine attribute.

## Run the static front end

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Run the TypeScript application

```bash
cd app
npm install
npm run dev -- --host 127.0.0.1 --strictPort
```

## Local data

The native primary book is stored at:

```text
~/Library/Application Support/com.qiushan.AssetTracker/AssetTrackerBook.json
```

No personal book data is bundled in the application or release archive.

## License

MIT License. See [LICENSE](./LICENSE).

**Author**: Qiushan

**Last updated**: 2026-08-11

**Version**: v3.1.0
