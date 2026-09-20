(function (root) {
  "use strict";
  const W = root.AssetTrackerWechatImport,
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
  let opened = false;
  function open({ parsed, getBook, onCommit }) {
    if (opened)
      return Promise.reject(Error("已有账单导入预览，请先完成或取消"));
    opened = true;
    const providerName =
      { wechat: "微信", alipay: "支付宝", icbc: "工商银行", ocbc: "OCBC" }[
        parsed.provider
      ] || "微信";
    return new Promise((resolve, reject) => {
      const trigger = document.activeElement,
        dialog = document.createElement("dialog");
      dialog.className = "wechat-dialog";
      dialog.setAttribute("aria-label", providerName + "账单导入预览");
      const mapping = Object.create(null),
        selectedReviewIds = new Set();
      let reviewPage = 0;
      let plan,
        pending = false;
      const accounts = I.accounts(getBook());
      const optionsFor = (currency) =>
        '<option value="">请选择对应账户</option>' +
        accounts
          .filter(
            (a) =>
              (a.node.currency || getBook().settings.baseCurrency) === currency,
          )
          .map(
            (a) =>
              `<option value="${h(a.node.id)}">${h(a.path.join(" / "))}${a.node.isDebt ? " · 负债账户" : ""}</option>`,
          )
          .join("");
      dialog.innerHTML = `<div class="wechat-title"><h3>${providerName}账单导入预览</h3><button type="button" class="btn btn-secondary" data-wechat-cancel>取消</button></div><p class="helper-text">已识别 ${parsed.total} 笔${providerName}记录。文件仅在本机解析，确认后才写入当前账本。</p>
   <h4>确认资金账户</h4><p class="helper-text">支付方式表示钱从哪里收付，与消费分类分开。不会自动新建或合并你的账户。</p>
   <div class="wechat-mappings">${parsed.methods.map((m, i) => `<label>${h(m.name === "/" ? "未注明支付方式（/）" : m.name)} · ${m.count} 笔<select data-wechat-method="${i}" aria-label="${h(m.name)}对应账户">${optionsFor(m.currency || "CNY")}</select></label>`).join("")}</div>
   ${!accounts.length ? '<p class="negative">当前没有资金账户。请先添加账户，再选择此文件。</p>' : ""}
   <label class="wechat-mode">导入方式<select data-wechat-mode><option value="history">补充历史流水，不改当前余额（推荐）</option><option value="apply">新增流水，同时调整对应账户余额</option></select></label>
   <p class="helper-text">如果账户余额已经是最新值，请保留历史流水模式。退款按原支出和实际退款收入分别记录，不把“已退款”状态直接改成净额。</p>
   <div class="wechat-results"></div>
   <label class="wechat-review-choice" hidden><input type="checkbox" data-wechat-review>我已逐页核对，全选需复核记录</label>
   <div class="wechat-review-list"></div>
   <p class="wechat-feedback" role="status" aria-live="polite"></p><div class="wechat-actions"><button type="button" class="btn btn-secondary" data-wechat-cancel>取消</button><button type="button" class="btn btn-primary" data-wechat-confirm>确认导入</button></div>`;
      const feedback = dialog.querySelector(".wechat-feedback"),
        confirm = dialog.querySelector("[data-wechat-confirm]"),
        include = dialog.querySelector("[data-wechat-review]");
      function count() {
        const n = plan.accepted.length + selectedReviewIds.size;
        confirm.textContent = n
          ? `确认导入 ${n} 笔并保存核对记录`
          : "保存核对记录";
        confirm.disabled = pending || plan.errors.length > 0;
        include.checked =
          plan.review.length > 0 &&
          selectedReviewIds.size === plan.review.length;
        include.indeterminate = selectedReviewIds.size > 0 && !include.checked;
        const title = dialog.querySelector(".wechat-review-list h4");
        if (title)
          title.textContent = `逐笔复核（已选 ${selectedReviewIds.size} / ${plan.review.length}）`;
      }
      function renderReviews() {
        const pages = Math.max(1, Math.ceil(plan.review.length / 30));
        reviewPage = Math.max(0, Math.min(reviewPage, pages - 1));
        dialog.querySelector(".wechat-review-list").innerHTML = plan.review
          .length
          ? `<h4>逐笔复核（已选 ${selectedReviewIds.size} / ${plan.review.length}）</h4><p class="helper-text">勾选后导入；未勾选的记录保存为待核对，可稍后在“导入核对记录”继续处理。</p><div class="wechat-review-rows">${plan.review
              .slice(reviewPage * 30, (reviewPage + 1) * 30)
              .map(
                (item) =>
                  `<label><input type="checkbox" data-wechat-review-id="${h(item.transaction.id)}" ${selectedReviewIds.has(item.transaction.id) ? "checked" : ""}><span>第 ${item.row} 行 · ${item.transaction.amount.toFixed(2)} ${h(item.transaction.currency)} · ${h(item.transaction.description)}<small>${h(item.reason)}</small></span></label>`,
              )
              .join(
                "",
              )}</div><div class="wechat-review-pages"><button type="button" class="btn btn-secondary" data-wechat-review-page="-1" ${reviewPage === 0 ? "disabled" : ""}>上一页</button><span>${reviewPage + 1} / ${pages}</span><button type="button" class="btn btn-secondary" data-wechat-review-page="1" ${reviewPage === pages - 1 ? "disabled" : ""}>下一页</button></div>`
          : "";
        include.checked =
          plan.review.length > 0 &&
          selectedReviewIds.size === plan.review.length;
        include.indeterminate = selectedReviewIds.size > 0 && !include.checked;
      }
      function render() {
        plan = W.prepare(getBook(), parsed, mapping);
        const mappingErrors = plan.errors.filter(
          (e) => e.code === "account-mapping",
        );
        const skipGroups = new Map();
        for (const item of plan.skipped)
          skipGroups.set(item.reason, (skipGroups.get(item.reason) || 0) + 1);
        const fileErrors = plan.errors.filter(
          (e) => e.code !== "account-mapping",
        );
        dialog.querySelector(".wechat-results").innerHTML =
          `<div class="wechat-counts"><span>可新增 <strong>${plan.accepted.length}</strong></span><span>已存在 <strong>${plan.duplicates.length}</strong></span><span>需复核 <strong>${plan.review.length}</strong></span><span>已跳过 <strong>${plan.skipped.length}</strong></span><span>待对应支付方式 <strong>${new Set(mappingErrors.map((e) => e.method)).size}</strong></span><span>文件错误 <strong>${fileErrors.length}</strong></span></div>
   <div class="wechat-records">${mappingErrors.length ? "<p>请先完成上方的资金账户对应，然后查看可导入明细。</p>" : ""}${fileErrors
     .slice(0, 20)
     .map((e) => `<p class="negative">第 ${e.row} 行：${h(e.message)}</p>`)
     .join("")}${plan.review
     .slice(0, 20)
     .map((e) => `<p>第 ${e.row} 行需复核：${h(e.reason)}</p>`)
     .join("")}${[...plan.accepted, ...plan.review]
     .slice(0, 30)
     .map(
       ({ row, transaction: t }) =>
         `<article><span>第 ${row} 行 · ${h(t.date.replace("T", " "))} · ${h(t.category)}${t.subcategory ? " / " + h(t.subcategory) : ""}</span><strong>${t.amount.toFixed(2)} ${h(t.currency)}</strong><small>${h(t.description)}</small></article>`,
     )
     .join("")}${[...skipGroups]
     .map(([reason, count]) => `<p>已跳过 ${count} 笔：${h(reason)}</p>`)
     .join("")}${plan.warnings
     .slice(0, 15)
     .map((e) => `<p>第 ${e.row} 行：${h(e.message)}</p>`)
     .join(
       "",
     )}</div><p class="helper-text">预览最多展示 30 笔记录；相同来源标识识别明确重复；银行使用账户、日期、原币金额、余额与摘要生成标识。同日同额仅提示疑似重复，由你核对。分析及处理结果会随完整 JSON 保存。</p>`;
        dialog.querySelector(".wechat-review-choice").hidden =
          !plan.review.length;
        feedback.textContent = "";
        renderReviews();
        count();
      }
      function finish(value) {
        if (pending) return;
        opened = false;
        dialog.close?.();
        dialog.remove();
        trigger?.focus?.();
        resolve(value);
      }
      dialog.addEventListener("change", (event) => {
        if (event.target.matches("[data-wechat-method]")) {
          const method =
            parsed.methods[Number(event.target.dataset.wechatMethod)].name;
          mapping[method] = event.target.value;
          include.checked = false;
          selectedReviewIds.clear();
          reviewPage = 0;
          render();
        } else if (event.target.matches("[data-wechat-review-id]")) {
          const id = event.target.dataset.wechatReviewId;
          if (event.target.checked) selectedReviewIds.add(id);
          else selectedReviewIds.delete(id);
          count();
        } else if (event.target === include) {
          selectedReviewIds.clear();
          if (include.checked)
            for (const item of plan.review)
              selectedReviewIds.add(item.transaction.id);
          dialog
            .querySelectorAll("[data-wechat-review-id]")
            .forEach(
              (el) =>
                (el.checked = selectedReviewIds.has(el.dataset.wechatReviewId)),
            );
          count();
        } else count();
      });
      dialog.addEventListener("click", (event) => {
        const button = event.target.closest("[data-wechat-review-page]");
        if (button && !pending) {
          reviewPage += Number(button.dataset.wechatReviewPage);
          renderReviews();
        }
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog
        .querySelectorAll("[data-wechat-cancel]")
        .forEach((b) => (b.onclick = () => finish(false)));
      confirm.onclick = async () => {
        if (pending || confirm.disabled) return;
        try {
          const candidate = W.apply(getBook(), plan, {
            reviewIds: [...selectedReviewIds],
            adjustBalances:
              dialog.querySelector("[data-wechat-mode]").value === "apply",
          });
          pending = true;
          dialog
            .querySelectorAll("button,input,select")
            .forEach((el) => (el.disabled = true));
          feedback.textContent = "正在安全保存，请稍候…";
          await onCommit(candidate);
          pending = false;
          finish(true);
        } catch (error) {
          pending = false;
          dialog
            .querySelectorAll("button,input,select")
            .forEach((el) => (el.disabled = false));
          feedback.textContent =
            error?.message || "保存失败，输入已保留，请重试";
          count();
        }
      };
      document.body.append(dialog);
      try {
        render();
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        dialog.querySelector("select")?.focus();
      } catch (e) {
        opened = false;
        dialog.remove();
        reject(e);
      }
    });
  }
  root.AssetTrackerWechatUI = { open };
})(globalThis);
