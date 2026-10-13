// Pure rules for the rejection-feedback workflow: what an employer may submit, which
// status moves are legal, and — most importantly — what a candidate is ever allowed to
// see. Kept free of Mongoose so it is unit-testable and so the candidate projection
// can't accidentally grow a field by way of a model change.

export const FEEDBACK_STATUSES = ['pending_review', 'approved', 'returned', 'flagged', 'disputed']

// The furthest point the candidate actually reached. `application_review` is the honest
// answer when no call or interview took place, so employers are never pushed to invent
// interview feedback.
export const FEEDBACK_STAGES = {
  application_review: 'Application / profile review',
  screening_call: 'Screening call',
  assessment: 'Assessment or task',
  interview: 'Interview',
  final_round: 'Final round',
}

// `improvement` and `suggestion` are authored here (never taken from employer text) so
// candidate-facing wording stays constructive and consistent. `legacy` reasons are still
// accepted on old records but are no longer offered to employers.
export const FEEDBACK_REASONS = {
  skills_mismatch: {
    category: 'skill',
    label: 'Required skills do not match',
    improvement: 'Skills the role asks for',
    suggestion: 'Pick two or three skills from the job description and build a small project or exercise around each, then add it to your profile.',
  },
  insufficient_experience: {
    category: 'skill',
    label: 'Insufficient relevant experience',
    improvement: 'Hands-on experience in this kind of role',
    suggestion: 'Highlight the closest work, internships or projects you have done, and describe what you owned and the result.',
  },
  technical_assessment: {
    category: 'skill',
    label: 'Technical assessment result',
    improvement: 'Technical assessment performance',
    suggestion: 'Practise timed exercises for the role’s core tools, then review the answers you got wrong and why.',
  },
  interview_performance: {
    category: 'skill',
    label: 'Interview performance',
    improvement: 'Interview preparation',
    suggestion: 'Rehearse answers to common questions for this role out loud, and prepare two examples of your work you can walk through.',
  },
  communication_role: {
    category: 'skill',
    label: 'Communication relevant to the role',
    improvement: 'Communication',
    suggestion: 'Practise explaining your work in two minutes: the problem, what you did, and what changed because of it.',
  },
  salary_mismatch: { category: 'non_skill', label: 'Salary expectations mismatch' },
  position_closed: { category: 'non_skill', label: 'Position closed or role cancelled' },
  other_job_related: { category: 'other', label: 'Other job-related reason' },

  // Offered by the first version of this feature; kept so existing records stay valid.
  technical_skills: { legacy: true, category: 'skill', label: 'Technical skills for the role', improvement: 'Technical depth for the role', suggestion: 'Pick two or three skills from the job description and build a small project or exercise around each, then add it to your profile.' },
  relevant_experience: { legacy: true, category: 'skill', label: 'Relevant experience', improvement: 'Hands-on experience in this kind of role', suggestion: 'Highlight the closest work, internships or projects you have done, and describe what you owned and the result.' },
  communication: { legacy: true, category: 'skill', label: 'Communication', improvement: 'Communication', suggestion: 'Practise explaining your work in two minutes: the problem, what you did, and what changed because of it.' },
  problem_solving: { legacy: true, category: 'skill', label: 'Problem solving', improvement: 'Problem solving', suggestion: 'Work through a few role-relevant case questions or practice problems, talking through your reasoning as you go.' },
  role_knowledge: { legacy: true, category: 'skill', label: 'Knowledge of the domain or role', improvement: 'Domain and role knowledge', suggestion: 'Read up on the role’s core concepts and tools, and be ready to explain how you would apply them.' },
  portfolio_quality: { legacy: true, category: 'skill', label: 'Portfolio or work samples', improvement: 'Portfolio or work samples', suggestion: 'Add one or two strong, well-explained work samples and keep your portfolio link current.' },
  role_mismatch: { legacy: true, category: 'non_skill', label: 'The role was not the right fit for your background' },
  location_availability: { legacy: true, category: 'non_skill', label: 'Location or availability did not align' },
}

export const OFFERED_REASONS = Object.entries(FEEDBACK_REASONS).filter(([, r]) => !r.legacy).map(([code]) => code)

// Preset reasons a reviewer picks when sending feedback back to the employer.
export const RETURN_REASONS = {
  too_vague: 'Feedback is too vague',
  missing_details: 'Missing relevant details',
  inappropriate_wording: 'Unsupported or inappropriate wording',
  needs_job_related_explanation: 'More job-related explanation required',
  other: 'Other (explained below)',
}

export const REMARKS_MIN = 15
export const REMARKS_OTHER_MIN = 25
export const REMARKS_MAX = 1000
export const SUMMARY_MIN = 20
export const SUMMARY_MAX = 1200
export const MESSAGE_MIN = 5
export const MESSAGE_MAX = 500
export const DISPUTE_MIN = 10
export const DISPUTE_MAX = 500
export const NOTE_MAX = 1000
export const MAX_REASONS = 3

