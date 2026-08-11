import type { Book } from '../../shared/types/entities';
import { createAutomationRule } from '../../domain/automation/createAutomationRule';
import { deleteAutomationRule } from '../../domain/automation/deleteAutomationRule';
import { fillAutomationRuleToDate } from '../../domain/automation/fillAutomationRuleToDate';
import { listAutomationRulesForBook } from '../../domain/automation/listAutomationRulesForBook';
import { toggleAutomationRule } from '../../domain/automation/toggleAutomationRule';
import { updateAutomationRule } from '../../domain/automation/updateAutomationRule';
import { listCategoryTree } from '../../domain/categories/listCategoryTree';
import { applyTransactionTemplate } from '../../domain/templates/applyTransactionTemplate';
import { createTransactionTemplate } from '../../domain/templates/createTransactionTemplate';
import { deleteTransactionTemplate } from '../../domain/templates/deleteTransactionTemplate';
import { listTransactionTemplatesForBook } from '../../domain/templates/listTransactionTemplatesForBook';
import { updateTransactionTemplate } from '../../domain/templates/updateTransactionTemplate';
import { formatDateForDateInput } from '../../shared/utils/datetimeLocal';
import { escapeHtml } from '../../shared/utils/escapeHtml';
import { formatMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';

interface AutomationPanelContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
  onChange?: () => Promise<void>;
  onStatus?: (message: string) => void;
}

function frequencyLabel(frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'): string {
  return {
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
    yearly: '每年'
  }[frequency];
}

function intervalUnit(frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'): string {
  return {
    daily: '日',
    weekly: '周',
    monthly: '月',
    yearly: '年'
  }[frequency];
}

function describeRuleSchedule(rule: {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  monthlyDays: number[];
  includeLastDayOfMonth: boolean;
  timeOfDay: string;
}): string {
  if (rule.frequency === 'monthly' && (rule.monthlyDays.length > 0 || rule.includeLastDayOfMonth)) {
    const tokens = [...rule.monthlyDays.map((day) => `${day}日`), ...(rule.includeLastDayOfMonth ? ['月末'] : [])];
    return `每 ${rule.interval} 月 · ${tokens.join(' / ')} · ${rule.timeOfDay}`;
  }

  return `每 ${rule.interval} ${intervalUnit(rule.frequency)} · ${rule.timeOfDay}`;
}

