// Every verified campus gets one code: MZOBS12 + a running serial, e.g. MZOBS1201,
// MZOBS1202 … MZOBS1299, then MZOBS12100 (the serial just keeps growing).
export const CAMPUS_CODE_PREFIX = 'MZOBS12'
export const CAMPUS_CODE_COUNTER = 'campus-code'

export function formatCampusCode(seq) {
  return `${CAMPUS_CODE_PREFIX}${String(seq).padStart(2, '0')}`
}