// from -> allowed next statuses. Anything not listed is rejected, so a status can never
// jump (e.g. pending_review straight to disputed).
const TRANSITIONS = {
  pending_review: ['approved', 'returned', 'flagged'],
  returned: ['pending_review'],
  flagged: ['pending_review', 'returned'],
  approved: ['disputed'],
  disputed: ['approved', 'returned'],
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to)
}

// The only status in which the employer may edit and resubmit. A flagged record is an internal matter
// for reviewers and is not editable (or even visible as flagged) from the employer side.
export function employerCanEdit(status) {
  return status === 'returned'
}

export function outcomeFor(reasons) {
  const categories = new Set(reasons.map((code) => FEEDBACK_REASONS[code]?.category))
  const skill = categories.has('skill')
  const other = categories.has('non_skill') || categories.has('other')
  if (skill && other) return 'mixed'
  return skill ? 'skills' : 'non_skill'
}

// Free-text that is empty in substance: filler, a single repeated character or word,
// mostly symbols, or too few distinct words to explain anything.
const JUNK = new Set(['na', 'n/a', 'none', 'nil', 'no', 'ok', 'okay', 'test', 'testing', 'asdf', 'xxx', 'abc', 'null', 'nothing', 'no reason', 'not fit', 'not suitable', 'rejected', 'no comments', 'no comment'])

