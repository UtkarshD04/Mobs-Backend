import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, setPaginationHeaders } from '../utils/paginate.js'
import Invoice from '../models/Invoice.js'
import Employee from '../models/Employee.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'
import { resolveTrendRange, dayKey, monthKey, startOfUTCDay, startOfUTCMonth } from '../utils/trendRange.js'

// This report merges two different collections in memory, so each source
// query is capped rather than paginated at the DB level — bounded to the
// most recent SOURCE_CAP rows of each type before merging, sorting and
// slicing to the requested page. Prevents an unbounded scan/serialize;
// not exact pagination at extreme scale, which is fine for an admin report.
const SOURCE_CAP = 500

export const listPayments = asyncHandler(async (req, res) => {
  const { type, status } = req.query
  const { page, limit, skip } = paginationParams(req)

  const rows = []

  if (type !== 'candidate') {
    const invoices = await Invoice.find({}).populate('company', 'name').populate('job', 'title').sort({ date: -1 }).limit(SOURCE_CAP)
    for (const inv of invoices) {
      rows.push({
        id: inv._id.toString(),
        type: 'employer',
        party: inv.company?.name ?? '',
        desc: inv.description,
        date: inv.date,
        amount: inv.amount,
        status: inv.status,
        paymentMode: inv.paymentMode,
        reference: inv.reference,
      })
    }
  }

  if (type !== 'employer') {
    const employees = await Employee.find({ 'subscription.amount': { $gt: 0 } })
      .select('name subscription createdAt')
      .sort({ createdAt: -1 })
      .limit(SOURCE_CAP)
    for (const emp of employees) {
      rows.push({
        id: emp._id.toString(),
        type: 'candidate',
        party: emp.name,
        desc: 'Mzobs placement programme — one-time fee',
        date: emp.subscription.paidOn ?? emp.createdAt,
        amount: emp.subscription.amount,
        status: emp.subscription.status === 'paid' ? 'paid' : 'due',
      })
    }
  }

  const filtered = status && status !== 'all' ? rows.filter((r) => r.status === status) : rows
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date))
  const pageRows = filtered.slice(skip, skip + limit)

  setPaginationHeaders(res, { page, limit, total: filtered.length })
  res.json(pageRows)
})

// Candidate subscription payments bucketed by day (week/month view) or by
// month (year view), with every bucket in range present at zero — so the
// admin's line chart never has a gap even on a day with no payments.
//
// Bucket boundaries and keys are computed entirely in UTC (never local
// time/toLocale*, which use the server's zone) — mixing the two meant a
// server running ahead of UTC (e.g. IST) generated its last bucket for
// "yesterday" while today's UTC-keyed payments had nowhere to land, so
// today's subscriptions silently vanished from the chart.
export const subscriptionTrend = asyncHandler(async (req, res) => {
  const { range, days, unit } = resolveTrendRange(req.query)

  const now = new Date()
  const points = []
  let since

  if (unit === 'day') {
    const todayUTC = startOfUTCDay(now)
    since = new Date(todayUTC)
    since.setUTCDate(since.getUTCDate() - days)
    for (const d = new Date(since); d <= todayUTC; d.setUTCDate(d.getUTCDate() + 1)) {
      points.push({ key: dayKey(d), label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }) })
    }
  } else {
    const roughSince = new Date(now)
    roughSince.setUTCDate(roughSince.getUTCDate() - days)
    since = startOfUTCMonth(roughSince)
    const thisMonthUTC = startOfUTCMonth(now)
    for (const d = new Date(since); d <= thisMonthUTC; d.setUTCMonth(d.getUTCMonth() + 1)) {
      points.push({ key: monthKey(d), label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }) })
    }
  }

  const employees = await Employee.find({
    'subscription.status': 'paid',
    'subscription.paidOn': { $gte: since },
  }).select('subscription.paidOn subscription.amount')

  const bucketMap = new Map(points.map((p) => [p.key, { count: 0, amount: 0 }]))
  for (const emp of employees) {
    const paidOn = emp.subscription?.paidOn
    if (!paidOn) continue
    const d = new Date(paidOn)
    const key = unit === 'day' ? dayKey(d) : monthKey(d)
    const bucket = bucketMap.get(key)
    if (!bucket) continue
    bucket.count += 1
    bucket.amount += emp.subscription.amount ?? 0
  }

  const series = points.map((p) => ({ label: p.label, ...bucketMap.get(p.key) }))
  const totalCount = series.reduce((n, p) => n + p.count, 0)
  const totalAmount = series.reduce((n, p) => n + p.amount, 0)

  res.json({ range, days, series, totalCount, totalAmount })
})

// Employer job-posting revenue (paid invoices) bucketed the same way as
// subscriptionTrend above — by day (week/month view) or by month (year
// view), with every bucket in range present at zero.
//
// Invoice has no separate paid-on date, so we bucket by `date` (the
// invoice-issued date). That reflects when the invoice was raised, not
// necessarily when payment was received — same caveat as sourcing directly
// from the only date field available on the model.
export const employerRevenueTrend = asyncHandler(async (req, res) => {
  const { range, days, unit } = resolveTrendRange(req.query)

  const now = new Date()
  const points = []
  let since

  if (unit === 'day') {
    const todayUTC = startOfUTCDay(now)
    since = new Date(todayUTC)
    since.setUTCDate(since.getUTCDate() - days)
    for (const d = new Date(since); d <= todayUTC; d.setUTCDate(d.getUTCDate() + 1)) {
      points.push({ key: dayKey(d), label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }) })
    }
  } else {
    const roughSince = new Date(now)
    roughSince.setUTCDate(roughSince.getUTCDate() - days)
    since = startOfUTCMonth(roughSince)
    const thisMonthUTC = startOfUTCMonth(now)
    for (const d = new Date(since); d <= thisMonthUTC; d.setUTCMonth(d.getUTCMonth() + 1)) {
      points.push({ key: monthKey(d), label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }) })
    }
  }

  const invoices = await Invoice.find({
    status: 'paid',
    date: { $gte: since },
  }).select('date amount')

  const bucketMap = new Map(points.map((p) => [p.key, { count: 0, amount: 0 }]))
  for (const inv of invoices) {
    const d = new Date(inv.date)
    const key = unit === 'day' ? dayKey(d) : monthKey(d)
    const bucket = bucketMap.get(key)
    if (!bucket) continue
    bucket.count += 1
    bucket.amount += inv.amount ?? 0
  }

  const series = points.map((p) => ({ label: p.label, ...bucketMap.get(p.key) }))
  const totalCount = series.reduce((n, p) => n + p.count, 0)
  const totalAmount = series.reduce((n, p) => n + p.amount, 0)

  res.json({ range, days, series, totalCount, totalAmount })
})

export const recordSubscriptionPayment = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  employee.subscription.status = 'paid'
  employee.subscription.paidOn = new Date()
  await employee.save()

  await logStaffActivity(`Recorded ₹${employee.subscription.amount} subscription payment for ${employee.name}`, 'green')
  await notifyEmployee(employee, {
    category: 'system',
    title: 'Payment recorded',
    body: `Your ₹${employee.subscription.amount} subscription payment has been recorded — your Mzobs subscription is now active.`,
  })

  res.json(employee.subscription)
})
