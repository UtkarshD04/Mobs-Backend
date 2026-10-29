// How the lead / enquiry forms store a phone number:
//  - an Indian mobile as its bare 10 digits starting 6-9 (no +91 or 0 in front);
//  - any other country as "+<country code><number>", 8-15 digits in all (E.164).
// Spaces and dashes typed between the digits are tolerated.
const MOBILE_RE = /^[6-9]\d{9}$/
const INTERNATIONAL_RE = /^\+(?!91)[1-9]\d{7,14}$/

const squeeze = (v) => v.replace(/[\s-]/g, '')

export const isIndianMobile = (v) => typeof v === 'string' && MOBILE_RE.test(squeeze(v))

/** An Indian mobile, or a "+<code><number>" from another country. */
export const isValidPhone = (v) => typeof v === 'string' && (MOBILE_RE.test(squeeze(v)) || INTERNATIONAL_RE.test(squeeze(v)))

export const MOBILE_ERROR = 'Enter a valid mobile number'
