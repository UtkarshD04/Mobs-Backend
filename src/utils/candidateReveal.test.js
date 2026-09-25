import 'dotenv/config'
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import CandidateUnlock from '../models/CandidateUnlock.js'
import CvCreditSubscription from '../models/CvCreditSubscription.js'
import CreditLedger from '../models/CreditLedger.js'
import { REVEAL_PARTS, revealedParts, parseRevealField, addRevealedParts } from './candidateReveal.js'
import { unlockCandidateForCredit, grantCredits } from './creditWallet.js'
import { redactCandidate } from '../controllers/candidateController.js'
import { redactEmployee } from '../controllers/employerResumeSearchController.js'

// Integration tests against a real, disposable local MongoDB (same approach as
// creditWallet.test.js) — its own database name, dropped on completion.
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_reveal_test'

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([CandidateUnlock.deleteMany({}), CvCreditSubscription.deleteMany({}), CreditLedger.deleteMany({})])
})

const balance = async (companyId) => (await CvCreditSubscription.findOne({ company: companyId })).remainingCredits
const setUp = async (credits = 10) => {
  const companyId = new mongoose.Types.ObjectId()
  await grantCredits(companyId, { delta: credits, type: 'admin_add' })
  return { companyId, candidateId: new mongoose.Types.ObjectId() }
}

describe('parseRevealField', () => {
  test('one part → just that part', () => {
    assert.deepEqual(parseRevealField('email'), ['email'])
    assert.deepEqual(parseRevealField('phone'), ['phone'])
    assert.deepEqual(parseRevealField('resume'), ['resume'])
  })

  test('missing (older clients) → every part, so they keep working', () => {
    assert.deepEqual(parseRevealField(undefined), REVEAL_PARTS)
    assert.deepEqual(parseRevealField(''), REVEAL_PARTS)
  })

  test('anything else is invalid', () => {
    assert.equal(parseRevealField('address'), null)
    assert.equal(parseRevealField(['email']), null)
  })
})

describe('one credit per candidate, each part revealed on its own click', () => {
  test('the first reveal spends the credit and opens only that part', async () => {
    const { companyId, candidateId } = await setUp(10)

    const first = await unlockCandidateForCredit({ companyId, candidateId, reveal: ['email'] })

    assert.equal(first.alreadyUnlocked, false)
    assert.deepEqual([...revealedParts(first.unlock)], ['email'])
    assert.equal(await balance(companyId), 9)
  })

  test('revealing the other parts later is free and adds them one by one', async () => {
    const { companyId, candidateId } = await setUp(10)
    await unlockCandidateForCredit({ companyId, candidateId, reveal: ['email'] })

    const phone = await unlockCandidateForCredit({ companyId, candidateId, reveal: ['phone'] })
    assert.equal(phone.alreadyUnlocked, true)
    assert.deepEqual([...revealedParts(phone.unlock)].sort(), ['email', 'phone'])

    const resume = await unlockCandidateForCredit({ companyId, candidateId, reveal: ['resume'] })
    assert.deepEqual([...revealedParts(resume.unlock)].sort(), ['email', 'phone', 'resume'])

    assert.equal(await balance(companyId), 9, 'three reveals of one candidate cost one credit in total')
    assert.equal(await CandidateUnlock.countDocuments({ company: companyId }), 1)
  })

  test('revealing the same part twice changes nothing and costs nothing', async () => {
    const { companyId, candidateId } = await setUp(10)
    await unlockCandidateForCredit({ companyId, candidateId, reveal: ['phone'] })

    const again = await unlockCandidateForCredit({ companyId, candidateId, reveal: ['phone'] })

    assert.deepEqual([...revealedParts(again.unlock)], ['phone'])
    assert.equal(await balance(companyId), 9)
  })

  test('two different candidates cost one credit each', async () => {
    const { companyId, candidateId } = await setUp(10)
    await unlockCandidateForCredit({ companyId, candidateId, reveal: ['email'] })
    await unlockCandidateForCredit({ companyId, candidateId: new mongoose.Types.ObjectId(), reveal: ['email'] })
    assert.equal(await balance(companyId), 8)
  })

  test('an unlock made without a part list (older clients) opens everything, still one credit', async () => {
    const { companyId, candidateId } = await setUp(10)

    const result = await unlockCandidateForCredit({ companyId, candidateId, reveal: parseRevealField(undefined) })

    assert.deepEqual([...revealedParts(result.unlock)].sort(), ['email', 'phone', 'resume'])
    assert.equal(await balance(companyId), 9)
  })

  test('with no credits nothing is revealed and no unlock is created', async () => {
    const { companyId, candidateId } = await setUp(1)
    await unlockCandidateForCredit({ companyId, candidateId: new mongoose.Types.ObjectId(), reveal: ['email'] })

    await assert.rejects(() => unlockCandidateForCredit({ companyId, candidateId, reveal: ['email'] }), { name: 'InsufficientCreditsError' })
    assert.equal(await CandidateUnlock.countDocuments({ company: companyId, candidate: candidateId }), 0)
  })
})

