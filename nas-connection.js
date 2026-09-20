(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerNASConnection = api;
})(globalThis, function () {
  "use strict";
  function rootURL(value) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw Error("请输入服务根地址，不包含密码、路径或参数");
    return url;
  }
  function lanOrigin(value) {
    const url = rootURL(value);
    const parts = url.hostname.split(".").map(Number);
    const privateIP =
      parts.length === 4 &&
      parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168));
    if (url.protocol !== "http:" || !privateIP)
      throw Error("NAS 内网配置必须是明确的私有 IPv4 HTTP 地址");
    return url.origin;
  }
  function endpoint(
    value,
    { pageOrigin = "", standalone = false, lanOrigin: configured = "" } = {},
  ) {
    const url = rootURL(value);
    if (
      url.protocol === "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return url.origin;
    let permitted = false;
    try {
      permitted =
        standalone &&
        configured &&
        lanOrigin(configured) === url.origin &&
        pageOrigin === url.origin;
    } catch {}
    if (!permitted)
      throw Error("该连接未获 NAS 内网授权，请通过 HTTPS 或 NAS 入口访问");
    return url.origin;
  }
  function id(crypto = globalThis.crypto) {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto?.getRandomValues !== "function")
      throw Error("浏览器缺少安全随机数功能，请更换浏览器");
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join(
      "",
    );
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }
  return { endpoint, lanOrigin, id };
});
