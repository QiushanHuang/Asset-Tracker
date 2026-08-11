import type { AutomationFrequency, AutomationRule } from '../../shared/types/entities';
import { parseDateAndTimeToIso } from '../../shared/utils/datetimeLocal';

export interface AutomationOccurrence {
  date: string;
  occurredAt: string;
}

export function normalizeMonthlyDays(days: number[] | undefined): number[] {
  return [...new Set((days ?? []).map((day) => Math.trunc(day)).filter((day) => day >= 1 && day <= 31))].sort(
    (left, right) => left - right
  );
}

export function resolveTimeOfDay(timeOfDay: string | null | undefined): string {
  return timeOfDay && /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeOfDay) ? timeOfDay : '00:00';
}

export function usesExplicitMonthlySchedule(rule: Pick<AutomationRule, 'monthlyDays' | 'includeLastDayOfMonth'>): boolean {
  return normalizeMonthlyDays(rule.monthlyDays).length > 0 || rule.includeLastDayOfMonth;
}

function formatRuleDate(date: Date): string {
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function formatOccurredAt(date: string, timeOfDay: string): string {
  return parseDateAndTimeToIso(date, timeOfDay);
}

function addFixedInterval(
  date: Date,
  frequency: Exclude<AutomationFrequency, 'monthly'>,
  interval: number,
  anchorDay: number,
  anchorMonth: number
): void {
  switch (frequency) {
    case 'daily':
      date.setUTCDate(date.getUTCDate() + interval);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + interval * 7);
      break;
    case 'yearly': {
      const targetYear = date.getUTCFullYear() + interval;
      const monthEnd = new Date(Date.UTC(targetYear, anchorMonth + 1, 0)).getUTCDate();
      date.setUTCFullYear(targetYear, anchorMonth, Math.min(anchorDay, monthEnd));
      break;
    }
  }
}

function addAnchoredMonthlyInterval(date: Date, interval: number, anchorDay: number): void {
  const targetYear = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + interval;
  const monthEnd = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  date.setUTCFullYear(targetYear, targetMonth, Math.min(anchorDay, monthEnd));
}

function monthDiff(startDate: string, targetDate: Date): number {
  const [startYear, startMonth] = startDate.split('-').map(Number);
  return (targetDate.getUTCFullYear() - startYear) * 12 + (targetDate.getUTCMonth() + 1 - startMonth);
}

function buildMonthlyDates(rule: AutomationRule, effectiveStart: string, effectiveEnd: string): AutomationOccurrence[] {
  const occurrences: AutomationOccurrence[] = [];
  const cursor = new Date(`${rule.startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const endMonth = new Date(`${effectiveEnd.slice(0, 7)}-01T00:00:00.000Z`);
  const monthlyDays = normalizeMonthlyDays(rule.monthlyDays);
  const timeOfDay = resolveTimeOfDay(rule.timeOfDay);

  while (cursor.getTime() <= endMonth.getTime()) {
    if (monthDiff(rule.startDate, cursor) % rule.interval === 0) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth();
      const monthEnd = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const days = new Set(monthlyDays.filter((day) => day <= monthEnd));

      if (rule.includeLastDayOfMonth) {
        days.add(monthEnd);
      }

      [...days]
        .sort((left, right) => left - right)
        .forEach((day) => {
          const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

          if (date < rule.startDate || date < effectiveStart || date > effectiveEnd) {
            return;
          }

          occurrences.push({
            date,
            occurredAt: formatOccurredAt(date, timeOfDay)
          });
        });
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
  }

  return occurrences;
}

export function listAutomationOccurrences(
  rule: AutomationRule,
  throughDate: string,
  fromDate = rule.startDate
): AutomationOccurrence[] {
  const effectiveStart = fromDate > rule.startDate ? fromDate : rule.startDate;
  const configuredEnd = rule.endDate && rule.endDate < throughDate ? rule.endDate : throughDate;

  if (effectiveStart > configuredEnd) {
    return [];
  }

  if (rule.frequency === 'monthly' && usesExplicitMonthlySchedule(rule)) {
    return buildMonthlyDates(rule, effectiveStart, configuredEnd);
  }

  const timeOfDay = resolveTimeOfDay(rule.timeOfDay);
  const occurrences: AutomationOccurrence[] = [];
  const cursor = new Date(`${rule.startDate}T00:00:00.000Z`);
  const endDate = new Date(`${configuredEnd}T23:59:59.999Z`);
  const anchorDay = cursor.getUTCDate();
  const anchorMonth = cursor.getUTCMonth();

  while (cursor.getTime() <= endDate.getTime()) {
    const date = formatRuleDate(cursor);

    if (date >= effectiveStart && date <= configuredEnd) {
      occurrences.push({
        date,
        occurredAt: formatOccurredAt(date, timeOfDay)
      });
    }

    if (rule.frequency === 'monthly') {
      addAnchoredMonthlyInterval(cursor, rule.interval, anchorDay);
    } else {
      addFixedInterval(cursor, rule.frequency, rule.interval, anchorDay, anchorMonth);
    }
  }

  return occurrences;
}