describe('unlocks made before per-part reveals existed', () => {
  test('a row with no `revealed` list counts as everything revealed', async () => {
    const legacy = await CandidateUnlock.create({ company: new mongoose.Types.ObjectId(), candidate: new mongoose.Types.ObjectId(), creditsUsed: 1 })

    assert.equal(legacy.revealed, undefined)
    assert.deepEqual([...revealedParts(legacy)].sort(), ['email', 'phone', 'resume'])
  })

  test('adding a part to a legacy row does not take the others away', async () => {
    const legacy = await CandidateUnlock.create({ company: new mongoose.Types.ObjectId(), candidate: new mongoose.Types.ObjectId(), creditsUsed: 1 })

    const after = await addRevealedParts(legacy, ['phone'])
    const stored = await CandidateUnlock.findById(legacy._id)

    assert.deepEqual([...revealedParts(after)].sort(), ['email', 'phone', 'resume'])
    assert.equal(stored.revealed, undefined, 'still a legacy row in the database')
  })

  test('a new unlock found through the credit path on a legacy row is not narrowed', async () => {
    const { companyId, candidateId } = await setUp(10)
    await CandidateUnlock.create({ company: companyId, candidate: candidateId, creditsUsed: 1 })

    const result = await unlockCandidateForCredit({ companyId, candidateId, reveal: ['email'] })

    assert.equal(result.alreadyUnlocked, true)
    assert.deepEqual([...revealedParts(result.unlock)].sort(), ['email', 'phone', 'resume'])
    assert.equal(await balance(companyId), 10)
  })
})

describe('only revealed parts are ever sent', () => {
  const candidate = () => ({ toJSON: () => ({ id: 'c1', name: 'Jordan', email: 'jordan@example.com', phone: '+919876543210' }) })
  const employee = () => ({ _id: new mongoose.Types.ObjectId(), name: 'Jordan Rivera', email: 'jordan@example.com', phone: '+919876543210' })

  test('pipeline candidate: email revealed, phone still hidden', () => {
    const out = redactCandidate(candidate(), true, new Set(['email']))
    assert.equal(out.email, 'jordan@example.com')
    assert.equal(out.phone, null)
    assert.deepEqual(out.revealed, ['email'])
    assert.equal(out.unlocked, true)
    assert.ok(out.contactPreview.phone.endsWith('3210'), 'masked preview is still there')
  })

  test('pipeline candidate: phone revealed, email still hidden', () => {
    const out = redactCandidate(candidate(), true, new Set(['phone']))
    assert.equal(out.email, null)
    assert.equal(out.phone, '+919876543210')
  })

  test('pipeline candidate: paid but nothing revealed yet sends nothing', () => {
    const out = redactCandidate(candidate(), true, new Set())
    assert.equal(out.email, null)
    assert.equal(out.phone, null)
    assert.equal(out.unlocked, true)
  })

  test('pipeline candidate: not paid sends nothing, whatever parts are passed', () => {
    const out = redactCandidate(candidate(), false, new Set(REVEAL_PARTS))
    assert.equal(out.email, null)
    assert.equal(out.phone, null)
    assert.deepEqual(out.revealed, [])
  })

  test('resume database profile: same per-part rule', () => {
    const emp = employee()
    const email = redactEmployee(emp, { unlocked: true, candidateId: 'c1', revealed: new Set(['email']) })
    assert.equal(email.email, 'jordan@example.com')
    assert.equal(email.phone, null)
    assert.deepEqual(email.revealed, ['email'])

    const locked = redactEmployee(emp, { unlocked: false, candidateId: null, revealed: new Set(REVEAL_PARTS) })
    assert.equal(locked.email, null)
    assert.equal(locked.phone, null)
    assert.deepEqual(locked.revealed, [])
  })

  test('resume database profile: callers that do not track parts (revealed omitted) get everything once unlocked', () => {
    const out = redactEmployee(employee(), { unlocked: true, candidateId: 'c1' })
    assert.equal(out.email, 'jordan@example.com')
    assert.equal(out.phone, '+919876543210')
  })
})
