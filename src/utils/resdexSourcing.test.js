import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import Candidate from '../models/Candidate.js'
import Job from '../models/Job.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import CvCreditSubscription from '../models/CvCreditSubscription.js'
import CreditLedger from '../models/CreditLedger.js'
import { findOrCreateSourcedCandidate, JobNotFoundError, NO_JOB_LABEL } from './resdexSourcing.js'
import { unlockCandidateForCredit, grantCredits } from './creditWallet.js'

// Integration tests against a real, disposable local MongoDB (same approach
// as creditWallet.test.js) — its own database name, dropped on completion.
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_resdex_sourcing_test'

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([Candidate.deleteMany({}), Job.deleteMany({}), CandidateUnlock.deleteMany({}), CvCreditSubscription.deleteMany({}), CreditLedger.deleteMany({})])
})

const employee = () => ({
  _id: new mongoose.Types.ObjectId(),
  name: 'Mayank Upadhyay',
  resumeHeadline: 'Sales executive',
  experienceYears: 0,
  currentCity: 'Lucknow',
  skills: ['SQL', 'Sales'],
  email: 'm@example.com',
  phone: '9999999999',
  resume: { status: 'verified' },
})

const makeJob = (companyId, title = 'Sales Executive') =>
  Job.create({
    company: companyId,
    title,
    department: 'Sales',
    employmentType: 'Full-time',
    experienceMin: 0,
    experienceMax: 2,
    salaryMin: 200000,
    salaryMax: 400000,
    vacancies: 1,
    location: 'Lucknow',
    workMode: 'On-site',
    description: 'Sell things',
    deadline: new Date(Date.now() + 30 * 86400000),
  })

describe('findOrCreateSourcedCandidate', () => {
  test('an employer with no job can still source a candidate (no jobId needed)', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const emp = employee()

    const candidate = await findOrCreateSourcedCandidate({ companyId, employee: emp })

    assert.equal(candidate.job, null)
    assert.equal(candidate.appliedFor, NO_JOB_LABEL)
    assert.equal(candidate.source, 'Resdex Search')
    assert.equal(String(candidate.employee), String(emp._id))
  })

  test('with a jobId, the candidate joins that job and is labelled with its title', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const job = await makeJob(companyId, 'Account Manager')

    const candidate = await findOrCreateSourcedCandidate({ companyId, employee: employee(), jobId: String(job._id) })

    assert.equal(String(candidate.job), String(job._id))
    assert.equal(candidate.appliedFor, 'Account Manager')
  })

  test("another company's job, or a malformed id, is rejected — never attached", async () => {
    const companyId = new mongoose.Types.ObjectId()
    const otherJob = await makeJob(new mongoose.Types.ObjectId())

    await assert.rejects(() => findOrCreateSourcedCandidate({ companyId, employee: employee(), jobId: String(otherJob._id) }), JobNotFoundError)
    await assert.rejects(() => findOrCreateSourcedCandidate({ companyId, employee: employee(), jobId: 'not-an-id' }), JobNotFoundError)
    assert.equal(await Candidate.countDocuments({}), 0)
  })

  test('sourcing the same employee twice reuses the row', async () => {
    const companyId = new mongoose.Types.ObjectId()
    const emp = employee()

    const first = await findOrCreateSourcedCandidate({ companyId, employee: emp })
    const second = await findOrCreateSourcedCandidate({ companyId, employee: emp })

    assert.equal(String(first._id), String(second._id))
    assert.equal(await Candidate.countDocuments({}), 1)
  })
})

describe('unlock with no job posting (the reported bug)', () => {
  test('spends exactly one credit, and unlocking again is free', async () => {
    const companyId = new mongoose.Types.ObjectId()
    await grantCredits(companyId, { delta: 40, type: 'admin_add' })
    const candidate = await findOrCreateSourcedCandidate({ companyId, employee: employee() })

    const first = await unlockCandidateForCredit({ companyId, candidateId: candidate._id, jobId: candidate.job })
    assert.equal(first.alreadyUnlocked, false)
    assert.equal(first.unlock.job, null)

    const again = await unlockCandidateForCredit({ companyId, candidateId: candidate._id, jobId: candidate.job })
    assert.equal(again.alreadyUnlocked, true)

    const wallet = await CvCreditSubscription.findOne({ company: companyId })
    assert.equal(wallet.remainingCredits, 39)
  })
})
