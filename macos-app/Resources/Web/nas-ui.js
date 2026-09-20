(function (root) {
  "use strict";
  const C = root.AssetTrackerNASConnection;
  const M = root.AssetTrackerNASModel,
    I = root.AssetTrackerImport;
  const h = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const kind = { personal: "个人私有", shared: "共同账本", family: "家庭账本" },
    roles = { owner: "拥有者", editor: "可记账", viewer: "只读" };
  const money = (n) =>
    Number(n).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const button = (action, label, extra = "") =>
    `<button type="button" class="btn btn-secondary" data-nas-action="${action}" ${extra}>${label}</button>`;
  function mount(node) {
    const standalone = node.dataset.standalone === "true";
    let configuredLANOrigin = "",
      connectionFailure = null,
      connectionReady = Promise.resolve();
    let base = standalone ? location.origin : "",
      token = "",
      me = null,
      ledgers = [],
      current = null,
      members = [],
      versions = [],
      page = 0,
      search = "",
      editId = null,
      mode = "login",
      pending = null,
      busy = false;
    const selected = new Set();
    const drafts = new Map();
    node.innerHTML =
      '<div class="nas-status" role="status" aria-live="polite"></div><p class="helper-text nas-connection-note"></p><div class="nas-body"></div>';
    const view = node.querySelector(".nas-body"),
      status = node.querySelector(".nas-status");
    function notify(message, error = false) {
      status.textContent = message;
      status.classList.toggle("negative", error);
    }
    async function request(route, { method = "GET", body } = {}) {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(base + "/api/" + route, {
          method,
          signal: controller.signal,
          cache: "no-store",
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok)
          throw Object.assign(Error(data.error || "请求失败"), {
            status: res.status,
          });
        return data;
      } catch (e) {
        if (e.status) throw e;
        throw Error(
          "连接中断或响应未知。请检查服务地址和网络；若刚刚保存，请点击“重试未确认操作”，不要重复新增。",
        );
      } finally {
        clearTimeout(timer);
      }
    }
    function fields(form) {
      return Object.fromEntries(new FormData(form).entries());
    }
    function endpoint(value) {
      return C.endpoint(value, {
        standalone,
        pageOrigin: location.origin,
        lanOrigin: configuredLANOrigin,
      });
    }
    async function load(id = current?.id, preserve = false) {
      if (current) drafts.set(current.id, { fields: captureDraft(), editId });
      const savedDraft = drafts.get(id);
      const draft = preserve ? captureDraft() : savedDraft?.fields;
      editId = savedDraft?.editId || null;
      ledgers = (await request("ledgers")).ledgers;
      if (id && ledgers.some((l) => l.id === id)) {
        current = await request("ledgers/" + id);
        [members, versions] = await Promise.all([
          request("ledgers/" + id + "/members").then((r) => r.members),
          request("ledgers/" + id + "/versions").then((r) => r.versions),
        ]);
      } else {
        current = null;
        members = [];
        versions = [];
      }
      for (const id of selected)
        if (!ledgers.some((l) => l.id === id && l.kind !== "personal"))
          selected.delete(id);
      render();
      if (draft) restoreDraft(draft);
    }
    const captureDraft = () =>
      [
        ...view.querySelectorAll(
          'form[data-nas-form="entry"],form[data-nas-form="transfer"],form[data-nas-form="account"]',
        ),
      ].map((f) => ({ type: f.dataset.nasForm, values: fields(f) }));
    const restoreDraft = (drafts) =>
      drafts.forEach((d) => {
        const f = view.querySelector(`[data-nas-form="${d.type}"]`);
        if (f && d.type === "entry") {
          const p = current.book.expenseProjects?.find(
            (p) => p.id === d.values.projectId,
          );
          f.elements.expenseCategoryId.innerHTML =
            '<option value="">未分类</option>' +
            (p?.categories || [])
              .map(
                (c) =>
                  `<option value="${h(c.id)}">${h(
                    root.AssetTrackerProjects.chain(p, c.id)
                      .map((n) => n.name)
                      .join(" / "),
                  )}</option>`,
              )
              .join("");
          if (
            p &&
            !Array.from(f.elements.projectId.options).some(
              (o) => o.value === p.id,
            )
          ) {
            const option = document.createElement("option");
            option.value = p.id;
            option.textContent = p.name + "（已归档）";
            f.elements.projectId.append(option);
          }
          if (editId) {
            f.querySelector('[type="submit"]').textContent = "保存修改";
            f.querySelector('[data-nas-action="cancel-edit"]').hidden = false;
          }
        }
        if (f)
          for (const [key, value] of Object.entries(d.values)) {
            const el = f.elements.namedItem(key);
            if (el) el.value = value;
          }
      });
    async function createLedger(body) {
      if (pending) throw Error("请先重试上一笔未确认操作");
      pending = {
        route: "ledgers",
        method: "POST",
        body: { ...body, operationId: C.id() },
      };
      await retry();
    }
    let spreadsheetLoader = null;
    async function ensureSpreadsheetParser() {
      if (root.XLSX) return root.XLSX;
      if (!spreadsheetLoader)
        spreadsheetLoader = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          const timer = setTimeout(() => {
            script.remove();
            reject(Error("Excel解析器加载超时，请重试"));
          }, 15000);
          script.src = "vendor/xlsx.full.min.js";
          script.onload = () => {
            clearTimeout(timer);
            if (root.XLSX) resolve(root.XLSX);
            else reject(Error("Excel解析器不可用"));
          };
          script.onerror = () => {
            clearTimeout(timer);
            script.remove();
            reject(Error("无法加载Excel解析器，请检查网络后重试"));
          };
          document.head.append(script);
        }).catch((error) => {
          spreadsheetLoader = null;
          throw error;
        });
      return spreadsheetLoader;
    }
    async function importWechatBytes(bytes, type, fileName = "") {
      if (!current || current.role === "viewer")
        throw Error("请选择可记账的账本");
      const id = current.id;
      let parsed;
      const pdfHeader =
        typeof bytes === "string"
          ? bytes.slice(0, 5)
          : String.fromCharCode(...new Uint8Array(bytes).slice(0, 5));
      if (pdfHeader === "%PDF-")
        parsed = await root.AssetTrackerBankImport.read(bytes, fileName);
      if (!parsed) {
        await ensureSpreadsheetParser();
        const { workbook } = root.AssetTrackerPaymentFile.read(
          bytes,
          root.XLSX,
          {
            type,
          },
        );
        const grids = workbook.SheetNames.map((name) =>
          root.XLSX.utils.sheet_to_json(workbook.Sheets[name], {
            header: 1,
            raw: true,
            defval: "",
            blankrows: true,
          }),
        );
        const provider = [
          root.AssetTrackerWechatImport,
          root.AssetTrackerAlipayImport,
        ].find((parser) => grids.some((grid) => parser.detect(grid)));
        if (!provider) throw Error("未识别到微信或支付宝原始账单");
        parsed = provider.readWorkbook(workbook, root.XLSX);
      }
      parsed.fileName = fileName;
      const applied = await root.AssetTrackerWechatUI.open({
        parsed,
        getBook: () => {
          if (current?.id !== id) throw Error("当前账本已变化，请重新选择文件");
          return current.book;
        },
        onCommit: async (candidate) => {
          await commit(candidate);
        },
      });
      if (!applied && pending)
        throw Error("账单导入的保存结果未确认，请点击重试未确认操作。");
      if (!applied) notify("已取消账单导入，账本未修改。");
    }
    async function importBook(text) {
      const validation = root.AssetTrackerLegacySafety.validateBookText(text);
      if (validation.status !== "valid") throw Error("JSON 未通过完整账本校验");
      const book = validation.payload;
      if (
        !confirm(
          `将文件里的 ${book.transactions.length} 笔账单和全部账户、设置上传到 ${base}，创建新的个人私有账本？`,
        )
      )
        return;
      await createLedger({ name: "导入的私有账本", kind: "personal", book });
    }
    async function commit(book, restore) {
      if (pending)
        throw Error("请先重试上一笔未确认操作，确认结果后再记录新账");
      pending = {
        route: "ledgers/" + current.id + (restore ? "/restore" : ""),
        method: restore ? "POST" : "PUT",
        body: {
          revision: current.revision,
          operationId: C.id(),
          ...(restore ? { targetRevision: restore } : { book }),
        },
      };
      await retry();
    }
    async function retry() {
      if (!pending) return;
      const op = pending;
      try {
        const result = await request(op.route, {
          method: op.method,
          body: op.body,
        });
        pending = null;
        editId = null;
        drafts.delete(result.id);
        current = null;
        await load(result.id);
        notify("已安全保存到 NAS · 版本 " + result.revision);
      } catch (e) {
        if (e.status && e.status !== 401) pending = null;
        throw e;
      }
    }
    function retryButton() {
      return pending ? button("retry", "重试未确认操作") : "";
    }
    function render() {
      if (!token) {
        view.innerHTML = `<div class="nas-intro"><p class="eyebrow">个人 · 共同 · 家庭</p><h3>一本账，按你的边界共享</h3><p>个人账本默认只有自己可见。共同和家庭账本通过邀请加入，已有本地账目不会自动上传。</p></div><div class="nas-auth card"><div class="nas-actions">${button("login-mode", "登录")}${button("join-mode", "凭邀请加入")}${button("setup-mode", "首次初始化")}</div>
 <form data-nas-form="auth">${standalone ? '<p class="helper-text">已从 NAS 打开，无需填写服务地址。请使用记账服务的账户登录。</p>' : `<label>NAS 记账服务地址<input name="endpoint" type="url" value="${h(base)}" required placeholder="https://book.example.com" autocomplete="url"></label><p class="helper-text">填写部署后的记账服务地址，不是绿联管理后台或 UGREENlink 地址。</p>`}
 ${mode === "setup" ? '<label>初始化口令<input name="bootstrapToken" type="password" required autocomplete="off"></label>' : ""}${mode === "join" ? '<label>邀请口令<input name="code" required autocomplete="off"></label>' : ""}
 <label>用户名<input name="username" required minlength="3" maxlength="64" pattern="[A-Za-z0-9_.-]+" autocomplete="username"></label><label>密码<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="${mode === "login" ? "current-password" : "new-password"}"></label><p class="helper-text">这是记账服务的独立账户，不使用绿联管理员密码。用户名为英文/数字，密码至少 12 位。</p><button class="btn btn-primary" type="submit">${mode === "setup" ? "创建第一个账户" : mode === "join" ? "注册并加入" : "连接并登录"}</button></form></div>`;
        return;
      }
      view.innerHTML = `<div class="nas-top"><div><h3>NAS 协作空间</h3><p class="helper-text">${h(me?.username)} · ${h(base)} · 在线保存 · ${ledgers.length} 本账</p></div><div class="nas-actions">${button("refresh", "刷新账本")}${button("import-json", "导入 JSON 为新私有账本")}${root.assetTracker ? button("upload-local", "复制本地账本") : ""}<input type="file" data-nas-import accept=".json" hidden aria-label="导入 NAS 私有账本">${retryButton()}${button("logout", "退出登录")}</div></div>
 ${current ? `<nav class="nas-jump" aria-label="账本快捷跳转">${current.role !== "viewer" ? '<a class="btn btn-secondary" href="#nas-entry">记一笔</a>' : ""}<a class="btn btn-secondary" href="#nas-history">看账单</a><a class="btn btn-secondary" href="#nas-household">家庭汇总</a></nav>` : ""}<div class="nas-workspace"><aside class="nas-ledgers" aria-label="NAS 账本">${ledgers.map((l) => button("open", `${h(l.name)}<small>${kind[l.kind]} · ${roles[l.role]}</small>`, `data-id="${h(l.id)}" class-extra="" aria-pressed="${current?.id === l.id}"`)).join("") || '<p class="helper-text">还没有账本，先创建一本。</p>'}<details class="card"><summary>新建账本</summary><form data-nas-form="create"><label>名称<input name="name" required maxlength="120"></label><label>归属<select name="kind"><option value="personal">个人私有</option><option value="shared">共同账本</option><option value="family">家庭账本</option></select></label><button type="submit" class="btn btn-primary">创建账本</button></form></details><details class="card"><summary>接受邀请</summary><form data-nas-form="accept"><label>邀请口令<input name="code" required></label><button type="submit" class="btn btn-primary">加入账本</button></form></details></aside>
 <div class="nas-detail">${current ? detail() : `<div class="card nas-empty"><h3>从一本个人账开始</h3><p>创建个人、共同或家庭账本。这里的账本存储在你连接的 NAS 上。</p>${root.assetTracker ? button("upload-local", "将本地账本复制为新的私有账本") : ""}</div>`}</div></div>${household()}`;
    }
    function household() {
      const totals = M.household(ledgers, [...selected]);
      return `<section id="nas-household" class="card nas-household"><h3>家庭汇总</h3><p class="helper-text">仅合并你勾选的共同/家庭账本；个人私有账本不参与。按原币汇总全部日期的收入和支出，内部转账排除；不是净资产，也不代表 AA 应付款。</p><div class="nas-actions">${
        ledgers
          .filter((l) => l.kind !== "personal")
          .map(
            (l) =>
              `<label class="nas-choice"><input type="checkbox" data-nas-summary="${h(l.id)}" ${selected.has(l.id) ? "checked" : ""}>${h(l.name)}</label>`,
          )
          .join("") ||
        '<p class="helper-text">创建共同或家庭账本后，可在这里选择汇总范围。</p>'
      }</div><div class="nas-summary-output">${totalsHTML(totals)}</div></section>`;
    }
    function totalsHTML(totals) {
      return (
        Object.entries(totals)
          .map(
            ([c, t]) =>
              `<div class="nas-currency"><strong>${h(c)}</strong><span>收入 ${money(t.income)}</span><span>支出 ${money(t.expense)}</span><span>结余 ${money(t.income - t.expense)}</span><small>${t.count} 笔</small></div>`,
          )
          .join("") ||
        '<p class="empty-state">选择账本后显示汇总；空账本尚无收支。</p>'
      );
    }
    function detail() {
      const c = current,
        b = c.book,
        editable = c.role !== "viewer",
        accounts = I.accounts(b);
      const opts = accounts
        .map(
          (a) =>
            `<option value="${h(a.node.id)}">${h(a.path.join(" / "))} · ${h(a.node.currency)}</option>`,
        )
        .join("");
      const today = new Date();
      const day = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0"),
      ].join("-");
      const projectOpts = (b.expenseProjects || [])
        .filter((p) => !p.archived)
        .map((p) => `<option value="${h(p.id)}">${h(p.name)}</option>`)
        .join("");
      return `<section class="card"><div class="nas-top"><div><p class="eyebrow">${kind[c.kind]} · ${roles[c.role]} · 版本 ${c.revision}</p><h3>${h(c.name)}</h3></div>${editable ? button("import-wechat", "导入微信 / 支付宝 / 银行") : ""}${button("import-audit", "导入核对记录")}${button("export", "导出完整 JSON")}<input type="file" data-nas-wechat-file accept=".xlsx,.csv,.pdf" hidden aria-label="选择支付平台或银行账单"></div><div class="nas-account-balances">${accounts.map((a) => `<div><span>${h(a.path.join(" / "))}</span><strong>${money(a.node.balance)} <small>${h(a.node.currency)}</small></strong></div>`).join("")}</div>${editable ? `<details><summary>添加资金账户</summary><form data-nas-form="account" class="nas-form-grid"><label>账户名称<input name="name" required maxlength="120"></label><label>币种<select name="currency">${["CNY", "USD", "SGD", "MYR", "HKD", "EUR", "JPY", "GBP"].map((x) => `<option>${x}</option>`).join("")}</select></label><button class="btn btn-secondary" type="submit">添加账户</button></form></details>` : ""}</section>
 ${editable ? `<section id="nas-entry" class="card"><h3>记一笔</h3><form data-nas-form="entry" class="nas-form-grid"><label>收支<select name="direction"><option value="expense">支出</option><option value="income">收入</option></select></label><label>金额<input name="amount" type="number" min="0.01" max="1000000000000" step="0.01" required inputmode="decimal" placeholder="0.00"></label><label>资金账户<select name="accountId" required>${opts}</select></label><label>日期<input name="date" type="date" value="${day}" required></label><label>项目<select name="projectId"><option value="">日常账单</option>${projectOpts}</select></label><label>消费分类<select name="expenseCategoryId"><option value="">未分类</option></select></label><label class="nas-wide">备注<input name="description" maxlength="2000" placeholder="这笔钱用在哪里"></label><button type="submit" class="btn btn-primary nas-wide">保存到 NAS</button>${button("cancel-edit", "取消修改并记新账", "hidden")}</form><details><summary>账户之间转账</summary><p class="helper-text">支持同币种、非负债账户之间转账。两笔账户变动在同一版本保存，不计入家庭收支。</p><form data-nas-form="transfer" class="nas-form-grid"><label>转出<select name="from">${opts}</select></label><label>转入<select name="to">${opts}</select></label><label>金额<input name="amount" type="number" min="0.01" step="0.01" required></label><label>日期<input name="date" type="date" value="${day}" required></label><button type="submit" class="btn btn-primary">确认转账</button></form></details></section>` : '<p class="helper-text">你拥有只读权限，可查看和导出账本。</p>'}
 <section id="nas-history" class="card"><div class="nas-top"><h3>账单记录</h3><label>搜索备注或账户<input type="search" data-nas-search value="${h(search)}" placeholder="搜索当前账本"></label></div><div class="nas-records">${records()}</div></section>
 <details class="card"><summary>成员与共享（${members.length} 人）</summary><div class="nas-member-list">${members.map((m) => `<div><span>${h(m.username)} · ${roles[m.role]}</span>${c.role === "owner" && m.role !== "owner" ? button("remove-member", "移除", `data-id="${h(m.id)}"`) : ""}</div>`).join("")}</div>${c.role === "owner" && c.kind !== "personal" ? `<form data-nas-form="invite" class="nas-form-grid"><label>邀请权限<select name="role"><option value="editor">可记账</option><option value="viewer">只读</option></select></label><button type="submit" class="btn btn-secondary">生成 24 小时邀请</button></form><p class="helper-text">口令只能使用一次。仅把它交给你希望共享这本账的人。</p><output class="nas-invite-code"></output>` : '<p class="helper-text">个人账本不能共享；只有账本拥有者可以邀请或移除成员。</p>'}</details>
 <details class="card"><summary>版本与恢复</summary><p class="helper-text">保留保存者和版本。恢复会产生新版本，已有历史保留。这里显示最近 100 个版本。</p><div class="nas-version-list">${versions.map((v) => `<div><span>v${v.revision} · ${h(v.username)} · ${h(new Date(v.created).toLocaleString())}</span>${editable && v.revision !== c.revision ? button("restore", "恢复", `data-revision="${v.revision}"`) : ""}</div>`).join("")}</div></details>`;
    }
    function records() {
      let rows = current.book.transactions
        .filter(
          (t) =>
            !search ||
            [t.description, t.category, t.subcategory, t.currency].some((v) =>
              String(v || "")
                .toLowerCase()
                .includes(search.toLowerCase()),
            ),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      const pages = Math.max(1, Math.ceil(rows.length / 50));
      page = Math.min(page, pages - 1);
      return `<div class="nas-record-list">${
        rows
          .slice(page * 50, (page + 1) * 50)
          .map(
            (t) =>
              `<article><div><strong>${h(t.description || t.purpose || "未填写备注")}</strong><small>${h(t.date)} · ${h(t.category)}${t.subcategory ? " / " + h(t.subcategory) : ""}${t.transferId ? " · 内部转账" : ""}</small></div><strong class="${t.amount < 0 ? "negative" : "positive"}">${money(t.amount)} <small>${h(t.currency)}</small></strong>${current.role !== "viewer" ? `<div class="nas-row-actions">${!t.transferId ? button("edit", "编辑", `data-id="${h(t.id)}"`) : ""}${button("remove", "删除", `data-id="${h(t.id)}"`)}</div>` : ""}</article>`,
          )
          .join("") || '<p class="empty-state">暂无符合条件的账单。</p>'
      }</div><div class="nas-top"><small>共 ${rows.length} 笔 · 第 ${page + 1}/${pages} 页</small><div class="nas-actions">${button("prev", "上一页", page === 0 ? "disabled" : "")}${button("next", "下一页", page === pages - 1 ? "disabled" : "")}</div></div>`;
    }
    async function action(fn) {
      if (busy) return;
      busy = true;
      node.setAttribute("aria-busy", "true");
      notify("正在处理…");
      try {
        await fn();
      } catch (e) {
        notify(e.message, true);
        if (e.status === 401 && me) {
          const auth = document.createElement("form");
          auth.dataset.nasReauth = "";
          auth.innerHTML = `<label>会话已过期，为 ${h(me.username)} 重新登录<input name="password" type="password" minlength="12" required autocomplete="current-password"></label><button class="btn btn-primary" type="submit">登录并重试未确认保存</button>`;
          status.append(auth);
        }
        if (pending && !view.querySelector('[data-nas-action="retry"]')) {
          const box = document.createElement("div");
          box.className = "nas-actions";
          box.innerHTML = retryButton();
          status.append(box);
        }
      } finally {
        busy = false;
        node.removeAttribute("aria-busy");
      }
    }
    node.addEventListener("submit", (event) => {
      if (!event.target.matches("[data-nas-reauth]")) return;
      event.preventDefault();
      const password = event.target.elements.password.value;
      action(async () => {
        const auth = await request("login", {
          method: "POST",
          body: { username: me.username, password },
        });
        token = auth.token;
        if (pending) await retry();
        else notify("已重新登录，未提交的输入保留。");
      });
    });
    view.addEventListener("submit", (event) => {
      const form = event.target.closest("form[data-nas-form]");
      if (!form) return;
      event.preventDefault();
      const data = fields(form);
      action(async () => {
        const f = form.dataset.nasForm;
        if (f === "auth") {
          await connectionReady;
          if (connectionFailure) throw connectionFailure;
          base = endpoint(standalone ? location.origin : data.endpoint);
          const r = await request(
            mode === "setup" ? "setup" : mode === "join" ? "join" : "login",
            { method: "POST", body: data },
          );
          token = r.token;
          me = await request("me");
          await load();
          notify("已连接 NAS。个人账本默认私有。");
          return;
        }
        if (f === "create") {
          await createLedger(data);
          return;
        }
        if (f === "accept") {
          const r = await request("invites/accept", {
            method: "POST",
            body: data,
          });
          await load(r.id);
          notify("已加入账本。");
          return;
        }
        if (f === "entry")
          return commit(
            editId
              ? M.edit(current.book, editId, data)
              : M.entry(current.book, data),
          );
        if (f === "transfer") return commit(M.transfer(current.book, data));
        if (f === "account") return commit(M.account(current.book, data));
        if (f === "invite") {
          const r = await request("ledgers/" + current.id + "/invites", {
            method: "POST",
            body: data,
          });
          view.querySelector(".nas-invite-code").textContent = r.code;
          notify("邀请已生成，有效期 24 小时；请自行发送给指定成员。");
        }
      });
    });
    node.addEventListener("click", (event) => {
      const b = event.target.closest("[data-nas-action]");
      if (!b) return;
      const a = b.dataset.nasAction;
      if (busy) return;
      if (a.endsWith("-mode")) {
        mode = a.split("-")[0];
        render();
        notify("");
        return;
      }
      action(async () => {
        if (a === "open") {
          page = 0;
          search = "";
          await load(b.dataset.id);
          notify("已打开 " + current.name);
        }
        if (a === "refresh") {
          await load(current?.id, true);
          notify("已读取最新版本，尚未提交的输入保留。");
        }
        if (a === "retry") {
          await retry();
        }
        if (a === "logout") {
          if (
            pending &&
            !confirm(
              "仍有结果未知的保存。退出将丢弃本机的重试信息，请先确认 NAS 中是否已记录。仍退出？",
            )
          )
            return;
          let revoked = false;
          try {
            await request("logout", { method: "POST", body: {} });
            revoked = true;
          } catch (e) {
            if (e.status === 401) revoked = true;
          }
          token = "";
          me = null;
          current = null;
          ledgers = [];
          pending = null;
          selected.clear();
          drafts.clear();
          render();
          notify(
            revoked
              ? "已退出，会话已撤销。"
              : "本机已退出；网络不可用，服务端会话撤销未确认，最多 12 小时后过期。",
            !revoked,
          );
        }
        if (a === "import-audit") {
          const ledgerId = current?.id;
          root.AssetTrackerImportAuditUI.open({
            getBook: () => {
              if (current?.id !== ledgerId) throw Error("账本已变化");
              return current.book;
            },
            onCommit: async next => {try{await commit(next);}catch(e){render();throw e;}},
            readOnly: current?.role === "viewer",
          });
        }
        if (a === "import-wechat") {
          if (pending) throw Error("请先重试上一笔未确认操作");
          if (root.assetTracker) {
            const result = await root.assetTracker.fileAdapter.openImport({
              acceptedTypes: ".xlsx,.csv,.pdf",
              fileInputId: "import-file",
              readAs: "binary",
            });
            if (result) {
              if (result.text.length > 16 * 1024 * 1024)
                throw Error("文件不能超过12MB");
              await importWechatBytes(
                root.assetTracker.fileAdapter.normalizeImportedContent(
                  result.text,
                  result.encoding || "binary",
                  { output: "binary" },
                ),
                "binary",
                result.fileName || "",
              );
            }
          } else view.querySelector("[data-nas-wechat-file]").click();
        }
        if (a === "import-json") {
          if (root.assetTracker) {
            const result = await root.assetTracker.fileAdapter.openImport({
              acceptedTypes: ".json",
              fileInputId: "import-book-file",
              readAs: "text",
            });
            if (result) {
              if (result.text.length > 12 * 1024 * 1024)
                throw Error("文件不能超过 12 MB");
              await importBook(
                root.assetTracker.fileAdapter.normalizeImportedContent(
                  result.text,
                  result.encoding || "text",
                  { output: "text" },
                ),
              );
            }
          } else view.querySelector("[data-nas-import]").click();
        }
        if (a === "cancel-edit") {
          editId = null;
          const form = view.querySelector('[data-nas-form="entry"]');
          form.reset();
          form.querySelector('[type="submit"]').textContent = "保存到 NAS";
          b.hidden = true;
          notify("已取消修改，账本没有变化。");
        }
        if (a === "edit") {
          const t = current.book.transactions.find(
            (t) => t.id === b.dataset.id,
          );
          if (t.transferId) throw Error("转账请整组删除后重新记录");
          const form = view.querySelector('[data-nas-form="entry"]');
          editId = t.id;
          const draft = {
            ...t,
            direction: t.amount < 0 ? "expense" : "income",
            amount: String(Math.abs(t.amount)),
            date: t.date.slice(0, 10),
            projectId: t.projectId || "",
            expenseCategoryId: t.expenseCategoryId || "",
          };
          restoreDraft([{ type: "entry", values: draft }]);
          form.querySelector('[type="submit"]').textContent = "保存修改";
          form.querySelector('[data-nas-action="cancel-edit"]').hidden = false;
          form.elements.amount.focus();
          notify("正在编辑记录。刷新保留输入，保存后形成新版本。");
        }
        if (
          a === "remove" &&
          confirm(
            "删除这条记录并回退对应账户金额？内部转账会成对删除；可从版本历史恢复。",
          )
        )
          await commit(M.remove(current.book, b.dataset.id));
        if (a === "prev" || a === "next") {
          page += a === "prev" ? -1 : 1;
          view.querySelector(".nas-records").innerHTML = records();
          notify("");
        }
        if (a === "export") {
          const payload = {
            format: "qiushan.asset-book",
            formatVersion: 1,
            schemaVersion: 1,
            domainCapabilityVersion: 1,
            minimumReaderVersion: 1,
            exportedAt: new Date().toISOString(),
            payload: current.book,
          };
          const text = JSON.stringify(payload, null, 2);
          if (root.assetTracker)
            await root.assetTracker.fileAdapter.saveFile({
              suggestedName: "NAS账本备份.json",
              mimeType: "application/json",
              text,
            });
          else {
            const url = URL.createObjectURL(
                new Blob([text], { type: "application/json" }),
              ),
              link = document.createElement("a");
            link.href = url;
            link.download = "NAS账本备份.json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          notify("备份导出已发起，请确认文件已保存。");
        }
        if (
          a === "remove-member" &&
          confirm("移除该成员后，其将无法再读取或修改这本账。继续？")
        ) {
          await request(`ledgers/${current.id}/members/${b.dataset.id}`, {
            method: "DELETE",
          });
          await load();
          notify("成员已移除。");
        }
        if (
          a === "restore" &&
          confirm(
            "将当前账本恢复到该版本？现有版本会保留，恢复形成一个新版本。",
          )
        )
          await commit(null, Number(b.dataset.revision));
        if (a === "upload-local") {
          const local = root.assetTracker?.data;
          if (!local) throw Error("本地账本尚未打开");
          if (
            !confirm(
              `把本地 ${local.transactions.length} 笔账单及全部账户、项目、规则复制到 ${base} 的新私有账本？本地账本保持原样。`,
            )
          )
            return;
          await createLedger({
            name: "本地账本副本",
            kind: "personal",
            book: local,
          });
          notify("已复制到新的私有账本。");
        }
      });
    });
    view.addEventListener("change", (event) => {
      if (event.target.matches("[data-nas-wechat-file]")) {
        const file = event.target.files[0];
        event.target.value = "";
        if (file)
          action(async () => {
            if (file.size > 12 * 1024 * 1024) throw Error("文件不能超过12MB");
            await importWechatBytes(
              await file.arrayBuffer(),
              "array",
              file.name,
            );
          });
        return;
      }

      if (event.target.matches("[data-nas-import]")) {
        const file = event.target.files[0];
        if (file)
          action(async () => {
            if (file.size > 12 * 1024 * 1024) throw Error("文件不能超过 12 MB");
            await importBook(await file.text());
          });
        event.target.value = "";
      }

      if (event.target.matches("[data-nas-summary]")) {
        if (event.target.checked) selected.add(event.target.dataset.nasSummary);
        else selected.delete(event.target.dataset.nasSummary);
        view.querySelector(".nas-summary-output").innerHTML = totalsHTML(
          M.household(ledgers, [...selected]),
        );
      }
      if (event.target.name === "projectId") {
        const p = current.book.expenseProjects.find(
            (p) => p.id === event.target.value,
          ),
          select = event.target.form.elements.expenseCategoryId;
        select.innerHTML =
          '<option value="">未分类</option>' +
          (p?.categories || [])
            .map(
              (c) =>
                `<option value="${h(c.id)}">${h(
                  root.AssetTrackerProjects.chain(p, c.id)
                    .map((n) => n.name)
                    .join(" / "),
                )}</option>`,
            )
            .join("");
      }
    });
    let searchTimer;
    view.addEventListener("input", (event) => {
      if (event.target.matches("[data-nas-search]")) {
        search = event.target.value;
        page = 0;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          view.querySelector(".nas-records").innerHTML = records();
        }, 150);
      }
    });
    render();
    if (standalone)
      connectionReady = request("status")
        .then((info) => {
          configuredLANOrigin = info.lanOrigin || "";
          const note = node.querySelector(".nas-connection-note");
          note.textContent =
            configuredLANOrigin === location.origin
              ? "当前为 NAS 局域网 HTTP 连接，只在可信网络使用；它不是 HTTPS 加密连接。"
              : "";
          if (!info.initialized) {
            const form = view.querySelector('[data-nas-form="auth"]');
            if (
              form &&
              !form.elements.username.value &&
              !form.elements.password.value
            ) {
              mode = "setup";
              render();
            }
          }
        })
        .catch((error) => {
          connectionFailure = error;
          notify("无法确认 NAS 的访问配置，请刷新后重试。", true);
        });
  }
  root.AssetTrackerNASUI = { mount };
  document.addEventListener("DOMContentLoaded", () =>
    document.querySelectorAll("[data-nas-root]").forEach(mount),
  );
})(globalThis);
