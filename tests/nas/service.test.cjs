const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = fs.existsSync(path.join(__dirname, "../../server/server.cjs"))
  ? require("../../server/server.cjs")
  : {};
const wireFetch = require("./http-client.cjs");
const secret = "test-bootstrap-token-".repeat(3),
  password = "A long testing password 123!";
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-nas-test-"));
  const app = S.createServer({
    dbPath: path.join(dir, "test.sqlite"),
    bootstrapToken: secret,
    ...options,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const call = async (route, method = "GET", data, token) => {
    const res = await fetch(base + "/api/" + route, {
      method,
      headers: {
        ...(data ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const owner = (
    await call("setup", "POST", {
      bootstrapToken: secret,
      username: "owner",
      password,
    })
  ).body.token;
  return { app, call, owner, dir };
}
const create = (f, kind = "family") =>
  f.call("ledgers", "POST", { name: "家庭账本", kind }, f.owner);
test("setup is single use, unauthenticated access denied, personal ledgers cannot be shared", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call("setup", "POST", {
        bootstrapToken: secret,
        username: "attacker",
        password,
      })
    ).status,
    409,
  );
  assert.equal((await f.call("ledgers")).status, 401);
  const id = (await create(f, "personal")).body.id;
  assert.equal(
    (await f.call(`ledgers/${id}/invites`, "POST", { role: "editor" }, f.owner))
      .status,
    403,
  );
});
test("invites grant only the selected ledger and viewers cannot modify; revocation is immediate", async (t) => {
  const f = await fixture(t);
  const privateId = (await create(f, "personal")).body.id;
  const id = (await create(f)).body.id;
  const code = (
    await f.call(`ledgers/${id}/invites`, "POST", { role: "viewer" }, f.owner)
  ).body.code;
  const guest = (
    await f.call("join", "POST", { code, username: "guest", password })
  ).body.token;
  assert.ok(guest);
  assert.equal(
    (await f.call("join", "POST", { code, username: "again", password }))
      .status,
    400,
  );
  assert.equal(
    (await f.call(`ledgers/${privateId}`, "GET", null, guest)).status,
    404,
  );
  const list = await f.call("ledgers", "GET", null, guest);
  assert.equal(list.body.ledgers.length, 1);
  const b = (await f.call(`ledgers/${id}`, "GET", null, guest)).body;
  assert.equal(
    (
      await f.call(
        `ledgers/${id}`,
        "PUT",
        { book: b.book, revision: b.revision, operationId: "a".repeat(32) },
        guest,
      )
    ).status,
    403,
  );
  const members = (await f.call(`ledgers/${id}/members`, "GET", null, f.owner))
    .body.members;
  const guestId = members.find((m) => m.username === "guest").id;
  assert.equal(
    (await f.call(`ledgers/${id}/members/${guestId}`, "DELETE", null, f.owner))
      .status,
    200,
  );
  assert.equal((await f.call(`ledgers/${id}`, "GET", null, guest)).status, 404);
});
test("CAS and idempotency prevent lost and duplicate writes; snapshot restoration creates a revision", async (t) => {
  const f = await fixture(t),
    id = (await create(f)).body.id;
  const a = (await f.call(`ledgers/${id}`, "GET", null, f.owner)).body;
  a.book.memo = "one";
  const request = {
    book: a.book,
    revision: a.revision,
    operationId: "op-".repeat(12),
  };
  const first = await f.call(`ledgers/${id}`, "PUT", request, f.owner);
  assert.equal(first.status, 200);
  assert.equal(
    (await f.call(`ledgers/${id}`, "PUT", request, f.owner)).body.revision,
    first.body.revision,
  );
  assert.equal(
    (
      await f.call(
        `ledgers/${id}`,
        "PUT",
        { ...request, operationId: "new-".repeat(12) },
        f.owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        `ledgers/${id}`,
        "PUT",
        { ...request, book: { ...a.book, memo: "different" } },
        f.owner,
      )
    ).status,
    409,
  );
  const restore = await f.call(
    `ledgers/${id}/restore`,
    "POST",
    { targetRevision: 1, revision: 2, operationId: "restore-".repeat(5) },
    f.owner,
  );
  assert.equal(restore.status, 200);
  assert.equal(restore.body.revision, 3);
  assert.equal(
    (await f.call(`ledgers/${id}`, "GET", null, f.owner)).body.book.memo,
    "",
  );
});
test("summary excludes paired transfers and rejects forged unbalanced transfers", async (t) => {
  const f = await fixture(t),
    id = (await create(f)).body.id;
  await f.call("ledgers", "GET", null, f.owner);
  const b = (await f.call(`ledgers/${id}`, "GET", null, f.owner)).body;
  const book = b.book;
  book.categories.bank = {
    id: "bank",
    name: "银行卡",
    balance: 0,
    currency: "CNY",
  };
  const txn = (id, amount, accountId, transferId) => ({
    id,
    date: "2026-09-19",
    category: accountId === "cash" ? "现金" : "银行卡",
    accountId,
    amount,
    currency: "CNY",
    type: "单次",
    description: "测试",
    ...(transferId ? { transferId } : {}),
  });
  book.transactions = [
    txn("expense", -15, "cash"),
    txn("out", -50, "cash", "x"),
    txn("in", 50, "bank", "x"),
  ];
  assert.equal(
    (
      await f.call(
        `ledgers/${id}`,
        "PUT",
        { book, revision: 1, operationId: "transfer-".repeat(5) },
        f.owner,
      )
    ).status,
    200,
  );
  const list = (await f.call("ledgers", "GET", null, f.owner)).body.ledgers;
  assert.equal(list[0].summary.CNY.expense, 15);
  assert.equal(list[0].summary.CNY.income, 0);
  book.transactions.pop();
  assert.equal(
    (
      await f.call(
        `ledgers/${id}`,
        "PUT",
        { book, revision: 2, operationId: "bad-transfer-".repeat(5) },
        f.owner,
      )
    ).status,
    400,
  );
});
test("sessions revoke on logout and password hashes never appear in API responses", async (t) => {
  const f = await fixture(t);
  const me = await f.call("me", "GET", null, f.owner);
  assert.equal(JSON.stringify(me).includes("password"), false);
  await f.call("logout", "POST", {}, f.owner);
  assert.equal((await f.call("ledgers", "GET", null, f.owner)).status, 401);
  assert.equal(
    (await f.call("login", "POST", { username: "owner", password: "wrong" }))
      .status,
    401,
  );
  assert.equal(
    (await f.call("login", "POST", { username: "owner", password })).status,
    200,
  );
});
test("ledger creation is idempotent and changed requests cannot reuse a key", async (t) => {
  const f = await fixture(t),
    body = { name: "私有", kind: "personal", operationId: "create-".repeat(6) };
  const a = await f.call("ledgers", "POST", body, f.owner),
    b = await f.call("ledgers", "POST", body, f.owner);
  assert.equal(a.body.id, b.body.id);
  assert.equal(
    (await f.call("ledgers", "POST", { ...body, name: "changed" }, f.owner))
      .status,
    409,
  );
});
test("untrusted origins and arbitrary files are blocked; same-origin assets contain no real ledger", async (t) => {
  const f = await fixture(t),
    base = "http://127.0.0.1:" + f.app.server.address().port;
  assert.equal(
    (
      await fetch(base + "/api/me", {
        headers: {
          origin: "https://evil.example",
          authorization: "Bearer " + f.owner,
        },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + "/server/data/book.sqlite")).status, 404);
  assert.equal((await fetch(base + "/README.md")).status, 404);
  assert.equal((await fetch(base + "/")).status, 200);
  const pdf=await fetch(base+"/vendor/pdfjs/pdf.mjs");assert.equal(pdf.status,200);assert.match(pdf.headers.get("content-type"),/javascript/);
  assert.equal((await fetch(base+"/vendor/pdfjs/pdf.worker.mjs")).status,200);
});
test("malformed snapshots and prototype-shaped currencies are rejected without changing revisions", async (t) => {
  const f = await fixture(t),
    id = (await create(f)).body.id;
  const b = (await f.call(`ledgers/${id}`, "GET", null, f.owner)).body.book;
  b.transactions = [
    {
      id: "x",
      date: "2026-09-19",
      category: "现金",
      accountId: "cash",
      amount: 1,
      currency: "__proto__",
    },
  ];
  assert.equal(
    (
      await f.call(
        `ledgers/${id}`,
        "PUT",
        { book: b, revision: 1, operationId: "proto-".repeat(6) },
        f.owner,
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.call(`ledgers/${id}`, "GET", null, f.owner)).body.revision,
    1,
  );
});
test("consistent backups survive reopening and retain membership and ledger revisions", async (t) => {
  const f = await fixture(t),
    id = (await create(f)).body.id;
  const target = path.join(f.dir, "snapshot.sqlite");
  require("node:child_process").execFileSync(
    process.execPath,
    [path.join(__dirname, "../../server/backup.cjs"), target],
    {
      env: { ...process.env, ASSET_DB: path.join(f.dir, "test.sqlite") },
      stdio: "pipe",
    },
  );
  const { DatabaseSync } = require("node:sqlite");
  const backup = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(
      backup.prepare("SELECT revision FROM ledgers WHERE id=?").get(id)
        .revision,
      1,
    );
    assert.equal(backup.prepare("SELECT count(*) n FROM members").get().n, 1);
    assert.equal(
      backup.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
  } finally {
    backup.close();
  }
  await new Promise((r) => f.app.server.close(r));
  f.app.db.close();
  const reopened = S.createServer({
    dbPath: path.join(f.dir, "test.sqlite"),
    bootstrapToken: secret,
  });
  await new Promise((r) => reopened.server.listen(0, "127.0.0.1", r));
  f.app.server = reopened.server;
  f.app.db = reopened.db;
  const res = await fetch(
    "http://127.0.0.1:" + reopened.server.address().port + "/api/ledgers/" + id,
    { headers: { authorization: "Bearer " + f.owner } },
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).revision, 1);
});
test("LAN allowance is off by default and advertised only for its configured authority", async (t) => {
  const original = await fixture(t);
  assert.equal((await original.call("status")).body.lanOrigin, null);
  const f = await fixture(t, { lanOrigin: "http://192.168.50.20:8789" }),
    base = "http://127.0.0.1:" + f.app.server.address().port;
  const allowed = await wireFetch(base + "/api/status", {
    headers: { host: "192.168.50.20:8789" },
  });
  assert.equal((await allowed.json()).lanOrigin, "http://192.168.50.20:8789");
  assert.equal((await f.call("status")).body.lanOrigin, null);
  assert.throws(
    () =>
      S.createServer({
        dbPath: "unused.sqlite",
        lanOrigin: "http://public.example",
      }),
    /私有/,
  );
});
