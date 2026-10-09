// Pure GSTIN helpers — no DB, no network — shared by the GST verification
// service (utils/gstVerification.js) and its tests. A valid format/checksum
// only means "this could be a real GSTIN"; it never makes a company verified
// on its own (that needs a provider lookup, see gstVerification.js).

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// 2-digit state code, 10-char PAN, entity number (1-9/A-Z), the fixed 'Z',
// and one checksum character.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export function normalizeGstin(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : ''
}

// GSTN's published check-digit scheme: base-36 values, weights alternating
// 1 and 2, each product folded as quotient + remainder of 36.
export function gstinCheckDigit(first14) {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = CHARSET.indexOf(first14[i]) * (i % 2 ? 2 : 1)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARSET[(36 - (sum % 36)) % 36]
}

export function isValidGstin(value) {
  const gstin = normalizeGstin(value)
  if (!GSTIN_RE.test(gstin)) return false
  return gstinCheckDigit(gstin.slice(0, 14)) === gstin[14]
}

// Legal-name comparison. Registered names differ from how people type them
// in predictable ways (case, punctuation, "Pvt." vs "Private", a leading
// "M/s"), so both sides are folded to one canonical form first.
const SUFFIXES = [
  [/\bPVT\b/g, 'PRIVATE'],
  [/\bLTD\b/g, 'LIMITED'],
  [/\bCO\b/g, 'COMPANY'],
  [/\bCORP\b/g, 'CORPORATION'],
]

export function normalizeCompanyName(value) {
  if (typeof value !== 'string') return ''
  let name = value
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  name = name.replace(/^(M S|MS|MESSRS|THE) /, '')
  for (const [re, full] of SUFFIXES) name = name.replace(re, full)
  return name.replace(/\s+/g, ' ').trim()
}

const GENERIC_WORDS = new Set(['PRIVATE', 'LIMITED', 'COMPANY', 'CORPORATION', 'LLP', 'OPC', 'AND', 'THE', 'INDIA', 'PVT', 'LTD'])

function distinctiveTokens(name) {
  return new Set(normalizeCompanyName(name).split(' ').filter((t) => t && !GENERIC_WORDS.has(t)))
}

// 'exact'   — same canonical name.
// 'partial' — shares at least half of the distinctive words (ignoring
//             "Private", "Limited", …) — plausible, but a human should look.
// 'none'    — unrelated.
export function compareCompanyNames(a, b) {
  const na = normalizeCompanyName(a)
  const nb = normalizeCompanyName(b)
  if (!na || !nb) return 'none'
  if (na === nb) return 'exact'
  const ta = distinctiveTokens(a)
  const tb = distinctiveTokens(b)
  if (!ta.size || !tb.size) return 'none'
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.min(ta.size, tb.size) >= 0.5 ? 'partial' : 'none'
}
