import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

// Integration tests for the rejection-feedback workflow, driven through the real
// controllers against a real, disposable local MongoDB (same approach as
// resdexSourcing.test.js) — its own database name, dropped on completion.
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'test-secret'
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_rejection_feedback_test'

const M = {}
for (const name of ['Candidate', 'Application', 'RejectionFeedback', 'FeedbackFollowUp', 'Employee', 'EmployeeNotification', 'NotificationPreference', 'Notification', 'SupportTicket', 'Company', 'Job', 'User', 'StaffUser']) {
  M[name] = (await import(`../models/${name}.js`)).default
}
const { env } = await import('../config/env.js')
const { setCandidateStage } = await import('../controllers/candidateController.js')
const employer = await import('../controllers/rejectionFeedbackController.js')
const staff = await import('../controllers/staffRejectionFeedbackController.js')
const followUps = await import('../controllers/staffFeedbackFollowUpController.js')
const employee = await import('../controllers/employeeFeedbackController.js')
const { notifyEmployee } = await import('./notifyEmployee.js')

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
  await Promise.all(Object.values(M).map((model) => model.init()))
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all(Object.values(M).map((model) => model.deleteMany({})))
})

const id = () => new mongoose.Types.ObjectId()

// Calls an Express handler directly and captures what it answered.
async function call(handler, req) {
  const out = { status: 200, body: undefined, headers: {} }
  const res = {
    status(code) { out.status = code; return res },
    json(body) { out.body = body; return res },
    set(key, value) { out.headers[key] = value; return res },
  }
  await handler({ params: {}, query: {}, body: {}, ...req }, res, (err) => { throw err })
  return out
}

const GOOD = { stage: 'interview', reasons: ['skills_mismatch', 'salary_mismatch'], remarks: 'PRIVATE: could not explain how to index a large orders table.' }

async function seed({ realEmployee = true, name = 'Asha Rao', company } = {}) {
  const co = company ?? (await M.Company.create({ name: 'Acme Analytics' }))
  const job = await M.Job.create({
    company: co._id, title: 'Data Analyst', department: 'Ops', employmentType: 'Full-time', experienceMin: 0, experienceMax: 2, salaryMin: 1, salaryMax: 2,
    vacancies: 1, location: 'Pune', workMode: 'On-site', description: 'x',
  })
  const employeeId = id()
  if (realEmployee) await M.Employee.create({ _id: employeeId, name, email: `${employeeId}@c.test` })
  const application = await M.Application.create({ employee: employeeId, job: job._id, status: 'shared' })
  const candidate = await M.Candidate.create({ company: co._id, job: job._id, employee: employeeId, application: application._id, name, appliedFor: 'Data Analyst', stage: 'shared' })
  const user = await M.User.create({ company: co._id, name: 'Rec', email: `${id()}@acme.test`, role: 'Recruiter' })
  const reviewer = await M.StaffUser.create({ name: 'Reviewer Rita', email: `${id()}@m.test`, passwordHash: 'x', role: 'Operations Manager', accessLevel: 'admin' })
  const reviewerB = await M.StaffUser.create({ name: 'Reviewer Raj', email: `${id()}@m.test`, passwordHash: 'x', role: 'Operations Manager', accessLevel: 'admin' })
  return {
    company: co, job, employeeId, application, candidate, user, reviewer, reviewerB,
    asEmployer: (c = co, u = user) => ({ company: { _id: c._id }, user: { _id: u._id, name: u.name } }),
    asCandidate: (employeeIdOverride = employeeId) => ({ employee: { _id: employeeIdOverride, name: name } }),
    asStaff: (s = reviewer) => ({ staff: s }),
  }
}

const reject = (ctx, feedback, overrides = {}) =>
  call(setCandidateStage, { ...ctx.asEmployer(overrides.company), params: { id: String(ctx.candidate._id) }, body: { stage: 'rejected', ...(feedback ? { feedback } : {}) } })
const fbParams = async () => ({ id: String((await M.RejectionFeedback.findOne())._id) })
const detail = async (ctx, params, who) => call(staff.getFeedback, { ...ctx.asStaff(who), params })
async function approve(ctx, params, who = ctx.reviewer, summary = 'Practise explaining query indexing with a small example.') {
  const d = await detail(ctx, params, who)
  return call(staff.reviewFeedback, { ...ctx.asStaff(who), params, body: { action: 'approve', rev: d.body.rev, summary } })
}

