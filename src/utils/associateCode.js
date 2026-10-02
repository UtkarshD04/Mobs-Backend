// Every associate gets one code: MZ26 + a running serial, e.g. MZ2601, MZ2602 …
// MZ2699, then MZ26100 (the serial just keeps growing past two digits).
export const ASSOCIATE_CODE_PREFIX = 'MZ26'
export const ASSOCIATE_CODE_COUNTER = 'associate-code'

export function formatAssociateCode(seq) {
  return `${ASSOCIATE_CODE_PREFIX}${String(seq).padStart(2, '0')}`
}