export function isMeaningfulText(text, { min = REMARKS_MIN } = {}) {
  if (typeof text !== 'string') return false
  const value = text.trim().replace(/\s+/g, ' ')
  if (value.length < min) return false
  if (JUNK.has(value.toLowerCase())) return false
  const letters = value.replace(/[^\p{L}]/gu, '')
  if (letters.length < value.replace(/\s/g, '').length * 0.6) return false
  if (new Set(letters.toLowerCase()).size < 4) return false
  const words = value.toLowerCase().split(' ').filter((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length > 0)
  return new Set(words).size >= 3
}

// Returns { value } on success or { errors } (field -> message). Unknown keys are ignored,
// strings are trimmed, and reasons are de-duplicated. `remarks` is the "additional
// feedback" the employer writes: required, because a bare reason from a list explains
// nothing to a reviewer or, eventually, the candidate.
export function validateSubmission(body) {
  const errors = {}
  const input = body && typeof body === 'object' ? body : {}

  const stage = typeof input.stage === 'string' ? input.stage : ''
  if (!Object.hasOwn(FEEDBACK_STAGES, stage)) errors.stage = 'Choose the stage the candidate reached.'

  const rawReasons = Array.isArray(input.reasons) ? input.reasons : []
  const reasons = [...new Set(rawReasons.filter((r) => typeof r === 'string'))]
  if (reasons.length === 0) errors.reasons = 'Select at least one reason.'
  else if (reasons.some((r) => !Object.hasOwn(FEEDBACK_REASONS, r))) errors.reasons = 'One or more reasons are not recognised.'
  else if (reasons.length > MAX_REASONS) errors.reasons = `Select at most ${MAX_REASONS} reasons.`

  let remarks = ''
  if (typeof input.remarks === 'string') remarks = input.remarks.trim()
  else if (input.remarks !== undefined && input.remarks !== null) errors.remarks = 'Additional feedback must be text.'
  if (!errors.remarks) {
    const min = reasons.includes('other_job_related') ? REMARKS_OTHER_MIN : REMARKS_MIN
    if (!remarks) errors.remarks = reasons.includes('other_job_related') ? 'Explain the job-related reason you selected.' : 'Add a short, job-related explanation.'
    else if (remarks.length > REMARKS_MAX) errors.remarks = `Keep this under ${REMARKS_MAX} characters.`
    else if (!isMeaningfulText(remarks, { min })) errors.remarks = `Write a clear, professional, job-related explanation (at least ${min} characters).`
  }

  if (Object.keys(errors).length > 0) return { errors }
  return { value: { stage, reasons, outcome: outcomeFor(reasons), remarks } }
}

export function improvementAreasFor(reasons) {
  return reasons
    .filter((code) => FEEDBACK_REASONS[code]?.category === 'skill')
    .map((code) => ({ code, label: FEEDBACK_REASONS[code].improvement, suggestion: FEEDBACK_REASONS[code].suggestion }))
}

export const reasonLabels = (reasons) => reasons.map((code) => ({ code, label: FEEDBACK_REASONS[code]?.label ?? code }))

// A starting point for the reviewer, built only from the structured reasons — never from
// the employer's free-text remarks.
export function draftSummary(reasons, stage) {
  const stageText = (FEEDBACK_STAGES[stage] ?? 'the process').toLowerCase()
  const skill = reasons.filter((c) => FEEDBACK_REASONS[c]?.category === 'skill').map((c) => FEEDBACK_REASONS[c].label.toLowerCase())
  const other = reasons.filter((c) => FEEDBACK_REASONS[c]?.category !== 'skill').map((c) => FEEDBACK_REASONS[c]?.label.toLowerCase()).filter(Boolean)
  const parts = [`The employer reviewed your application and did not move forward after the ${stageText} stage.`]
  if (skill.length) parts.push(`They felt there was room to grow in: ${skill.join(', ')}.`)
  if (other.length) parts.push(`This outcome was ${skill.length ? 'also ' : ''}related to: ${other.join('; ')}.`)
  if (!skill.length) parts.push('This decision was not a reflection of your skills.')
  return parts.join(' ')
}

export function validateReviewSummary(summary) {
  if (typeof summary !== 'string' || !summary.trim()) return { error: 'A candidate-facing explanation is required to approve.' }
  const value = summary.trim()
  if (value.length < SUMMARY_MIN || !isMeaningfulText(value, { min: SUMMARY_MIN })) return { error: `Write a meaningful explanation for the candidate (at least ${SUMMARY_MIN} characters).` }
  if (value.length > SUMMARY_MAX) return { error: `Keep the explanation under ${SUMMARY_MAX} characters.` }
  return { value }
}

export function validateMessage(message, { min = MESSAGE_MIN, max = MESSAGE_MAX, label = 'message' } = {}) {
  if (typeof message !== 'string' || message.trim().length < min) return { error: `Add a ${label} (at least ${min} characters).` }
  const value = message.trim()
  if (value.length > max) return { error: `Keep the ${label} under ${max} characters.` }
  return { value }
}

// A return needs a reason from the preset list; "other" also needs words.
export function validateReturn({ returnReason, message }) {
  if (!Object.hasOwn(RETURN_REASONS, returnReason)) return { error: 'Choose why this is being returned to the employer.' }
  const extra = typeof message === 'string' ? message.trim() : ''
  if (returnReason === 'other' && extra.length < MESSAGE_MIN) return { error: `Explain what the employer should fix (at least ${MESSAGE_MIN} characters).` }
  if (extra.length > MESSAGE_MAX) return { error: `Keep the message under ${MESSAGE_MAX} characters.` }
  return { value: { returnReason, text: extra ? `${RETURN_REASONS[returnReason]}: ${extra}` : RETURN_REASONS[returnReason] } }
}

export function latestApprovedVersion(feedback) {
  const versions = feedback?.versions ?? []
  return versions.length ? versions[versions.length - 1] : null
}

// What the candidate list shows next to each application. Reveals nothing beyond "is
// there something to read yet", and only for rejected applications.
export function candidateFeedbackStatus(applicationStatus, feedback) {
  if (applicationStatus !== 'rejected') return 'none'
  if (!feedback) return 'none'
  return latestApprovedVersion(feedback) ? 'available' : 'pending'
}

// THE candidate-facing projection. Built field by field (an allow-list) so employer
// remarks, raw submissions, reviewer notes, audit entries, staff ids and company details
// can never ride along. Returns null until a version has been approved — unreviewed
// feedback is never exposed.
export function toCandidateView(feedback) {
  const version = latestApprovedVersion(feedback)
  if (!version) return null
  return {
    stage: feedback.stage,
    stageLabel: FEEDBACK_STAGES[feedback.stage] ?? null,
    reasons: (version.reasons ?? []).map((r) => ({ code: r.code, label: r.label })),
    summary: version.summary,
    improvementAreas: (version.improvementAreas ?? []).map((a) => ({ code: a.code, label: a.label, suggestion: a.suggestion })),
    version: version.number,
    deliveredAt: version.approvedAt,
    dispute: feedback.dispute?.status ? { status: feedback.dispute.status, raisedAt: feedback.dispute.raisedAt } : null,
  }
}

// What the employer sees about their own submission. No reviewer-only notes.
export function toEmployerView(feedback) {
  return {
    id: String(feedback._id ?? feedback.id),
    candidateId: String(feedback.candidate),
    stage: feedback.stage,
    stageLabel: FEEDBACK_STAGES[feedback.stage] ?? null,
    reasons: feedback.reasons,
    outcome: feedback.outcome,
    status: feedback.status === 'flagged' ? 'pending_review' : feedback.status,
    revision: (feedback.submissions?.length ?? 0) || 1,
    clarification: feedback.status === 'returned' && feedback.clarification?.message
      ? { message: feedback.clarification.message, requestedAt: feedback.clarification.requestedAt, kind: feedback.clarification.kind }
      : null,
    submittedAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  }
}

// Notification delivery is tracked on its own, apart from approval: approval stands even
// if the message can't be delivered.
export const NOTIFICATION_STATES = ['pending', 'sent', 'failed', 'suppressed']
export const canRetryNotification = (notification) => Boolean(notification) && (notification.status === 'failed' || notification.status === 'pending')
