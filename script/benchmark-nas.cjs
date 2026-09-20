const { createServer, emptyBook } = require("../server/server.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { performance } = require("node:perf_hooks");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nas-bench-")),
    app = createServer({
      dbPath: path.join(dir, "book.sqlite"),
      bootstrapToken: "benchmark-".repeat(6),
    });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + app.server.address().port + "/api/";
  let token;
  const call = async (route, method = "GET", body) => {
    const r = await fetch(url + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw Error(await r.text());
    return r.json();
  };
  try {
    token = (
      await call("setup", "POST", {
        username: "bench",
        password: "synthetic-benchmark-password",
        bootstrapToken: "benchmark-".repeat(6),
      })
    ).token;
    const book = emptyBook();
    book.transactions = Array.from({ length: 10000 }, (_, i) => ({
      id: String(i),
      accountId: "cash",
      category: "现金",
      date: "2026-09-19",
      amount: -1,
      currency: "CNY",
      description: "synthetic",
    }));
    book.categories.cash.balance = -10000;
    const created = await call("ledgers", "POST", {
      name: "bench",
      kind: "family",
      book,
    });
    await call("ledgers");
    const times = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const list = await call("ledgers");
      times.push(performance.now() - start);
      if (list.ledgers[0].summary.CNY.expense !== 10000)
        throw Error("Summary mismatch");
    }
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
          environment:
            "Node " +
            process.version +
            "; localhost; SQLite; synthetic data; not NAS hardware",
          transactions: 10000,
          requests: 20,
          listMedianMs: +times[10].toFixed(2),
          listP95Ms: +times[19].toFixed(2),
          revision: (await call("ledgers/" + created.id)).revision,
        },
        null,
        2,
      ),
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    app.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
