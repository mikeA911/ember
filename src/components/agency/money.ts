import type { FeeCurrency } from '@/types/database'

export function formatMoney(amount: number, currency: FeeCurrency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

// Per-currency monthly totals -- PHP and USD are never added together.
export function monthlyTotals(fees: { currency: FeeCurrency; monthlyAmount: number; platformMonthly: number }[]) {
  const totals = new Map<FeeCurrency, { clientMonthly: number; platformMonthly: number }>()
  for (const f of fees) {
    const t = totals.get(f.currency) ?? { clientMonthly: 0, platformMonthly: 0 }
    t.clientMonthly += f.monthlyAmount
    t.platformMonthly += f.platformMonthly
    totals.set(f.currency, t)
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b))
}