export async function renderAutomationPanel({
  db,
  book,
  target,
  onChange,
  onStatus
}: AutomationPanelContext): Promise<void> {
  const [categories, templates, rules] = await Promise.all([
    listCategoryTree(db, book.id),
    listTransactionTemplatesForBook(db, book.id),
    listAutomationRulesForBook(db, book.id)
  ]);
  const leafCategories = categories.filter((item) => item.kind !== 'group');
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const ruleById = new Map(rules.map((item) => [item.id, item]));

  target.innerHTML = `
    <div class="template-management">
      <section class="card">
        <div class="card-header">
          <h3>模板管理</h3>
        </div>
        <form data-role="template-form" class="stack-form">
          <input name="editingId" type="hidden" />
          <div class="form-grid three-columns">
            <input name="name" placeholder="模板名称" required />
            <select name="categoryId" required>
              <option value="">选择分类</option>
              ${leafCategories
                .map(
                  (item) =>
                    `<option value="${item.id}">${escapeHtml('— '.repeat(item.depth) + item.name)}</option>`
                )
                .join('')}
            </select>
            <select name="direction">
              <option value="income">收入</option>
              <option value="expense">支出</option>
              <option value="adjustment">调整</option>
            </select>
            <input name="amount" type="number" step="0.01" placeholder="金额" required />
            <input name="purpose" placeholder="用途" required />
            <input name="description" placeholder="备注" />
          </div>
          <div class="action-row">
            <button type="submit" class="btn btn-primary" data-role="template-submit">添加模板</button>
            <button type="button" class="btn btn-secondary" data-role="template-cancel" hidden>取消编辑</button>
          </div>
        </form>
        <div class="template-list" data-role="template-list">
          ${
            templates.length === 0
              ? '<p class="panel__empty">暂无模板，先保存一条常用账单。</p>'
              : templates
                  .map(
                    (template) => `
                      <div class="template-item">
                        <div class="template-info">
                          <strong>${escapeHtml(template.name)}</strong>
                          <span>${escapeHtml(template.categoryName)} · ${template.direction}</span>
                          <span class="template-amount">${formatMinorUnits(template.amount)} ${template.currency}</span>
                        </div>
                        <div class="template-actions">
                          <button type="button" class="btn btn-sm" data-action="apply-template" data-template-id="${template.id}">应用</button>
                          <button type="button" class="btn btn-sm" data-action="edit-template" data-template-id="${template.id}">编辑</button>
                          <button type="button" class="btn btn-sm btn-danger" data-action="delete-template" data-template-id="${template.id}">删除</button>
                        </div>
                      </div>
                    `
                  )
                  .join('')
          }
        </div>
      </section>
      <section class="card">
        <div class="card-header">
          <h3>自动记账规则</h3>
        </div>
        <form data-role="rule-form" class="stack-form">
          <input name="editingId" type="hidden" />
          <input name="isActive" type="hidden" value="true" />
          <div class="form-grid three-columns">
            <input name="name" placeholder="规则名称" required />
            <select name="categoryId" required>
              <option value="">选择分类</option>
              ${leafCategories
                .map(
                  (item) =>
                    `<option value="${item.id}">${escapeHtml('— '.repeat(item.depth) + item.name)}</option>`
                )
                .join('')}
            </select>
            <select name="direction">
              <option value="income">收入</option>
              <option value="expense">支出</option>
              <option value="adjustment">调整</option>
            </select>
            <input name="amount" type="number" step="0.01" placeholder="金额" required />
            <input name="purpose" placeholder="用途" required />
            <input name="description" placeholder="备注" />
            <select name="frequency">
              <option value="daily">每日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
            </select>
            <input name="interval" type="number" min="1" step="1" value="1" required />
            <input name="startDate" type="date" required value="${formatDateForDateInput(new Date())}" />
            <input name="endDate" type="date" />
            <input name="monthlyDays" placeholder="每月几日，例如 5,15" />
            <label class="checkbox-label">
              <input name="includeLastDayOfMonth" type="checkbox" />
              <span>当月最后一日</span>
            </label>
            <label class="field-label inline-field">
              <span>执行时间</span>
              <input name="timeOfDay" type="time" value="09:00" />
            </label>
          </div>
          <div class="action-row">
            <button type="submit" class="btn btn-primary" data-role="rule-submit">添加规则</button>
            <button type="button" class="btn btn-secondary" data-role="rule-cancel" hidden>取消编辑</button>
          </div>
        </form>
        <div data-role="rule-list">
          ${
            rules.length === 0
              ? '<p class="panel__empty">暂无自动记账规则。</p>'
              : rules
                  .map(
                    (rule) => `
                      <div class="rule-item">
                        <div class="rule-header">
                          <span class="rule-name">${escapeHtml(rule.name)}</span>
                          <span class="rule-frequency">${frequencyLabel(rule.frequency)}</span>
                        </div>
                        <div class="rule-details">
                          ${escapeHtml(rule.categoryName)} · ${formatMinorUnits(rule.amount)} ${rule.currency} ·
                          ${escapeHtml(describeRuleSchedule(rule))}
                        </div>
                        <div class="template-actions">
                          <button type="button" class="btn btn-sm" data-action="toggle-rule" data-rule-id="${rule.id}">
                            ${rule.isActive ? '暂停' : '启用'}
                          </button>
                          <button type="button" class="btn btn-sm btn-primary" data-action="fill-rule" data-rule-id="${rule.id}">补齐到今天</button>
                          <button type="button" class="btn btn-sm" data-action="edit-rule" data-rule-id="${rule.id}">编辑</button>
                          <button type="button" class="btn btn-sm btn-danger" data-action="delete-rule" data-rule-id="${rule.id}">删除</button>
                        </div>
                      </div>
                    `
                  )
                  .join('')
          }
        </div>
      </section>
    </div>
  `;

  const templateForm = target.querySelector<HTMLFormElement>('[data-role="template-form"]');
  const templateSubmit = target.querySelector<HTMLButtonElement>('[data-role="template-submit"]');
  const templateCancel = target.querySelector<HTMLButtonElement>('[data-role="template-cancel"]');
  const ruleForm = target.querySelector<HTMLFormElement>('[data-role="rule-form"]');
  const ruleSubmit = target.querySelector<HTMLButtonElement>('[data-role="rule-submit"]');
  const ruleCancel = target.querySelector<HTMLButtonElement>('[data-role="rule-cancel"]');

  const resetTemplateForm = (): void => {
    templateForm?.reset();
    if (!templateForm) {
      return;
    }

    (templateForm.elements.namedItem('editingId') as HTMLInputElement).value = '';
    if (templateSubmit) {
      templateSubmit.textContent = '添加模板';
    }
    if (templateCancel) {
      templateCancel.hidden = true;
    }
  };

  const resetRuleForm = (): void => {
    ruleForm?.reset();
    if (!ruleForm) {
      return;
    }

    (ruleForm.elements.namedItem('editingId') as HTMLInputElement).value = '';
    (ruleForm.elements.namedItem('isActive') as HTMLInputElement).value = 'true';
    (ruleForm.elements.namedItem('interval') as HTMLInputElement).value = '1';
    (ruleForm.elements.namedItem('startDate') as HTMLInputElement).value = formatDateForDateInput(
      new Date()
    );
    (ruleForm.elements.namedItem('monthlyDays') as HTMLInputElement).value = '';
    (ruleForm.elements.namedItem('includeLastDayOfMonth') as HTMLInputElement).checked = false;
    (ruleForm.elements.namedItem('timeOfDay') as HTMLInputElement).value = '09:00';
    if (ruleSubmit) {
      ruleSubmit.textContent = '添加规则';
    }
    if (ruleCancel) {
      ruleCancel.hidden = true;
    }
  };

  templateCancel?.addEventListener('click', resetTemplateForm);
  ruleCancel?.addEventListener('click', resetRuleForm);

  templateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!templateForm) {
      return;
    }

    const formData = new FormData(templateForm);
    const editingId = String(formData.get('editingId') ?? '');
    const categoryId = String(formData.get('categoryId') ?? '');
    const category = leafCategories.find((item) => item.id === categoryId);

    if (!category) {
      onStatus?.('Category does not exist');
      return;
    }

    try {
      if (editingId) {
        await updateTransactionTemplate(db, {
          bookId: book.id,
          templateId: editingId,
          name: String(formData.get('name') ?? ''),
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          direction: String(formData.get('direction') ?? 'expense') as
            | 'income'
            | 'expense'
            | 'transfer'
            | 'adjustment',
          purpose: String(formData.get('purpose') ?? ''),
          description: String(formData.get('description') ?? '')
        });
        onStatus?.('模板已更新');
      } else {
        await createTransactionTemplate(db, {
          bookId: book.id,
          name: String(formData.get('name') ?? ''),
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          direction: String(formData.get('direction') ?? 'expense') as
            | 'income'
            | 'expense'
            | 'transfer'
            | 'adjustment',
          purpose: String(formData.get('purpose') ?? ''),
          description: String(formData.get('description') ?? '')
        });
        onStatus?.('模板已添加');
      }

      resetTemplateForm();
      await onChange?.();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '模板操作失败');
    }
  });

  ruleForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ruleForm) {
      return;
    }

    const formData = new FormData(ruleForm);
    const editingId = String(formData.get('editingId') ?? '');
    const categoryId = String(formData.get('categoryId') ?? '');
    const isActive = String(formData.get('isActive') ?? 'true') === 'true';
    const category = leafCategories.find((item) => item.id === categoryId);

    if (!category) {
      onStatus?.('Category does not exist');
      return;
    }

    try {
      if (editingId) {
        await updateAutomationRule(db, {
          bookId: book.id,
          ruleId: editingId,
          name: String(formData.get('name') ?? ''),
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          direction: String(formData.get('direction') ?? 'expense') as
            | 'income'
            | 'expense'
            | 'transfer'
            | 'adjustment',
          purpose: String(formData.get('purpose') ?? ''),
          description: String(formData.get('description') ?? ''),
          frequency: String(formData.get('frequency') ?? 'monthly') as
            | 'daily'
            | 'weekly'
            | 'monthly'
            | 'yearly',
          interval: Number(formData.get('interval') ?? 1),
          startDate: String(formData.get('startDate') ?? ''),
          endDate: String(formData.get('endDate') ?? '') || null,
          monthlyDays: String(formData.get('monthlyDays') ?? '')
            .split(',')
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isInteger(item)),
          includeLastDayOfMonth: formData.get('includeLastDayOfMonth') !== null,
          timeOfDay: String(formData.get('timeOfDay') ?? '09:00'),
          isActive
        });
        onStatus?.('规则已更新');
      } else {
        await createAutomationRule(db, {
          bookId: book.id,
          name: String(formData.get('name') ?? ''),
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          direction: String(formData.get('direction') ?? 'expense') as
            | 'income'
            | 'expense'
            | 'transfer'
            | 'adjustment',
          purpose: String(formData.get('purpose') ?? ''),
          description: String(formData.get('description') ?? ''),
          frequency: String(formData.get('frequency') ?? 'monthly') as
            | 'daily'
            | 'weekly'
            | 'monthly'
            | 'yearly',
          interval: Number(formData.get('interval') ?? 1),
          startDate: String(formData.get('startDate') ?? ''),
          endDate: String(formData.get('endDate') ?? '') || null,
          monthlyDays: String(formData.get('monthlyDays') ?? '')
            .split(',')
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isInteger(item)),
          includeLastDayOfMonth: formData.get('includeLastDayOfMonth') !== null,
          timeOfDay: String(formData.get('timeOfDay') ?? '09:00')
        });
        onStatus?.('规则已添加');
      }

      resetRuleForm();
      await onChange?.();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '规则操作失败');
    }
  });

  target.querySelector('[data-role="template-list"]')?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');

    if (!button || !templateForm) {
      return;
    }

    const templateId = button.dataset.templateId;
    const template = templateId ? templateById.get(templateId) : undefined;

    if (!template || !templateId) {
      return;
    }

    try {
      if (button.dataset.action === 'apply-template') {
        await applyTransactionTemplate(db, {
          bookId: book.id,
          templateId,
          occurredAt: new Date().toISOString()
        });
        onStatus?.('模板已生成账单');
        await onChange?.();
        return;
      }

      if (button.dataset.action === 'edit-template') {
        (templateForm.elements.namedItem('editingId') as HTMLInputElement).value = template.id;
        (templateForm.elements.namedItem('name') as HTMLInputElement).value = template.name;
        (templateForm.elements.namedItem('categoryId') as HTMLSelectElement).value = template.categoryId;
        (templateForm.elements.namedItem('direction') as HTMLSelectElement).value = template.direction;
        (templateForm.elements.namedItem('amount') as HTMLInputElement).value =
          template.direction === 'adjustment' || template.direction === 'transfer'
            ? (template.amount / 100).toFixed(2)
            : (Math.abs(template.amount) / 100).toFixed(2);
        (templateForm.elements.namedItem('purpose') as HTMLInputElement).value = template.purpose;
        (templateForm.elements.namedItem('description') as HTMLInputElement).value = template.description;

        if (templateSubmit) {
          templateSubmit.textContent = '保存模板';
        }
        if (templateCancel) {
          templateCancel.hidden = false;
        }
        return;
      }

      if (button.dataset.action === 'delete-template') {
        await deleteTransactionTemplate(db, {
          bookId: book.id,
          templateId
        });
        onStatus?.('模板已删除');
        await onChange?.();
      }
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '模板操作失败');
    }
  });

  target.querySelector('[data-role="rule-list"]')?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');

    if (!button || !ruleForm) {
      return;
    }

    const ruleId = button.dataset.ruleId;
    const rule = ruleId ? ruleById.get(ruleId) : undefined;

    if (!rule || !ruleId) {
      return;
    }

    try {
      if (button.dataset.action === 'toggle-rule') {
        await toggleAutomationRule(db, {
          bookId: book.id,
          ruleId,
          isActive: !rule.isActive
        });
        onStatus?.('规则状态已更新');
        await onChange?.();
        return;
      }

      if (button.dataset.action === 'fill-rule') {
        const created = await fillAutomationRuleToDate(db, {
          bookId: book.id,
          ruleId,
          throughDate: formatDateForDateInput(new Date())
        });
        onStatus?.(`已补齐 ${created.length} 条账单`);
        await onChange?.();
        return;
      }

      if (button.dataset.action === 'edit-rule') {
        (ruleForm.elements.namedItem('editingId') as HTMLInputElement).value = rule.id;
        (ruleForm.elements.namedItem('name') as HTMLInputElement).value = rule.name;
        (ruleForm.elements.namedItem('categoryId') as HTMLSelectElement).value = rule.categoryId;
        (ruleForm.elements.namedItem('direction') as HTMLSelectElement).value = rule.direction;
        (ruleForm.elements.namedItem('amount') as HTMLInputElement).value =
          rule.direction === 'adjustment' || rule.direction === 'transfer'
            ? (rule.amount / 100).toFixed(2)
            : (Math.abs(rule.amount) / 100).toFixed(2);
        (ruleForm.elements.namedItem('purpose') as HTMLInputElement).value = rule.purpose;
        (ruleForm.elements.namedItem('description') as HTMLInputElement).value = rule.description;
        (ruleForm.elements.namedItem('frequency') as HTMLSelectElement).value = rule.frequency;
        (ruleForm.elements.namedItem('interval') as HTMLInputElement).value = String(rule.interval);
        (ruleForm.elements.namedItem('startDate') as HTMLInputElement).value = rule.startDate;
        (ruleForm.elements.namedItem('endDate') as HTMLInputElement).value = rule.endDate ?? '';
        (ruleForm.elements.namedItem('monthlyDays') as HTMLInputElement).value = rule.monthlyDays.join(',');
        (ruleForm.elements.namedItem('includeLastDayOfMonth') as HTMLInputElement).checked =
          rule.includeLastDayOfMonth;
        (ruleForm.elements.namedItem('timeOfDay') as HTMLInputElement).value = rule.timeOfDay;
        (ruleForm.elements.namedItem('isActive') as HTMLInputElement).value = String(rule.isActive);

        if (ruleSubmit) {
          ruleSubmit.textContent = '保存规则';
        }
        if (ruleCancel) {
          ruleCancel.hidden = false;
        }
        return;
      }

      if (button.dataset.action === 'delete-rule') {
        await deleteAutomationRule(db, {
          bookId: book.id,
          ruleId
        });
        onStatus?.('规则已删除');
        await onChange?.();
      }
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '规则操作失败');
    }
  });
}
