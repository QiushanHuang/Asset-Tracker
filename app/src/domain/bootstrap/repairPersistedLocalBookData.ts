import type {
  AssetStateAnchor,
  AutomationRule,
  Book,
  ExchangeRate
} from '../../shared/types/entities';
import { assetStateAnchorSchema, automationRuleSchema, bookSchema, exchangeRateSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { BookRepository } from '../../storage/repositories/bookRepository';
import { ExchangeRateRepository } from '../../storage/repositories/exchangeRateRepository';
import { normalizeMonthlyDays, resolveTimeOfDay } from '../automation/schedule';
import { normalizeEffectiveDate } from '../settings/exchangeRateTimeline';

function normalizeBook(book: Book, now: string): Book | null {
  const nextMemo = typeof book.memo === 'string' ? book.memo : '';

  if (nextMemo === book.memo) {
    return null;
  }

  return bookSchema.parse({
    ...book,
    memo: nextMemo,
    ...bumpMetadata(book, now)
  });
}

function normalizeAutomationRule(rule: AutomationRule, now: string): AutomationRule | null {
  const nextMonthlyDays = normalizeMonthlyDays(rule.monthlyDays);
  const nextIncludeLastDayOfMonth = rule.includeLastDayOfMonth ?? false;
  const nextTimeOfDay = resolveTimeOfDay(rule.timeOfDay);

  const unchanged =
    Array.isArray(rule.monthlyDays) &&
    JSON.stringify(nextMonthlyDays) === JSON.stringify(rule.monthlyDays) &&
    typeof rule.includeLastDayOfMonth === 'boolean' &&
    nextIncludeLastDayOfMonth === rule.includeLastDayOfMonth &&
    nextTimeOfDay === rule.timeOfDay;

  if (unchanged) {
    return null;
  }

  return automationRuleSchema.parse({
    ...rule,
    monthlyDays: nextMonthlyDays,
    includeLastDayOfMonth: nextIncludeLastDayOfMonth,
    timeOfDay: nextTimeOfDay,
    ...bumpMetadata(rule, now)
  });
}

function normalizeAnchor(anchor: AssetStateAnchor, now: string): AssetStateAnchor | null {
  const nextNote = typeof anchor.note === 'string' ? anchor.note : '';

  if (nextNote === anchor.note) {
    return null;
  }

  return assetStateAnchorSchema.parse({
    ...anchor,
    note: nextNote,
    ...bumpMetadata(anchor, now)
  });
}

function normalizeExchangeRate(
  exchangeRate: ExchangeRate,
  baseCurrency: Book['baseCurrency'],
  now: string
): ExchangeRate | null {
  const nextBaseCurrency = exchangeRate.baseCurrency ?? baseCurrency;
  const nextEffectiveFrom = normalizeEffectiveDate(exchangeRate.effectiveFrom ?? exchangeRate.updatedAt);

  if (nextBaseCurrency === exchangeRate.baseCurrency && nextEffectiveFrom === exchangeRate.effectiveFrom) {
    return null;
  }

  return exchangeRateSchema.parse({
    ...exchangeRate,
    baseCurrency: nextBaseCurrency,
    effectiveFrom: nextEffectiveFrom,
    ...bumpMetadata(exchangeRate, now)
  });
}

export async function repairPersistedLocalBookData(
  db: AssetTrackerDb,
  book: Book
): Promise<Book> {
  const now = new Date().toISOString();
  const bookRepository = new BookRepository(db);
  const repairedBook = normalizeBook(book, now);
  let currentBook = book;

  if (repairedBook) {
    await bookRepository.put(repairedBook);
    currentBook = repairedBook;
  }

  const [rules, anchors, exchangeRates] = await Promise.all([
    new AutomationRuleRepository(db).listByBook(currentBook.id),
    new AssetStateAnchorRepository(db).listByBook(currentBook.id),
    new ExchangeRateRepository(db).listByBook(currentBook.id)
  ]);

  const repairedRules = rules
    .filter((rule) => rule.deletedAt === null)
    .map((rule) => normalizeAutomationRule(rule, now))
    .filter((rule): rule is AutomationRule => Boolean(rule));
  const repairedAnchors = anchors
    .filter((anchor) => anchor.deletedAt === null)
    .map((anchor) => normalizeAnchor(anchor, now))
    .filter((anchor): anchor is AssetStateAnchor => Boolean(anchor));
  const repairedExchangeRates = exchangeRates
    .filter((exchangeRate) => exchangeRate.deletedAt === null)
    .map((exchangeRate) => normalizeExchangeRate(exchangeRate, currentBook.baseCurrency, now))
    .filter((exchangeRate): exchangeRate is ExchangeRate => Boolean(exchangeRate));

  await Promise.all([
    repairedRules.length > 0 ? new AutomationRuleRepository(db).putMany(repairedRules) : Promise.resolve(),
    repairedAnchors.length > 0 ? new AssetStateAnchorRepository(db).putMany(repairedAnchors) : Promise.resolve(),
    repairedExchangeRates.length > 0
      ? new ExchangeRateRepository(db).putMany(repairedExchangeRates)
      : Promise.resolve()
  ]);

  return currentBook;
}
