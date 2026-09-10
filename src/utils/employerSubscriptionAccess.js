import EmployerSubscription from '../models/EmployerSubscription.js'

// Single source of truth for "is this employer allowed to post jobs / see
// applicant resumes right now". Never trusts anything the frontend sends —
// always re-derives from the DB, and treats a past-expiry `active` row as
// inactive even if no cron has flipped its status field yet.
async function latestSubscription(companyId) {
  return EmployerSubscription.findOne({ company: companyId }).sort({ createdAt: -1 })
}

function isCurrentlyActive(sub) {
  if (!sub) return false
  if (sub.status !== 'active') return false
  if (!sub.expiresAt || sub.expiresAt.getTime() <= Date.now()) return false
  return true
}

// Self-healing: lazily flips a stale `active` row to `expired` the first
// time anything reads it past its expiry, so status stays honest without a
// separate cron job. Idempotent — a no-op once already `expired`.
async function lazilyExpireIfNeeded(sub) {
  if (sub && sub.status === 'active' && sub.expiresAt && sub.expiresAt.getTime() <= Date.now()) {
    sub.status = 'expired'
    await sub.save()
  }
  return sub
}

export async function hasActiveEmployerSubscription(companyId) {
  const sub = await latestSubscription(companyId)
  await lazilyExpireIfNeeded(sub)
  return isCurrentlyActive(sub)
}

// Returns the latest subscription period plus a computed `isActive` flag —
// used by the account/status endpoints so the frontend has one place to read
// "what plan, until when, is it actually usable right now".
export async function getEffectiveSubscription(companyId) {
  const sub = await latestSubscription(companyId)
  await lazilyExpireIfNeeded(sub)
  return { subscription: sub, isActive: isCurrentlyActive(sub) }
}
