process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import EmployerSubscription from '../models/EmployerSubscription.js'
import CvCreditSubscription from '../models/CvCreditSubscription.js'
import CreditLedger from '../models/CreditLedger.js'
const { activateEmployerSubscription, grantPlanCvCredits } = await import('./activateEmployerSubscription.js')
const { getEmployerPlanCvCredits } = await import('./employerPlanPricing.js')
const { env } = await import('../config/env.js')

// Same disposable local MongoDB setup as creditWallet.test.js — the
// once-only guarantee is an atomic database update, so it's tested for real.
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_plan_credits_test'

const [basic, plus, pro] = env.employerPlan.plans

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([EmployerSubscription.deleteMany({}), CvCreditSubscription.deleteMany({}), CreditLedger.deleteMany({})])
})

function makeSubscription(planDef, status) {
  return EmployerSubscription.create({
    company: new mongoose.Types.ObjectId(),
    planCode: planDef.planCode,
    planName: planDef.planName,
    amount: 117882,
    status,
  })
}

async function walletCredits(companyId) {
  const wallet = await CvCreditSubscription.findOne({ company: companyId })
  return wallet?.remainingCredits ?? 0
}

describe('plan-included CV credits', () => {
  test('tiers default to Basic 40, Plus 20, Pro 40', () => {
    assert.equal(getEmployerPlanCvCredits(basic.planCode), 40)
    assert.equal(getEmployerPlanCvCredits(plus.planCode), 20)
    assert.equal(getEmployerPlanCvCredits(pro.planCode), 40)
    assert.equal(getEmployerPlanCvCredits('SOME_RETIRED_CODE'), null)
  })

  test('activating a Basic plan adds 40 credits to the wallet', async () => {
    const sub = await makeSubscription(basic, 'pending')
    await activateEmployerSubscription(sub, { razorpayPaymentId: 'pay_1' })

    assert.equal(await walletCredits(sub.company), 40)
    const saved = await EmployerSubscription.findById(sub._id)
    assert.equal(saved.status, 'active')
    assert.equal(saved.cvCreditsGranted, 40)
  })

  test('verify + webhook activating at the same time grant credits only once', async () => {
    const sub = await makeSubscription(basic, 'pending')
    const again = await EmployerSubscription.findById(sub._id)
    await Promise.all([
      activateEmployerSubscription(sub, { razorpayPaymentId: 'pay_1' }),
      activateEmployerSubscription(again, { razorpayPaymentId: 'pay_1' }),
    ])

    assert.equal(await walletCredits(sub.company), 40)
    assert.equal(await CreditLedger.countDocuments({ company: sub.company }), 1)
  })

  test('re-running on an already-granted plan adds nothing', async () => {
    const sub = await makeSubscription(pro, 'active')
    assert.equal(await grantPlanCvCredits(sub), 40)
    assert.equal(await grantPlanCvCredits(sub), 0)
    assert.equal(await walletCredits(sub.company), 40)
  })

  test('a plan that is not active yet gets nothing', async () => {
    const sub = await makeSubscription(plus, 'pending')
    assert.equal(await grantPlanCvCredits(sub), 0)
    assert.equal(await walletCredits(sub.company), 0)
  })
})
