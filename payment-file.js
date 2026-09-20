(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerPaymentFile = api;
})(globalThis, function () {
  "use strict";
  function read(input, XLSX, { type = "binary", fileName = "" } = {}) {
    const bytes =
      typeof input === "string"
        ? Uint8Array.from(input, (c) => c.charCodeAt(0) & 255)
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);
    if (!bytes.length) throw Error("账单文件为空");
    if (bytes.length > 12 * 1024 * 1024) throw Error("账单不能超过12MB");
    const binary =
      (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
      (bytes[0] === 0xd0 && bytes[1] === 0xcf) ||
      /\.xlsx?$/i.test(fileName);
    let workbook,
      encoding = "Excel";
    if (binary)
      workbook = XLSX.read(bytes, {
        type: "array",
        raw: true,
        cellDates: false,
        sheetRows: 50064,
      });
    else {
      let text;
      const encodings =
        bytes[0] === 255 && bytes[1] === 254
          ? ["utf-16le"]
          : bytes[0] === 254 && bytes[1] === 255
            ? ["utf-16be"]
            : ["utf-8", "gb18030"];
      for (const name of encodings) {
        try {
          text = new TextDecoder(name, { fatal: true }).decode(bytes);
          encoding = name;
          break;
        } catch {}
      }
      if (text === undefined)
        throw Error("无法识别CSV编码，请使用原始导出文件");
      workbook = XLSX.read(text, {
        type: "string",
        raw: true,
        cellDates: false,
        sheetRows: 50064,
      });
    }
    return { workbook, encoding };
  }
  return { read };
});
