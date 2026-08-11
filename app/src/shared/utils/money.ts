import type { MonetaryAmount } from '../types/entities';
import { amountInputSchema } from '../validation/schemas';

export function toMinorUnits(amount: number): MonetaryAmount {
  return amountInputSchema.parse(amount);
}

export function formatMinorUnits(amount: number): string {
  return (amount / 100).toFixed(2);
}

export function formatMinorUnitsAbsolute(amount: number): string {
  return (Math.abs(amount) / 100).toFixed(2);
}

export function fromMinorUnits(amount: number): number {
  return amount / 100;
}
