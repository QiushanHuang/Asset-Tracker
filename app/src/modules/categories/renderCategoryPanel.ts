import type { Book } from '../../shared/types/entities';
import { createAssetStateAnchor } from '../../domain/assetStates/createAssetStateAnchor';
import { deleteAssetStateAnchor } from '../../domain/assetStates/deleteAssetStateAnchor';
import { listAssetStateAnchorsForBook } from '../../domain/assetStates/listAssetStateAnchorsForBook';
import { updateAssetStateAnchor } from '../../domain/assetStates/updateAssetStateAnchor';
import { editableAssetStateAmount } from '../../domain/assetStates/normalizeAssetStateAmount';
import { createCategory } from '../../domain/categories/createCategory';
import { deleteCategory } from '../../domain/categories/deleteCategory';
import { listCategoryTree } from '../../domain/categories/listCategoryTree';
import { moveCategory } from '../../domain/categories/moveCategory';
import { updateCategory } from '../../domain/categories/updateCategory';
import { formatIsoForDatetimeLocal, parseDatetimeLocalToIso } from '../../shared/utils/datetimeLocal';
import { balanceToneClass, formatBalanceAmount } from '../../shared/utils/balanceDisplay';
import { escapeHtml } from '../../shared/utils/escapeHtml';
import { AssetTrackerDb } from '../../storage/db';

interface CategoryPanelContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
  onChange?: () => Promise<void>;
  onStatus?: (message: string) => void;
}

function formatLocalTimestamp(isoString: string): string {
  return formatIsoForDatetimeLocal(isoString).replace('T', ' ');
}

