// Pure rules for the rejection-feedback workflow: what an employer may submit,
// which status moves are legal, and — most importantly — what a candidate is
// ever allowed to see. Kept free of Mongoose so it is unit-testable and so the
// candidate projection can't accidentally grow a field by way of a model change.

export const FEEDBACK_STATUSES = ['pending_review', 'approved', 'returned', 'flagged', 'disputed']

// The furthest point the candidate actually reached. `application_review` is the
// honest answer when no call or interview took place, so employers are never
// pushed to invent interview feedback.
export const FEEDBACK_STAGES = {
  application_review: 'Application / profile review',
  screening_call: 'Screening call',
  assessment: 'Assessment or task',
  interview: 'Interview',
  final_round: 'Final round',
}

// `improvement` and `suggestion` are authored here (never taken from employer
// text) so candidate-facing wording stays constructive and consistent.
export const FEEDBACK_REASONS = {
  technical_skills: {
    category: 'skill',
    label: 'Technical skills for the role',
    improvement: 'Technical depth for the role',
    suggestion: 'Pick two or three skills from the job description and build a small project or exercise around each, then add it to your profile.',
  },
  relevant_experience: {
    category: 'skill',
    label: 'Relevant experience',
    improvement: 'Hands-on experience in this kind of role',
    suggestion: 'Highlight the closest work, internships or projects you have done, and describe what you owned and the result.',
  },
  communication: {
    category: 'skill',
    label: 'Communication',
    improvement: 'Communication',
    suggestion: 'Practice explaining your work out loud in two minutes: the problem, what you did, and what changed because of it.',
  },
  problem_solving: {
    category: 'skill',
    label: 'Problem solving',
    improvement: 'Problem solving',
    suggestion: 'Work through a few role-relevant case questions or practice problems, talking through your reasoning as you go.',
  },
  role_knowledge: {
    category: 'skill',
    label: 'Knowledge of the domain or role',
    improvement: 'Domain and role knowledge',
    suggestion: 'Read up on the role’s core concepts and tools, and be ready to explain how you would apply them.',
  },
  portfolio_quality: {
    category: 'skill',
    label: 'Portfolio or work samples',
    improvement: 'Portfolio or work samples',
    suggestion: 'Add one or two strong, well-explained work samples and keep your portfolio link current.',
  },
  position_closed: { category: 'non_skill', label: 'The position was closed or put on hold' },
  salary_mismatch: { category: 'non_skill', label: 'Salary expectations did not align' },
  role_mismatch: { category: 'non_skill', label: 'The role was not the right fit for your background' },
  location_availability: { category: 'non_skill', label: 'Location or availability did not align' },
}

export const REMARKS_MAX = 1000
export const SUMMARY_MAX = 1200
export const MESSAGE_MIN = 5
export const MESSAGE_MAX = 500
export const DISPUTE_MIN = 10
export const DISPUTE_MAX = 500

// from -> allowed next statuses. Anything not listed is rejected, so a status
// can never jump (e.g. pending_review straight to disputed).
const TRANSITIONS = {
  pending_review: ['approved', 'returned', 'flagged'],
  returned: ['pending_review'],
  flagged: ['pending_review'],
  approved: ['disputed'],
  disputed: ['approved', 'returned', 'flagged'],
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to)
}

// The one the employer may edit and resubmit.
export function employerCanEdit(status) {
  return status === 'returned' || status === 'flagged' || status === 'pending_review'
}

export function outcomeFor(reasons) {
  const categories = new Set(reasons.map((code) => FEEDBACK_REASONS[code]?.category))
  if (categories.has('skill') && categories.has('non_skill')) return 'mixed'
  return categories.has('skill') ? 'skills' : 'non_skill'
}

