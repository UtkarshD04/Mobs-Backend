import Application from '../models/Application.js'
import Employee from '../models/Employee.js'
import { notifyEmployee } from './notifyEmployee.js'

// Candidate-facing push/inbox wording for each Application.status change.
export const STATUS_UPDATE_MESSAGES = {
  screening: (job) => `Your application for ${job} is now under screening.`,
  shortlisted: (job) => `Your application for ${job} has been shortlisted.`,
  shared: (job) => `Your profile for ${job} has been shared with the employer.`,
  interview: (job) => `Your application for ${job} has moved to the interview stage.`,
  selected: (job) => `You've been selected for ${job}. Congratulations!`,
  rejected: (job, { reason, after } = {}) =>
    `Your application for ${job} was not selected${after === 'interview' ? ' after the interview' : ' this time'}.${reason ? ` Reason: ${reason}` : ''}`,
}

// What the employer's pipeline stage (Candidate.stage) means on the candidate's
// own application. 'offered' has no candidate-facing equivalent, so it leaves the
// application where it is.
const STATUS_FOR_STAGE = {
  shared: 'shared',
  shortlisted: 'shortlisted',
  interviewing: 'interview',
  hired: 'selected',
  rejected: 'rejected',
}

export function applicationStatusForStage(stage) {
  return STATUS_FOR_STAGE[stage] ?? null
}

async function notifyApplicant(application, message) {
  const employee = await Employee.findById(application.employee)
  if (employee) await notifyEmployee(employee, { category: 'applications', title: 'Application update', body: message })
}

const loadApplication = (id) =>
  Application.findById(id).populate({ path: 'job', select: 'title company', populate: { path: 'company', select: 'name' } })

// Records the first time the employer opened the candidate and, that one time, tells the
// candidate. Idempotent — later views leave the original timestamp alone and stay silent.
export async function markApplicationViewed(applicationId) {
  if (!applicationId) return
  const { modifiedCount } = await Application.updateOne({ _id: applicationId, employerViewedOn: null }, { $set: { employerViewedOn: new Date() } })
  if (!modifiedCount) return

  const application = await loadApplication(applicationId)
  if (!application || application.status === 'withdrawn') return
  const employer = application.job?.company?.name ?? 'The employer'
  await notifyApplicant(application, `${employer} viewed your profile for ${application.job?.title ?? 'a role'}.`)
}

// An offer has no candidate-facing application status of its own (the application stays where it
// is), but it is the biggest update a candidate can get, so it always gets a notification.
export async function notifyApplicationOffered(candidate) {
  if (!candidate.application) return
  const application = await loadApplication(candidate.application)
  if (!application || application.status === 'withdrawn') return
  const employer = application.job?.company?.name ?? 'The employer'
  await notifyApplicant(application, `${employer} has made you an offer for ${application.job?.title ?? 'a role'}. Check your messages and email for the details.`)
}

// Carries an employer's stage change (shortlist, interview, hire, reject) onto the
// candidate's Application so their "My applications" page and notifications follow.
// A withdrawn application is never reopened, and an unchanged status is a no-op —
// except that re-rejecting with a new reason updates the reason the candidate sees.
// Pass `notify: false` when the caller already sends its own, more specific notification
// (e.g. scheduling an interview).
export async function syncApplicationStatusFromStage(candidate, stage, { notify = true } = {}) {
  const status = applicationStatusForStage(stage)
  if (!status || !candidate.application) return

  const application = await Application.findById(candidate.application).populate('job', 'title')
  if (!application || application.status === 'withdrawn') return

  const reason = status === 'rejected' ? String(candidate.rejectionReason ?? '').trim() : ''

  if (application.status === status) {
    if (status === 'rejected' && reason && application.rejectionReason !== reason) {
      application.rejectionReason = reason
      await application.save()
    }
    return
  }

  const previous = application.status
  application.status = status
  application.statusHistory.push({ status, changedOn: new Date(), changedBy: 'employer' })
  application.rejectionReason = reason
  application.rejectedAfter = status === 'rejected' ? previous : ''
  await application.save()

  const message = STATUS_UPDATE_MESSAGES[status]
  const employee = notify && message ? await Employee.findById(application.employee) : null
  if (employee) {
    await notifyEmployee(employee, {
      category: 'applications',
      title: 'Application update',
      body: message(application.job?.title ?? 'a role', { reason, after: application.rejectedAfter }),
    })
  }
}
