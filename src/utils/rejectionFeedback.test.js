import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  FEEDBACK_REASONS,
  FEEDBACK_STAGES,
  FEEDBACK_STATUSES,
  candidateFeedbackStatus,
  canTransition,
  draftSummary,
  improvementAreasFor,
  outcomeFor,
  toCandidateView,
  toEmployerView,
  validateMessage,
  validateReviewSummary,
  validateSubmission,
} from './rejectionFeedback.js'

describe('validateSubmission', () => {
  test('requires at least one reason', () => {
    const { errors } = validateSubmission({ stage: 'interview', reasons: [] })
    assert.ok(errors.reasons)
    assert.ok(validateSubmission({ stage: 'interview' }).errors.reasons)
    assert.ok(validateSubmission({ stage: 'interview', reasons: 'communication' }).errors.reasons)
  })

  test('requires a known stage and rejects unknown reasons', () => {
    assert.ok(validateSubmission({ stage: 'nope', reasons: ['communication'] }).errors.stage)
    assert.ok(validateSubmission({ reasons: ['communication'] }).errors.stage)
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['made_up'] }).errors.reasons)
  })

  test('accepts a profile-review rejection with no remarks (no interview took place)', () => {
    const { value, errors } = validateSubmission({ stage: 'application_review', reasons: ['role_mismatch'] })
    assert.equal(errors, undefined)
    assert.equal(value.remarks, '')
    assert.equal(value.outcome, 'non_skill')
  })

  test('trims remarks, de-duplicates reasons and enforces the remarks length', () => {
    const { value } = validateSubmission({ stage: 'interview', reasons: ['communication', 'communication', 'position_closed'], remarks: '  Struggled with the case.  ' })
    assert.deepEqual(value.reasons, ['communication', 'position_closed'])
    assert.equal(value.remarks, 'Struggled with the case.')
    assert.equal(value.outcome, 'mixed')
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['communication'], remarks: 'x'.repeat(1001) }).errors.remarks)
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['communication'], remarks: { $ne: 1 } }).errors.remarks)
  })

  test('ignores unexpected keys instead of passing them through', () => {
    const { value } = validateSubmission({ stage: 'interview', reasons: ['communication'], status: 'approved', company: 'other' })
    assert.deepEqual(Object.keys(value).sort(), ['outcome', 'reasons', 'remarks', 'stage'])
  })
})

describe('outcomeFor', () => {
  test('separates skill-related from non-skill outcomes', () => {
    assert.equal(outcomeFor(['technical_skills']), 'skills')
    assert.equal(outcomeFor(['position_closed', 'salary_mismatch']), 'non_skill')
    assert.equal(outcomeFor(['technical_skills', 'salary_mismatch']), 'mixed')
  })
})

describe('status transitions', () => {
  test('allows the review path and the dispute loop', () => {
    assert.ok(canTransition('pending_review', 'approved'))
    assert.ok(canTransition('pending_review', 'returned'))
    assert.ok(canTransition('pending_review', 'flagged'))
    assert.ok(canTransition('returned', 'pending_review'))
    assert.ok(canTransition('approved', 'disputed'))
    assert.ok(canTransition('disputed', 'approved'))
    assert.ok(canTransition('disputed', 'returned'))
  })

  test('refuses shortcuts and anything out of a terminal-ish state', () => {
    assert.equal(canTransition('pending_review', 'disputed'), false)
    assert.equal(canTransition('returned', 'approved'), false)
    assert.equal(canTransition('flagged', 'approved'), false)
    assert.equal(canTransition('approved', 'pending_review'), false)
    assert.equal(canTransition('approved', 'returned'), false)
    assert.equal(canTransition('bogus', 'approved'), false)
  })

  test('every status has a defined way out or is intentionally stable', () => {
    for (const status of FEEDBACK_STATUSES) assert.ok(typeof canTransition(status, 'approved') === 'boolean')
  })
})