// Returns { value } on success or { errors } (field -> message). Unknown keys
// are ignored, strings are trimmed, and reasons are de-duplicated.
export function validateSubmission(body) {
  const errors = {}
  const input = body && typeof body === 'object' ? body : {}

  const stage = typeof input.stage === 'string' ? input.stage : ''
  if (!Object.hasOwn(FEEDBACK_STAGES, stage)) errors.stage = 'Choose the stage the candidate reached.'

  const rawReasons = Array.isArray(input.reasons) ? input.reasons : []
  const reasons = [...new Set(rawReasons.filter((r) => typeof r === 'string'))]
  if (reasons.length === 0) errors.reasons = 'Select at least one reason.'
  else if (reasons.some((r) => !Object.hasOwn(FEEDBACK_REASONS, r))) errors.reasons = 'One or more reasons are not recognised.'

  let remarks = ''
  if (input.remarks !== undefined && input.remarks !== null) {
    if (typeof input.remarks !== 'string') errors.remarks = 'Remarks must be text.'
    else {
      remarks = input.remarks.trim()
      if (remarks.length > REMARKS_MAX) errors.remarks = `Keep remarks under ${REMARKS_MAX} characters.`
    }
  }

  if (Object.keys(errors).length > 0) return { errors }
  return { value: { stage, reasons, outcome: outcomeFor(reasons), remarks } }
}

export function improvementAreasFor(reasons) {
  return reasons
    .filter((code) => FEEDBACK_REASONS[code]?.category === 'skill')
    .map((code) => ({
      code,
      label: FEEDBACK_REASONS[code].improvement,
      suggestion: FEEDBACK_REASONS[code].suggestion,
    }))
}

// A starting point for the reviewer, built only from the structured reasons —
// never from the employer's free-text remarks.
export function draftSummary(reasons, stage) {
  const stageText = (FEEDBACK_STAGES[stage] ?? 'the process').toLowerCase()
  const skill = reasons.filter((c) => FEEDBACK_REASONS[c]?.category === 'skill').map((c) => FEEDBACK_REASONS[c].label.toLowerCase())
  const other = reasons.filter((c) => FEEDBACK_REASONS[c]?.category === 'non_skill').map((c) => FEEDBACK_REASONS[c].label.toLowerCase())
  const parts = [`The employer reviewed your application and did not move forward after the ${stageText} stage.`]
  if (skill.length) parts.push(`They felt there was room to grow in: ${skill.join(', ')}.`)
  if (other.length) parts.push(`This outcome was ${skill.length ? 'also ' : ''}related to: ${other.join('; ')}.`)
  if (!skill.length) parts.push('This decision was not a reflection of your skills.')
  return parts.join(' ')
}

export function validateReviewSummary(summary) {
  if (typeof summary !== 'string' || !summary.trim()) return { error: 'A candidate-facing summary is required to approve.' }
  const value = summary.trim()
  if (value.length > SUMMARY_MAX) return { error: `Keep the summary under ${SUMMARY_MAX} characters.` }
  return { value }
}

export function validateMessage(message, { min = MESSAGE_MIN, max = MESSAGE_MAX, label = 'message' } = {}) {
  if (typeof message !== 'string' || message.trim().length < min) return { error: `Add a ${label} (at least ${min} characters).` }
  const value = message.trim()
  if (value.length > max) return { error: `Keep the ${label} under ${max} characters.` }
  return { value }
}

export function latestApprovedVersion(feedback) {
  const versions = feedback?.versions ?? []
  return versions.length ? versions[versions.length - 1] : null
}

// What the candidate list shows next to each application. Reveals nothing
// beyond "is there something to read yet", and only for rejected applications.
export function candidateFeedbackStatus(applicationStatus, feedback) {
  if (applicationStatus !== 'rejected') return 'none'
  if (!feedback) return 'none'
  return latestApprovedVersion(feedback) ? 'available' : 'pending'
}

// THE candidate-facing projection. Built field by field (an allow-list) so
// employer remarks, raw reasons, reviewer notes, audit entries, staff ids and
// company details can never ride along. Returns null until a version has been
// approved — unreviewed feedback is never exposed.
export function toCandidateView(feedback) {
  const version = latestApprovedVersion(feedback)
  if (!version) return null
  return {
    stage: feedback.stage,
    stageLabel: FEEDBACK_STAGES[feedback.stage] ?? null,
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
    status: feedback.status,
    clarification: feedback.clarification?.message
      ? { message: feedback.clarification.message, requestedAt: feedback.clarification.requestedAt, kind: feedback.clarification.kind }
      : null,
    submittedAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  }
}
