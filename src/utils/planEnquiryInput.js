import { PLAN_ENQUIRY_SOURCES } from '../models/PlanEnquiry.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const REQUIRED = ['name', 'companyName', 'phone', 'email']

const str = (v) => (typeof v === 'string' ? v.trim() : '')

// Normalises and validates the "Customize plan" form body.
// Returns { data } on success or { error } with a message safe to show the visitor.
export function parsePlanEnquiryInput(body = {}) {
  const data = {
    name: str(body.name),
    companyName: str(body.companyName),
    phone: str(body.phone),
    email: str(body.email),
    source: PLAN_ENQUIRY_SOURCES.includes(body.source) ? body.source : 'website',
  }

  if (REQUIRED.some((k) => !data[k])) return { error: 'Please fill in all the fields' }
  if (!EMAIL_RE.test(data.email)) return { error: 'Enter a valid email address' }
  if (data.phone.replace(/\D/g, '').length < 10) return { error: 'Enter a 10-digit phone number' }
  return { data }
}
