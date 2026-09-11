import 'dotenv/config'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CV_CREDIT_PLANS, RUPEES_PER_CV_CREDIT, rupeesPerCredit } from './cvCreditPlans.js'

describe('CV-credit plan catalog', () => {
  test('every default plan prices out to exactly ₹25/credit', () => {
    for (const plan of DEFAULT_CV_CREDIT_PLANS) {
      assert.equal(rupeesPerCredit(plan), RUPEES_PER_CV_CREDIT, `${plan.code} should be ₹${RUPEES_PER_CV_CREDIT}/credit`)
    }
  })

  test('the ₹5,000 Business plan grants exactly 200 credits', () => {
    const business = DEFAULT_CV_CREDIT_PLANS.find((p) => p.code === 'CV_BUSINESS_200')
    assert.equal(business.amountPaise, 500000)
    assert.equal(business.creditsGranted, 200)
  })

  test('the ₹1,250 Starter plan grants exactly 50 credits', () => {
    const starter = DEFAULT_CV_CREDIT_PLANS.find((p) => p.code === 'CV_STARTER_50')
    assert.equal(starter.amountPaise, 125000)
    assert.equal(starter.creditsGranted, 50)
  })

  test('the ₹2,500 Growth plan grants exactly 100 credits', () => {
    const growth = DEFAULT_CV_CREDIT_PLANS.find((p) => p.code === 'CV_GROWTH_100')
    assert.equal(growth.amountPaise, 250000)
    assert.equal(growth.creditsGranted, 100)
  })
})
