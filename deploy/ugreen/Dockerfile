FROM node:24.11.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node script/web-assets.manifest ./script/web-assets.manifest
COPY --chown=node:node nas.html nas.css nas-connection.js nas-model.js nas-ui.js ledger-import.js payment-file.js wechat-import.js alipay-import.js wechat-import-ui.js bank-import.js import-audit-ui.js legacy-safety.js expense-projects.js styles.css ./
COPY --chown=node:node vendor/xlsx.full.min.js ./vendor/xlsx.full.min.js
COPY --chown=node:node vendor/pdfjs ./vendor/pdfjs
COPY --chown=node:node assets/asset-tracker-logo-v3.png ./assets/asset-tracker-logo-v3.png
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8789 ASSET_DB=/data/book.sqlite
EXPOSE 8789
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8789/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/server.cjs"]
