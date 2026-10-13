import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

// Integration tests for the rejection-feedback workflow, driven through the real
// controllers against a real, disposable local MongoDB (same approach as
// resdexSourcing.test.js) — its own database name, dropped on completion.
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'test-secret'
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_rejection_feedback_test'

const { default: Candidate } = await import('../models/Candidate.js')
const { default: Application } = await import('../models/Application.js')
const { default: RejectionFeedback } = await import('../models/RejectionFeedback.js')
// Populate targets: the running app registers every model, a lone test process has to do it itself.
await Promise.all(['Company', 'Job', 'Employee', 'User'].map((name) => import(`../models/${name}.js`)))
const { env } = await import('../config/env.js')
const { setCandidateStage } = await import('../controllers/candidateController.js')
const employer = await import('../controllers/rejectionFeedbackController.js')
const staff = await import('../controllers/staffRejectionFeedbackController.js')
const employee = await import('../controllers/employeeFeedbackController.js')

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([Candidate.deleteMany({}), Application.deleteMany({}), RejectionFeedback.deleteMany({})])
})

const id = () => new mongoose.Types.ObjectId()

// Calls an Express handler directly and captures what it answered.
async function call(handler, req) {
  const out = { status: 200, body: undefined }
  const res = {
    status(code) { out.status = code; return res },
    json(body) { out.body = body; return res },
    set() { return res },
  }
  await handler({ params: {}, query: {}, body: {}, ...req }, res, (err) => { throw err })
  return out
}

async function seed() {
  const companyA = id()
  const companyB = id()
  const job = id()
  const candidateEmployee = id()
  const application = await Application.create({ employee: candidateEmployee, job, status: 'shared' })
  const candidate = await Candidate.create({
    company: companyA, job, employee: candidateEmployee, application: application._id, name: 'Asha Rao', appliedFor: 'Analyst', stage: 'shared',
  })
  return {
    companyA, companyB, application, candidate, candidateEmployee,
    asEmployer: (company = companyA) => ({ company: { _id: company }, user: { _id: id() } }),
    asCandidate: (employeeId = candidateEmployee) => ({ employee: { _id: employeeId } }),
    asStaff: () => ({ staff: { _id: id() } }),
  }
}

const reject = (ctx, feedback, company) =>
  call(setCandidateStage, { ...ctx.asEmployer(company), params: { id: String(ctx.candidate._id) }, body: { stage: 'rejected', ...(feedback ? { feedback } : {}) } })

const goodFeedback = { stage: 'interview', reasons: ['communication'], remarks: 'PRIVATE: talked over the panel' }

describe('employer submission', () => {
  test('rejecting without a reason is refused and leaves the candidate where they were', async () => {
    const ctx = await seed()
    const out = await reject(ctx, { stage: 'interview', reasons: [] })
    assert.equal(out.status, 400)
    assert.ok(out.body.errors.reasons)
    assert.equal((await Candidate.findById(ctx.candidate._id)).stage, 'shared')
    assert.equal(await RejectionFeedback.countDocuments(), 0)
  })

  test('rejecting with feedback saves it against the right application and queues it for review', async () => {
    const ctx = await seed()
    const out = await reject(ctx, goodFeedback)
    assert.equal(out.status, 200)
    assert.equal(out.body.feedback.status, 'pending_review')
    assert.equal(out.body.feedback.result, 'created')
    const row = await RejectionFeedback.findOne().select('+employerRemarks +audit')
    assert.equal(String(row.application), String(ctx.application._id))
    assert.equal(String(row.employee), String(ctx.candidateEmployee))
    assert.equal(row.employerRemarks, goodFeedback.remarks)
    assert.deepEqual(row.audit.map((a) => a.action), ['employer_submitted'])
    assert.ok(!JSON.stringify(out.body).includes('PRIVATE'))
  })

  test("another company cannot reject, or resubmit feedback on, this company's candidate", async () => {
    const ctx = await seed()
    const out = await reject(ctx, goodFeedback, ctx.companyB)
    assert.equal(out.status, 404)
    assert.equal(await RejectionFeedback.countDocuments(), 0)
    assert.equal((await Candidate.findById(ctx.candidate._id)).stage, 'shared')

    await reject(ctx, goodFeedback)
    const row = await RejectionFeedback.findOne()
    const resubmit = await call(employer.resubmitFeedback, { ...ctx.asEmployer(ctx.companyB), params: { id: String(row._id) }, body: goodFeedback })
    assert.equal(resubmit.status, 404)
    const read = await call(employer.getFeedbackForCandidate, { ...ctx.asEmployer(ctx.companyB), params: { candidateId: String(ctx.candidate._id) } })
    assert.equal(read.status, 404)
  })

  test('rejecting the same candidate twice keeps a single record', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    const again = await reject(ctx, { stage: 'screening_call', reasons: ['technical_skills'] })
    assert.equal(again.body.feedback.result, 'resubmitted')
    assert.equal(await RejectionFeedback.countDocuments(), 1)
    assert.equal((await RejectionFeedback.findOne()).stage, 'screening_call')
  })

  test('the legacy free-text reject still works unless feedback is made mandatory', async () => {
    const ctx = await seed()
    const legacy = await call(setCandidateStage, { ...ctx.asEmployer(), params: { id: String(ctx.candidate._id) }, body: { stage: 'rejected', rejectionReason: 'Not a fit' } })
    assert.equal(legacy.status, 200)
    assert.equal(await RejectionFeedback.countDocuments(), 0)

    env.rejectionFeedbackRequired = true
    try {
      const refused = await call(setCandidateStage, { ...ctx.asEmployer(), params: { id: String(ctx.candidate._id) }, body: { stage: 'rejected', rejectionReason: 'Not a fit' } })
      assert.equal(refused.status, 400)
      assert.equal(refused.body.code, 'FEEDBACK_REQUIRED')
    } finally {
      env.rejectionFeedbackRequired = false
    }
  })
})

