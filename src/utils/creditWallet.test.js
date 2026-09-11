import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import CvCreditSubscription from '../models/CvCreditSubscription.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import CreditLedger from '../models/CreditLedger.js'
import CreditPlan from '../models/CreditPlan.js'
import Payment from '../models/Payment.js'
import { grantCredits, adminAdjustCredits, unlockCandidateForCredit, activateCvCreditPurchase, getWalletBalance, InsufficientCreditsError } from './creditWallet.js'

// Integration tests against a real (local, disposable) MongoDB — the
// business rules under test here (atomic decrement, unique-index race
// resolution, compare-and-swap idempotency) are genuine database behavior,
// not something a pure function mock could meaningfully verify. Uses its
// own database name so it never touches dev data; drops it on completion.
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_cvcredit_test'

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([
    CvCreditSubscription.deleteMany({}),
    CandidateUnlock.deleteMany({}),
    CreditLedger.deleteMany({}),
    CreditPlan.deleteMany({}),
    Payment.deleteMany({}),
  ])
})

describe('purchase activation', () => {
  test('activating a ₹5,000 (500000 paise) purchase grants exactly 200 credits', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const plan = await CreditPlan.create({ code: 'TEST_BIZ', name: 'Business', amountPaise: 500000, creditsGranted: 200 })
    const payment = await Payment.create({
      purpose: 'employer_cv_credit',
      company: companyId,
      creditPlan: plan._id,
      creditsGranted: plan.creditsGranted,
      razorpayOrderId: `order_${Date.now()}`,
      amount: 5000,
      status: 'created',
      receipt: 'r1',
    })

    const activated = await activateCvCreditPurchase(payment._id)
    assert.ok(activated)

    const wallet = await getWalletBalance(companyId)
    assert.equal(wallet.remainingCredits, 200)
    assert.equal(wallet.totalCredits, 200)
    assert.equal(wallet.usedCredits, 0)
    assert.equal(wallet.amountPaid, 500000)
  })

  test('activating the same payment twice (verify + webhook race) grants credits only once', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const plan = await CreditPlan.create({ code: 'TEST_DUP', name: 'Dup Test', amountPaise: 125000, creditsGranted: 50 })
    const payment = await Payment.create({
      purpose: 'employer_cv_credit',
      company: companyId,
      creditPlan: plan._id,
      creditsGranted: plan.creditsGranted,
      razorpayOrderId: `order_dup_${Date.now()}`,
      amount: 1250,
      status: 'created',
      receipt: 'r2',
    })

    const [first, second] = await Promise.all([
      activateCvCreditPurchase(payment._id, { razorpayPaymentId: 'pay_1' }),
      activateCvCreditPurchase(payment._id, { razorpayPaymentId: 'pay_1' }),
    ])
    const winners = [first, second].filter(Boolean)
    assert.equal(winners.length, 1, 'exactly one of the two concurrent activations should win the created->paid transition')

    const wallet = await getWalletBalance(companyId)
    assert.equal(wallet.remainingCredits, 50)
    assert.equal(wallet.totalCredits, 50)

    // A later call (the slower of verify-endpoint / webhook arriving after
    // the other already completed) must be a pure no-op.
    const third = await activateCvCreditPurchase(payment._id, { razorpayPaymentId: 'pay_1' })
    assert.equal(third, null)
    const walletAfter = await getWalletBalance(companyId)
    assert.equal(walletAfter.remainingCredits, 50)
  })
})