describe('employer submission', () => {
  test('missing, empty or meaningless feedback is refused and leaves the candidate where they were', async () => {
    const ctx = await seed()
    for (const bad of [{ stage: 'interview', reasons: [] , remarks: 'A real explanation here.' }, { stage: 'interview', reasons: ['skills_mismatch'] }, { stage: 'interview', reasons: ['skills_mismatch'], remarks: 'asdf asdf asdf asdf' }, { stage: 'interview', reasons: ['other_job_related'], remarks: 'Not a good fit' }]) {
      const out = await reject(ctx, bad)
      assert.equal(out.status, 400)
      assert.ok(out.body.errors)
    }
    assert.equal((await M.Candidate.findById(ctx.candidate._id)).stage, 'shared')
    assert.equal(await M.RejectionFeedback.countDocuments(), 0)
  })

  test('rejecting rejects the application straight away while feedback waits in Pending Review', async () => {
    const ctx = await seed()
    const out = await reject(ctx, GOOD)
    assert.equal(out.status, 200)
    assert.equal(out.body.feedback.status, 'pending_review')
    assert.equal((await M.Application.findById(ctx.application._id)).status, 'rejected')
    const row = await M.RejectionFeedback.findOne().select('+employerRemarks +audit +submissions')
    assert.equal(String(row.application), String(ctx.application._id))
    assert.equal(row.candidateName, 'Asha Rao')
    assert.equal(row.companyName, 'Acme Analytics')
    assert.equal(row.jobTitle, 'Data Analyst')
    assert.equal(row.submissions.length, 1)
    assert.equal(row.employerRemarks, GOOD.remarks)
    assert.deepEqual(row.audit.map((a) => a.action), ['employer_submitted'])
    assert.ok(!JSON.stringify(out.body).includes('PRIVATE'))
  })

  test("another company cannot reject, read, or resubmit feedback on this company's candidate", async () => {
    const ctx = await seed()
    const other = await M.Company.create({ name: 'Other Co' })
    assert.equal((await reject(ctx, GOOD, { company: other })).status, 404)
    assert.equal((await M.Candidate.findById(ctx.candidate._id)).stage, 'shared')

    await reject(ctx, GOOD)
    const params = await fbParams()
    assert.equal((await call(employer.resubmitFeedback, { ...ctx.asEmployer(other), params, body: GOOD })).status, 404)
    assert.equal((await call(employer.getFeedbackForCandidate, { ...ctx.asEmployer(other), params: { candidateId: String(ctx.candidate._id) } })).status, 404)
    assert.equal((await call(employer.listFeedback, { ...ctx.asEmployer(other) })).body.length, 0)
  })

  test('a second rejection of the same candidate is refused instead of duplicating or rewriting', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const again = await reject(ctx, { ...GOOD, stage: 'final_round' })
    assert.equal(again.status, 409)
    assert.equal(again.body.code, 'ALREADY_REJECTED')
    assert.equal(await M.RejectionFeedback.countDocuments(), 1)
    assert.equal((await M.RejectionFeedback.findOne()).stage, 'interview')
  })

  test('feedback can still be supplied late for a candidate rejected without any, without re-rejecting', async () => {
    const ctx = await seed()
    await call(setCandidateStage, { ...ctx.asEmployer(), params: { id: String(ctx.candidate._id) }, body: { stage: 'rejected', rejectionReason: 'Not a fit' } })
    assert.equal(await M.RejectionFeedback.countDocuments(), 0)
    const late = await reject(ctx, GOOD)
    assert.equal(late.status, 200)
    assert.equal(late.body.feedback.result, 'created')
    assert.equal(await M.RejectionFeedback.countDocuments(), 1)
  })

  test('the legacy free-text reject still works unless feedback is made mandatory', async () => {
    const ctx = await seed()
    const legacy = await call(setCandidateStage, { ...ctx.asEmployer(), params: { id: String(ctx.candidate._id) }, body: { stage: 'rejected', rejectionReason: 'Not a fit' } })
    assert.equal(legacy.status, 200)
    assert.equal(await M.RejectionFeedback.countDocuments(), 0)

    const ctx2 = await seed({ name: 'Ravi' })
    env.rejectionFeedbackRequired = true
    try {
      const refused = await call(setCandidateStage, { ...ctx2.asEmployer(), params: { id: String(ctx2.candidate._id) }, body: { stage: 'rejected', rejectionReason: 'Not a fit' } })
      assert.equal(refused.status, 400)
      assert.equal(refused.body.code, 'FEEDBACK_REQUIRED')
    } finally {
      env.rejectionFeedbackRequired = false
    }
  })

  test('an employer cannot approve or edit their own feedback', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    const edit = await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: { ...GOOD, status: 'approved' } })
    assert.equal(edit.status, 409)
    assert.equal(edit.body.code, 'FEEDBACK_NOT_EDITABLE')
    assert.equal((await M.RejectionFeedback.findOne()).status, 'pending_review')
    assert.equal(typeof staff.reviewFeedback, 'function')
    assert.equal('approveFeedback' in employer, false)
  })
})

