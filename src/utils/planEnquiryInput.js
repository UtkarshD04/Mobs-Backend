import { PLAN_ENQUIRY_SOURCES } from '../models/PlanEnquiry.js'
import { isValidPhone, MOBILE_ERROR } from './indianMobile.js'

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

  // Optional so older clients keep working; when sent it must be a whole number of at least 1.
  if (body.employeesNeeded !== undefined && body.employeesNeeded !== null && body.employeesNeeded !== '') {
    const n = Number(body.employeesNeeded)
    if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: 'Enter how many employees you need' }
    data.employeesNeeded = n
  }

  if (REQUIRED.some((k) => !data[k])) return { error: 'Please fill in all the fields' }
  if (!EMAIL_RE.test(data.email)) return { error: 'Enter a valid email address' }
  if (!isValidPhone(data.phone)) return { error: MOBILE_ERROR }
  return { data }
}
