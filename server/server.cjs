"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const Safety = require("../legacy-safety.js"),
  Import = require("../ledger-import.js");
const digest = (s) => createHash("sha256").update(s).digest("hex");
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const str = (v, max = 120) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(400, "文本为空或过长");
  return v.trim();
};
function emptyBook() {
  return {
    categories: {
      cash: {
        id: "cash",
        name: "现金",
        balance: 0,
        currency: "CNY",
        isDebt: false,
      },
    },
    transactions: [],
    expenseProjects: [],
    automationRules: [],
    purposeCategories: [],
    initialAssets: [],
    transactionTemplates: [],
    memo: "",
    settings: { baseCurrency: "CNY", exchangeRates: { CNY: 1 } },
  };
}
function validateBook(book) {
  if (!book || typeof book !== "object" || Array.isArray(book))
    fail(400, "账本格式无效");
  const text = JSON.stringify(book);
  if (text.length > 8 * 1024 * 1024) fail(413, "账本超过 8 MB");
  if (Safety.validateBookText(text).status !== "valid")
    fail(400, "账本校验失败");
  if (book.transactions.length > 50000)
    fail(400, "单账本最多 50,000 笔，请按年度拆分");
  const ids = new Set(),
    transfers = new Map(),
    accounts = new Map(Import.accounts(book).map((a) => [a.node.id, a.node]));
  for (const t of book.transactions) {
    if (ids.has(t.id) || t.id.length > 160 || Math.abs(t.amount) > 1e12)
      fail(400, "记录 ID 重复或金额超限");
    ids.add(t.id);
    if (!/^[A-Z]{3}$/.test(t.currency || book.settings.baseCurrency))
      fail(400, "币种必须是三位大写代码");
    if (t.accountId && !accounts.has(t.accountId))
      fail(400, "记录引用了不存在的账户");
    if (t.transferId) {
      str(t.transferId, 160);
      if (!t.accountId) fail(400, "转账必须指定账户");
      const group = transfers.get(t.transferId) || [];
      group.push(t);
      transfers.set(t.transferId, group);
    }
  }
  if (
    ![book.settings.baseCurrency, ...accounts.values()].every((v) =>
      /^[A-Z]{3}$/.test(
        typeof v === "string" ? v : v.currency || book.settings.baseCurrency,
      ),
    )
  )
    fail(400, "账户币种无效");
  for (const pair of transfers.values())
    if (
      pair.length !== 2 ||
      pair[0].amount !== -pair[1].amount ||
      !pair[0].amount ||
      pair[0].currency !== pair[1].currency ||
      pair[0].accountId === pair[1].accountId ||
      pair[0].date !== pair[1].date ||
      pair.some((t) => accounts.get(t.accountId).currency !== t.currency)
    )
      fail(400, "内部转账必须是同日同币种不同账户的两笔等额反向记录");
  return text;
}
function summary(book) {
  const result = Object.create(null);
  for (const t of book.transactions) {
    if (t.transferId) continue;
    const c = t.currency || book.settings.baseCurrency;
    const out = (result[c] ??= { income: 0, expense: 0, count: 0 });
    if (t.amount >= 0) out.income += t.amount;
    else out.expense -= t.amount;
    out.count++;
  }
  for (const v of Object.values(result)) {
    v.income = Math.round(v.income * 100) / 100;
    v.expense = Math.round(v.expense * 100) / 100;
  }
  return result;
}
const Connection = require("../nas-connection.js");
function createServer({
  dbPath = process.env.ASSET_DB || path.join(__dirname, "data/book.sqlite"),
  bootstrapToken = process.env.ASSET_BOOTSTRAP_TOKEN || "",
  allowedOrigins = (process.env.ASSET_ALLOWED_ORIGINS || "")
    .split(",")
    .filter(Boolean),
  allowDesktop = process.env.ASSET_ALLOW_DESKTOP === "1",
  lanOrigin = process.env.ASSET_LAN_ORIGIN || "",
} = {}) {
  const configuredLANOrigin = lanOrigin
    ? Connection.lanOrigin(lanOrigin)
    : null;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;",
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS ledgers(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,owner TEXT REFERENCES users(id),revision INTEGER NOT NULL,book TEXT NOT NULL);CREATE TABLE IF NOT EXISTS members(ledger_id TEXT REFERENCES ledgers(id),user_id TEXT REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(ledger_id,user_id));CREATE TABLE IF NOT EXISTS versions(ledger_id TEXT REFERENCES ledgers(id),revision INTEGER,user_id TEXT REFERENCES users(id),book TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(ledger_id,revision));CREATE TABLE IF NOT EXISTS operations(ledger_id TEXT,operation_id TEXT,user_id TEXT,request_hash TEXT,result TEXT,PRIMARY KEY(ledger_id,operation_id));CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,ledger_id TEXT REFERENCES ledgers(id),role TEXT,expires INTEGER,used INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ledger_id TEXT,actor TEXT,action TEXT,created INTEGER);`,
  );
  const q = (sql, ...args) => db.prepare(sql).get(...args),
    all = (sql, ...args) => db.prepare(sql).all(...args),
    run = (sql, ...args) => db.prepare(sql).run(...args);
  const atomic = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      db.exec("COMMIT");
      return v;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const audit = (id, user, action) =>
    run(
      "INSERT INTO audit(ledger_id,actor,action,created) VALUES(?,?,?,?)",
      id,
      user,
      action,
      Date.now(),
    );
  const session = (user) => {
    const token = randomBytes(32).toString("base64url");
    run("DELETE FROM sessions WHERE expires<?", Date.now());
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      digest(token),
      user,
      Date.now() + 12 * 3600000,
    );
    return token;
  };
  const username = (v) => {
    v = str(v, 64).toLowerCase();
    if (!/^[a-z0-9_.-]{3,64}$/.test(v))
      fail(400, "用户名需为 3–64 位字母、数字、点、横线或下划线");
    return v;
  };
  let hashing = 0;
  async function passwordHash(
    password,
    salt = randomBytes(16).toString("hex"),
  ) {
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 256
    )
      fail(400, "密码需为 12–256 字符");
    if (hashing >= 4) fail(429, "登录繁忙，请稍后重试");
    hashing++;
    try {
      return salt + ":" + (await derive(password, salt, 64)).toString("hex");
    } finally {
      hashing--;
    }
  }
  const authorized = (user, id, roles) => {
    const row = q(
      "SELECT l.*,m.role FROM ledgers l JOIN members m ON m.ledger_id=l.id WHERE l.id=? AND m.user_id=?",
      id,
      user,
    );
    if (!row) fail(404, "账本不存在或无访问权限");
    if (roles && !roles.includes(row.role)) fail(403, "当前角色没有该操作权限");
    return row;
  };
  const invite = (code) => {
    const row = q("SELECT * FROM invites WHERE hash=?", digest(str(code, 160)));
    if (!row || row.used || row.expires < Date.now())
      fail(400, "邀请无效、过期或已使用");
    return row;
  };
  const accept = (code, user) => {
    const i = invite(code),
      l = q("SELECT * FROM ledgers WHERE id=?", i.ledger_id);
    if (l.kind === "personal") fail(403, "个人账本不能共享");
    if (q("SELECT 1 FROM members WHERE ledger_id=? AND user_id=?", l.id, user))
      fail(409, "你已经是该账本成员");
    run("INSERT INTO members VALUES(?,?,?)", l.id, user, i.role);
    run("UPDATE invites SET used=1 WHERE hash=?", i.hash);
    audit(l.id, user, "invite.accept");
    return l.id;
  };
  const mutate = (row, user, body, book) => {
    str(body.operationId, 160);
    if (body.operationId.length < 16 || !Number.isSafeInteger(body.revision))
      fail(400, "请求缺少有效版本和操作标识");
    const requestHash = digest(JSON.stringify(body));
    return atomic(() => {
      const existing = q(
        "SELECT * FROM operations WHERE ledger_id=? AND operation_id=?",
        row.id,
        body.operationId,
      );
      if (existing) {
        if (existing.user_id !== user || existing.request_hash !== requestHash)
          fail(409, "操作标识已被不同请求使用");
        return JSON.parse(existing.result);
      }
      const current = authorized(user, row.id, ["owner", "editor"]);
      if (body.revision !== current.revision)
        fail(409, "账本已有新版本。输入已保留，请重新读取后核对再提交");
      const bookText = validateBook(book),
        revision = current.revision + 1;
      run(
        "UPDATE ledgers SET book=?,revision=? WHERE id=?",
        bookText,
        revision,
        row.id,
      );
      run(
        "INSERT INTO versions VALUES(?,?,?,?,?)",
        row.id,
        revision,
        user,
        bookText,
        Date.now(),
      );
      const result = { id: row.id, revision };
      run(
        "INSERT INTO operations VALUES(?,?,?,?,?)",
        row.id,
        body.operationId,
        user,
        requestHash,
        JSON.stringify(result),
      );
      audit(row.id, user, body.targetRevision ? "restore" : "save");
      return result;
    });
  };
  // Cache only derived totals and use the committed revision as the invalidation key.
  // List requests do not pull every full ledger blob out of SQLite.
  const summaryCache = new Map();
  function cachedSummary(row) {
    const cached = summaryCache.get(row.id);
    if (cached?.revision === row.revision) return cached.value;
    const value = summary(
      JSON.parse(q("SELECT book FROM ledgers WHERE id=?", row.id).book),
    );
    if (summaryCache.size >= 200)
      summaryCache.delete(summaryCache.keys().next().value);
    summaryCache.set(row.id, { revision: row.revision, value });
    return value;
  }
  const limits = new Map();
  function throttle(key, max, windowMs) {
    const now = Date.now();
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    if (limits.size > 10000) fail(503, "服务繁忙");
    const item = limits.get(key) || { count: 0, until: now + windowMs };
    if (++item.count > max) fail(429, "请求过于频繁，请稍后再试");
    limits.set(key, item);
  }
  const root = path.resolve(__dirname, ".."),
    assets = new Set(
      fs
        .readFileSync(path.join(root, "script/web-assets.manifest"), "utf8")
        .trim()
        .split(/\r?\n/),
    );
  assets.add("nas.html");
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    const send = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
    };
    try {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {}
      if (
        origin &&
        !sameOrigin &&
        !allowedOrigins.includes(origin) &&
        !(origin === "null" && allowDesktop)
      )
        fail(403, "来源未获允许");
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization,Content-Type",
        );
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,DELETE,OPTIONS",
        );
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url, "http://localhost"),
        route = url.pathname;
      if (!route.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD")
          fail(405, "不支持此方法");
        const file = decodeURIComponent(
          route === "/" ? "/nas.html" : route,
        ).slice(1);
        if (!assets.has(file) || !fs.existsSync(path.join(root, file)))
          fail(404, "文件不存在");
        const ext = path.extname(file),
          type =
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".png": "image/png",
            }[ext] || "application/octet-stream";
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
        res.writeHead(200, { "Content-Type": type });
        if (req.method === "HEAD") res.end();
        else res.end(fs.readFileSync(path.join(root, file)));
        return;
      }
      throttle("api:" + req.socket.remoteAddress, 240, 60000);
      let body = {};
      if (["POST", "PUT"].includes(req.method)) {
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          fail(415, "请求必须为 JSON");
        let size = 0,
          chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 12 * 1024 * 1024) fail(413, "请求超过 12 MB");
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          fail(400, "无效 JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail(400, "无效请求");
      }
      if (route === "/api/health" && req.method === "GET")
        return send(200, { ok: q("SELECT 1 ok").ok === 1 });
      if (route === "/api/status" && req.method === "GET")
        return send(200, {
          initialized: !!q("SELECT 1 FROM users LIMIT 1"),
          lanOrigin:
            configuredLANOrigin &&
            req.headers.host === new URL(configuredLANOrigin).host
              ? configuredLANOrigin
              : null,
        });
      if (
        ["setup", "login", "join"].some((x) => route === "/api/" + x) &&
        req.method === "POST"
      ) {
        throttle("auth:" + req.socket.remoteAddress, 15, 15 * 60000);
        if (route === "/api/setup") {
          if (q("SELECT 1 FROM users LIMIT 1")) fail(409, "服务已初始化");
          if (
            bootstrapToken.length < 32 ||
            typeof body.bootstrapToken !== "string" ||
            digest(body.bootstrapToken) !== digest(bootstrapToken)
          )
            fail(403, "初始化口令无效");
          const name = username(body.username),
            hash = await passwordHash(body.password);
          const id = randomUUID();
          atomic(() => {
            if (q("SELECT 1 FROM users LIMIT 1")) fail(409, "服务已初始化");
            run("INSERT INTO users VALUES(?,?,?)", id, name, hash);
          });
          return send(201, { token: session(id) });
        }
        if (route === "/api/login") {
          const name = username(body.username);
          const u = q("SELECT * FROM users WHERE username=?", name);
          const expected =
            u?.password ||
            "00000000000000000000000000000000:" + "0".repeat(128);
          let hash;
          try {
            hash = await passwordHash(body.password, expected.split(":")[0]);
          } catch (e) {
            if (e.status === 429) throw e;
            fail(401, "用户名或密码错误");
          }
          if (!u || !timingSafeEqual(Buffer.from(hash), Buffer.from(expected)))
            fail(401, "用户名或密码错误");
          return send(200, { token: session(u.id) });
        }
        invite(body.code);
        const name = username(body.username);
        if (q("SELECT 1 FROM users WHERE username=?", name))
          fail(409, "用户名已存在，请登录后接受邀请");
        const hash = await passwordHash(body.password),
          id = randomUUID();
        atomic(() => {
          invite(body.code);
          if (q("SELECT 1 FROM users WHERE username=?", name))
            fail(409, "用户名已存在");
          run("INSERT INTO users VALUES(?,?,?)", id, name, hash);
          accept(body.code, id);
        });
        return send(201, { token: session(id) });
      }
      const token = String(req.headers.authorization || "").replace(
        /^Bearer /,
        "",
      );
      const auth = q(
        "SELECT user_id FROM sessions WHERE hash=? AND expires>?",
        digest(token),
        Date.now(),
      );
      if (!auth) fail(401, "请登录，或会话已过期");
      const user = auth.user_id;
      if (route === "/api/me" && req.method === "GET")
        return send(200, q("SELECT id,username FROM users WHERE id=?", user));
      if (route === "/api/logout" && req.method === "POST") {
        run("DELETE FROM sessions WHERE hash=?", digest(token));
        return send(200, { ok: true });
      }
      if (route === "/api/invites/accept" && req.method === "POST")
        return send(200, { id: atomic(() => accept(body.code, user)) });
      if (route === "/api/ledgers") {
        if (req.method === "GET") {
          const ledgers = all(
            "SELECT l.id,l.name,l.kind,l.owner,l.revision,m.role FROM ledgers l JOIN members m ON l.id=m.ledger_id WHERE m.user_id=? ORDER BY l.name,l.id",
            user,
          ).map((l) => ({
            ...l,
            summary: cachedSummary(l),
          }));
          return send(200, { ledgers });
        }
        if (req.method === "POST") {
          const name = str(body.name);
          if (!["personal", "shared", "family"].includes(body.kind))
            fail(400, "账本类型无效");
          const op = body.operationId;
          if (
            op !== undefined &&
            (typeof op !== "string" || op.length < 16 || op.length > 160)
          )
            fail(400, "操作标识无效");
          const requestHash = digest(JSON.stringify(body));
          const result = atomic(() => {
            if (op) {
              const prior = q(
                "SELECT * FROM operations WHERE ledger_id=? AND operation_id=?",
                "create:" + user,
                op,
              );
              if (prior) {
                if (prior.request_hash !== requestHash)
                  fail(409, "操作标识已被不同请求使用");
                return JSON.parse(prior.result);
              }
            }
            if (
              q("SELECT count(*) n FROM ledgers WHERE owner=?", user).n >= 100
            )
              fail(400, "最多创建 100 个账本");
            const id = randomUUID(),
              book = validateBook(body.book || emptyBook());
            run(
              "INSERT INTO ledgers VALUES(?,?,?,?,?,?)",
              id,
              name,
              body.kind,
              user,
              1,
              book,
            );
            run("INSERT INTO members VALUES(?,?,?)", id, user, "owner");
            run(
              "INSERT INTO versions VALUES(?,?,?,?,?)",
              id,
              1,
              user,
              book,
              Date.now(),
            );
            audit(id, user, "create");
            const result = { id, revision: 1 };
            if (op)
              run(
                "INSERT INTO operations VALUES(?,?,?,?,?)",
                "create:" + user,
                op,
                user,
                requestHash,
                JSON.stringify(result),
              );
            return result;
          });
          return send(201, result);
        }
      }
      const m = route.match(
        /^\/api\/ledgers\/([a-zA-Z0-9-]+)(?:\/(invites|members|versions|restore)(?:\/([a-zA-Z0-9-]+))?)?$/,
      );
      if (!m) fail(404, "接口不存在");
      const [, id, action, memberId] = m,
        row = authorized(user, id);
      if (!action && req.method === "GET")
        return send(200, {
          id,
          name: row.name,
          kind: row.kind,
          role: row.role,
          revision: row.revision,
          book: JSON.parse(row.book),
        });
      if (!action && req.method === "PUT") {
        authorized(user, id, ["owner", "editor"]);
        return send(200, mutate(row, user, body, body.book));
      }
      if (action === "versions" && req.method === "GET")
        return send(200, {
          versions: all(
            "SELECT v.revision,v.created,u.username FROM versions v JOIN users u ON v.user_id=u.id WHERE ledger_id=? ORDER BY revision DESC LIMIT 100",
            id,
          ),
        });
      if (action === "restore" && req.method === "POST") {
        authorized(user, id, ["owner", "editor"]);
        if (!Number.isSafeInteger(body.targetRevision)) fail(400, "版本无效");
        const v = q(
          "SELECT book FROM versions WHERE ledger_id=? AND revision=?",
          id,
          body.targetRevision,
        );
        if (!v) fail(404, "版本不存在");
        return send(200, mutate(row, user, body, JSON.parse(v.book)));
      }
      if (action === "members" && req.method === "GET")
        return send(200, {
          members: all(
            "SELECT u.id,u.username,m.role FROM members m JOIN users u ON m.user_id=u.id WHERE ledger_id=?",
            id,
          ),
        });
      if (action === "members" && req.method === "DELETE" && memberId) {
        authorized(user, id, ["owner"]);
        if (memberId === row.owner) fail(400, "不能移除拥有者");
        atomic(() => {
          run(
            "DELETE FROM members WHERE ledger_id=? AND user_id=?",
            id,
            memberId,
          );
          audit(id, user, "member.remove");
        });
        return send(200, { ok: true });
      }
      if (action === "invites" && req.method === "POST") {
        authorized(user, id, ["owner"]);
        if (row.kind === "personal") fail(403, "个人账本不能共享");
        if (!["viewer", "editor"].includes(body.role))
          fail(400, "邀请角色无效");
        const code = randomBytes(24).toString("base64url");
        run(
          "INSERT INTO invites(hash,ledger_id,role,expires) VALUES(?,?,?,?)",
          digest(code),
          id,
          body.role,
          Date.now() + 86400000,
        );
        audit(id, user, "invite.create");
        return send(201, { code, expiresInHours: 24 });
      }
      fail(405, "不支持此操作");
    } catch (e) {
      if (!res.headersSent)
        send(e.status || 500, {
          error: e.status ? e.message : "服务暂时不可用，请重试",
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return { server, db, validateBook, summary };
}
if (require.main === module) {
  const app = createServer();
  const port = Number(process.env.PORT || 8789);
  app.server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log("Asset Tracker NAS service listening on " + port),
  );
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, () =>
      app.server.close(() => {
        app.db.close();
        process.exit(0);
      }),
    );
}
module.exports = { createServer, validateBook, summary, emptyBook };
