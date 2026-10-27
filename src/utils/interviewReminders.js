import Interview from '../models/Interview.js'
import Candidate from '../models/Candidate.js'
import Employee from '../models/Employee.js'
import { notifyEmployer } from './notifyEmployer.js'
import { notifyEmployee } from './notifyEmployee.js'
import { logger } from '../config/logger.js'

// Sends the reminders recruiters asked for when scheduling. Each interview is claimed atomically
// (reminderSentAt set in the same update that matches it), so several workers sweeping at once
// still send exactly one reminder.
export async function sendDueInterviewReminders(now = new Date()) {
  let sent = 0
  for (;;) {
    const i = await Interview.findOneAndUpdate(
      { reminderAt: { $ne: null, $lte: now }, reminderSentAt: null, startsAt: { $gt: now }, status: { $in: ['Confirmed', 'Awaiting confirmation', 'Rescheduled'] } },
      { $set: { reminderSentAt: now } },
      { new: true }
    )
    if (!i) break
    sent += 1
    try {
      const when = new Date(i.startsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
      await notifyEmployer({ _id: i.company }, { category: 'interviews', title: 'Interview reminder', body: `${i.candidateName} · ${i.role} on ${when}${i.interviewers.length ? ` (panel: ${i.interviewers.map((p) => p.name).join(', ')})` : ''}` })
      const candidate = await Candidate.findById(i.candidate).select('employee')
      const employee = candidate?.employee ? await Employee.findById(candidate.employee) : null
      if (employee) await notifyEmployee(employee, { category: 'interviews', title: 'Interview reminder', body: `Your interview for ${i.role} is on ${when}.` })
    } catch (err) {
      logger.warn({ err, interview: String(i._id) }, 'Failed to send interview reminder')
    }
  }
  return sent
}

export function startInterviewReminderSweep(everyMs = 5 * 60 * 1000) {
  const timer = setInterval(() => sendDueInterviewReminders().catch((err) => logger.warn({ err }, 'Interview reminder sweep failed')), everyMs)
  timer.unref()
  return timer
}
