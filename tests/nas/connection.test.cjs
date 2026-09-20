const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = fs.existsSync(path.join(__dirname, "../../nas-connection.js"))
  ? require("../../nas-connection.js")
  : {};
const nas = "http://192.168.50.20:8789";
test("private HTTP requires an explicit matching server policy and same-origin NAS page", () => {
  assert.equal(
    C.endpoint(nas, { pageOrigin: nas, standalone: true, lanOrigin: nas }),
    nas,
  );
  for (const options of [
    { pageOrigin: nas, standalone: true },
    { pageOrigin: nas, standalone: false, lanOrigin: nas },
    {
      pageOrigin: "http://192.168.50.21:8789",
      standalone: true,
      lanOrigin: nas,
    },
  ])
    assert.throws(() => C.endpoint(nas, options), /HTTPS/);
});
test("public HTTP, deceptive URLs and malformed LAN policy are never accepted", () => {
  for (const value of [
    "http://example.com",
    "http://192.168.50.20.evil.test:8789",
    "http://user:pass@192.168.50.20:8789",
    "http://192.168.50.20:8789/path",
    "http://172.32.0.1:8789",
    "http://169.254.1.1:8789",
    "http://192.168.50.20:8789/?secret=x",
  ])
    assert.throws(() =>
      C.endpoint(value, {
        pageOrigin: value,
        standalone: true,
        lanOrigin: value,
      }),
    );
  assert.equal(C.lanOrigin("http://10.1.2.3:8789"), "http://10.1.2.3:8789");
  assert.equal(C.lanOrigin("http://172.31.1.1:8789"), "http://172.31.1.1:8789");
  assert.throws(() => C.lanOrigin("https://example.com"));
});
test("HTTPS and localhost retain their existing behavior", () => {
  assert.equal(
    C.endpoint("https://books.example.com"),
    "https://books.example.com",
  );
  assert.equal(C.endpoint("http://127.0.0.1:8789"), "http://127.0.0.1:8789");
});
test("NAS HTTP contexts generate unique identifiers using secure random bytes without randomUUID", () => {
  const crypto = {
    getRandomValues: require("node:crypto").webcrypto.getRandomValues.bind(
      require("node:crypto").webcrypto,
    ),
  };
  const ids = Array.from({ length: 100 }, () => C.id(crypto));
  assert.equal(new Set(ids).size, 100);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  assert.throws(() => C.id({}), /随机/);
});
