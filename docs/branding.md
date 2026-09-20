# Asset Tracker identity

The v3 identity uses two ledger leaves that suggest an **A**, with a small mint
balance marker on the application's violet tile. Broad shapes keep the mark
recognizable in a README header and at small application-icon sizes.

- Source: `assets/asset-tracker-logo-v3.png`, with an alpha channel.
- Native icon: `macos-app/Resources/AssetTracker-v3.icns`.
- Rebuild the native icon on macOS with `./script/build-icon.sh`.
- The image was generated with the built-in ImageGen tool, inspected, then
  copied into the project. `sips`/`iconutil` create the required packaging sizes;
  they do not redraw the design.

## Generation prompt

> Use case: logo-brand. Create one polished production app icon for Asset Tracker, a local-first personal and family ledger application. This is a new logo for a real macOS application and GitHub README, not a presentation mockup. A bold, distinctive, simple geometric ledger mark: two carefully balanced overlapping ledger leaves forming a subtle abstract A in negative space, with one small balanced circular accent suggesting a recorded amount. Broad ivory-white shapes on a deep violet rounded-square tile, using the existing product palette #5146b5 with a restrained lighter violet edge; only one subtle mint accent if it improves legibility. Frontal flat composition, precise optical balance, clean edges, generous consistent padding, minimal tonal depth. Designed to remain immediately readable at 32px and 16px. Single icon centered in a square 1024x1024 canvas. Genuine transparent background outside the rounded tile, keep its alpha. No text, letters, labels, numbers, currency signs, chart arrows, mockup device, watermark, photo texture, extra icons or surrounding decoration. Professional calm financial recordkeeping identity; avoid resemblance to an existing brand.

The generator returned a 1254×1254 PNG rather than the requested dimensions;
platform icon sizes are derived during packaging. This is an app identity,
not a claim of trademark registration.

## 中文

新版Logo使用两片账页构成抽象A形，配以代表已记录金额的薄荷色圆点，延续紫色主视觉。
源PNG保留透明通道；macOS图标由同一图像生成各档尺寸。生成工具为内置ImageGen，实际源图1254×1254；生成提示词及打包方式如上。
