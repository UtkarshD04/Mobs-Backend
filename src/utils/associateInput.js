import { CITY_TYPES } from '../models/PlacementAssociate.js'
import { isValidPhone, MOBILE_ERROR } from './indianMobile.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const REQUIRED = ['companyName', 'contactName', 'email', 'phone', 'city', 'cityType', 'about']

const str = (v) => (typeof v === 'string' ? v.trim() : '')

// Normalises and validates the public "Associate with Mzobs" form body.
// Returns { data } on success or { error } with a message safe to show the visitor.
export function parseAssociateInput(body = {}) {
  const data = {
    companyName: str(body.companyName),
    contactName: str(body.contactName),
    email: str(body.email),
    phone: str(body.phone),
    city: str(body.city),
    cityType: str(body.cityType),
    website: str(body.website),
    about: str(body.about),
  }

  if (REQUIRED.some((k) => !data[k])) return { error: 'Please fill in all the required fields' }
  if (!EMAIL_RE.test(data.email)) return { error: 'Enter a valid email address' }
  if (!isValidPhone(data.phone)) return { error: MOBILE_ERROR }
  if (!CITY_TYPES.includes(data.cityType)) return { error: 'Choose whether your city is a large city or a small city / town' }
  return { data }
}
