(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./legacy-safety.js")
      : root.AssetTrackerLegacySafety,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerBankImport = api;
})(globalThis, function (S) {
  "use strict";
  const currencies = {
    人民币: "CNY",
    新加坡元: "SGD",
    日元: "JPY",
    美元: "USD",
    港币: "HKD",
    欧元: "EUR",
    英镑: "GBP",
    澳大利亚元: "AUD",
    加拿大元: "CAD",
  };
  const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
  const clean = (s) => String(s || "").trim();
  function cents(s) {
    s = clean(s).replace(/,/g, "");
    if (!/^[+-]?\d+\.\d{2}$/.test(s)) throw Error("金额或余额无法精确识别");
    const n = Math.round(Number(s) * 100);
    if (!Number.isSafeInteger(n)) throw Error("金额超出范围");
    return n;
  }
  const hash = (s) => S.sha256Hex(new TextEncoder().encode(s));
  function parse(pages) {
    if (!Array.isArray(pages) || !pages.length)
      throw Error("PDF 没有可读取的文字层，暂不支持扫描件");
    const text = pages[0].items.map((i) => i.s).join(" "),
      provider = text.includes("工商银行借记账户历史明细")
        ? "icbc"
        : text.includes("OCBC FRANK ACCOUNT")
          ? "ocbc"
          : null;
    if (!provider)
      throw Error("未识别到工行或 OCBC FRANK 原始账单；扫描件暂不支持");
    const result = {
      provider,
      total: 0,
      records: [],
      errors: [],
      skipped: [],
      methods: [],
      totals: { incomeCents: 0, expenseCents: 0 },
      verification: [],
    };
    let account = "",
      lastBalance = new Map(),
      opening = null,
      closing = null,
      withdrawals = null,
      deposits = null;
    function add({
      page,
      row,
      date,
      currency,
      amount,
      balance,
      description,
      kind,
      valueDate = "",
      account: acct,
    }) {
      if (
        !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/.test(date) ||
        Number.isNaN(Date.parse(date)) ||
        new Date(date.slice(0, 10)).toISOString().slice(0, 10) !==
          date.slice(0, 10)
      )
        throw Error("交易日期无法识别");
      const signed = cents(amount),
        bal = cents(balance),
        key = acct + "|" + currency;
      const previous = lastBalance.get(key);
      if (previous !== undefined && previous + signed !== bal)
        throw Error("流水余额不连续，不能确认 PDF 读取完整性");
      lastBalance.set(key, bal);
      const transactionId = hash(
        JSON.stringify([
          provider,
          acct,
          currency,
          date,
          signed,
          bal,
          description,
          valueDate,
        ]),
      );
      const direction = signed < 0 ? "支出" : "收入",
        method =
          (provider === "icbc" ? "工商银行" : "OCBC FRANK") +
          " · 尾号 " +
          acct.split("-")[0].slice(-4) +
          " · " +
          currency;
      const reason =
        /转账|汇款|汇入|汇出|提现|存款|取现|还款|银证|理财|基金|购汇|结汇|存入|取款|支付宝|财付通|微信|小荷包|FAST |TRANSFER|GIRO|REMITTANCE/i.test(
          description + " " + kind,
        )
          ? "可能为内部转账或支付平台扣款，请核对是否已在其他账单记账；内部调拨不要作为普通收支重复计入"
          : "";
      result.records.push({
        row: ++result.total,
        page,
        date,
        amount: signed / 100,
        currency,
        id: provider + ":" + transactionId,
        needsReview: !!reason,
        reviewReason: reason,
        source: {
          version: 1,
          transactionId,
          merchantId: "",
          transactionType: kind,
          counterparty: "",
          product: description,
          direction,
          paymentMethod: method,
          status: "已入账",
          note: `PDF 第 ${page} 页，第 ${row} 笔；账后余额 ${balance} ${currency}`,
          timezone: "source-local",
          signature: JSON.stringify([date, direction, Math.abs(signed)]),
          bankBalanceCents: bal,
          sourcePage: page,
          sourceRow: row,
          accountFingerprint: hash(acct),
          valueDate,
        },
      });
    }
    for (const page of pages) {
      const items = page.items
          .filter((i) => Math.abs(i.angle || 0) < 0.02)
          .sort((a, b) => a.y - b.y || a.x - b.x),
        all = items.map((i) => i.s).join(" ");
      if (provider === "icbc") {
        if (!all.includes("交易日期") || !all.includes("本页交易笔数"))
          throw Error(`第 ${page.number} 页缺少工行表头或页合计`);
        const anchors = items.filter(
          (i) => i.x / page.width < 0.16 && /^\d{4}-\d{2}-\d{2}$/.test(i.s),
        );
        const declared = all.match(/本页交易笔数[：:]\s*(\d+)/);
        if (!declared || +declared[1] !== anchors.length)
          throw Error(`第 ${page.number} 页笔数校验失败`);
        const bounds = [
          84, 133, 211, 243, 275, 308, 332, 373, 405, 493, 581, 639, 717, 759,
        ].map((x) => (x / 842) * page.width);
        let income = 0,
          expense = 0;
        anchors.forEach((a, index) => {
          const low = a.y - 3,
            high =
              index + 1 < anchors.length ? anchors[index + 1].y - 3 : a.y + 14;
          const cells = bounds.slice(0, -1).map((x, j) =>
            items
              .filter(
                (i) =>
                  i.y >= low && i.y < high && i.x >= x && i.x < bounds[j + 1],
              )
              .map((i) => i.s)
              .join(" ")
              .trim(),
          );
          const currency = currencies[cells[4]];
          if (!currency)
            throw Error(`第 ${page.number} 页币种无法识别：${cells[4]}`);
          const stamp = cells[0].match(
            /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/,
          );
          if (!stamp || !/^\d+$/.test(cells[1]))
            throw Error("工行日期或账户列不完整");
          const n = cents(cells[8]);
          if (n >= 0) income += n;
          else expense -= n;
          add({
            page: page.number,
            row: index + 1,
            date: stamp[1] + "T" + stamp[2],
            currency,
            amount: cells[8],
            balance: cells[9],
            description: cells[10] + " · " + cells[11] + " · " + cells[12],
            kind: cells[6],
            account: cells[1] + "-" + cells[5],
          });
        });
        for (const [label, n] of [
          ["收入", income],
          ["支出", expense],
        ]) {
          const m = all.match(
            new RegExp("本页" + label + "算术合计[：:]\\s*([\\d,.]+)"),
          );
          if (!m || cents(m[1]) !== n)
            throw Error(`第 ${page.number} 页${label}合计校验失败`);
        }
        result.verification.push({
          page: page.number,
          count: anchors.length,
          incomeCents: income,
          expenseCents: expense,
        });
      } else {
        if (!all.includes("OCBC FRANK ACCOUNT")) continue; // Bank glossary and notices have no ledger table.
        const am = all.match(/Account No\.\s*(\d+)/),
          period = all.match(
            /(\d{1,2})\s+([A-Z]{3})\s+(\d{4})\s+TO\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/,
          );
        if (
          !am ||
          !period ||
          !all.includes("Withdrawal") ||
          !all.includes("Deposit")
        )
          throw Error("OCBC 账户、期间或表头缺失");
        if (account && account !== am[1])
          throw Error("请分别导入不同账户的账单");
        account = am[1];
        const scale = page.width / 595.28;
        const moneyAt = (y, lo, hi) =>
          items
            .filter(
              (i) =>
                Math.abs(i.y - y) < 2 && i.x / scale >= lo && i.x / scale < hi,
            )
            .map((i) => i.s)
            .join("")
            .trim();
        const bf = items.find((i) => i.s === "BALANCE B/F");
        if (bf) {
          opening = cents(moneyAt(bf.y, 500, 575));
          lastBalance.set(account + "|SGD", opening);
        }
        const cf = items.find((i) => i.s === "BALANCE C/F");
        if (cf) closing = cents(moneyAt(cf.y, 500, 575));
        const total = items.find((i) => i.s === "Total Withdrawals/Deposits");
        if (total) {
          withdrawals = cents(moneyAt(total.y, 320, 400));
          deposits = cents(moneyAt(total.y, 400, 500));
        }
        const anchors = items.filter(
          (i) => i.x / scale < 80 && /^\d{1,2} [A-Z]{3}$/.test(i.s),
        );
        anchors.forEach((a, index) => {
          const [day, month] = a.s.split(" "),
            mi = months.indexOf(month);
          if (mi < 0) throw Error("OCBC 月份无法识别");
          const year = month === period[2] ? period[3] : period[6],
            date = `${year}-${String(mi + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
          const start = `${period[3]}-${String(months.indexOf(period[2]) + 1).padStart(2, "0")}-${period[1].padStart(2, "0")}`,
            end = `${period[6]}-${String(months.indexOf(period[5]) + 1).padStart(2, "0")}-${period[4].padStart(2, "0")}`;
          if (
            Date.parse(date) < Date.parse(start) - 7 * 86400000 ||
            Date.parse(date) > Date.parse(end) + 7 * 86400000
          )
            throw Error("OCBC 交易日期明显超出账单期间");
          const hi = anchors[index + 1]?.y - 2 || cf?.y - 2 || page.height - 58;
          const lines = items
            .filter(
              (i) =>
                i.x / scale >= 130 &&
                i.x / scale < 320 &&
                i.y >= a.y - 2 &&
                i.y < hi,
            )
            .map((i) => i.s);
          const debit = moneyAt(a.y, 320, 400),
            credit = moneyAt(a.y, 400, 500),
            balance = moneyAt(a.y, 500, 575);
          if (!!debit === !!credit) throw Error("OCBC 收支列不明确");
          add({
            page: page.number,
            row: index + 1,
            date,
            currency: "SGD",
            amount: debit ? "-" + debit : credit,
            balance,
            description: lines.join(" · "),
            kind: lines[0] || "银行流水",
            valueDate: moneyAt(a.y, 80, 130),
            account,
          });
        });
      }
    }
    if (!result.total) throw Error("未识别到交易明细");
    if (provider === "ocbc") {
      const income = result.records
          .filter((r) => r.amount > 0)
          .reduce((a, r) => a + Math.round(r.amount * 100), 0),
        expense = result.records
          .filter((r) => r.amount < 0)
          .reduce((a, r) => a - Math.round(r.amount * 100), 0);
      if (
        opening === null ||
        closing === null ||
        withdrawals !== expense ||
        deposits !== income ||
        opening + income - expense !== closing
      )
        throw Error("OCBC 期初、期末余额或收支合计校验失败");
      result.verification.push({
        openingCents: opening,
        closingCents: closing,
        incomeCents: income,
        expenseCents: expense,
      });
    }
    const methods = new Map();
    for (const r of result.records) {
      const m = methods.get(r.source.paymentMethod) || {
        name: r.source.paymentMethod,
        currency: r.currency,
        count: 0,
      };
      m.count++;
      methods.set(m.name, m);
    }
    result.methods = [...methods.values()];
    return result;
  }
  let desktopLoader;
  function loadDesktopParser(){
    if(!desktopLoader)desktopLoader=(async()=>{
      for(const [src,key] of [['vendor/pdfjs/pdf.classic.js','AssetPDF'],['vendor/pdfjs/pdf.worker.classic.js','pdfjsWorker']]){
        if(globalThis[key])continue;
        await new Promise((resolve,reject)=>{const script=document.createElement('script');const timer=setTimeout(()=>{script.remove();reject(Error('PDF 解析器加载超时，请重试'));},15000);script.src=src;script.onload=()=>{clearTimeout(timer);globalThis[key]?resolve():reject(Error('PDF 解析器不可用'));};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('PDF 解析器加载失败，请重试'));};document.head.append(script);});
      }
      return globalThis.AssetPDF;
    })().catch(e=>{desktopLoader=null;throw e;});
    return desktopLoader;
  }
  async function read(input, fileName = "") {
    const bytes =
      typeof input === "string"
        ? Uint8Array.from(input, (c) => c.charCodeAt(0))
        : new Uint8Array(input);
    if (bytes.length > 12 * 1024 * 1024) throw Error("PDF 不能超过 12 MB");
    const pdf = location.protocol === "file:" ? await loadDesktopParser() : await import("./vendor/pdfjs/pdf.mjs");
    pdf.GlobalWorkerOptions.workerSrc = new URL(
      "vendor/pdfjs/pdf.worker.mjs",
      document.baseURI,
    ).href;
    const task = pdf.getDocument({
      data: bytes,
      useSystemFonts: true,
      isEvalSupported: false,
      stopAtErrors: true,
    });
    try {
      const doc = await task.promise;
      if (doc.numPages > 200) throw Error("单次最多读取 200 页");
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n),
          v = page.getViewport({ scale: 1 }),
          tc = await page.getTextContent();
        pages.push({
          number: n,
          width: v.width,
          height: v.height,
          items: tc.items
            .filter((i) => i.str?.trim())
            .map((i) => {
              const t = pdf.Util.transform(v.transform, i.transform);
              return {
                s: i.str,
                x: t[4],
                y: t[5],
                w: i.width,
                angle: Math.atan2(t[1], t[0]),
              };
            }),
        });
        page.cleanup();
      }
      const parsed = parse(pages);
      parsed.fileName = fileName;
      return parsed;
    } catch (e) {
      if (e.name === "PasswordException")
        throw Error("PDF 需要密码，请先在本机解锁后导入");
      throw e;
    } finally {
      await task.destroy();
    }
  }
  return { parse, read };
});
