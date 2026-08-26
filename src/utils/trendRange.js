// Shared range/bucketing helpers for admin revenue trend charts (candidate
// subscriptions and employer invoices). Extracted so both trend handlers in
// staffPaymentController.js bucket time identically.

export const TREND_RANGES = {
  week: { days: 7, unit: 'day' },
  month: { days: 30, unit: 'day' },
  year: { days: 365, unit: 'month' },
}

// A custom day count beyond a preset — capped so nobody can request an
// unbounded scan, and bucketed by month once the range gets long enough
// that daily points would be unreadable.
export const MAX_CUSTOM_DAYS = 3650
export const CUSTOM_DAY_BUCKET_CUTOFF = 90

export function resolveTrendRange(query) {
  const customDays = Number.parseInt(query.days, 10)
  if (Number.isFinite(customDays) && customDays > 0) {
    const days = Math.min(customDays, MAX_CUSTOM_DAYS)
    return { range: `${days}d`, days, unit: days > CUSTOM_DAY_BUCKET_CUTOFF ? 'month' : 'day' }
  }
  const range = TREND_RANGES[query.range] ? query.range : 'month'
  return { range, ...TREND_RANGES[range] }
}

export const dayKey = (d) => d.toISOString().slice(0, 10)
export const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
export const startOfUTCDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
export const startOfUTCMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
