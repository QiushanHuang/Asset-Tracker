import { formatMinorUnits, formatMinorUnitsAbsolute } from './money';

export function balanceToneClass(
  amount: number,
  kind: 'asset' | 'debt' | 'group'
): 'positive' | 'negative' {
  if (kind === 'debt') {
    return amount < 0 ? 'negative' : 'positive';
  }

  return amount >= 0 ? 'positive' : 'negative';
}

export function formatBalanceAmount(
  amount: number | null,
  kind: 'asset' | 'debt' | 'group'
): string {
  if (amount === null) {
    return '多币种';
  }

  if (kind === 'debt' && amount < 0) {
    return formatMinorUnitsAbsolute(amount);
  }

  return formatMinorUnits(amount);
}