describe('review and candidate visibility', () => {
  test('candidates see nothing until a reviewer approves, then only the approved text', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    await Application.updateOne({ _id: ctx.application._id }, { status: 'rejected' })
    const feedbackId = String((await RejectionFeedback.findOne())._id)

    const before = await call(employee.getFeedback, { ...ctx.asCandidate(), params: { id: String(ctx.application._id) } })
    assert.deepEqual(before.body, { status: 'pending' })

    const approved = await call(staff.reviewFeedback, { ...ctx.asStaff(), params: { id: feedbackId }, body: { action: 'approve', summary: 'Practice explaining your work clearly.' } })
    assert.equal(approved.body.status, 'approved')

    const after = await call(employee.getFeedback, { ...ctx.asCandidate(), params: { id: String(ctx.application._id) } })
    assert.equal(after.body.status, 'available')
    assert.equal(after.body.feedback.summary, 'Practice explaining your work clearly.')
    assert.equal(after.body.feedback.improvementAreas[0].code, 'communication')
    const text = JSON.stringify(after.body)
    for (const secret of ['PRIVATE', 'talked over', 'employerRemarks', 'audit', 'company']) assert.ok(!text.includes(secret), `leaked ${secret}`)
  })

  test("another candidate cannot read someone else's feedback", async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    await Application.updateOne({ _id: ctx.application._id }, { status: 'rejected' })
    await call(staff.reviewFeedback, { ...ctx.asStaff(), params: { id: String((await RejectionFeedback.findOne())._id) }, body: { action: 'approve', summary: 'Okay.' } })

    const stranger = ctx.asCandidate(id())
    const read = await call(employee.getFeedback, { ...stranger, params: { id: String(ctx.application._id) } })
    assert.equal(read.status, 404)
    const dispute = await call(employee.disputeFeedback, { ...stranger, params: { id: String(ctx.application._id) }, body: { reason: 'This is not about me at all.' } })
    assert.equal(dispute.status, 404)
  })

  test('two reviewers cannot both act on the same pending record', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    const params = { id: String((await RejectionFeedback.findOne())._id) }
    const first = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', summary: 'Fine.' } })
    const second = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'return', message: 'Please add more detail.' } })
    assert.equal(first.status, 200)
    assert.equal(second.status, 409)
    assert.equal((await RejectionFeedback.findOne()).versions.length, 1)
  })

  test('returning for clarification, resubmitting and approving walks the audit trail in order', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    const params = { id: String((await RejectionFeedback.findOne())._id) }

    const returned = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'return', message: 'Please say more about the interview.' } })
    assert.equal(returned.body.status, 'returned')
    const followUp = await call(employer.listFeedback, { ...ctx.asEmployer(), query: { followUp: '1' } })
    assert.equal(followUp.body.length, 1)
    assert.equal(followUp.body[0].clarification.message, 'Please say more about the interview.')

    const resubmit = await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: { stage: 'interview', reasons: ['problem_solving'], remarks: 'More detail' } })
    assert.equal(resubmit.body.status, 'pending_review')
    assert.equal(resubmit.body.clarification, null)

    await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', summary: 'Work on structuring your answers.' } })
    const detail = await call(staff.getFeedback, { ...ctx.asStaff(), params })
    assert.deepEqual(detail.body.audit.map((a) => a.action).filter((a) => !a.startsWith('candidate_')), ['employer_submitted', 'returned', 'employer_resubmitted', 'approved'])
    assert.equal(detail.body.employerRemarks, 'More detail')
  })

  test('the employer cannot edit feedback once it is approved, and re-rejecting does not rewrite it', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    const params = { id: String((await RejectionFeedback.findOne())._id) }
    await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', summary: 'Delivered text.' } })

    const edit = await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: { stage: 'interview', reasons: ['technical_skills'] } })
    assert.equal(edit.status, 409)

    const again = await reject(ctx, { stage: 'final_round', reasons: ['technical_skills'] })
    assert.equal(again.body.feedback.result, 'kept')
    const row = await RejectionFeedback.findOne()
    assert.equal(row.stage, 'interview')
    assert.equal(row.versions[0].summary, 'Delivered text.')
  })

  test('flagging and returning require a message the employer can read', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    const params = { id: String((await RejectionFeedback.findOne())._id) }
    assert.equal((await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'flag' } })).status, 400)
    assert.equal((await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'nope' } })).status, 400)
    assert.equal((await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'flag', message: 'Remarks contain personal comments.' } })).body.status, 'flagged')
  })

  test('the queue counts each status', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    const counts = await call(staff.feedbackCounts, {})
    assert.equal(counts.body.pending_review, 1)
    assert.equal(counts.body.followUp, 0)
  })
})

