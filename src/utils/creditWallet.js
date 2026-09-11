import CvCreditSubscription from '../models/CvCreditSubscription.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import CreditLedger from '../models/CreditLedger.js'
import CreditPlan from '../models/CreditPlan.js'
import Payment from '../models/Payment.js'
import { logActivity } from './activityLog.js'
import { incrementCouponUsage } from './coupon.js'
import { logger } from '../config/logger.js'

export class InsufficientCreditsError extends Error {
  constructor(message = 'Not enough CV credits remaining') {
    super(message)
    this.name = 'InsufficientCreditsError'
    this.statusCode = 402
  }
}

// Read-only — never mutates. A company with no purchases yet simply has no
// wallet row, which reads as a zero balance rather than a 404, so the
// dashboard has something to render before the employer's first purchase.
export async function getWalletBalance(companyId) {
  const wallet = await CvCreditSubscription.findOne({ company: companyId })
  if (wallet) return wallet
  return {
    id: null,
    companyId: companyId.toString(),
    planName: null,
    planCode: null,
    amountPaid: 0,
    totalCredits: 0,
    usedCredits: 0,
    remainingCredits: 0,
    status: 'active',
    startsAt: null,
    expiresAt: null,
  }
}

// The single place a wallet balance is ever mutated, always paired with a
// CreditLedger row in the same call — so CvCreditSubscription.remainingCredits
// and the ledger's running balance can never drift apart. `delta` positive
// grants credits (purchase/admin_add/refund-in), negative spends them
// (admin_deduct/refund-out) — cv_unlock spending goes through
// unlockCandidateForCredit below instead, since it also needs the
// CandidateUnlock row created atomically alongside the decrement.
export async function grantCredits(companyId, { delta, type, planName = null, planCode = null, paymentId = null, amountPaidDelta = 0, referenceType = null, referenceId = null, description = '', performedBy = null }) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('delta must be a non-zero integer')

  const setFields = { status: 'active' }
  if (planName) setFields.planName = planName
  if (planCode) setFields.planCode = planCode
  if (paymentId) setFields.payment = paymentId

  let wallet
  if (delta > 0) {
    wallet = await CvCreditSubscription.findOneAndUpdate(
      { company: companyId },
      {
        $inc: { remainingCredits: delta, totalCredits: delta, amountPaid: amountPaidDelta },
        $set: setFields,
        $setOnInsert: { company: companyId, startsAt: new Date() },
      },
      { new: true, upsert: true }
    )
  } else {
    // Admin deduction — atomic conditional decrement, never lets the
    // balance go negative regardless of what the caller believes it to be.
    wallet = await CvCreditSubscription.findOneAndUpdate(
      { company: companyId, remainingCredits: { $gte: -delta } },
      { $inc: { remainingCredits: delta, usedCredits: -delta }, $set: setFields },
      { new: true }
    )
    if (!wallet) throw new InsufficientCreditsError('Cannot deduct more credits than the employer currently has')
  }

  await CreditLedger.create({
    company: companyId,
    type,
    delta,
    balanceAfter: wallet.remainingCredits,
    referenceType,
    referenceId,
    description,
    performedBy,
  })

  return wallet
}

export async function adminAdjustCredits(companyId, { delta, reason, staffId }) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('delta must be a non-zero integer')
  if (!reason || !reason.trim()) throw new Error('A reason is required for a manual credit adjustment')

  const wallet = await grantCredits(companyId, {
    delta,
    type: delta > 0 ? 'admin_add' : 'admin_deduct',
    description: reason.trim(),
    performedBy: staffId,
    referenceType: 'StaffUser',
    referenceId: staffId,
  })
  await logStaffCreditAdjustment(companyId, delta, reason.trim())
  return wallet
}

async function logStaffCreditAdjustment(companyId, delta, reason) {
  try {
    await logActivity(companyId, `Mzobs support ${delta > 0 ? 'added' : 'deducted'} ${Math.abs(delta)} CV credit${Math.abs(delta) === 1 ? '' : 's'} — ${reason}`, delta > 0 ? 'green' : 'navy')
  } catch (err) {
    logger.warn({ err }, 'Failed to log company activity for admin credit adjustment')
  }
}

