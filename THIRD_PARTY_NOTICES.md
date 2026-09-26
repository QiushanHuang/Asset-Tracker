# Third-party notices

Asset Tracker's own source is available under the MIT license in [LICENSE](LICENSE).
Third-party libraries retain their own licenses and copyright notices.

| Component | Version | License | Bundled use |
| --- | --- | --- | --- |
| [Chart.js](https://github.com/chartjs/Chart.js) | 4.5.1 | [MIT](vendor/CHARTJS-LICENSE.txt) | Local asset and analysis charts |
| [SheetJS Community Edition](https://docs.sheetjs.com/) | 0.20.3 | [Apache-2.0](vendor/SHEETJS-LICENSE.txt) | Local Excel/CSV parsing and spreadsheet export |
| [PDF.js](https://github.com/mozilla/pdf.js) | 6.3.289 | [Apache-2.0](vendor/pdfjs/LICENSE) | Local PDF text extraction; desktop classic bundles generated with esbuild |
| [Tabler Icons](https://github.com/tabler/tabler-icons) | 3.31.0 | [MIT](assets/icons/LICENSE) | Bundled workspace navigation and action icons |
| [Node.js](https://nodejs.org/) | 24.11.0 in the Dockerfile | Node.js distribution licenses | NAS server runtime; distributed by the upstream base image |

SheetJS was retrieved from the official versioned distribution:
`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`.
Chart.js remains the bundled 4.5.1 distribution. Release archives retain the
library notices; the prebuilt NAS image retains upstream Node/Debian notices.

The `app/` development track uses packages listed in its `package.json` and
lockfile, including Dexie, Zod, TypeScript, Vite, Vitest and JSDOM. Their package
license files remain authoritative. These are not all loaded by the shipped
root web interface or the NAS service.

## 中文

本项目自身代码使用MIT许可，第三方库保留各自版权及许可。Chart.js 4.5.1用于图表，SheetJS CE 0.20.3用于表格导入导出。
工作区图标使用MIT许可的Tabler Icons 3.31.0。NAS镜像使用官方Node.js基础镜像并保留上游发行许可。`app/`演进实现的依赖以其包清单、锁文件和各包许可为准。