describe('disputes', () => {
  async function delivered() {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    await Application.updateOne({ _id: ctx.application._id }, { status: 'rejected' })
    const params = { id: String((await RejectionFeedback.findOne())._id) }
    await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', summary: 'Original text.' } })
    return { ctx, params, appParams: { id: String(ctx.application._id) } }
  }

  test('a candidate can report delivered feedback once; the original stays readable while it is reviewed', async () => {
    const { ctx, appParams } = await delivered()
    const first = await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'This does not describe my interview.' } })
    assert.equal(first.status, 201)
    const second = await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'Reporting it again just in case.' } })
    assert.equal(second.status, 409)

    const read = await call(employee.getFeedback, { ...ctx.asCandidate(), params: appParams })
    assert.equal(read.body.feedback.summary, 'Original text.')
    assert.equal(read.body.feedback.dispute.status, 'open')
    assert.ok(!JSON.stringify(read.body).includes('does not describe'))
  })

  test('a dispute needs a real description', async () => {
    const { ctx, appParams } = await delivered()
    assert.equal((await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'no' } })).status, 400)
    assert.equal((await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: {} })).status, 400)
  })

  test('nothing can be disputed before it has been approved', async () => {
    const ctx = await seed()
    await reject(ctx, goodFeedback)
    await Application.updateOne({ _id: ctx.application._id }, { status: 'rejected' })
    const out = await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: { id: String(ctx.application._id) }, body: { reason: 'I want to report this.' } })
    assert.equal(out.status, 404)
  })

  test('revising after a dispute adds a new version and keeps the delivered one', async () => {
    const { ctx, params, appParams } = await delivered()
    await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'The summary is inaccurate.' } })
    const out = await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'revise', summary: 'Revised text.' } })
    assert.equal(out.body.status, 'approved')

    const row = await RejectionFeedback.findOne().select('+audit')
    assert.deepEqual(row.versions.map((v) => v.summary), ['Original text.', 'Revised text.'])
    assert.equal(row.dispute.status, 'resolved')
    assert.ok(row.audit.some((a) => a.action === 'candidate_disputed'))
    const read = await call(employee.getFeedback, { ...ctx.asCandidate(), params: appParams })
    assert.equal(read.body.feedback.summary, 'Revised text.')
    assert.equal(read.body.feedback.version, 2)
  })

  test('upholding closes the dispute and cannot be re-raised on the same text', async () => {
    const { ctx, params, appParams } = await delivered()
    await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'I disagree with this.' } })
    assert.equal((await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'uphold' } })).body.status, 'approved')
    const again = await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'I still disagree with this.' } })
    assert.equal(again.status, 409)
    assert.equal((await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'uphold' } })).status, 409)
  })

  test('returning a dispute to the employer routes it through resubmission and re-approval', async () => {
    const { ctx, params, appParams } = await delivered()
    await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'The employer got this wrong.' } })
    const returned = await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'return', message: 'Candidate disputes the interview stage.' } })
    assert.equal(returned.body.status, 'returned')
    await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: { stage: 'screening_call', reasons: ['role_mismatch'] } })
    await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', summary: 'Corrected text.' } })

    const row = await RejectionFeedback.findOne()
    assert.equal(row.status, 'approved')
    assert.equal(row.dispute.status, 'resolved')
    assert.equal(row.versions.length, 2)
  })
})
