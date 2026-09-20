(function (root) {
  "use strict";
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
  function open({ getBook, onCommit, readOnly = false }) {
    const dialog = document.createElement("dialog"),
      trigger = document.activeElement;
    dialog.className = "wechat-dialog import-audit-dialog";
    dialog.setAttribute("aria-label", "导入核对记录");
    let pending = false,
      selected = "",
      page = 0,
      onlyPending = false;
    const label = {
      pending: "待核对",
      imported: "已导入",
      excluded: "手动排除",
      duplicate: "明确重复",
      skipped: "规则跳过",
    };
    function render() {
      const audits = getBook().importAudits || [],
        a = audits.find((a) => a.id === selected) || audits.at(-1);
      selected = a?.id || "";
      const allRows = a?.items || [],
        rows = allRows
          .map((item, index) => ({ ...item, index }))
          .filter((item) => !onlyPending || item.decision === "pending");
      page = Math.min(page, Math.max(0, Math.ceil(rows.length / 30) - 1));
      dialog.innerHTML = `<div class="wechat-title"><h3>导入核对记录</h3><button data-close class="btn btn-secondary">关闭</button></div><p class="helper-text">分析依据、原始候选记录与处理结果随账本保存，并包含在完整 JSON 备份中。排除只处理候选记录，不删除已有账目。</p><label>导入批次<select data-batch>${audits.map((a) => `<option value="${h(a.id)}" ${a.id === selected ? "selected" : ""}>${h(new Date(a.createdAt).toLocaleString("zh-CN",{hour12:false}))} · ${h(a.fileName || a.provider)} · ${a.items.filter((i) => i.decision === "pending").length} 待核对</option>`).join("")}</select></label>${
        !a
          ? "<p>暂无导入核对记录。</p>"
          : `<label class="audit-filter"><input type="checkbox" data-pending ${onlyPending ? "checked" : ""}>只看待核对</label><p>本批 ${allRows.length} 笔 · ${a.status === "pending" ? "待核对" : "已完成"} · ${a.adjustBalances ? "保留时调整余额" : "仅补历史，不调整余额"}</p><div class="wechat-review-rows">${rows
              .slice(page * 30, (page + 1) * 30)
              .map((item, j) => {
                const t = item.candidate || item.record;
                return `<article><strong>${h(label[item.decision])} · 第 ${item.row} 行</strong>${t ? `<p>${h(t.date)} · ${h(t.amount)} ${h(t.currency)} · ${h(t.description)}</p>` : ""}<p>${h(item.reason || "来源标识及原始财务信息已核对")}</p>${item.matches.map((m) => `<p class="helper-text">匹配记录：${h(m.date || "")} · ${h(m.amount ?? "")} ${h(m.currency || "")} · ${h(m.description || "")}<br>标识：${h(m.id)}</p>`).join("")}${item.decision === "pending" && !readOnly ? `<button class="btn btn-primary" data-decision="include" data-index="${item.index}">确认为独立收支，保留</button> <button class="btn btn-secondary" data-decision="exclude" data-index="${item.index}">重复或内部调拨，排除</button>` : `<small>${h(item.decidedAt ? new Date(item.decidedAt).toLocaleString("zh-CN",{hour12:false}) : "")}</small>`}</article>`;
              })
              .join(
                "",
              )}</div><div class="wechat-review-pages"><button class="btn btn-secondary" data-page="-1" ${page === 0 ? "disabled" : ""}>上一页</button><span>${page + 1} / ${Math.max(1, Math.ceil(rows.length / 30))}</span><button class="btn btn-secondary" data-page="1" ${(page + 1) * 30 >= rows.length ? "disabled" : ""}>下一页</button></div>`
      }<p role="status" aria-live="polite"></p>`;
    }
    function close() {
      if (pending) return;
      dialog.close?.();
      dialog.remove();
      trigger?.focus?.();
    }
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    dialog.addEventListener("change", (e) => {
      if (e.target.matches("[data-pending]")) {
        onlyPending = e.target.checked;
        page = 0;
        render();
      } else if (e.target.matches("[data-batch]")) {
        selected = e.target.value;
        page = 0;
        render();
      }
    });
    dialog.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || pending) return;
      if (b.hasAttribute("data-close")) return close();
      if (b.hasAttribute("data-page")) {
        page += Number(b.dataset.page);
        return render();
      }
      if (b.dataset.decision) {
        try {
          const next = root.AssetTrackerWechatImport.resolveAudit(
            getBook(),
            selected,
            Number(b.dataset.index),
            b.dataset.decision,
          );
          pending = true;
          dialog
            .querySelectorAll("button,select,input")
            .forEach((el) => (el.disabled = true));
          await onCommit(next);
          pending = false;
          render();
        } catch (err) {
          pending = false;
          render();
          dialog.querySelector("[role=status]").textContent =
            err.message || "保存失败，请重试";
        }
      }
    });
    document.body.append(dialog);
    render();
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
  }
  root.AssetTrackerImportAuditUI = { open };
})(globalThis);
