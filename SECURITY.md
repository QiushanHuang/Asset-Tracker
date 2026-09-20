# Security and data boundaries

Asset Tracker is a personal-recordkeeping tool, not an audited banking system.
The macOS build is unsigned and not notarized. The NAS module is an early
collaboration release and does not provide a public-hosting hardening guarantee.

- Local books are not automatically uploaded. Browser books belong to their
  origin/profile; native books are stored outside the application bundle.
- NAS membership is enforced by the service. Viewer access includes export.
  Removing a member revokes future service access, not copies already exported.
- NAS passwords use salted scrypt; the service stores hashes of session tokens.
  Tokens are held in page memory, and sessions expire after 12 hours.
- HTTPS is required for ordinary remote connections. The optional trusted-LAN
  configuration permits explicitly configured, same-origin private-IPv4 HTTP.
  That traffic is unencrypted. Do not expose it publicly.
- CORS and the NAS launcher are not identity checks. Keep the bootstrap token,
  `.env`, database, snapshots and full-service backups private.
- Do not enable public registration, forward the service's plain HTTP port, or
  mount the Docker socket just to make deployment easier.
- Backups contain sensitive records; full-service backups also contain account
  and membership information. Store and protect them accordingly.

The bundled SheetJS parser is 0.20.3, updated from 0.18.5. Upstream documents
fixes for [CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533)
and [CVE-2024-22363](https://cdn.sheetjs.com/advisories/CVE-2024-22363).
A pinned dependency and passing tests do not establish that all vulnerabilities
have been eliminated. See [third-party notices](THIRD_PARTY_NOTICES.md).

If you discover a vulnerability, use GitHub's private reporting option when
available. Otherwise open a minimal issue requesting private contact without
including exploit details, credentials or user data. Public issue examples
should contain only synthetic records.

## 中文

这是个人记账工具，不是经过金融安全审计的银行系统。macOS包未签名、未公证，NAS协作仍属早期版本。

默认不上传本地账本；NAS由服务端执行成员权限，只读也可导出。密码使用带盐scrypt，令牌只保存在页面内存中，会话12小时过期。
普通远程连接要求HTTPS；明确启用的可信内网HTTP不加密，不能公开转发。CORS或NAS快捷方式不能代替登录鉴权。

初始化口令、`.env`、数据库及备份须保密。不要为了方便部署而挂载Docker socket、公开注册或暴露明文端口。
依赖版本和测试通过不代表不存在漏洞。报告安全问题时不要把真实账目、口令或可利用细节直接发布到公开Issue。
