PDF.js 6.3.289 from the official npm `pdfjs-dist` archive, legacy/build.
License: Apache-2.0 (LICENSE). PDF source files remain on the client.

`pdf.mjs` and `pdf.worker.mjs` are unchanged upstream files.
The classic bundles are generated for WKWebView file URLs using esbuild:

```
esbuild pdf.mjs --bundle --format=iife --global-name=AssetPDF --platform=browser --minify --outfile=pdf.classic.js
esbuild pdf.worker.mjs --bundle --format=iife --global-name=pdfjsWorker --platform=browser --minify --outfile=pdf.worker.classic.js
```

Desktop loads both classic scripts on demand and uses PDF.js's main-thread
worker handler. HTTP pages keep the module worker. No CORS/WebView security
settings are relaxed. Only text extraction is used; rendering font/wasm assets
are not included. Unknown layouts and failed statement totals are rejected.