describe('review', () => {
  test('approval requires the reviewer to have opened the submission first, and a meaningful explanation', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    const rev = (await M.RejectionFeedback.findOne()).rev

    const blind = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', rev, summary: 'Practise explaining query indexing.' } })
    assert.equal(blind.status, 400)
    assert.equal(blind.body.code, 'REVIEW_REQUIRED')

    const d = await detail(ctx, params)
    assert.equal(d.body.employerRemarks, GOOD.remarks)
    const weak = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', rev: d.body.rev, summary: 'ok' } })
    assert.equal(weak.status, 400)
    assert.equal((await M.RejectionFeedback.findOne()).status, 'pending_review')

    const done = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', rev: d.body.rev, summary: 'Practise explaining query indexing.' } })
    assert.equal(done.status, 200)
    assert.equal(done.body.status, 'approved')
  })

  test("a reviewer who has not personally opened it cannot approve on someone else's view", async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    const d = await detail(ctx, params, ctx.reviewer)
    const out = await call(staff.reviewFeedback, { ...ctx.asStaff(ctx.reviewerB), params, body: { action: 'approve', rev: d.body.rev, summary: 'Practise explaining query indexing.' } })
    assert.equal(out.status, 400)
    assert.equal(out.body.code, 'REVIEW_REQUIRED')
  })

  test('approval snapshots the reviewer and approved reasons, preserves the employer original, and notifies the candidate', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    const out = await approve(ctx, params)
    assert.equal(out.body.notification, 'sent')

    const row = await M.RejectionFeedback.findOne().select('+employerRemarks +submissions')
    assert.equal(row.versions[0].approvedByName, 'Reviewer Rita')
    assert.deepEqual(row.versions[0].reasons.map((r) => r.code), ['skills_mismatch', 'salary_mismatch'])
    assert.equal(row.employerRemarks, GOOD.remarks)
    assert.equal(row.submissions[0].remarks, GOOD.remarks)
    assert.equal(row.notification.status, 'sent')
    assert.equal(await M.EmployeeNotification.countDocuments({ employee: ctx.employeeId, dedupeKey: { $regex: '^rejection-feedback:' } }), 1)
  })

  test('a stale review (someone else acted meanwhile) is refused, and two reviewers cannot both approve', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    const a = await detail(ctx, params, ctx.reviewer)
    await detail(ctx, params, ctx.reviewerB)
    const [first, second] = await Promise.all([
      call(staff.reviewFeedback, { ...ctx.asStaff(ctx.reviewer), params, body: { action: 'approve', rev: a.body.rev, summary: 'Practise explaining query indexing.' } }),
      call(staff.reviewFeedback, { ...ctx.asStaff(ctx.reviewerB), params, body: { action: 'return', rev: a.body.rev, returnReason: 'too_vague' } }),
    ])
    assert.deepEqual([first.status, second.status].sort(), [200, 409])
    assert.equal((await M.RejectionFeedback.findOne()).versions.length + (await M.RejectionFeedback.countDocuments({ status: 'returned' })), 1)

    const late = await call(staff.reviewFeedback, { ...ctx.asStaff(ctx.reviewer), params, body: { action: 'approve', rev: a.body.rev, summary: 'Practise explaining query indexing.' } })
    assert.equal(late.status, 409)
    assert.equal(late.body.code, 'FEEDBACK_STATE_CHANGED')
    assert.equal((await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'approve', summary: 'x' } })).status, 400)
  })

  test('returning needs a preset reason; the employer sees it, can correct, and resubmission goes back to review (never auto-approved)', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    const d = await detail(ctx, params)
    assert.equal((await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'return', rev: d.body.rev } })).status, 400)
    assert.equal((await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'return', rev: d.body.rev, returnReason: 'other' } })).status, 400)

    const returned = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'return', rev: d.body.rev, returnReason: 'missing_details', message: 'Which tables did they struggle with?' } })
    assert.equal(returned.body.status, 'returned')
    assert.equal(await M.Notification.countDocuments({ company: ctx.company._id }), 1)

    const list = await call(employer.listFeedback, { ...ctx.asEmployer(), query: { followUp: '1' } })
    assert.equal(list.body[0].status, 'returned')
    assert.match(list.body[0].clarification.message, /Missing relevant details: Which tables/)

    const bad = await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: { stage: 'interview', reasons: ['skills_mismatch'], remarks: 'asdf asdf asdf asdf' } })
    assert.equal(bad.status, 400)
    const fixed = await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: { stage: 'interview', reasons: ['skills_mismatch'], remarks: 'Struggled with joins and indexes on a three-table question.' } })
    assert.equal(fixed.body.status, 'pending_review')
    assert.equal(fixed.body.revision, 2)

    const row = await M.RejectionFeedback.findOne().select('+submissions')
    assert.equal(row.status, 'pending_review')
    assert.equal(row.versions.length, 0)
    assert.equal(row.submissions.length, 2)
    assert.equal(row.submissions[0].remarks, GOOD.remarks)

    const history = await call(employer.getFeedbackForCandidate, { ...ctx.asEmployer(), params: { candidateId: String(ctx.candidate._id) } })
    assert.equal(history.body.history.length, 2)
  })

  test('flagging is internal: needs a reason, is invisible to the employer, and can be cleared or returned', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    let d = await detail(ctx, params)
    assert.equal((await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'flag', rev: d.body.rev, internalReason: 'short' } })).status, 400)
    const flagged = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'flag', rev: d.body.rev, internalReason: 'Remarks contain a personal comment.' } })
    assert.equal(flagged.body.status, 'flagged')

    const seen = await call(employer.getFeedbackForCandidate, { ...ctx.asEmployer(), params: { candidateId: String(ctx.candidate._id) } })
    assert.equal(seen.body.status, 'pending_review')
    assert.ok(!JSON.stringify(seen.body).includes('personal comment'))
    assert.equal((await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: GOOD })).status, 409)

    d = await detail(ctx, params)
    assert.equal(d.body.flag.reason, 'Remarks contain a personal comment.')
    const cleared = await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'clear_flag', rev: d.body.rev } })
    assert.equal(cleared.body.status, 'pending_review')
  })

  test('internal notes persist, are attributed, and never reach employer or candidate responses', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    assert.equal((await call(staff.addNote, { ...ctx.asStaff(), params, body: { text: '' } })).status, 400)
    assert.equal((await call(staff.addNote, { ...ctx.asStaff(), params, body: { text: 'PRIVATE-NOTE call employer about wording' } })).status, 201)
    await approve(ctx, params)

    const d = await detail(ctx, params)
    assert.equal(d.body.notes[0].by, 'Reviewer Rita')
    const appId = { id: String(ctx.application._id) }
    await M.Application.updateOne({ _id: ctx.application._id }, { status: 'rejected' })
    const candidateView = await call(employee.getFeedback, { ...ctx.asCandidate(), params: appId })
    const employerView = await call(employer.getFeedbackForCandidate, { ...ctx.asEmployer(), params: { candidateId: String(ctx.candidate._id) } })
    // The employer legitimately sees their own submission; neither side may see reviewer notes or names.
    for (const body of [candidateView.body, employerView.body]) {
      const text = JSON.stringify(body)
      for (const secret of ['PRIVATE-NOTE', 'Rita', 'audit', 'employerRemarks']) assert.ok(!text.includes(secret), `leaked ${secret}`)
    }
    // The candidate must not see the employer's own words either.
    assert.ok(!JSON.stringify(candidateView.body).includes('PRIVATE'))
  })
})