describe('candidate privacy', () => {
  const stored = {
    _id: 'fb1',
    stage: 'interview',
    reasons: ['technical_skills', 'salary_mismatch'],
    outcome: 'mixed',
    employerRemarks: 'PRIVATE: candidate was rude to our CTO',
    status: 'approved',
    company: 'company-1',
    submittedBy: 'user-1',
    clarification: { message: 'PRIVATE reviewer ask' },
    audit: [{ note: 'PRIVATE audit note' }],
    versions: [{ number: 1, summary: 'Room to grow in technical depth.', improvementAreas: [{ code: 'technical_skills', label: 'Technical depth for the role', suggestion: 'Build a small project.' }], approvedBy: 'staff-9', approvedAt: new Date('2026-01-01') }],
    dispute: { status: 'open', reason: 'PRIVATE dispute text', raisedAt: new Date('2026-01-02'), version: 1 },
  }

  test('the candidate view contains only approved, candidate-facing fields', () => {
    const view = toCandidateView(stored)
    assert.deepEqual(Object.keys(view).sort(), ['deliveredAt', 'dispute', 'improvementAreas', 'stage', 'stageLabel', 'summary', 'version'])
    const text = JSON.stringify(view)
    for (const secret of ['PRIVATE', 'staff-9', 'user-1', 'company-1', 'technical_skills\",\"salary']) assert.ok(!text.includes(secret), `leaked ${secret}`)
    assert.equal(view.dispute.status, 'open')
    assert.equal('reason' in view.dispute, false)
  })

  test('unreviewed feedback is never exposed', () => {
    assert.equal(toCandidateView({ ...stored, versions: [], status: 'pending_review' }), null)
    assert.equal(toCandidateView(null), null)
  })

  test('the candidate always sees the latest approved version only', () => {
    const view = toCandidateView({ ...stored, versions: [stored.versions[0], { ...stored.versions[0], number: 2, summary: 'Revised text.' }] })
    assert.equal(view.version, 2)
    assert.equal(view.summary, 'Revised text.')
  })

  test('list status labels reveal nothing beyond availability, and only for rejected applications', () => {
    assert.equal(candidateFeedbackStatus('rejected', null), 'none')
    assert.equal(candidateFeedbackStatus('rejected', { versions: [] }), 'pending')
    assert.equal(candidateFeedbackStatus('rejected', stored), 'available')
    assert.equal(candidateFeedbackStatus('shared', stored), 'none')
  })

  test('the employer view omits remarks, audit and the delivered text', () => {
    const view = toEmployerView({ ...stored, candidate: 'cand1' })
    const text = JSON.stringify(view)
    assert.ok(!text.includes('PRIVATE audit') && !text.includes('PRIVATE: candidate') && !text.includes('PRIVATE dispute'))
    assert.equal('versions' in view, false)
  })
})

describe('candidate-facing wording', () => {
  test('improvement areas come only from skill reasons, using authored text', () => {
    const areas = improvementAreasFor(['communication', 'position_closed'])
    assert.equal(areas.length, 1)
    assert.equal(areas[0].code, 'communication')
    assert.ok(areas[0].suggestion.length > 10)
  })

  test('the draft summary is built from structured reasons and says non-skill outcomes are not about skills', () => {
    const text = draftSummary(['position_closed'], 'application_review')
    assert.match(text, /not a reflection of your skills/i)
    assert.ok(Object.hasOwn(FEEDBACK_STAGES, 'application_review'))
    assert.match(draftSummary(['communication'], 'interview'), /communication/i)
  })

  test('every reason is either authored for improvement or explicitly non-skill', () => {
    for (const [code, reason] of Object.entries(FEEDBACK_REASONS)) {
      if (reason.category === 'skill') assert.ok(reason.improvement && reason.suggestion, code)
      else assert.equal(reason.improvement, undefined, code)
    }
  })
})

describe('review input', () => {
  test('approval needs a non-empty, bounded summary', () => {
    assert.ok(validateReviewSummary('').error)
    assert.ok(validateReviewSummary('   ').error)
    assert.ok(validateReviewSummary('x'.repeat(1201)).error)
    assert.equal(validateReviewSummary('  Good.  ').value, 'Good.')
  })

  test('clarification and dispute messages enforce their bounds', () => {
    assert.ok(validateMessage('no').error)
    assert.ok(validateMessage(undefined).error)
    assert.ok(validateMessage('x'.repeat(501)).error)
    assert.equal(validateMessage(' Please add detail ').value, 'Please add detail')
    assert.ok(validateMessage('too short', { min: 10 }).error)
  })
})
