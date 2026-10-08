import { INSTITUTION_TYPES } from '../models/CampusRequest.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const REQUIRED = ['campusName', 'institutionType', 'city', 'state', 'contactPerson', 'officialEmail', 'phone']

const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

// Normalises and validates the public "Add Your Campus" form body.
// Returns { data } on success or { error } with a message safe to show the visitor.
export function parseCampusRequestInput(body = {}) {
  const data = {
    campusName: str(body.campusName),
    institutionType: str(body.institutionType),
    website: str(body.website),
    city: str(body.city),
    state: str(body.state),
    contactPerson: str(body.contactPerson),
    officialEmail: str(body.officialEmail),
    phone: str(body.phone),
    message: str(body.message),
  }

  if (REQUIRED.some((k) => !data[k])) return { error: 'Please fill in all the required fields' }
  if (!INSTITUTION_TYPES.includes(data.institutionType)) return { error: 'Choose an institution type' }
  if (!EMAIL_RE.test(data.officialEmail)) return { error: 'Enter a valid email address' }
  if (data.phone.replace(/\D/g, '').length < 10) return { error: 'Enter a 10-digit phone number' }

  const strength = str(body.studentStrength)
  if (strength) {
    if (!/^\d+$/.test(strength)) return { error: 'Student strength must be a number' }
    data.studentStrength = Number(strength)
  }
  return { data }
}