describe('notification delivery is tracked apart from approval', () => {
  test('a failed delivery keeps the approval, can be retried safely, and never duplicates the message', async () => {
    const ctx = await seed({ realEmployee: false }) // the candidate account is missing, so delivery cannot succeed yet
    await reject(ctx, GOOD)
    const params = await fbParams()
    const out = await approve(ctx, params)
    assert.equal(out.status, 200)
    assert.equal(out.body.status, 'approved')

    let row = await M.RejectionFeedback.findOne().select('+audit')
    assert.equal(row.status, 'approved')
    assert.equal(row.notification.status, 'failed')
    assert.equal(row.notification.attempts, 1)
    assert.ok(row.audit.some((a) => a.action === 'candidate_notification_failed'))

    // Still failing: stays failed and counts the attempt.
    const again = await call(staff.retryNotification, { ...ctx.asStaff(), params })
    assert.equal(again.status, 502)
    assert.equal((await M.RejectionFeedback.findOne()).notification.attempts, 2)

    await M.Employee.create({ _id: ctx.employeeId, name: 'Asha Rao', email: 'asha@late.test' })
    const retried = await call(staff.retryNotification, { ...ctx.asStaff(), params })
    assert.equal(retried.status, 200)
    row = await M.RejectionFeedback.findOne()
    assert.equal(row.notification.status, 'sent')
    assert.ok(row.notification.sentAt)

    const duplicate = await call(staff.retryNotification, { ...ctx.asStaff(), params })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.code, 'ALREADY_DELIVERED')
    assert.equal(await M.EmployeeNotification.countDocuments({ dedupeKey: { $regex: '^rejection-feedback:' } }), 1)
  })

  test('concurrent retries send exactly one notification', async () => {
    const ctx = await seed({ realEmployee: false })
    await reject(ctx, GOOD)
    const params = await fbParams()
    await approve(ctx, params)
    await M.Employee.create({ _id: ctx.employeeId, name: 'Asha Rao', email: 'asha@late2.test' })
    await Promise.all([1, 2, 3].map(() => call(staff.retryNotification, { ...ctx.asStaff(), params })))
    assert.equal(await M.EmployeeNotification.countDocuments({ dedupeKey: { $regex: '^rejection-feedback:' } }), 1)
  })

  test('a candidate who switched the category off is recorded as suppressed, not failed', async () => {
    const ctx = await seed()
    await M.NotificationPreference.create({ employee: ctx.employeeId, applications: { inApp: false } })
    await reject(ctx, GOOD)
    await approve(ctx, await fbParams())
    const row = await M.RejectionFeedback.findOne()
    assert.equal(row.notification.status, 'suppressed')
    assert.equal(row.status, 'approved')
    assert.equal((await call(staff.retryNotification, { ...ctx.asStaff(), params: await fbParams() })).status, 409)
  })

  test('an idempotency key makes notifyEmployee safe to repeat', async () => {
    const ctx = await seed()
    const e = await M.Employee.findById(ctx.employeeId)
    const first = await notifyEmployee(e, { category: 'applications', title: 'T', body: 'B', dedupeKey: 'k1' })
    const second = await notifyEmployee(e, { category: 'applications', title: 'T', body: 'B', dedupeKey: 'k1' })
    assert.equal(String(first._id), String(second._id))
    assert.equal(await M.EmployeeNotification.countDocuments({ dedupeKey: 'k1' }), 1)
  })
})