export async function renderCategoryPanel({
  db,
  book,
  target,
  onChange,
  onStatus
}: CategoryPanelContext): Promise<void> {
  const [categories, assetStateAnchors] = await Promise.all([
    listCategoryTree(db, book.id),
    listAssetStateAnchorsForBook(db, book.id)
  ]);
  const categoryMap = new Map(categories.map((item) => [item.id, item]));
  const anchorMap = new Map(assetStateAnchors.map((item) => [item.id, item]));
  const leafCategories = categories.filter((item) => item.kind !== 'group');
  const kindLabels: Record<'asset' | 'debt' | 'group', string> = {
    asset: '资产',
    debt: '负债',
    group: '分组'
  };
  let draggedCategoryId: string | null = null;

  target.dataset.panel = 'categories';
  target.innerHTML = `
    <div class="section-grid">
      <section class="card">
        <div class="card-header">
          <h3>分类管理</h3>
        </div>
        <form data-role="category-form" class="stack-form">
          <input name="editingId" type="hidden" />
          <div class="form-grid two-columns">
            <input name="name" placeholder="分类名称" required />
            <select name="parentId">
            <option value="">顶层分类</option>
            ${categories
              .map(
                (item) =>
                  `<option value="${item.id}">${escapeHtml('— '.repeat(item.depth) + item.name)}</option>`
              )
              .join('')}
            </select>
            <select name="kind">
              <option value="asset">资产</option>
              <option value="debt">负债</option>
              <option value="group">分组</option>
            </select>
            <select name="currency">
              <option value="CNY">CNY</option>
              <option value="SGD">SGD</option>
              <option value="USD">USD</option>
              <option value="MYR">MYR</option>
            </select>
          </div>
          <div class="action-row">
            <button type="submit" class="btn btn-primary" data-role="category-submit">添加分类</button>
            <button type="button" class="btn btn-secondary" data-role="category-cancel" hidden>取消编辑</button>
          </div>
        </form>
        <div class="categories-tree" data-role="category-list">
          ${categories.length === 0
            ? '<p class="panel__empty">还没有分类，先创建一个资产账户。</p>'
            : categories
                .map(
                  (item) => `
                    <div class="category-item" data-category-id="${item.id}" style="margin-left:${item.depth * 24}px">
                      <div class="drop-zone" data-drop-position="before" data-target-id="${item.id}"></div>
                      <div class="category-header" draggable="true" data-role="drag-source" data-category-id="${item.id}">
                        <div class="category-meta">
                          <span class="drag-handle">⋮⋮</span>
                          <div>
                            <div class="category-name">${escapeHtml(item.name)}</div>
                            <div class="category-subtitle">
                              <span class="${item.kind === 'debt' ? 'negative' : ''}">${kindLabels[item.kind]}</span>
                              <span> · ${item.currency} · </span>
                              <span class="${item.aggregateAmount === null ? '' : balanceToneClass(item.aggregateAmount, item.kind)}">${formatBalanceAmount(item.aggregateAmount, item.kind)}</span>
                            </div>
                          </div>
                        </div>
                        <div class="template-actions">
                          <button type="button" class="btn btn-sm" data-action="edit" data-category-id="${item.id}">编辑</button>
                          <button type="button" class="btn btn-sm btn-danger" data-action="delete" data-category-id="${item.id}">删除</button>
                        </div>
                      </div>
                      <div class="drop-zone drop-zone-inside" data-drop-position="inside" data-target-id="${item.id}">拖到这里作为子分类</div>
                      <div class="drop-zone" data-drop-position="after" data-target-id="${item.id}"></div>
                    </div>
                  `
                )
                .join('')}
        </div>
      </section>
      <section class="card">
        <div class="card-header">
          <h3>资产状态</h3>
          <span class="tag">设置某个时点的准确余额</span>
        </div>
        <form data-role="asset-state-form" class="stack-form">
          <input name="editingId" type="hidden" />
          <div class="form-grid two-columns">
            <select name="categoryId" ${leafCategories.length === 0 ? 'disabled' : ''}>
              <option value="">选择分类</option>
              ${leafCategories
                .map(
                  (item) =>
                    `<option value="${item.id}">${escapeHtml('— '.repeat(item.depth) + item.name)} · ${escapeHtml(item.currency)}</option>`
                )
                .join('')}
            </select>
            <input name="anchoredAt" type="datetime-local" required value="${formatIsoForDatetimeLocal(new Date().toISOString())}" />
            <input name="amount" type="number" step="0.01" placeholder="资产状态金额" required ${leafCategories.length === 0 ? 'disabled' : ''} />
            <input name="note" placeholder="备注（可选）" ${leafCategories.length === 0 ? 'disabled' : ''} />
          </div>
          <p class="panel__empty anchor-hint">盘点值会接管该时点之后的余额，之前的账单只影响历史回放。</p>
          <div class="action-row">
            <button type="submit" class="btn btn-primary" data-role="asset-state-submit" ${leafCategories.length === 0 ? 'disabled' : ''}>设置资产状态</button>
            <button type="button" class="btn btn-secondary" data-role="asset-state-cancel" hidden>取消编辑</button>
          </div>
        </form>
        <div class="transactions-table">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>分类</th>
                <th>金额</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody data-role="asset-state-list">
              ${
                assetStateAnchors.length === 0
                  ? '<tr><td colspan="5" class="panel__empty">还没有资产状态锚点。</td></tr>'
                  : assetStateAnchors
                      .map(
                        (item) => `
                          <tr>
                            <td>${escapeHtml(formatLocalTimestamp(item.anchoredAt))}</td>
                            <td>${escapeHtml(item.categoryName)}</td>
                            <td class="${balanceToneClass(item.amount, item.categoryKind)}">${formatBalanceAmount(item.amount, item.categoryKind)} ${escapeHtml(item.currency)}</td>
                            <td>${escapeHtml(item.note || '无备注')}</td>
                            <td>
                              <button type="button" class="btn btn-sm" data-action="edit-anchor" data-anchor-id="${item.id}">编辑</button>
                              <button type="button" class="btn btn-sm btn-danger" data-action="delete-anchor" data-anchor-id="${item.id}">删除</button>
                            </td>
                          </tr>
                        `
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  const form = target.querySelector<HTMLFormElement>('[data-role="category-form"]');
  const cancelButton = target.querySelector<HTMLButtonElement>('[data-role="category-cancel"]');
  const submitButton = target.querySelector<HTMLButtonElement>('[data-role="category-submit"]');
  const assetStateForm = target.querySelector<HTMLFormElement>('[data-role="asset-state-form"]');
  const assetStateSubmitButton = target.querySelector<HTMLButtonElement>('[data-role="asset-state-submit"]');
  const assetStateCancelButton = target.querySelector<HTMLButtonElement>('[data-role="asset-state-cancel"]');

  const resetForm = (): void => {
    form?.reset();
    if (form) {
      const editingInput = form.elements.namedItem('editingId') as HTMLInputElement;
      editingInput.value = '';
    }

    if (submitButton) {
      submitButton.textContent = '添加分类';
    }

    if (cancelButton) {
      cancelButton.hidden = true;
    }
  };

  cancelButton?.addEventListener('click', () => {
    resetForm();
  });

  const resetAssetStateForm = (): void => {
    assetStateForm?.reset();

    if (!assetStateForm) {
      return;
    }

    (assetStateForm.elements.namedItem('editingId') as HTMLInputElement).value = '';
    (assetStateForm.elements.namedItem('anchoredAt') as HTMLInputElement).value = formatIsoForDatetimeLocal(
      new Date().toISOString()
    );

    if (assetStateSubmitButton) {
      assetStateSubmitButton.textContent = '设置资产状态';
    }

    if (assetStateCancelButton) {
      assetStateCancelButton.hidden = true;
    }
  };

  assetStateCancelButton?.addEventListener('click', () => {
    resetAssetStateForm();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const formData = new FormData(formElement);
    const editingId = String(formData.get('editingId') ?? '');

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      if (editingId) {
        await updateCategory(db, {
          bookId: book.id,
          categoryId: editingId,
          parentId: String(formData.get('parentId') ?? '') || null,
          name: String(formData.get('name') ?? ''),
          kind: String(formData.get('kind') ?? 'asset') as 'asset' | 'debt' | 'group',
          currency: String(formData.get('currency') ?? 'CNY') as 'CNY' | 'SGD' | 'USD' | 'MYR'
        });
        onStatus?.('分类已更新');
      } else {
        await createCategory(db, {
          bookId: book.id,
          name: String(formData.get('name') ?? ''),
          parentId: String(formData.get('parentId') ?? '') || null,
          kind: String(formData.get('kind') ?? 'asset') as 'asset' | 'debt' | 'group',
          currency: String(formData.get('currency') ?? 'CNY') as 'CNY' | 'SGD' | 'USD' | 'MYR'
        });
        onStatus?.('分类已添加');
      }

      resetForm();

      if (onChange) {
        await onChange();
      }
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '分类操作失败');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  target.querySelector('[data-role="category-list"]')?.addEventListener('click', async (event) => {
    const actionButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');

    if (!actionButton || !form) {
      return;
    }

    const categoryId = actionButton.dataset.categoryId;

    if (!categoryId) {
      return;
    }

    if (actionButton.dataset.action === 'edit') {
      const category = categoryMap.get(categoryId);

      if (!category) {
        return;
      }

      (form.elements.namedItem('editingId') as HTMLInputElement).value = category.id;
      (form.elements.namedItem('name') as HTMLInputElement).value = category.name;
      (form.elements.namedItem('parentId') as HTMLSelectElement).value = category.parentId ?? '';
      (form.elements.namedItem('kind') as HTMLSelectElement).value = category.kind;
      (form.elements.namedItem('currency') as HTMLSelectElement).value = category.currency;

      if (submitButton) {
        submitButton.textContent = '保存分类';
      }

      if (cancelButton) {
        cancelButton.hidden = false;
      }

      return;
    }

    if (actionButton.dataset.action === 'delete') {
      try {
        await deleteCategory(db, {
          bookId: book.id,
          categoryId
        });
        onStatus?.('分类及其关联账单已删除');
        await onChange?.();
      } catch (error) {
        onStatus?.(error instanceof Error ? error.message : '删除分类失败');
      }
    }
  });

  assetStateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentForm = event.currentTarget as HTMLFormElement;
    const formData = new FormData(currentForm);
    const editingId = String(formData.get('editingId') ?? '');
    const categoryId = String(formData.get('categoryId') ?? '');
    const category = categoryMap.get(categoryId);

    if (!category || category.kind === 'group') {
      onStatus?.('请选择一个可记账分类');
      return;
    }

    if (assetStateSubmitButton) {
      assetStateSubmitButton.disabled = true;
    }

    try {
      if (editingId) {
        await updateAssetStateAnchor(db, {
          bookId: book.id,
          anchorId: editingId,
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          anchoredAt: parseDatetimeLocalToIso(String(formData.get('anchoredAt') ?? '')),
          note: String(formData.get('note') ?? '')
        });
        onStatus?.('资产状态已更新');
      } else {
        await createAssetStateAnchor(db, {
          bookId: book.id,
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          anchoredAt: parseDatetimeLocalToIso(String(formData.get('anchoredAt') ?? '')),
          note: String(formData.get('note') ?? '')
        });
        onStatus?.('资产状态已设置');
      }

      resetAssetStateForm();
      await onChange?.();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '设置资产状态失败');
    } finally {
      if (assetStateSubmitButton) {
        assetStateSubmitButton.disabled = false;
      }
    }
  });

  target.querySelector('[data-role="asset-state-list"]')?.addEventListener('click', async (event) => {
    const actionButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');

    if (!actionButton || !assetStateForm) {
      return;
    }

    const anchorId = actionButton.dataset.anchorId ?? '';
    const anchor = anchorMap.get(anchorId);

    if (!anchor) {
      return;
    }

    if (actionButton.dataset.action === 'edit-anchor') {
      (assetStateForm.elements.namedItem('editingId') as HTMLInputElement).value = anchor.id;
      (assetStateForm.elements.namedItem('categoryId') as HTMLSelectElement).value = anchor.categoryId;
      (assetStateForm.elements.namedItem('anchoredAt') as HTMLInputElement).value = formatIsoForDatetimeLocal(
        anchor.anchoredAt
      );
      (assetStateForm.elements.namedItem('amount') as HTMLInputElement).value = editableAssetStateAmount(
        anchor.amount,
        anchor.categoryKind === 'group' ? 'asset' : anchor.categoryKind
      );
      (assetStateForm.elements.namedItem('note') as HTMLInputElement).value = anchor.note;

      if (assetStateSubmitButton) {
        assetStateSubmitButton.textContent = '保存资产状态';
      }

      if (assetStateCancelButton) {
        assetStateCancelButton.hidden = false;
      }

      return;
    }

    if (actionButton.dataset.action === 'delete-anchor') {
      try {
        await deleteAssetStateAnchor(db, {
          bookId: book.id,
          anchorId
        });
        onStatus?.('资产状态已删除');
        await onChange?.();
      } catch (error) {
        onStatus?.(error instanceof Error ? error.message : '删除资产状态失败');
      }
    }
  });

  target.querySelectorAll<HTMLElement>('[data-role="drag-source"]').forEach((source) => {
    source.addEventListener('dragstart', () => {
      draggedCategoryId = source.dataset.categoryId ?? null;
    });

    source.addEventListener('dragend', () => {
      draggedCategoryId = null;
    });
  });

  target.querySelectorAll<HTMLElement>('.drop-zone').forEach((dropZone) => {
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('active');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('active');
    });

    dropZone.addEventListener('drop', async (event) => {
      event.preventDefault();
      dropZone.classList.remove('active');

      if (!draggedCategoryId) {
        return;
      }

      const targetId = dropZone.dataset.targetId;
      const position = dropZone.dataset.dropPosition;
      const targetCategory = targetId ? categoryMap.get(targetId) : undefined;

      if (!targetCategory || draggedCategoryId === targetCategory.id) {
        return;
      }

      try {
        if (position === 'inside') {
          const siblingCount = categories.filter((item) => item.parentId === targetCategory.id).length;

          await moveCategory(db, {
            bookId: book.id,
            categoryId: draggedCategoryId,
            targetParentId: targetCategory.id,
            targetIndex: siblingCount
          });
        } else {
          const targetParentId = targetCategory.parentId ?? null;
          const siblings = categories
            .filter((item) => item.parentId === targetParentId && item.id !== draggedCategoryId)
            .sort((left, right) => left.sortOrder - right.sortOrder);
          const targetIndex =
            siblings.findIndex((item) => item.id === targetCategory.id) + (position === 'after' ? 1 : 0);

          await moveCategory(db, {
            bookId: book.id,
            categoryId: draggedCategoryId,
            targetParentId,
            targetIndex: Math.max(0, targetIndex)
          });
        }

        onStatus?.('分类顺序已更新');
        await onChange?.();
      } catch (error) {
        onStatus?.(error instanceof Error ? error.message : '拖拽分类失败');
      }
    });
  });
}
