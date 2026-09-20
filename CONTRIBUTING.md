# Contributing

Start with [README](README.md), the [user guide](docs/user-guide.md), and the
[security notes](SECURITY.md). Use synthetic books for reproduction. Never attach
a real ledger, NAS address, authentication token or database to a public issue.

The shared local UI is at the repository root. `macos-app/Resources/Web` is a
staged copy maintained by `script/sync_web_assets.sh`; edit the root sources,
then sync. The optional NAS service is in `server/`, with its client in `nas-*`.
The TypeScript/IndexedDB work in `app/` is a separate development track.

## Checks

```sh
npm ci --prefix app
./script/sync_web_assets.sh
ASSET_TRACKER_VERIFY_STAGED=1 node --test tests/*.test.js
node --test tests/nas/*.test.cjs
npm --prefix app test
npm --prefix app run build
python3 script/check-release-docs.py
```

On macOS, also run:

```sh
swift build --package-path macos-app --product AssetTrackerFaultHarness
ASSET_TRACKER_FAULT_HARNESS="$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness" \
  swift test --package-path macos-app
ASSET_TRACKER_CONFIGURATION=release ./script/build_and_run.sh --stage-only
```

State which behavior changed and how it was checked. Keep original-currency
precision until the final display conversion, preserve stable identifiers,
exercise real parser/adapter boundaries, and cover save failures as well as the
happy path. Do not treat a successful process exit as proof of durable storage
or correct financial totals.

Keep the English and Chinese sections of README in sync. Language badges must
stay within that README, with Chinese below English. New screenshots must use
fictional examples and exclude browser chrome or machine details.

## 中文

请使用虚构账本复现问题，不要在公开Issue中上传真实账目、NAS地址、密码、令牌或数据库。
根目录是当前本地界面源码；修改后用同步脚本更新macOS资源，不要只改打包副本。
NAS服务与前端分别位于`server/`和`nas-*`，`app/`是单独的演进开发分支实现。

修改需说明用户可见行为与验证结果；涉及保存、导入、金额和权限时覆盖失败路径。
README中英文保持一致，语言徽标使用同文件锚点；公开截图只能使用虚构演示数据。
