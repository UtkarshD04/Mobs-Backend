import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  FEEDBACK_REASONS,
  FEEDBACK_STAGES,
  FEEDBACK_STATUSES,
  OFFERED_REASONS,
  RETURN_REASONS,
  candidateFeedbackStatus,
  canRetryNotification,
  canTransition,
  draftSummary,
  employerCanEdit,
  improvementAreasFor,
  isMeaningfulText,
  outcomeFor,
  toCandidateView,
  toEmployerView,
  validateMessage,
  validateReturn,
  validateReviewSummary,
  validateSubmission,
} from './rejectionFeedback.js'

const GOOD = 'Could not explain how they would index a large orders table.'

describe('validateSubmission', () => {
  test('requires at least one reason, and at most three', () => {
    assert.ok(validateSubmission({ stage: 'interview', reasons: [], remarks: GOOD }).errors.reasons)
    assert.ok(validateSubmission({ stage: 'interview', remarks: GOOD }).errors.reasons)
    assert.ok(validateSubmission({ stage: 'interview', reasons: 'skills_mismatch', remarks: GOOD }).errors.reasons)
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['skills_mismatch', 'insufficient_experience', 'technical_assessment', 'interview_performance'], remarks: GOOD }).errors.reasons)
  })

  test('requires a known stage and rejects unknown reasons', () => {
    assert.ok(validateSubmission({ stage: 'nope', reasons: ['skills_mismatch'], remarks: GOOD }).errors.stage)
    assert.ok(validateSubmission({ reasons: ['skills_mismatch'], remarks: GOOD }).errors.stage)
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['made_up'], remarks: GOOD }).errors.reasons)
  })

  test('additional feedback is required', () => {
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['skills_mismatch'] }).errors.remarks)
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['skills_mismatch'], remarks: '   ' }).errors.remarks)
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['skills_mismatch'], remarks: { $ne: 1 } }).errors.remarks)
  })

  test('meaningless feedback is refused', () => {
    for (const remarks of ['asdf asdf asdf asdf', 'n/a', 'xxxxxxxxxxxxxxxxxxxx', 'not suitable', 'ok ok ok ok ok ok ok ok', '12345 67890 12345 67890', '!!!! ???? ---- ++++', 'bad bad bad bad bad bad']) {
      assert.ok(validateSubmission({ stage: 'interview', reasons: ['skills_mismatch'], remarks }).errors?.remarks, `accepted: ${remarks}`)
    }
  })

  test('choosing "Other" needs a fuller explanation', () => {
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['other_job_related'], remarks: 'Not a good fit really' }).errors.remarks)
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['other_job_related'] }).errors.remarks)
    const ok = validateSubmission({ stage: 'interview', reasons: ['other_job_related'], remarks: 'The role needs on-call weekend cover the candidate could not offer.' })
    assert.equal(ok.errors, undefined)
  })

  test('accepts a profile-review rejection (no interview took place) with a short, real explanation', () => {
    const { value, errors } = validateSubmission({ stage: 'application_review', reasons: ['insufficient_experience'], remarks: 'Profile shows no hands-on SQL work.' })
    assert.equal(errors, undefined)
    assert.equal(value.outcome, 'skills')
  })

  test('trims text, de-duplicates reasons and enforces the length limit', () => {
    const { value } = validateSubmission({ stage: 'interview', reasons: ['skills_mismatch', 'skills_mismatch', 'position_closed'], remarks: `  ${GOOD}  ` })
    assert.deepEqual(value.reasons, ['skills_mismatch', 'position_closed'])
    assert.equal(value.remarks, GOOD)
    assert.equal(value.outcome, 'mixed')
    assert.ok(validateSubmission({ stage: 'interview', reasons: ['skills_mismatch'], remarks: `${GOOD} `.repeat(30) }).errors.remarks)
  })

  test('ignores unexpected keys instead of passing them through', () => {
    const { value } = validateSubmission({ stage: 'interview', reasons: ['skills_mismatch'], remarks: GOOD, status: 'approved', company: 'other' })
    assert.deepEqual(Object.keys(value).sort(), ['outcome', 'reasons', 'remarks', 'stage'])
  })

  test('records created by the first version (legacy reasons) are still valid', () => {
    assert.equal(validateSubmission({ stage: 'interview', reasons: ['communication'], remarks: GOOD }).errors, undefined)
    assert.ok(!OFFERED_REASONS.includes('communication'))
  })
})

