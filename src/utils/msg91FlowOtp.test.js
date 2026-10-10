process.env.JWT_SECRET ??= 'unit-test-secret'
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_flowotp_test'
process.env.MONGO_URI ??= TEST_MONGO_URI
import { test, describe, before, after, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import mongoose from 'mongoose'
const { env } = await import('../config/env.js')
const { default: PhoneOtp } = await import('../models/PhoneOtp.js')
const { sendOtp, verifyOtp } = await import('./msg91.js')

// Integration test against a disposable local MongoDB, with MSG91 itself stubbed out: what matters
// here is that the code we text is the code we later accept, once, and never more than 5 guesses.
const PHONE = '9876543210'
let sent

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})
after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})
beforeEach(async () => {
  await PhoneOtp.deleteMany({})
  env.msg91.otpFlowTemplateId = 'tpl_otp'
  env.msg91.otpFlowVariable = 'otp'
  env.msg91.authKey = 'key'
  sent = []
  mock.method(axios, 'post', async (url, body) => {
    sent.push({ url, body })
    return { data: { type: 'success', message: 'req_1' } }
  })
})

const lastCode = () => sent.at(-1).body.recipients[0].otp

describe('mobile OTP through the SMS (Flow) API', () => {
  test('texts a 6-digit code through the flow endpoint with the OTP template', async () => {
    await sendOtp(PHONE)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, 'https://control.msg91.com/api/v5/flow')
    assert.equal(sent[0].body.template_id, 'tpl_otp')
    assert.equal(sent[0].body.recipients[0].mobiles, `91${PHONE}`)
    assert.match(lastCode(), /^\d{6}$/)
  })

  test('the code we sent verifies once, then is spent', async () => {
    await sendOtp(PHONE)
    const code = lastCode()
    assert.equal(await verifyOtp(PHONE, code), true)
    assert.equal(await verifyOtp(PHONE, code), false)
  })

  test('a wrong code is rejected and the right one still works afterwards', async () => {
    await sendOtp(PHONE)
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    assert.equal(await verifyOtp(PHONE, wrong), false)
    assert.equal(await verifyOtp(PHONE, code), true)
  })

  test('five wrong guesses burn the code', async () => {
    await sendOtp(PHONE)
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) assert.equal(await verifyOtp(PHONE, wrong), false)
    assert.equal(await verifyOtp(PHONE, code), false)
  })

  test('an expired code is rejected', async () => {
    await sendOtp(PHONE)
    const code = lastCode()
    await PhoneOtp.updateOne({ phone: PHONE }, { expiresAt: new Date(Date.now() - 1000) })
    assert.equal(await verifyOtp(PHONE, code), false)
  })

  test('a code is bound to its number', async () => {
    await sendOtp(PHONE)
    assert.equal(await verifyOtp('9123456780', lastCode()), false)
  })

  test('asking again within 30 seconds is refused with a 429', async () => {
    await sendOtp(PHONE)
    await assert.rejects(() => sendOtp(PHONE), (err) => err.status === 429)
    assert.equal(sent.length, 1)
  })

  test('a failed send drops the code so the person can retry straight away', async () => {
    axios.post.mock.mockImplementation(async () => ({ data: { type: 'error', message: 'template not approved' } }))
    await assert.rejects(() => sendOtp(PHONE), (err) => err.status === 502)
    assert.equal(await PhoneOtp.countDocuments({ phone: PHONE }), 0)
    axios.post.mock.mockImplementation(async (url, body) => {
      sent.push({ url, body })
      return { data: { type: 'success' } }
    })
    await sendOtp(PHONE)
    assert.equal(sent.length, 1)
  })

  test('without a flow template it falls back to the OTP API', async () => {
    env.msg91.otpFlowTemplateId = ''
    await sendOtp(PHONE)
    assert.equal(sent[0].url, 'https://control.msg91.com/api/v5/otp')
    assert.equal(await PhoneOtp.countDocuments({}), 0)
  })
})