describe('queues, counts, search, filters, pagination', () => {
  async function dataset() {
    const a = await seed({ name: 'Asha Rao' })
    const b = await seed({ name: 'Ravi Kumar' })
    const c = await seed({ name: 'Meera Joshi', company: b.company })
    await reject(a, { ...GOOD, stage: 'interview' })
    await reject(b, { stage: 'screening_call', reasons: ['position_closed'], remarks: 'The role was cancelled by the hiring manager.' })
    await reject(c, { stage: 'application_review', reasons: ['insufficient_experience'], remarks: 'Profile shows no hands-on dashboard work.' })
    const rows = await M.RejectionFeedback.find().select('candidateName')
    const by = Object.fromEntries(rows.map((r) => [r.candidateName, { id: String(r._id) }]))
    await approve(a, by['Asha Rao'])
    const d = await detail(b, by['Ravi Kumar'])
    await call(staff.reviewFeedback, { ...b.asStaff(), params: by['Ravi Kumar'], body: { action: 'return', rev: d.body.rev, returnReason: 'too_vague' } })
    return { a, b, c, by }
  }

  test('counts match the database for every status', async () => {
    await dataset()
    const out = await call(staff.feedbackCounts, {})
    assert.equal(out.body.pending_review, await M.RejectionFeedback.countDocuments({ status: 'pending_review' }))
    assert.equal(out.body.approved, 1)
    assert.equal(out.body.returned, 1)
    assert.equal(out.body.pending_review, 1)
    assert.equal(out.body.attention, 0)
    assert.equal(out.body.flagged + out.body.disputed, out.body.attention)
  })

  test('each queue returns only its own records, with the fields the reviewer needs', async () => {
    await dataset()
    const pending = await call(staff.listFeedback, { query: { status: 'pending_review' } })
    assert.deepEqual(pending.body.map((r) => r.candidateName), ['Meera Joshi'])
    assert.equal(pending.body[0].employerFeedback, 'Profile shows no hands-on dashboard work.')
    assert.equal(pending.body[0].companyName, 'Acme Analytics')
    assert.ok(pending.body[0].applicationId)

    const approved = await call(staff.listFeedback, { query: { status: 'approved' } })
    assert.equal(approved.body[0].approvedByName, 'Reviewer Rita')
    assert.equal(approved.body[0].notification.status, 'sent')

    const returned = await call(staff.listFeedback, { query: { status: 'returned' } })
    assert.equal(returned.body[0].returnReason, 'Feedback is too vague')
    assert.equal((await call(staff.listFeedback, { query: { status: 'nonsense' } })).status, 400)
  })

  test('search covers candidate name, application id, company and job title; filters narrow by company, stage and date', async () => {
    const { a, c } = await dataset()
    const names = async (query) => (await call(staff.listFeedback, { query })).body.map((r) => r.candidateName).sort()
    assert.deepEqual(await names({ q: 'asha' }), ['Asha Rao'])
    assert.deepEqual(await names({ q: String(a.application._id) }), ['Asha Rao'])
    assert.deepEqual(await names({ q: 'analyst' }), ['Asha Rao', 'Meera Joshi', 'Ravi Kumar'])
    assert.deepEqual(await names({ q: 'acme' }), ['Asha Rao', 'Meera Joshi', 'Ravi Kumar'])
    assert.deepEqual(await names({ q: '.*' }), [])
    assert.deepEqual(await names({ company: String(c.company._id) }), ['Meera Joshi', 'Ravi Kumar'])
    assert.deepEqual(await names({ stage: 'application_review' }), ['Meera Joshi'])
    assert.deepEqual(await names({ from: '2999-01-01' }), [])
    assert.deepEqual(await names({ from: '2000-01-01', to: '2999-01-01' }), ['Asha Rao', 'Meera Joshi', 'Ravi Kumar'])
    assert.equal((await call(staff.listFeedback, { query: { company: 'not-an-id' } })).status, 400)
    assert.equal((await call(staff.listFeedback, { query: { from: 'garbage' } })).status, 400)
    assert.equal((await call(staff.listFeedback, { query: { q: { $ne: null } } })).status, 200)
  })

  test('pagination is server-side and reports the total', async () => {
    await dataset()
    const page1 = await call(staff.listFeedback, { query: { limit: '2', page: '1' } })
    const page2 = await call(staff.listFeedback, { query: { limit: '2', page: '2' } })
    assert.equal(page1.body.length, 2)
    assert.equal(page2.body.length, 1)
    assert.equal(page1.headers['X-Total-Count'], '3')
    assert.equal(new Set([...page1.body, ...page2.body].map((r) => r.id)).size, 3)
  })

  test('records saved before the search fields existed are backfilled', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    await M.RejectionFeedback.updateOne({}, { $unset: { candidateName: '', companyName: '', jobTitle: '' } })
    const out = await call(staff.listFeedback, { query: { q: 'asha' } })
    assert.equal(out.body.length, 1)
    assert.equal(out.body[0].companyName, 'Acme Analytics')
  })

  test('filters endpoint lists only companies and jobs that have feedback', async () => {
    const { b } = await dataset()
    const out = await call(staff.feedbackFilters, {})
    assert.equal(out.body.companies.length, 2)
    assert.ok(out.body.companies.some((c) => c.id === String(b.company._id)))
    assert.ok(out.body.returnReasons.length >= 4)
  })
})

