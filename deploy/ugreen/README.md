<a id="english"></a>

# NAS deployment

[English](#english) · [简体中文](#中文) · [Main README](../../README.md)

Run Asset Tracker in its own Docker project and persistent SQLite volume.
Create a separate bookkeeping account, then invite the people who should have
access to each shared or family book.

## Pick a deployment mode

| Configuration | Purpose |
| --- | --- |
| `compose.yaml` | Build from source; bind to loopback, normally behind an existing HTTPS reverse proxy |
| `compose.prebuilt.yaml` | Use the imported `asset-tracker:3.3.0` image; same loopback default |
| `compose.nas-lan.yaml` | Explicit trusted-LAN opt-in, bound to the private IPv4 address in `NAS_IP` |

The LAN mode is **HTTP, not encrypted**. Only use it on a trusted network; do not
publish or port-forward it to the internet. Other remote connections continue
to require HTTPS. No domain, public tunnel or Tailscale configuration is created.

The prebuilt release image is **linux/amd64**, suitable for an x86-64 NAS such as
UGREEN DXP4800 Plus. For a different architecture, build the source on that platform and check the
result before creating your everyday book.

## Install on a UGREEN NAS

1. Download the NAS ZIP and, for an x86-64 device, the image archive from the same
   GitHub release. Verify their entries in `SHA256SUMS.txt`.
2. Extract the NAS ZIP into a new dedicated directory, for example a folder named
   `asset-tracker` under your Docker shared folder. Do not reuse another app's directory.
3. Copy `.env.example` to `.env`. Generate your own bootstrap token with
   `openssl rand -hex 32`, and put it in `ASSET_BOOTSTRAP_TOKEN`. Keep `.env`
   private. For LAN mode, set `NAS_IP` to this NAS's actual private IPv4 address;
   `NAS_PORT` defaults to `8789`. Do not enter a public IP or `0.0.0.0`.
4. For the prebuilt image, use **Docker → Images → Local images → Add image →
   Import from NAS** to import `AssetTracker-v3.3.0-nas-linux-amd64.tar.gz`.
5. In **Docker → Project → Create**, name the project `asset-tracker`, select
   the dedicated directory, and paste/import the chosen Compose file. Keep the
   adjacent `.env` file. For trusted-LAN access use `compose.nas-lan.yaml`.
6. Deploy without pulling a replacement for the imported image. The configured
   image uses `pull_policy: never`. Check both the container's running/healthy
   state and the actual page.
7. In the container's menu, create a desktop shortcut named **Family Ledger /
   家庭记账**, using the host port you configured. On the desktop client this may
   launch your system browser.
8. Open the shortcut. An empty service shows **First-time setup / 首次初始化**.
   Enter the bootstrap token from your own `.env`, choose a username and a
   password of at least 12 characters, and create the first account yourself.

Keep your NAS address and bootstrap token in your own `.env`. If the NAS cannot
reach Docker Hub, import the prebuilt image. Once the container is healthy, open
the shortcut and sign in to check the connection you will use each day.

[UGREEN's container guide](https://support.ugnas.com/detail/article/en-US/289)
describes desktop shortcuts and the conditions for UGREENlink remote access.
Check opening, signing in and saving on each phone or remote connection you plan to use.

## Command-line deployment

From the extracted NAS package directory:

```sh
cp .env.example .env
# Edit .env: unique bootstrap token and, for trusted LAN, your NAS_IP.
docker load -i /path/to/AssetTracker-v3.3.0-nas-linux-amd64.tar.gz
docker compose -p asset-tracker -f compose.nas-lan.yaml config --quiet
docker compose -p asset-tracker -f compose.nas-lan.yaml up -d
```

When working from a full Git checkout, the files are under `deploy/ugreen/`:

```sh
cd deploy/ugreen
cp .env.example .env
# Edit .env, then use the loopback/source-build configuration:
docker compose -p asset-tracker -f compose.yaml up -d --build
```

The packaged ZIP rewrites the source-build context to its own root. The Git
checkout configuration resolves the repository root via `../..`.

## Network, permissions and capacity

- Service port: `8789` in the container; loopback by default, or the explicit
  private `NAS_IP` in the LAN template. No automatic UPnP/router forwarding.
- Storage: `/data/book.sqlite`, on the dedicated `ledger-data` volume.
- Runtime: Node 24.11.0, non-root user, read-only root filesystem, dropped
  capabilities, no-new-privileges, 512 MB memory and one CPU limit.
- LAN opt-in: `ASSET_LAN_ORIGIN` must be an exact private IPv4 HTTP origin.
  The server reports it only to matching host requests; the browser must also
  be on that same origin. Users still sign in and receive the permissions assigned to their books.
- `ASSET_ALLOWED_ORIGINS` accepts exact additional origins, separated by commas.
  Same-origin NAS pages need no addition. `ASSET_ALLOW_DESKTOP=1` permits a
  bundled file-origin desktop client, still requiring authentication; it is
  disabled in the NAS-only LAN template.
- Change both the port binding and allowed origin if the NAS's IP changes. Do
  not solve an address mismatch by casually exposing all interfaces.

SQLite uses WAL and FULL synchronization. Do not let clients write the database
or a shared JSON file over SMB/WebDAV. The UI retains 12-hour session tokens in
memory, offers a single-use 24-hour invitation workflow, and uses server-side
membership checks, revisions and operation IDs.

The service keeps all ledger revisions and shows the latest 100 in the UI.
Monitor volume usage and keep separate backups. Node 24.11.0 prints an
experimental-feature warning when SQLite starts; check container health and the
application page for service readiness.

## Backup and restore

A JSON book export is portable, but does **not** include service accounts,
password hashes, invitations, memberships or revision history. Use a full
SQLite backup to preserve the service:

```sh
docker compose -p asset-tracker -f compose.nas-lan.yaml exec ledger \
  node server/backup.cjs /data/backups/backup-YYYYMMDD-HHMMSS.sqlite
```

Replace the timestamp with a new name for each backup. The script refuses to
overwrite an existing target, uses SQLite `VACUUM INTO`, and runs an integrity
check. It can operate while the service is running. Copy the verified result
to a separately approved backup destination: a second file on the same volume
cannot protect against loss of that volume.

To restore, stop **this project only**, preserve the current database/WAL/SHM
files together, and restore the verified backup into a **new empty volume**
with access for UID 1000. Point this project at the restored volume, then verify
users, memberships, books and revisions. Keep the original volume until the
restore has been checked. Do not copy only the live main SQLite file while
ignoring its WAL, and do not use `docker compose down -v` for routine updates.

## Update or roll back

Back up first. Keep the same project name and persistent-volume identity.
Import/build the intended image, update its tag in Compose, and redeploy just
this project. Retain the previous image archive and a verified database backup.
Do not relabel an old image as a new version or replace other NAS containers.
A version rollback also needs a compatible database schema; see that release's
notes before changing it.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Healthy container, shortcut cannot connect | Host port, actual NAS IP, selected Compose mode and local firewall; loopback mode is not reachable through a LAN-IP shortcut |
| HTTP is refused in the page | LAN opt-in must match the page's exact private IPv4 origin; otherwise use HTTPS |
| Image build times out | Import the matching prebuilt image; do not weaken unrelated network protections |
| First-time setup fails | Correct `.env` bootstrap token, unique username, 12+ character password, and whether setup was already completed |
| Another user's changes are reported | Refresh while retaining your draft, review the new revision, then submit |
| Response lost after a write | Use the pending-operation retry rather than creating the record again |

---

<a id="中文"></a>

## 中文

[English](#english) · [简体中文](#中文) · [返回主 README](../../README.md#中文)

将记账服务放在独立 Docker 项目和 SQLite 数据卷中，创建自己的记账服务账户，再邀请家人加入需要共同使用的账本。

### 三种配置

| 文件 | 用途 |
| --- | --- |
| `compose.yaml` | 源码构建，默认只监听回环地址，通常接已有 HTTPS 反向代理 |
| `compose.prebuilt.yaml` | 使用已导入的 `asset-tracker:3.3.0` 镜像，仍默认回环监听 |
| `compose.nas-lan.yaml` | 明确选择可信局域网，绑定 `NAS_IP` 指定的私有 IPv4 地址 |

局域网模式使用 **HTTP，传输不加密**，只能在可信内网使用，不能直接映射到公网。程序不会自动创建域名、公网隧道或 Tailscale。

发布镜像为 **linux/amd64**，适用于绿联 DXP4800 Plus 等 x86-64 NAS；其他架构需要自行构建，不在此二进制包的验证范围内。

### 绿联 NAS 安装步骤

1. 下载同一版本的 NAS ZIP、镜像归档和校验文件，先核对 SHA-256。
2. 把 ZIP 解压到新的专用目录，例如 Docker 共享目录下的 `asset-tracker`，不要复用其他应用目录。
3. 将 `.env.example` 复制为 `.env`。用 `openssl rand -hex 32` 生成自己的随机口令，填入 `ASSET_BOOTSTRAP_TOKEN`，保密保存。内网模式再填写实际私有地址 `NAS_IP`，`NAS_PORT` 默认8789；不能填写公网IP或 `0.0.0.0`。
4. 在“Docker → 镜像 → 本地镜像 → 添加镜像 → 从NAS导入”中导入 `AssetTracker-v3.3.0-nas-linux-amd64.tar.gz`。
5. “Docker → 项目 → 创建”，项目名设为 `asset-tracker`，选择专用目录，导入所选 Compose。使用可信局域网时选 `compose.nas-lan.yaml`，`.env` 放在相邻位置。
6. 使用已导入镜像部署，不勾选拉取替代镜像。既要看容器 running/healthy，也要实际打开页面。
7. 在容器菜单创建“**家庭记账**”桌面快捷方式，端口填所配置的主机端口。PC客户端可能会调用系统浏览器打开。
8. 空服务会显示“首次初始化”。输入你自己的 `.env` 中的初始化口令，设置用户名和至少12位密码，创建首个记账服务账户。

把自己的 NAS 地址和初始化口令保存在 `.env` 中。NAS 下载 Docker Hub 失败时可导入预构建镜像。容器启动后，实际打开快捷方式并登录；每台手机或远程连接也沿自己的访问路径检查一次。绿联官方的[容器说明](https://support.ugnas.com/detail/article/en-US/289)介绍了快捷方式与 UGREENlink 的使用条件。

### 命令行方式

在解压后的NAS包目录运行：

```sh
cp .env.example .env
# 编辑 .env，填写自己的初始化口令及内网NAS_IP。
docker load -i /path/to/AssetTracker-v3.3.0-nas-linux-amd64.tar.gz
docker compose -p asset-tracker -f compose.nas-lan.yaml config --quiet
docker compose -p asset-tracker -f compose.nas-lan.yaml up -d
```

完整Git仓库中的配置位于 `deploy/ugreen/`。源码构建使用该目录的 `compose.yaml`；分发ZIP中的构建上下文已改为ZIP自身根目录。

### 数据、安全与维护

- 数据库在独立卷的 `/data/book.sqlite`，不要通过SMB/WebDAV让客户端直接写它。
- 服务为非root运行、只读根文件系统、移除能力权限，限制512MB内存和1核CPU。
- 只有显式 `ASSET_LAN_ORIGIN`、请求Host和页面来源匹配时，NAS页面才允许私有IPv4的HTTP；用户鉴权仍由服务端检查。
- 额外跨域来源通过 `ASSET_ALLOWED_ORIGINS` 精确列出。NAS同源页面无需添加。`ASSET_ALLOW_DESKTOP=1` 会允许file-origin客户端，但仍需登录；NAS专用局域网模板关闭此项。
- NAS地址改变时，同时核对端口绑定和允许来源，不要直接改成全接口监听。
- 登录令牌在页面内存中，有效期12小时；邀请24小时有效且单次使用。版本冲突和结果未知的写入由版本号与操作编号保护。
- 服务保留全部账本版本，页面只显示最近100个并不意味着只保留100个；需要关注容量。
- Node 24.11.0 启动 SQLite 时会输出 experimental 提示；通过容器健康状态和实际应用页面检查服务是否就绪。

### 备份与恢复

账本JSON不包含服务账户、密码哈希、邀请、成员权限或版本历史。完整备份使用：

```sh
docker compose -p asset-tracker -f compose.nas-lan.yaml exec ledger \
  node server/backup.cjs /data/backups/backup-YYYYMMDD-HHMMSS.sqlite
```

每次换用新的时间戳文件名。程序拒绝覆盖目标，用 SQLite `VACUUM INTO` 创建运行时一致备份并检查完整性。再将核验后的备份复制到独立保存位置；同卷副本不能抵御数据卷丢失。

恢复时只停止本项目，保留当前数据库及WAL/SHM完整副本，把已核验的备份放到新的空卷，保证UID1000可读写，再将本项目指向该卷。核对账户、权限、账本和版本后再正式使用，保留原卷。不要只复制正在运行的主SQLite文件，也不要用 `docker compose down -v` 更新。

### 更新与排错

先备份，保持项目名和数据卷不变，导入新镜像、修改版本号后只重新部署本项目。保留旧镜像归档；降级前核对数据库兼容性。

“容器健康但入口打不开”时检查端口、NAS地址、配置模式和本地防火墙：回环监听不能通过LAN-IP快捷方式访问。HTTP被拒绝时检查显式内网来源是否匹配。初始化失败时核对口令、用户名、密码长度及是否已初始化。遇到版本冲突先刷新核对；保存响应丢失则重试原操作，不要另建一笔。
