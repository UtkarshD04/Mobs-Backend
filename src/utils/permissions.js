// Role -> permission matrix for the employer (recruiter) workspace. Pure data + helpers,
// so the same table drives the API guards, the team page and the unit tests.
//
// 'Hiring Manager' is a legacy role kept so existing accounts keep working; it has
// exactly the Recruiter's permissions.

export const ROLES = ['Owner', 'Admin', 'Recruiter', 'Interviewer', 'Finance']
export const LEGACY_ROLES = ['Hiring Manager']
export const ASSIGNABLE_ROLES = [...ROLES]

export const PERMISSIONS = {
  'jobs.manage': 'Create and edit jobs',
  'jobs.publish': 'Publish, close and reopen jobs',
  'candidates.view': 'View all applicants and candidate profiles',
  'candidates.viewAssigned': 'View only candidates they interview',
  'candidates.manage': 'Move stages, add notes, tags, assign owners',
  'candidates.reject': 'Reject candidates',
  'cv.unlock': 'Spend CV credits to unlock resume / contact details',
  'interviews.manage': 'Schedule, reschedule and cancel interviews',
  'interviews.feedback': 'Submit interview scorecards',
  'offers.manage': 'Create offers and update their status',
  'billing.view': 'View credits, invoices and plan',
  'billing.manage': 'Buy credits, change plan and billing settings',
  'exports.run': 'Export candidate and report data',
  'team.manage': 'Invite members and change roles',
  'audit.view': 'View the audit trail',
  'support.request': 'Request MZOBS managed shortlisting',
  'templates.manage': 'Edit communication templates and send messages',
}

const RECRUITING = ['jobs.manage', 'jobs.publish', 'candidates.view', 'candidates.manage', 'candidates.reject', 'cv.unlock', 'interviews.manage', 'interviews.feedback', 'offers.manage', 'support.request', 'templates.manage']

export const ROLE_PERMISSIONS = {
  Owner: Object.keys(PERMISSIONS),
  Admin: Object.keys(PERMISSIONS),
  Recruiter: RECRUITING,
  'Hiring Manager': RECRUITING,
  Interviewer: ['candidates.viewAssigned', 'interviews.feedback'],
  Finance: ['billing.view', 'billing.manage', 'exports.run'],
}

export const can = (role, permission) => (ROLE_PERMISSIONS[role] ?? []).includes(permission)
export const permissionsFor = (role) => ROLE_PERMISSIONS[role] ?? []
export const isTeamAdmin = (role) => role === 'Owner' || role === 'Admin'
