import test from 'node:test'
import assert from 'node:assert/strict'

// The controllers pull in config/env.js, which insists on these being set; nothing here connects to a database.
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'test-secret'
const { canMoveManaged } = await import('./managedShortlistController.js')
const { feedbackState } = await import('./interviewController.js')

test('managed shortlist statuses only move forward, or to closed', () => {
  assert.equal(canMoveManaged('requested', 'in_review'), true)
  assert.equal(canMoveManaged('requested', 'shortlist_shared'), true)
  assert.equal(canMoveManaged('shortlisting', 'in_review'), false)
  assert.equal(canMoveManaged('shortlisting', 'closed'), true)
  assert.equal(canMoveManaged('closed', 'requested'), false)
})

const hour = 3600e3
const base = { startsAt: new Date(Date.now() - 2 * hour), durationMins: 30, status: 'Confirmed', scorecards: [], interviewers: [] }

test('feedback is pending only after the interview has ended', () => {
  assert.equal(feedbackState({ ...base, startsAt: new Date(Date.now() + hour) }).pending, false)
  assert.equal(feedbackState(base).pending, true)
  assert.equal(feedbackState({ ...base, status: 'Cancelled' }).pending, false)
})

test('with a panel, pending lists exactly who has not submitted; overdue needs a passed deadline', () => {
  const panel = [{ user: 'a', name: 'Ann' }, { user: 'b', name: 'Bo' }]
  const s = feedbackState({ ...base, interviewers: panel, scorecards: [{ interviewer: 'a' }], feedbackDueOn: new Date(Date.now() - hour) })
  assert.deepEqual(s.awaiting.map((x) => x.name), ['Bo'])
  assert.equal(s.overdue, true)
  assert.equal(feedbackState({ ...base, interviewers: panel, scorecards: [{ interviewer: 'a' }, { interviewer: 'b' }] }).pending, false)
  assert.equal(feedbackState({ ...base, interviewers: panel, feedbackDueOn: new Date(Date.now() + hour) }).overdue, false)
})

test('legacy interviews with free-text feedback are not pending', () => {
  assert.equal(feedbackState({ ...base, feedback: { notes: 'went well' } }).pending, false)
})
