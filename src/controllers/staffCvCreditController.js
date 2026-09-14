import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { adminAdjustCredits } from '../utils/creditWallet.js'
import { getActiveCvCreditPlans } from '../utils/cvCreditPlans.js'
import Payment from '../models/Payment.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import CvCreditSubscription from '../models/CvCreditSubscription.js'
import CreditLedger from '../models/CreditLedger.js'
import CreditPlan from '../models/CreditPlan.js'
import Company from '../models/Company.js'

function dateRangeFilter(from, to) {
  const filter = {}
  if (from) filter.$gte = new Date(from)
  if (to) filter.$lte = new Date(to)
  return Object.keys(filter).length ? filter : undefined
}

// GET /api/staff/cv-credits/purchases — every CV-credit purchase, filterable
// by employer, plan and payment status.
export const listCreditPurchases = asyncHandler(async (req, res) => {
  const { companyId, planId, status, from, to } = req.query
  const query = { purpose: 'employer_cv_credit' }
  if (companyId) query.company = companyId
  if (planId) query.creditPlan = planId
  if (status && status !== 'all') query.status = status
  const createdAt = dateRangeFilter(from, to)
  if (createdAt) query.createdAt = createdAt

  const { data, page, limit, total } = await paginate(Payment, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: [{ path: 'company', select: 'name' }, { path: 'creditPlan', select: 'name code creditsGranted' }],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// GET /api/staff/cv-credits/unlocks — every CV unlock, filterable by
// employer, candidate and date.
export const listCvUnlocks = asyncHandler(async (req, res) => {
  const { companyId, candidateId, from, to } = req.query
  const query = {}
  if (companyId) query.company = companyId
  if (candidateId) query.candidate = candidateId
  const createdAt = dateRangeFilter(from, to)
  if (createdAt) query.createdAt = createdAt

  const { data, page, limit, total } = await paginate(CandidateUnlock, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: [{ path: 'company', select: 'name' }, { path: 'candidate', select: 'name headline appliedFor' }, { path: 'job', select: 'title' }],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// GET /api/staff/cv-credits/ledger — the full audit trail, optionally
// scoped to one employer (used by the admin employer-detail drill-down).
export const listCreditLedger = asyncHandler(async (req, res) => {
  const { companyId, type } = req.query
  const query = {}
  if (companyId) query.company = companyId
  if (type && type !== 'all') query.type = type

  const { data, page, limit, total } = await paginate(CreditLedger, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: [{ path: 'company', select: 'name' }, { path: 'performedBy', select: 'name email' }],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// GET /api/staff/cv-credits/summary — headline KPIs for the admin dashboard.
export const creditSummary = asyncHandler(async (req, res) => {
  const [revenueAgg, totalUnlocks, outstandingAgg, purchaseCount] = await Promise.all([
    Payment.aggregate([{ $match: { purpose: 'employer_cv_credit', status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    CandidateUnlock.countDocuments({}),
    CvCreditSubscription.aggregate([{ $group: { _id: null, total: { $sum: '$remainingCredits' } } }]),
    Payment.countDocuments({ purpose: 'employer_cv_credit', status: 'paid' }),
  ])

  res.json({
    totalRevenue: revenueAgg[0]?.total ?? 0, // rupees
    totalUnlocks,
    outstandingCredits: outstandingAgg[0]?.total ?? 0,
    totalPurchases: purchaseCount,
  })
})

// POST /api/staff/cv-credits/adjust — manual grant/deduction. Never edits
// history: it always creates a new CreditLedger row (admin_add/admin_deduct)
// via adminAdjustCredits, same as every other balance change.
export const adjustCredits = asyncHandler(async (req, res) => {
  const { companyId, delta, reason } = req.body ?? {}
  if (!companyId) return res.status(400).json({ message: 'companyId is required' })
  const parsedDelta = Number(delta)
  if (!Number.isInteger(parsedDelta) || parsedDelta === 0) return res.status(400).json({ message: 'delta must be a non-zero integer' })
  if (!reason || !String(reason).trim()) return res.status(400).json({ message: 'A reason is required for a manual credit adjustment' })

  const company = await Company.findById(companyId).select('name')
  if (!company) return res.status(404).json({ message: 'Company not found' })

  let wallet
  try {
    wallet = await adminAdjustCredits(companyId, { delta: parsedDelta, reason, staffId: req.staff._id })
  } catch (err) {
    return res.status(400).json({ message: err.message })
  }

  // The credit mutation above (and its CreditLedger row) already committed
  // successfully — this admin-feed note is a convenience, not the audit
  // trail, so a failure here must never surface as if the adjustment itself
  // failed (it didn't).
  try {
    await logStaffActivity(`${req.staff.name} ${parsedDelta > 0 ? 'added' : 'deducted'} ${Math.abs(parsedDelta)} CV credit${Math.abs(parsedDelta) === 1 ? '' : 's'} for ${company.name} — ${reason}`, parsedDelta > 0 ? 'green' : 'navy')
  } catch {
    // no-op — the ledger row is the real audit trail, this feed entry is best-effort.
  }

  res.json({ wallet })
})

// GET /api/staff/cv-credits/plans — the editable pack catalog.
export const listPlansForAdmin = asyncHandler(async (req, res) => {
  const plans = await getActiveCvCreditPlans()
  res.json(plans)
})

export const createPlan = asyncHandler(async (req, res) => {
  const { code, name, amountPaise, creditsGranted, sortOrder } = req.body ?? {}
  if (!code || !name) return res.status(400).json({ message: 'code and name are required' })
  const parsedAmount = Number(amountPaise)
  const parsedCredits = Number(creditsGranted)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ message: 'amountPaise must be a positive number' })
  if (!Number.isInteger(parsedCredits) || parsedCredits <= 0) return res.status(400).json({ message: 'creditsGranted must be a positive integer' })

  const existing = await CreditPlan.findOne({ code: String(code).trim().toUpperCase() })
  if (existing) return res.status(409).json({ message: 'A plan with this code already exists' })

  const plan = await CreditPlan.create({
    code: String(code).trim().toUpperCase(),
    name: String(name).trim(),
    amountPaise: parsedAmount,
    creditsGranted: parsedCredits,
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    createdBy: req.staff._id,
  })
  await logStaffActivity(`${req.staff.name} created CV-credit plan ${plan.name}`, 'green')
  res.status(201).json(plan)
})

export const updatePlan = asyncHandler(async (req, res) => {
  const plan = await CreditPlan.findById(req.params.id)
  if (!plan) return res.status(404).json({ message: 'Plan not found' })

  const { name, amountPaise, creditsGranted, sortOrder, isActive } = req.body ?? {}
  if (name !== undefined) plan.name = String(name).trim()
  if (amountPaise !== undefined) {
    const parsed = Number(amountPaise)
    if (!Number.isFinite(parsed) || parsed <= 0) return res.status(400).json({ message: 'amountPaise must be a positive number' })
    plan.amountPaise = parsed
  }
  if (creditsGranted !== undefined) {
    const parsed = Number(creditsGranted)
    if (!Number.isInteger(parsed) || parsed <= 0) return res.status(400).json({ message: 'creditsGranted must be a positive integer' })
    plan.creditsGranted = parsed
  }
  if (sortOrder !== undefined) plan.sortOrder = Number(sortOrder) || 0
  if (isActive !== undefined) plan.isActive = !!isActive

  await plan.save()
  await logStaffActivity(`${req.staff.name} updated CV-credit plan ${plan.name}`, 'navy')
  res.json(plan)
})
