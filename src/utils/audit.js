import AuditLog from '../models/AuditLog.js'
import { logger } from '../config/logger.js'

export const AUDIT_ACTIONS = {
  'cv.unlocked': 'Unlocked a CV',
  'candidate.moved': 'Moved a candidate',
  'candidate.rejected': 'Rejected a candidate',
  'candidate.assigned': 'Assigned a candidate',
  'job.published': 'Published a job',
  'job.closed': 'Closed a job',
  'job.reopened': 'Reopened a job',
  'billing.changed': 'Changed billing settings',
  'team.invited': 'Invited a team member',
  'team.role_changed': 'Changed a role',
  'team.removed': 'Removed a team member',
  'interview.scheduled': 'Scheduled an interview',
  'interview.scorecard': 'Submitted a scorecard',
  'offer.created': 'Created an offer',
  'support.requested': 'Requested managed shortlisting',
  'export.run': 'Exported data',
}

// Best-effort: an audit write must never fail the action it describes.
export async function audit(req, action, { targetType = '', targetId = '', targetLabel = '', detail = '' } = {}) {
  try {
    await AuditLog.create({
      company: req.company._id,
      actor: req.user?._id ?? null,
      actorName: req.user?.name ?? '',
      actorRole: req.user?.role ?? '',
      action,
      targetType,
      targetId: String(targetId ?? ''),
      targetLabel,
      detail: String(detail).slice(0, 500),
    })
  } catch (err) {
    logger.warn({ err, action }, 'Failed to write audit log')
  }
}