describe('candidate unlock spending', () => {
  test('the first CV unlock deducts exactly one credit', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const candidateId = new mongoose.Types.ObjectId()
    await grantCredits(companyId, { delta: 10, type: 'purchase', description: 'seed' })

    const { unlock, alreadyUnlocked } = await unlockCandidateForCredit({ companyId, candidateId })
    assert.equal(alreadyUnlocked, false)
    assert.ok(unlock)

    const wallet = await getWalletBalance(companyId)
    assert.equal(wallet.remainingCredits, 9)
    assert.equal(wallet.usedCredits, 1)
  })

  test('reopening an already-unlocked candidate deducts zero further credits', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const candidateId = new mongoose.Types.ObjectId()
    await grantCredits(companyId, { delta: 5, type: 'purchase', description: 'seed' })

    await unlockCandidateForCredit({ companyId, candidateId })
    const second = await unlockCandidateForCredit({ companyId, candidateId })

    assert.equal(second.alreadyUnlocked, true)
    const wallet = await getWalletBalance(companyId)
    assert.equal(wallet.remainingCredits, 4)
    assert.equal(wallet.usedCredits, 1)
    assert.equal(await CandidateUnlock.countDocuments({ company: companyId, candidate: candidateId }), 1)
  })

  test('insufficient credits blocks the unlock and creates no CandidateUnlock/ledger rows', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const candidateId = new mongoose.Types.ObjectId()

    await assert.rejects(() => unlockCandidateForCredit({ companyId, candidateId }), InsufficientCreditsError)
    assert.equal(await CandidateUnlock.countDocuments({ company: companyId, candidate: candidateId }), 0)
    assert.equal(await CreditLedger.countDocuments({ company: companyId }), 0)
  })

  test('two employers can independently unlock the same candidate id without sharing balance or unlock state', async () => {
    const companyA = new mongoose.Types.ObjectId()
    const companyB = new mongoose.Types.ObjectId()
    const candidateId = new mongoose.Types.ObjectId()
    await grantCredits(companyA, { delta: 1, type: 'purchase', description: 'seed A' })
    // companyB deliberately has zero credits.

    const resultA = await unlockCandidateForCredit({ companyId: companyA, candidateId })
    assert.equal(resultA.alreadyUnlocked, false)

    await assert.rejects(() => unlockCandidateForCredit({ companyId: companyB, candidateId }), InsufficientCreditsError)

    const walletB = await getWalletBalance(companyB)
    assert.equal(walletB.remainingCredits, 0)
    assert.equal(await CandidateUnlock.findOne({ company: companyB, candidate: candidateId }), null)
    // Employer A's own unlock is untouched by employer B's failed attempt.
    assert.equal(await CandidateUnlock.countDocuments({ company: companyA, candidate: candidateId }), 1)
  })

  test('concurrent unlock attempts for the same candidate deduct only one credit total', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const candidateId = new mongoose.Types.ObjectId()
    await grantCredits(companyId, { delta: 20, type: 'purchase', description: 'seed' })

    const results = await Promise.all(Array.from({ length: 15 }, () => unlockCandidateForCredit({ companyId, candidateId })))
    const realUnlocks = results.filter((r) => r.alreadyUnlocked === false)
    assert.equal(realUnlocks.length, 1, 'exactly one of the 15 concurrent callers should have performed the real unlock')

    const wallet = await getWalletBalance(companyId)
    assert.equal(wallet.remainingCredits, 19)
    assert.equal(wallet.usedCredits, 1)
    assert.equal(await CandidateUnlock.countDocuments({ company: companyId, candidate: candidateId }), 1)
  })
})

describe('admin ledger adjustments', () => {
  test('CreditLedger balanceAfter always matches the wallet remainingCredits after each mutation', async () => {
    const companyId = new mongoose.Types.ObjectId()
    await grantCredits(companyId, { delta: 10, type: 'purchase', description: 'seed' })
    await adminAdjustCredits(companyId, { delta: 5, reason: 'goodwill credit', staffId: new mongoose.Types.ObjectId() })
    await adminAdjustCredits(companyId, { delta: -3, reason: 'correction', staffId: new mongoose.Types.ObjectId() })

    const wallet = await getWalletBalance(companyId)
    assert.equal(wallet.remainingCredits, 12)

    const rows = await CreditLedger.find({ company: companyId }).sort({ createdAt: 1 })
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map((r) => r.balanceAfter), [10, 15, 12])
    assert.deepEqual(rows.map((r) => r.type), ['purchase', 'admin_add', 'admin_deduct'])
  })

  test('an admin deduction that would overdraw the balance is rejected and never touches history', async () => {
    const companyId = new mongoose.Types.ObjectId()
    await grantCredits(companyId, { delta: 10, type: 'purchase', description: 'seed' })

    await assert.rejects(
      () => adminAdjustCredits(companyId, { delta: -999, reason: 'too much', staffId: new mongoose.Types.ObjectId() }),
      InsufficientCreditsError
    )

    const wallet = await getWalletBalance(companyId)
    assert.equal(wallet.remainingCredits, 10, 'a rejected deduction must not touch the balance')
    assert.equal(await CreditLedger.countDocuments({ company: companyId }), 1, 'only the original seed purchase should be on the ledger')
  })

  test('a manual adjustment without a reason is rejected', async () => {
    const companyId = new mongoose.Types.ObjectId()
    await assert.rejects(() => adminAdjustCredits(companyId, { delta: 5, reason: '', staffId: new mongoose.Types.ObjectId() }), /reason is required/)
  })
})