describe('isMeaningfulText', () => {
  test('accepts plain job-related explanations', () => {
    assert.ok(isMeaningfulText('Did not demonstrate knowledge of window functions.'))
    assert.ok(isMeaningfulText('Role needs 3+ years of React; profile shows one.'))
  })
  test('refuses filler and non-text', () => {
    assert.equal(isMeaningfulText(undefined), false)
    assert.equal(isMeaningfulText(''), false)
    assert.equal(isMeaningfulText('short'), false)
    assert.equal(isMeaningfulText('aaaa bbbb aaaa bbbb aaaa'), false)
  })
})

describe('outcomeFor', () => {
  test('separates skill-related from non-skill outcomes', () => {
    assert.equal(outcomeFor(['skills_mismatch']), 'skills')
    assert.equal(outcomeFor(['position_closed', 'salary_mismatch']), 'non_skill')
    assert.equal(outcomeFor(['other_job_related']), 'non_skill')
    assert.equal(outcomeFor(['skills_mismatch', 'salary_mismatch']), 'mixed')
  })
})

describe('status transitions', () => {
  test('allows the review path, the flag path and the dispute loop', () => {
    for (const [from, to] of [['pending_review', 'approved'], ['pending_review', 'returned'], ['pending_review', 'flagged'], ['returned', 'pending_review'], ['flagged', 'pending_review'], ['flagged', 'returned'], ['approved', 'disputed'], ['disputed', 'approved'], ['disputed', 'returned']]) {
      assert.ok(canTransition(from, to), `${from} -> ${to}`)
    }
  })

  test('refuses shortcuts', () => {
    for (const [from, to] of [['pending_review', 'disputed'], ['returned', 'approved'], ['flagged', 'approved'], ['approved', 'pending_review'], ['approved', 'returned'], ['approved', 'flagged'], ['bogus', 'approved']]) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to}`)
    }
  })

  test('only a returned record is editable by the employer', () => {
    assert.equal(employerCanEdit('returned'), true)
    for (const status of FEEDBACK_STATUSES.filter((s) => s !== 'returned')) assert.equal(employerCanEdit(status), false, status)
  })
})

describe('candidate privacy', () => {
  const stored = {
    _id: 'fb1',
    candidate: 'cand1',
    stage: 'interview',
    reasons: ['skills_mismatch', 'salary_mismatch'],
    outcome: 'mixed',
    employerRemarks: 'PRIVATE: candidate was rude to our CTO',
    submissions: [{ remarks: 'PRIVATE submission' }],
    status: 'approved',
    company: 'company-1',
    submittedBy: 'user-1',
    clarification: { message: 'PRIVATE reviewer ask' },
    flag: { reason: 'PRIVATE flag' },
    notes: [{ text: 'PRIVATE note' }],
    notification: { status: 'sent', error: 'PRIVATE smtp' },
    audit: [{ note: 'PRIVATE audit note' }],
    versions: [{ number: 1, summary: 'Room to grow in SQL depth.', reasons: [{ code: 'skills_mismatch', label: 'Required skills do not match' }], improvementAreas: [{ code: 'skills_mismatch', label: 'Skills the role asks for', suggestion: 'Build a small project.' }], approvedBy: 'staff-9', approvedByName: 'Reviewer Rita', approvedAt: new Date('2026-01-01') }],
    dispute: { status: 'open', reason: 'PRIVATE dispute text', raisedAt: new Date('2026-01-02'), version: 1, resolutionSummary: 'PRIVATE resolution' },
  }

  test('the candidate view is an allow-list of approved, candidate-facing fields', () => {
    const view = toCandidateView(stored)
    assert.deepEqual(Object.keys(view).sort(), ['deliveredAt', 'dispute', 'improvementAreas', 'reasons', 'stage', 'stageLabel', 'summary', 'version'])
    const text = JSON.stringify(view)
    for (const secret of ['PRIVATE', 'staff-9', 'Rita', 'user-1', 'company-1', 'salary_mismatch']) assert.ok(!text.includes(secret), `leaked ${secret}`)
    assert.deepEqual(view.reasons, [{ code: 'skills_mismatch', label: 'Required skills do not match' }])
    assert.deepEqual(view.dispute, { status: 'open', raisedAt: stored.dispute.raisedAt })
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

  test('the employer view omits remarks, notes, flags, audit and delivered text, and hides an internal flag', () => {
    const view = toEmployerView({ ...stored, status: 'flagged' })
    const text = JSON.stringify(view)
    assert.ok(!text.includes('PRIVATE'))
    assert.equal(view.status, 'pending_review')
    assert.equal(view.clarification, null)
    assert.equal('versions' in view, false)
    assert.equal(toEmployerView({ ...stored, status: 'returned' }).clarification.message, 'PRIVATE reviewer ask')
  })
})

describe('candidate-facing wording', () => {
  test('improvement areas come only from skill reasons, using authored text', () => {
    const areas = improvementAreasFor(['communication_role', 'position_closed', 'other_job_related'])
    assert.equal(areas.length, 1)
    assert.equal(areas[0].code, 'communication_role')
    assert.ok(areas[0].suggestion.length > 10)
  })

  test('the draft summary is built from structured reasons only', () => {
    assert.match(draftSummary(['position_closed'], 'application_review'), /not a reflection of your skills/i)
    assert.ok(Object.hasOwn(FEEDBACK_STAGES, 'application_review'))
    assert.match(draftSummary(['communication_role'], 'interview'), /communication/i)
  })

  test('every offered reason is either authored for improvement or explicitly not skill-based', () => {
    for (const code of OFFERED_REASONS) {
      const reason = FEEDBACK_REASONS[code]
      if (reason.category === 'skill') assert.ok(reason.improvement && reason.suggestion, code)
      else assert.equal(reason.improvement, undefined, code)
    }
    assert.equal(OFFERED_REASONS.length, 8)
  })
})

describe('review input', () => {
  test('approval needs a meaningful candidate-facing explanation', () => {
    assert.ok(validateReviewSummary('').error)
    assert.ok(validateReviewSummary('Short.').error)
    assert.ok(validateReviewSummary('aaaa bbbb aaaa bbbb aaaa bbbb').error)
    assert.ok(validateReviewSummary('x '.repeat(700)).error)
    assert.equal(validateReviewSummary('  Practise explaining your work clearly.  ').value, 'Practise explaining your work clearly.')
  })

  test('returning needs a preset reason; "other" also needs words', () => {
    assert.ok(validateReturn({ returnReason: 'nope' }).error)
    assert.ok(validateReturn({}).error)
    assert.ok(validateReturn({ returnReason: 'other' }).error)
    assert.equal(validateReturn({ returnReason: 'too_vague' }).value.text, RETURN_REASONS.too_vague)
    assert.match(validateReturn({ returnReason: 'missing_details', message: 'Which skill?' }).value.text, /Missing relevant details: Which skill\?/)
  })

  test('messages enforce their bounds', () => {
    assert.ok(validateMessage('no').error)
    assert.ok(validateMessage(undefined).error)
    assert.ok(validateMessage('x'.repeat(501)).error)
    assert.equal(validateMessage(' Please add detail ').value, 'Please add detail')
  })
})

describe('notification retry rule', () => {
  test('only failed or never-completed deliveries can be retried', () => {
    assert.equal(canRetryNotification({ status: 'failed' }), true)
    assert.equal(canRetryNotification({ status: 'pending' }), true)
    assert.equal(canRetryNotification({ status: 'sent' }), false)
    assert.equal(canRetryNotification({ status: 'suppressed' }), false)
    assert.equal(canRetryNotification(undefined), false)
  })
})
