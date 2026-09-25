import CandidateUnlock from '../models/CandidateUnlock.js'

// One CV credit buys a candidate once (the CandidateUnlock row); what the
// employer then actually sees is opened part by part — email, phone, resume —
// each on its own click, at no further cost.
export const REVEAL_PARTS = ['email', 'phone', 'resume']

// Rows created before per-part reveals existed have no `revealed` list; they
// were sold as "everything", so they stay fully revealed.
export function revealedParts(unlock) {
  if (!unlock) return new Set()
  return new Set(unlock.revealed ?? REVEAL_PARTS)
}

// `field` from a request body: one part → [part]; missing → every part (what
// clients written before per-part reveals send); anything else → null (invalid).
export function parseRevealField(field) {
  if (field == null || field === '') return [...REVEAL_PARTS]
  return REVEAL_PARTS.includes(field) ? [field] : null
}

// Adds parts to an existing unlock, free of charge. A legacy row (no
// `revealed` list) already has everything, so it is left alone — writing a
// partial list to it would take parts away.
export async function addRevealedParts(unlock, parts) {
  if (!unlock || unlock.revealed == null) return unlock
  return (
    (await CandidateUnlock.findOneAndUpdate({ _id: unlock._id, revealed: { $exists: true } }, { $addToSet: { revealed: { $each: parts } } }, { new: true })) ?? unlock
  )
}