describe('candidate access', () => {
  test('candidates see nothing until approved, then only the approved text; others get 404', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const appParams = { id: String(ctx.application._id) }
    const params = await fbParams()
    assert.deepEqual((await call(employee.getFeedback, { ...ctx.asCandidate(), params: appParams })).body, { status: 'pending' })

    await approve(ctx, params)
    const out = await call(employee.getFeedback, { ...ctx.asCandidate(), params: appParams })
    assert.equal(out.body.status, 'available')
    assert.equal(out.body.feedback.summary, 'Practise explaining query indexing with a small example.')
    assert.deepEqual(out.body.feedback.reasons.map((r) => r.label), ['Required skills do not match', 'Salary expectations mismatch'])
    assert.ok(out.body.feedback.improvementAreas[0].suggestion)
    assert.ok(out.body.feedback.deliveredAt)

    const stranger = ctx.asCandidate(id())
    assert.equal((await call(employee.getFeedback, { ...stranger, params: appParams })).status, 404)
    assert.equal((await call(employee.disputeFeedback, { ...stranger, params: appParams, body: { reason: 'Not mine to report.' } })).status, 404)
    assert.equal((await call(employee.askAboutFeedback, { ...stranger, params: appParams, body: { message: 'Not mine to ask about.' } })).status, 404)
  })

  test('a candidate question goes through the existing support queue, once at a time', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const appParams = { id: String(ctx.application._id) }
    assert.equal((await call(employee.askAboutFeedback, { ...ctx.asCandidate(), params: appParams, body: { message: 'What did indexing mean here?' } })).status, 404)
    await approve(ctx, await fbParams())
    assert.equal((await call(employee.askAboutFeedback, { ...ctx.asCandidate(), params: appParams, body: { message: 'hi' } })).status, 400)
    assert.equal((await call(employee.askAboutFeedback, { ...ctx.asCandidate(), params: appParams, body: { message: 'What did indexing mean here?' } })).status, 201)
    assert.equal((await call(employee.askAboutFeedback, { ...ctx.asCandidate(), params: appParams, body: { message: 'Asking a second question.' } })).status, 409)
    const ticket = await M.SupportTicket.findOne()
    assert.equal(ticket.source, 'employee')
    assert.equal(ticket.category, 'Application Status')
  })
})

describe('disputes', () => {
  async function delivered() {
    const ctx = await seed()
    await reject(ctx, GOOD)
    await M.Application.updateOne({ _id: ctx.application._id }, { status: 'rejected' })
    const params = await fbParams()
    await approve(ctx, params, ctx.reviewer, 'Original text that explains the decision.')
    return { ctx, params, appParams: { id: String(ctx.application._id) } }
  }
  const open = async (ctx, params) => {
    const d = await detail(ctx, params)
    return d.body.rev
  }

  test('a candidate can report delivered feedback once; the original stays readable and the employer submission is untouched', async () => {
    const { ctx, params, appParams } = await delivered()
    assert.equal((await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'no' } })).status, 400)
    assert.equal((await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'This does not describe my interview.' } })).status, 201)
    assert.equal((await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'Reporting it again just in case.' } })).status, 409)

    const read = await call(employee.getFeedback, { ...ctx.asCandidate(), params: appParams })
    assert.equal(read.body.feedback.summary, 'Original text that explains the decision.')
    assert.equal(read.body.feedback.dispute.status, 'open')
    assert.ok(!JSON.stringify(read.body).includes('does not describe'))

    const row = await M.RejectionFeedback.findOne().select('+employerRemarks +submissions')
    assert.equal(row.employerRemarks, GOOD.remarks)
    assert.equal(row.submissions.length, 1)
    assert.equal((await detail(ctx, params)).body.dispute.reason, 'This does not describe my interview.')
  })

  test('nothing can be disputed before approval', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    await M.Application.updateOne({ _id: ctx.application._id }, { status: 'rejected' })
    assert.equal((await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: { id: String(ctx.application._id) }, body: { reason: 'I want to report this.' } })).status, 404)
  })

  test('resolving needs a read first, a summary, and keeps the delivered text; the same text cannot be re-reported', async () => {
    const { ctx, params, appParams } = await delivered()
    await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'I disagree with this.' } })
    const blind = await call(staff.resolveDispute, { ...ctx.asStaff(ctx.reviewerB), params, body: { action: 'resolve', rev: 3, resolutionSummary: 'Reviewed and upheld.' } })
    assert.ok([400, 409].includes(blind.status))

    const rev = await open(ctx, params)
    assert.equal((await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'resolve', rev } })).status, 400)
    const done = await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'resolve', rev, resolutionSummary: 'Reviewed the transcript and upheld.' } })
    assert.equal(done.body.status, 'approved')
    const again = await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'I still disagree with this.' } })
    assert.equal(again.status, 409)
    assert.equal((await M.RejectionFeedback.findOne().select('+dispute.resolutionSummary')).dispute.resolutionSummary, 'Reviewed the transcript and upheld.')
  })

  test('investigating keeps the case open; revising publishes a new version and notifies again, keeping the old one', async () => {
    const { ctx, params, appParams } = await delivered()
    await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'The summary is inaccurate.' } })
    let rev = await open(ctx, params)
    assert.equal((await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'investigate', rev, note: 'x' } })).status, 400)
    const inv = await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'investigate', rev, note: 'Waiting on the interview recording.' } })
    assert.equal(inv.body.status, 'disputed')
    assert.equal((await M.RejectionFeedback.findOne()).dispute.status, 'investigating')
    assert.equal((await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'Another report while it is open.' } })).status, 409)

    rev = await open(ctx, params)
    const revised = await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'revise', rev, summary: 'Revised wording that is more accurate.', resolutionSummary: 'Corrected the stage reference.' } })
    assert.equal(revised.body.status, 'approved')
    const row = await M.RejectionFeedback.findOne()
    assert.deepEqual(row.versions.map((v) => v.summary), ['Original text that explains the decision.', 'Revised wording that is more accurate.'])
    assert.equal(row.dispute.status, 'resolved')
    assert.equal(row.notification.version, 2)
    assert.equal(await M.EmployeeNotification.countDocuments({ dedupeKey: { $regex: '^rejection-feedback:' } }), 2)
    const read = await call(employee.getFeedback, { ...ctx.asCandidate(), params: appParams })
    assert.equal(read.body.feedback.version, 2)
  })

  test('returning a dispute to the employer routes it through resubmission and re-review', async () => {
    const { ctx, params, appParams } = await delivered()
    await call(employee.disputeFeedback, { ...ctx.asCandidate(), params: appParams, body: { reason: 'The employer got this wrong.' } })
    const rev = await open(ctx, params)
    const returned = await call(staff.resolveDispute, { ...ctx.asStaff(), params, body: { action: 'return', rev, returnReason: 'missing_details', message: 'Candidate disputes the stage.' } })
    assert.equal(returned.body.status, 'returned')
    await call(employer.resubmitFeedback, { ...ctx.asEmployer(), params, body: { stage: 'screening_call', reasons: ['position_closed'], remarks: 'The role was cancelled before interviews began.' } })
    assert.equal((await M.RejectionFeedback.findOne()).status, 'pending_review')
    await approve(ctx, params, ctx.reviewer, 'Corrected explanation after the employer updated it.')
    const row = await M.RejectionFeedback.findOne()
    assert.equal(row.status, 'approved')
    assert.equal(row.dispute.status, 'resolved')
    assert.equal(row.versions.length, 2)
  })
})

