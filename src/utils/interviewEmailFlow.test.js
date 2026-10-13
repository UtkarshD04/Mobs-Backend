import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

// Drives the real interview controller against a disposable local MongoDB (same approach as
// rejectionFeedbackWorkflow.test.js). The test environment has no SMTP, which is exactly the
// case that must not break scheduling.
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'test-secret'
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_interview_email_test'

const M = {}
for (const name of ['Candidate', 'Application', 'Interview', 'Company', 'Job', 'User', 'Employee', 'EmployeeNotification', 'CandidateUnlock']) M[name] = (await import(`../models/${name}.js`)).default
const controller = await import('../controllers/interviewController.js')

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})
after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})
beforeEach(async () => {
  await Promise.all(Object.values(M).map((model) => model.deleteMany({})))
})

async function call(handler, req) {
  const out = { status: 200, body: undefined }
  const res = { status(code) { out.status = code; return res }, json(body) { out.body = body; return res } }
  await handler({ params: {}, query: {}, body: {}, ...req }, res, (err) => { throw err })
  return out
}

async function seed({ applied = true } = {}) {
  const company = await M.Company.create({ name: 'Acme Analytics' })
  const user = await M.User.create({ company: company._id, name: 'Priya', email: 'priya@acme.test', role: 'Recruiter' })
  const job = await M.Job.create({ company: company._id, title: 'Data Analyst', department: 'Ops', employmentType: 'Full-time', experienceMin: 0, experienceMax: 2, salaryMin: 1, salaryMax: 2, vacancies: 1, location: 'Pune', workMode: 'On-site', description: 'x' })
  const employee = await M.Employee.create({ name: 'Asha Rao', email: 'asha@example.com' })
  const application = applied ? await M.Application.create({ employee: employee._id, job: job._id, status: 'shared' }) : null
  const candidate = await M.Candidate.create({ company: company._id, job: job._id, employee: employee._id, application: application?._id ?? null, name: 'Asha Rao', appliedFor: 'Data Analyst', stage: 'shortlisted' })
  return { company, user, candidate, req: { company, user } }
}

const body = (candidate, extra = {}) => ({ candidateId: String(candidate._id), role: 'Data Analyst', round: 'Technical', startsAt: new Date(Date.now() + 86400000).toISOString(), durationMins: 45, mode: 'Video Call', meetingLink: 'https://meet.example.com/abc', panel: ['Priya'], ...extra })

describe('scheduling with the email option', () => {
  test('without the option nothing is emailed and the interview is saved as before', async () => {
    const ctx = await seed()
    const out = await call(controller.scheduleInterview, { ...ctx.req, body: body(ctx.candidate) })
    assert.equal(out.status, 201)
    assert.equal(out.body.email?.status, undefined)
    assert.equal((await M.Candidate.findById(ctx.candidate._id)).stage, 'interviewing')
  })

  test('with the option but no mail server, the interview is still scheduled and the result says why no email went', async () => {
    const ctx = await seed()
    const out = await call(controller.scheduleInterview, { ...ctx.req, body: body(ctx.candidate, { notifyByEmail: true }) })
    assert.equal(out.status, 201)
    assert.equal(out.body.email.status, 'not_configured')
    assert.equal(out.body.email.kind, 'scheduled')
    assert.equal((await M.Interview.countDocuments()), 1)
    assert.equal((await M.EmployeeNotification.countDocuments({ category: 'interviews' })), 1) // the in-app notice is unaffected
  })

  test('only an explicit true turns the email on', async () => {
    const ctx = await seed()
    for (const notifyByEmail of ['true', 1, 'yes']) {
      const out = await call(controller.scheduleInterview, { ...ctx.req, body: body(ctx.candidate, { notifyByEmail }) })
      assert.equal(out.body.email?.status, undefined)
    }
  })

  test('someone only found in the database (not applied, nothing unlocked) is not emailed', async () => {
    const ctx = await seed({ applied: false })
    const out = await call(controller.scheduleInterview, { ...ctx.req, body: body(ctx.candidate, { notifyByEmail: true }) })
    assert.equal(out.status, 201)
    assert.equal(out.body.email.status, 'not_allowed')
  })

  test('another company cannot schedule for this candidate', async () => {
    const ctx = await seed()
    const other = await M.Company.create({ name: 'Other Co' })
    const out = await call(controller.scheduleInterview, { company: other, user: ctx.user, body: body(ctx.candidate, { notifyByEmail: true }) })
    assert.equal(out.status, 404)
    assert.equal(await M.Interview.countDocuments(), 0)
  })

  test('rescheduling and cancelling record their own email result when asked', async () => {
    const ctx = await seed()
    const created = await call(controller.scheduleInterview, { ...ctx.req, body: body(ctx.candidate) })
    const params = { id: created.body.id }
    const moved = await call(controller.rescheduleInterview, { ...ctx.req, params, body: { startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), notifyByEmail: true } })
    assert.equal(moved.body.status, 'Rescheduled')
    assert.equal(moved.body.email.kind, 'rescheduled')
    const cancelled = await call(controller.cancelInterview, { ...ctx.req, params, body: { notifyByEmail: true } })
    assert.equal(cancelled.body.status, 'Cancelled')
    assert.equal(cancelled.body.email.kind, 'cancelled')
    const quiet = await call(controller.cancelInterview, { ...ctx.req, params, body: {} })
    assert.equal(quiet.body.email.kind, 'cancelled') // earlier result is kept, nothing new was sent
  })
})
