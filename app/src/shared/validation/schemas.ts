import { z } from 'zod';
import type { MonetaryAmount } from '../types/entities';

export const currencySchema = z.enum(['CNY', 'SGD', 'USD', 'MYR']);
export const transactionDirectionSchema = z.enum(['income', 'expense', 'transfer', 'adjustment']);
export const automationFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
const AMOUNT_PRECISION = 2;
export const MINOR_UNIT_SCALE = 10 ** AMOUNT_PRECISION;

export const amountInputSchema = z
  .number()
  .finite()
  .refine((value) => {
    const normalized = Number(value.toFixed(AMOUNT_PRECISION));
    return Math.abs(value - normalized) < Number.EPSILON;
  }, `Amount must use at most ${AMOUNT_PRECISION} decimal places`)
  .transform((value) => Math.round(value * MINOR_UNIT_SCALE) as MonetaryAmount);

export const minorUnitAmountSchema = z
  .number()
  .int()
  .transform((value) => value as MonetaryAmount);

export const metadataSchema = z.object({
  revision: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
  updatedBy: z.string().min(1),
  deviceId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

export const bookSchema = metadataSchema.extend({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal('private'),
  baseCurrency: currencySchema,
  memo: z.string()
}).strict();

export const categorySchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().min(1),
  kind: z.enum(['asset', 'debt', 'group']),
  currency: currencySchema,
  sortOrder: z.number().int(),
  isArchived: z.boolean()
}).strict();

export const transactionSchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  categoryId: z.string().min(1),
  amount: minorUnitAmountSchema,
  currency: currencySchema,
  direction: transactionDirectionSchema,
  purpose: z.string().min(1),
  description: z.string(),
  occurredAt: z.string().datetime(),
  automationRuleId: z.string().min(1).nullable().optional(),
  automationOccurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
}).strict();

export const transactionTemplateSchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  name: z.string().min(1),
  categoryId: z.string().min(1),
  amount: minorUnitAmountSchema,
  currency: currencySchema,
  direction: transactionDirectionSchema,
  purpose: z.string().min(1),
  description: z.string()
}).strict();

export const automationRuleSchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  name: z.string().min(1),
  categoryId: z.string().min(1),
  amount: minorUnitAmountSchema,
  currency: currencySchema,
  direction: transactionDirectionSchema,
  purpose: z.string().min(1),
  description: z.string(),
  frequency: automationFrequencySchema,
  interval: z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  monthlyDays: z.array(z.number().int().min(1).max(31)).default([]),
  includeLastDayOfMonth: z.boolean().default(false),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  lastGeneratedAt: z.string().datetime().nullable(),
  isActive: z.boolean()
}).strict();

export const exchangeRateSchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  currency: currencySchema,
  baseCurrency: currencySchema,
  rate: z.number().positive(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).strict();

export const assetStateAnchorSchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  categoryId: z.string().min(1),
  amount: minorUnitAmountSchema,
  currency: currencySchema,
  anchoredAt: z.string().datetime(),
  note: z.string()
}).strict();