describe('employer follow-ups', () => {
  const backdate = (model, filter, hours) => model.collection.updateOne(filter, { $set: { updatedAt: new Date(Date.now() - hours * 3600 * 1000) } })
  async function overdueRejection() {
    const ctx = await seed()
    await call(setCandidateStage, { ...ctx.asEmployer(), params: { id: String(ctx.candidate._id) }, body: { stage: 'rejected', rejectionReason: 'Not a fit' } })
    await backdate(M.Candidate, { _id: ctx.candidate._id }, 48)
    return ctx
  }

  test('only overdue rejections that really lack feedback open a case; recent or already-answered ones do not', async () => {
    const overdue = await overdueRejection()
    const recent = await seed({ name: 'Recent One' })
    await call(setCandidateStage, { ...recent.asEmployer(), params: { id: String(recent.candidate._id) }, body: { stage: 'rejected', rejectionReason: 'Not a fit' } })
    const answered = await seed({ name: 'Answered One' })
    await reject(answered, GOOD)
    await backdate(M.Candidate, { _id: answered.candidate._id }, 72)
    const noApp = await seed({ name: 'No App' })
    await M.Candidate.updateOne({ _id: noApp.candidate._id }, { stage: 'rejected', application: null })
    await backdate(M.Candidate, { _id: noApp.candidate._id }, 72)

    const out = await call(followUps.listFollowUps, {})
    assert.deepEqual(out.body.map((f) => f.candidateName), ['Asha Rao'])
    assert.equal(out.body[0].type, 'missing_feedback')
    assert.equal(out.body[0].applicationId, String(overdue.application._id))
    assert.equal(out.body[0].outstandingAction, 'Submit the reason for rejecting this candidate')
    assert.equal(out.body[0].contact.name, 'Rec')
    assert.equal(out.body[0].companyName, 'Acme Analytics')

    await call(followUps.listFollowUps, {})
    assert.equal(await M.FeedbackFollowUp.countDocuments({ status: 'open' }), 1) // idempotent
    assert.equal((await call(staff.feedbackCounts, {})).body.followUp, 1)
  })

  test('feedback sent back and left unanswered opens a case too', async () => {
    const ctx = await seed()
    await reject(ctx, GOOD)
    const params = await fbParams()
    const d = await detail(ctx, params)
    await call(staff.reviewFeedback, { ...ctx.asStaff(), params, body: { action: 'return', rev: d.body.rev, returnReason: 'too_vague' } })
    assert.equal((await call(followUps.listFollowUps, {})).body.length, 0) // too recent
    await M.RejectionFeedback.updateOne({}, { 'clarification.requestedAt': new Date(Date.now() - 5 * 24 * 3600 * 1000) })
    const out = await call(followUps.listFollowUps, {})
    assert.equal(out.body[0].type, 'returned_unanswered')
    assert.equal(out.body[0].applicationStatus, 'rejected')
  })

  test('notifying is deduplicated: a repeat is refused, delivery is recorded, and a different employer is unaffected', async () => {
    const ctx = await overdueRejection()
    const list = await call(followUps.listFollowUps, {})
    const params = { id: list.body[0].id }
    const first = await call(followUps.notifyEmployerFollowUp, { ...ctx.asStaff(), params })
    assert.equal(first.status, 200)
    const [second, third] = await Promise.all([call(followUps.notifyEmployerFollowUp, { ...ctx.asStaff(), params }), call(followUps.notifyEmployerFollowUp, { ...ctx.asStaff(), params })])
    assert.equal(second.status, 429)
    assert.equal(third.body.code, 'FOLLOW_UP_RECENTLY_SENT')
    assert.equal(await M.Notification.countDocuments({ company: ctx.company._id }), 1)
    const row = await M.FeedbackFollowUp.findById(params.id)
    assert.equal(row.attempts.filter((a) => a.kind === 'notification').length, 1)
    assert.equal(row.attempts[0].ok, true)
    assert.ok(row.lastContactedAt)
  })

  test('concurrent first clicks send exactly one notification', async () => {
    const ctx = await overdueRejection()
    const params = { id: (await call(followUps.listFollowUps, {})).body[0].id }
    const results = await Promise.all([1, 2, 3, 4].map(() => call(followUps.notifyEmployerFollowUp, { ...ctx.asStaff(), params })))
    assert.equal(results.filter((r) => r.status === 200).length, 1)
    assert.equal(await M.Notification.countDocuments({ company: ctx.company._id }), 1)
  })

  test('contact attempts, notes and the next follow-up date persist; invalid input is refused', async () => {
    const ctx = await overdueRejection()
    const params = { id: (await call(followUps.listFollowUps, {})).body[0].id }
    assert.equal((await call(followUps.recordContact, { ...ctx.asStaff(), params, body: { channel: 'carrier-pigeon', note: 'Called' } })).status, 400)
    assert.equal((await call(followUps.recordContact, { ...ctx.asStaff(), params, body: { channel: 'phone', note: '' } })).status, 400)
    assert.equal((await call(followUps.recordContact, { ...ctx.asStaff(), params, body: { channel: 'phone', note: 'Spoke to the hiring manager; will reply today.' } })).status, 201)
    assert.equal((await call(followUps.addFollowUpNote, { ...ctx.asStaff(), params, body: { text: 'Prefers email after 4pm' } })).status, 201)
    assert.equal((await call(followUps.setNextFollowUp, { ...ctx.asStaff(), params, body: { nextFollowUpAt: 'tomorrow-ish' } })).status, 400)
    assert.equal((await call(followUps.setNextFollowUp, { ...ctx.asStaff(), params, body: { nextFollowUpAt: '2000-01-01' } })).status, 400)
    const next = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString()
    assert.equal((await call(followUps.setNextFollowUp, { ...ctx.asStaff(), params, body: { nextFollowUpAt: next } })).status, 200)

    const out = (await call(followUps.listFollowUps, {})).body[0]
    assert.equal(out.attempts[0].channel, 'phone')
    assert.equal(out.notes[0].text, 'Prefers email after 4pm')
    assert.equal(new Date(out.nextFollowUpAt).toISOString(), next)
    assert.ok(out.lastContactedAt)
  })

  test('a case can only be completed once the employer has actually acted', async () => {
    const ctx = await overdueRejection()
    const params = { id: (await call(followUps.listFollowUps, {})).body[0].id }
    const early = await call(followUps.completeFollowUp, { ...ctx.asStaff(), params })
    assert.equal(early.status, 409)
    assert.equal(early.body.code, 'ACTION_NOT_VERIFIED')

    assert.equal((await reject(ctx, GOOD)).body.feedback.result, 'created') // the employer supplies the missing feedback late
    const done = await call(followUps.completeFollowUp, { ...ctx.asStaff(), params })
    assert.equal(done.body.status, 'completed')
    assert.equal((await call(followUps.completeFollowUp, { ...ctx.asStaff(), params })).status, 409)
    assert.equal((await call(staff.feedbackCounts, {})).body.followUp, 0)
  })

  test('cases close on their own when the employer acts before anyone marks them complete', async () => {
    const ctx = await overdueRejection()
    await call(followUps.listFollowUps, {})
    await reject(ctx, GOOD)
    const open = await call(followUps.listFollowUps, {})
    assert.equal(open.body.length, 0)
    const closed = await M.FeedbackFollowUp.findOne()
    assert.equal(closed.status, 'completed')
    assert.equal(closed.autoCompleted, true)
    assert.equal((await call(followUps.listFollowUps, { query: { status: 'completed' } })).body.length, 1)
  })

  test('unknown or malformed ids are 404, not errors', async () => {
    const ctx = await seed()
    assert.equal((await call(followUps.completeFollowUp, { ...ctx.asStaff(), params: { id: 'nope' } })).status, 404)
    assert.equal((await call(followUps.notifyEmployerFollowUp, { ...ctx.asStaff(), params: { id: String(id()) } })).status, 404)
    assert.equal((await call(staff.getFeedback, { ...ctx.asStaff(), params: { id: 'nope' } })).status, 404)
    assert.equal((await call(staff.retryNotification, { ...ctx.asStaff(), params: { id: String(id()) } })).status, 404)
  })
})
