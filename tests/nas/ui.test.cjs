const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { JSDOM } = require("../../app/node_modules/jsdom");
const wireFetch = require("./http-client.cjs");
const { createServer } = require("../../server/server.cjs");
async function wait(fn) {
  const until = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > until) throw Error("UI did not reach expected state");
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function ui(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nas-ui-")),
    service = createServer({
      dbPath: path.join(dir, "db.sqlite"),
      bootstrapToken: "test-bootstrap-".repeat(4),
      lanOrigin: options.lanOrigin || "",
    });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + service.server.address().port;
  const call = async (route, method, body, token) => {
    const r = await fetch(base + "/api/" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };
  const password = "Synthetic-test-password-123",
    token = (
      await call("setup", "POST", {
        username: "owner",
        password,
        bootstrapToken: "test-bootstrap-".repeat(4),
      })
    ).token;
  const id = (
    await call("ledgers", "POST", { name: "家庭测试", kind: "family" }, token)
  ).id;
  const dom = new JSDOM('<div data-nas-root data-standalone="true"></div>', {
    url: options.pageOrigin || base,
    runScripts: "outside-only",
  });
  const browserRequests = [];
  let loseResponse = false,
    offline = false;
  dom.window.fetch = async (url, opts) => {
    if (offline) throw Error("offline");
    browserRequests.push(new URL(url).pathname);
    const response = await wireFetch(base + new URL(url).pathname, {
      ...opts,
      headers: {
        ...opts.headers,
        host: new URL(options.pageOrigin || base).host,
      },
    });
    if (loseResponse && opts.method === "PUT") {
      loseResponse = false;
      throw Error("lost response");
    }
    return response;
  };
  if (options.disableRandomUUID)
    Object.defineProperty(dom.window.crypto, "randomUUID", {
      value: undefined,
    });
  dom.window.XLSX = require("../../vendor/xlsx.full.min.js");
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  dom.window.TextDecoder = TextDecoder;
  dom.window.AbortController = AbortController;
  dom.window.confirm = () => true;
  for (const file of [
    "expense-projects.js",
    "ledger-import.js",
    "payment-file.js",
    "wechat-import.js",
    "alipay-import.js",
    "wechat-import-ui.js",
    "import-audit-ui.js",
    "nas-connection.js",
    "nas-model.js",
  ])
    dom.window.eval(
      fs.readFileSync(path.join(__dirname, "../..", file), "utf8"),
    );
  let content = fs.readFileSync(
    process.env.ASSET_NAS_UI_BASELINE ||
      path.join(__dirname, "../../nas-ui.js"),
    "utf8",
  );
  content = content.replace(
    /document.addEventListener\("DOMContentLoaded",[\s\S]*?\n  \);/,
    "",
  );
  dom.window.eval(content);
  const node = dom.window.document.querySelector("[data-nas-root]");
  dom.window.AssetTrackerNASUI.mount(node);
  const doc = dom.window.document;
  t.after(async () => {
    dom.window.close();
    await new Promise((r) => service.server.close(r));
    service.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const form = doc.querySelector("form");
  form.elements.username.value = "owner";
  form.elements.password.value = password;
  form.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  if (options.expectBlocked)
    await wait(() => node.textContent.includes("HTTPS"));
  else {
    await wait(() => node.textContent.includes("已连接 NAS"));
    doc.querySelector('[data-nas-action="open"]').click();
    await wait(() => node.textContent.includes("已打开 家庭测试"));
  }

  return {
    browserRequests,
    doc,
    dom,
    node,
    call,
    token,
    id,
    service,
    lose: () => (loseResponse = true),
    offline: () => (offline = true),
  };
}
function submit(f, dom) {
  f.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
}
test("conflict retains form values, refresh preserves the draft, and retry applies it once", async (t) => {
  const f = await ui(t);
  let form = f.doc.querySelector('[data-nas-form="entry"]');
  form.elements.amount.value = "15";
  form.elements.description.value = "draft";
  const b = await f.call("ledgers/" + f.id, "GET", null, f.token);
  b.book.memo = "another editor";
  await f.call(
    "ledgers/" + f.id,
    "PUT",
    {
      book: b.book,
      revision: b.revision,
      operationId: "other-editor-operation",
    },
    f.token,
  );
  submit(form, f.dom);
  await wait(() => f.node.textContent.includes("账本已有新版本"));
  assert.equal(form.elements.amount.value, "15");
  f.doc.querySelector('[data-nas-action="refresh"]').click();
  await wait(() => f.node.textContent.includes("已读取最新版本"));
  form = f.doc.querySelector('[data-nas-form="entry"]');
  assert.equal(form.elements.amount.value, "15");
  submit(form, f.dom);
  await wait(() => f.node.textContent.includes("已安全保存到 NAS"));
  const result = await f.call("ledgers/" + f.id, "GET", null, f.token);
  assert.equal(result.book.transactions.length, 1);
  assert.equal(result.book.memo, "another editor");
});
test("an unknown save result exposes a retry which reuses its operation id", async (t) => {
  const f = await ui(t),
    form = f.doc.querySelector('[data-nas-form="entry"]');
  form.elements.amount.value = "9.50";
  f.lose();
  submit(form, f.dom);
  await wait(() => f.node.textContent.includes("连接中断"));
  f.doc.querySelector('[data-nas-action="retry"]').click();
  await wait(() => f.node.textContent.includes("已安全保存到 NAS"));
  const result = await f.call("ledgers/" + f.id, "GET", null, f.token);
  assert.equal(result.revision, 2);
  assert.equal(result.book.transactions.length, 1);
});
test("offline logout clears local access and explains unconfirmed server revocation", async (t) => {
  const f = await ui(t);
  f.offline();
  f.doc.querySelector('[data-nas-action="logout"]').click();
  await wait(() => f.doc.querySelector('[data-nas-form="auth"]'));
  assert.match(f.node.textContent, /本机已退出/);
});
test("expired session can reauthenticate without losing a pending entry", async (t) => {
  const f = await ui(t),
    form = f.doc.querySelector('[data-nas-form="entry"]');
  form.elements.amount.value = "7";
  f.service.db.exec("UPDATE sessions SET expires=0");
  submit(form, f.dom);
  await wait(() => f.doc.querySelector("[data-nas-reauth]"));
  assert.equal(form.elements.amount.value, "7");
  const auth = f.doc.querySelector("[data-nas-reauth]");
  auth.elements.password.value = "Synthetic-test-password-123";
  submit(auth, f.dom);
  await wait(() => f.node.textContent.includes("已安全保存到 NAS"));
});
test("switching ledgers preserves unsaved draft fields for the original ledger", async (t) => {
  const f = await ui(t);
  const other = (
    await f.call(
      "ledgers",
      "POST",
      { name: "第二本账", kind: "personal" },
      f.token,
    )
  ).id;
  f.doc.querySelector('[data-nas-action="refresh"]').click();
  await wait(() => f.node.textContent.includes("已读取最新版本"));
  let form = f.doc.querySelector('[data-nas-form="entry"]');
  form.elements.amount.value = "33";
  form.elements.description.value = "不要丢失";
  f.doc.querySelector(`[data-nas-action="open"][data-id="${other}"]`).click();
  await wait(() => f.node.textContent.includes("已打开 第二本账"));
  f.doc.querySelector(`[data-nas-action="open"][data-id="${f.id}"]`).click();
  await wait(() => f.node.textContent.includes("已打开 家庭测试"));
  form = f.doc.querySelector('[data-nas-form="entry"]');
  assert.equal(form.elements.amount.value, "33");
  assert.equal(form.elements.description.value, "不要丢失");
});
test("configured NAS origin works without an address form or secure-context randomUUID", async (t) => {
  const f = await ui(t, {
    pageOrigin: "http://192.168.50.20:8789",
    lanOrigin: "http://192.168.50.20:8789",
    disableRandomUUID: true,
  });
  assert.equal(f.doc.querySelector('input[name="endpoint"]'), null);
  assert.match(f.node.textContent, /不是 HTTPS/);
  const form = f.doc.querySelector('[data-nas-form="entry"]');
  form.elements.amount.value = "12.30";
  submit(form, f.dom);
  await wait(() => f.node.textContent.includes("已安全保存到 NAS"));
  const result = await f.call("ledgers/" + f.id, "GET", null, f.token);
  assert.equal(result.book.transactions.length, 1);
  assert.equal(result.book.transactions[0].amount, -12.3);
});
test("unconfigured NAS HTTP page never submits credentials", async (t) => {
  const f = await ui(t, {
    pageOrigin: "http://192.168.50.20:8789",
    expectBlocked: true,
  });
  assert.ok(!f.browserRequests.includes("/api/login"));
  assert.equal(f.doc.querySelector('input[name="endpoint"]'), null);
});
test("NAS WeChat import uses the same review, saves atomically and can recover a lost response", async (t) => {
  const f = await ui(t);
  f.doc.querySelector('[data-nas-action="import-wechat"]').click();
  await wait(() => !f.node.hasAttribute("aria-busy"));
  const csv =
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注\n2026-09-19 12:00:00,商户消费,测试商户,午餐,支出,12.30,零钱,支付成功,420000000000000000000000000001,m-1,/\n";
  const input = f.doc.querySelector("[data-nas-wechat-file]");
  Object.defineProperty(input, "files", {
    value: [
      {
        size: Buffer.byteLength(csv),
        arrayBuffer: async () => Uint8Array.from(Buffer.from(csv)).buffer,
      },
    ],
  });
  input.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  await wait(() => f.doc.querySelector(".wechat-dialog"));
  const select = f.doc.querySelector("[data-wechat-method]");
  select.value = "cash";
  select.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  f.lose();
  f.doc.querySelector("[data-wechat-confirm]").click();
  await wait(() =>
    f.doc.querySelector(".wechat-feedback").textContent.includes("连接中断"),
  );
  f.doc.querySelector("[data-wechat-cancel]").click();
  await wait(() => f.doc.querySelector('[data-nas-action="retry"]'));
  f.doc.querySelector('[data-nas-action="retry"]').click();
  await wait(() => f.node.textContent.includes("已安全保存到 NAS"));
  const b = await f.call("ledgers/" + f.id, "GET", null, f.token);
  assert.equal(b.book.transactions.length, 1);
  assert.equal(b.book.categories.cash.balance, 0);
  assert.equal(b.book.transactions[0].wechat.balanceMode, "history");
  assert.equal(b.revision, 2);
});
test("NAS spreadsheet parser load failure is visible and a subsequent file selection can retry", async (t) => {
  const f = await ui(t);
  delete f.dom.window.XLSX;
  const csv =
    "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n2026-09-19 12:00:00,商户消费,测试商户,交通,支出,8,零钱,支付成功,wechat-loader-001\n";
  const input = f.doc.querySelector("[data-nas-wechat-file]");
  Object.defineProperty(input, "files", {
    value: [
      {
        size: Buffer.byteLength(csv),
        arrayBuffer: async () => Uint8Array.from(Buffer.from(csv)).buffer,
      },
    ],
  });
  input.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  await wait(() =>
    f.doc.querySelector('script[src="vendor/xlsx.full.min.js"]'),
  );
  f.doc
    .querySelector('script[src="vendor/xlsx.full.min.js"]')
    .dispatchEvent(new f.dom.window.Event("error"));
  await wait(() => f.node.textContent.includes("无法加载Excel解析器"));
  assert.equal(
    (await f.call("ledgers/" + f.id, "GET", null, f.token)).book.transactions
      .length,
    0,
  );
  input.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  await wait(() =>
    f.doc.querySelector('script[src="vendor/xlsx.full.min.js"]'),
  );
  f.dom.window.XLSX = require("../../vendor/xlsx.full.min.js");
  f.doc
    .querySelector('script[src="vendor/xlsx.full.min.js"]')
    .dispatchEvent(new f.dom.window.Event("load"));
  await wait(() => f.doc.querySelector(".wechat-dialog"));
  f.doc.querySelector("[data-wechat-cancel]").click();
  await wait(() => !f.node.hasAttribute("aria-busy"));
  assert.equal(
    (await f.call("ledgers/" + f.id, "GET", null, f.token)).book.transactions
      .length,
    0,
  );
});
test("NAS Alipay GB18030 file opens the Alipay review and retains Alipay provenance", async (t) => {
  const f = await ui(t);
  const bytes = fs.readFileSync(
    path.join(__dirname, "../fixtures/alipay-synthetic-gb18030.csv"),
  );
  const input = f.doc.querySelector("[data-nas-wechat-file]");
  Object.defineProperty(input, "files", {
    value: [
      {
        size: bytes.length,
        arrayBuffer: async () => Uint8Array.from(bytes).buffer,
      },
    ],
  });
  input.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  await wait(() => f.doc.querySelector(".wechat-dialog"));
  assert.match(f.doc.querySelector(".wechat-title").textContent, /支付宝/);
  const select = f.doc.querySelector("[data-wechat-method]");
  select.value = "cash";
  select.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  f.doc.querySelector("[data-wechat-confirm]").click();
  await wait(() => f.node.textContent.includes("已安全保存到 NAS"));
  const result = await f.call("ledgers/" + f.id, "GET", null, f.token);
  assert.equal(result.book.transactions.length, 1);
  assert.equal(
    result.book.transactions[0].alipay.transactionId,
    "202600000000000000000000000001",
  );
  assert.equal(result.book.transactions[0].wechat, undefined);
  assert.equal(result.book.categories.cash.balance, 0);
});

test("NAS audit decisions survive lost acknowledgment with one persisted resolution", async t=>{
 const f=await ui(t),csv="交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n2026-09-19 12:00:00,商户消费,测试,商品,支出,8,零钱,未知状态,audit-test-001\n";
 const input=f.doc.querySelector('[data-nas-wechat-file]');Object.defineProperty(input,'files',{value:[{name:'synthetic.csv',size:Buffer.byteLength(csv),arrayBuffer:async()=>Uint8Array.from(Buffer.from(csv)).buffer}]});input.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
 await wait(()=>f.doc.querySelector('[data-wechat-method]'));const select=f.doc.querySelector('[data-wechat-method]');select.value='cash';select.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));f.doc.querySelector('[data-wechat-confirm]').click();await wait(()=>!f.doc.querySelector('.wechat-dialog'));
 f.doc.querySelector('[data-nas-action="import-audit"]').click();await wait(()=>f.doc.querySelector('[data-decision="exclude"]'));f.lose();f.doc.querySelector('[data-decision="exclude"]').click();await wait(()=>f.doc.querySelector('.import-audit-dialog [role=status]').textContent.includes('连接中断'));f.doc.querySelector('[data-close]').click();await wait(()=>f.doc.querySelector('[data-nas-action="retry"]'));f.doc.querySelector('[data-nas-action="retry"]').click();await wait(()=>f.node.textContent.includes('已安全保存到 NAS'));
 const result=await f.call('ledgers/'+f.id,'GET',null,f.token);assert.equal(result.revision,3);assert.equal(result.book.transactions.length,0);assert.equal(result.book.importAudits[0].items[0].decision,'excluded');assert.equal(result.book.importAudits[0].status,'completed');
});