// Idempotent purchase activation shared by the verify-payment endpoint and
// the Razorpay webhook — mirrors activateEmployerSubscription.js's
// "whichever path lands first wins" pattern, but the guard here is an
// atomic conditional update on the Payment document itself (status:
// 'created' -> 'paid') rather than a status check on the thing being
// activated, since the wallet is a single aggregate row with no natural
// "already applied" state of its own. findOneAndUpdate's compare-and-swap
// is atomic at the document level even without a multi-document transaction
// (this deployment's MongoDB runs as a standalone instance, which doesn't
// support those) — only one of two concurrent callers can ever win the
// 'created' -> 'paid' transition, so credits are granted exactly once no
// matter how many times verify/webhook are both retried.
export async function activateCvCreditPurchase(paymentId, { razorpayPaymentId = null, razorpaySignature = null } = {}) {
  const update = { status: 'paid', paidAt: new Date() }
  if (razorpayPaymentId) update.razorpayPaymentId = razorpayPaymentId
  if (razorpaySignature) update.razorpaySignature = razorpaySignature

  const claimed = await Payment.findOneAndUpdate({ _id: paymentId, purpose: 'employer_cv_credit', status: 'created' }, { $set: update }, { new: true })
  if (!claimed) return null // Already activated by the other path — idempotent no-op.

  const plan = claimed.creditPlan ? await CreditPlan.findById(claimed.creditPlan) : null
  const planName = plan?.name ?? 'CV Credit Pack'
  const planCode = plan?.code ?? null
  const creditsGranted = claimed.creditsGranted ?? plan?.creditsGranted ?? 0

  await grantCredits(claimed.company, {
    delta: creditsGranted,
    type: 'purchase',
    planName,
    planCode,
    paymentId: claimed._id,
    amountPaidDelta: Math.round(claimed.amount * 100), // Payment.amount is rupees; wallet.amountPaid is paise
    referenceType: 'Payment',
    referenceId: claimed._id,
    description: `Purchased ${planName} — ${creditsGranted} CV credits`,
  })

  // The `findOneAndUpdate` above only ever claims a given payment once, so
  // this only ever runs once too — safe from the same verify/webhook race
  // that the credit grant itself is guarded against, no separate idempotency
  // check needed here.
  if (claimed.couponCode) {
    try {
      await incrementCouponUsage(claimed.couponCode)
    } catch (err) {
      logger.warn({ err, couponCode: claimed.couponCode }, 'Failed to increment coupon usage for CV credit purchase')
    }
  }

  // Credits are already granted at this point — a failure logging the
  // activity-feed note must never make this call look like it failed (the
  // caller would otherwise be tempted to retry a purchase that already succeeded).
  try {
    await logActivity(claimed.company, `${planName} purchased — ${creditsGranted} CV credits added`, 'green')
  } catch (err) {
    logger.warn({ err }, 'Failed to log company activity for CV credit purchase')
  }

  return claimed
}

// The one place credits are spent for real (cv_unlock). Concurrency-safe
// without a multi-document transaction:
//  1. The credit decrement is a single atomic document update, conditioned
//     on remainingCredits >= 1 — two simultaneous callers can never both
//     succeed against the same unit of balance.
//  2. The CandidateUnlock unique index (company, candidate) is the second
//     guard: if two concurrent "first unlock" requests for the very same
//     candidate both pass step 1 (because there was more than one credit
//     left), only one of their CandidateUnlock inserts can succeed — the
//     loser's decrement is refunded, so net spend for that candidate is
//     still exactly one credit.
export async function unlockCandidateForCredit({ companyId, candidateId, jobId = null, userId = null }) {
  const existing = await CandidateUnlock.findOne({ company: companyId, candidate: candidateId })
  if (existing) return { unlock: existing, alreadyUnlocked: true }

  const wallet = await CvCreditSubscription.findOneAndUpdate(
    { company: companyId, remainingCredits: { $gte: 1 } },
    { $inc: { remainingCredits: -1, usedCredits: 1 } },
    { new: true }
  )
  if (!wallet) throw new InsufficientCreditsError()

  async function refundDecrement() {
    await CvCreditSubscription.updateOne({ company: companyId }, { $inc: { remainingCredits: 1, usedCredits: -1 } })
  }

  let unlock
  try {
    unlock = await CandidateUnlock.create({
      company: companyId,
      candidate: candidateId,
      job: jobId,
      creditsUsed: 1,
      unlockedAt: new Date(),
      unlockedBy: userId,
    })
  } catch (err) {
    await refundDecrement()
    if (err?.code === 11000) {
      const winner = await CandidateUnlock.findOne({ company: companyId, candidate: candidateId })
      if (winner) return { unlock: winner, alreadyUnlocked: true }
    }
    throw err
  }

  await CreditLedger.create({
    company: companyId,
    type: 'cv_unlock',
    delta: -1,
    balanceAfter: wallet.remainingCredits,
    referenceType: 'CandidateUnlock',
    referenceId: unlock._id,
    description: `Unlocked candidate contact & resume`,
  })

  return { unlock, alreadyUnlocked: false }
}
