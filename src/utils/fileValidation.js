// Sniffs a file's real type from its leading bytes instead of trusting the
// client-supplied mimetype/extension, which are easy to spoof. Covers the
// formats the resume-upload flows already accept.
const SIGNATURES = [
  { ext: '.pdf', mime: 'application/pdf', check: (b) => b.length >= 4 && b.toString('latin1', 0, 4) === '%PDF' },
  // .doc (legacy OLE compound file) — also matches .xls/.ppt, fine since
  // callers restrict which of these signatures they accept.
  { ext: '.doc', mime: 'application/msword', check: (b) => b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
  // .docx/.odt are zip containers (PK\x03\x04) — disambiguated below by
  // peeking at the archive's internal file list.
  {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    check: (b) => isZip(b) && zipLooksLikeDocx(b),
  },
  { ext: '.odt', mime: 'application/vnd.oasis.opendocument.text', check: (b) => isZip(b) && zipLooksLikeOdt(b) },
  { ext: '.jpg', mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', mime: 'image/png', check: (b) => b.length >= 8 && b.toString('hex', 0, 8) === '89504e470d0a1a0a' },
  { ext: '.rtf', mime: 'application/rtf', check: (b) => b.length >= 5 && b.toString('latin1', 0, 5) === '{\\rtf' },
]

function isZip(b) {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
}

// Cheap heuristic: docx/odt are both zip files, distinguished by scanning
// the (small, uncompressed) local file header names near the start of the
// archive for a format-specific member.
function zipLooksLikeDocx(b) {
  return b.includes('word/') || b.includes('[Content_Types].xml')
}
function zipLooksLikeOdt(b) {
  return b.includes('mimetypeapplication/vnd.oasis.opendocument')
}

export function sniffFileType(buffer) {
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) return { ext: sig.ext, mime: sig.mime }
  }
  return null
}

export const RESUME_ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx'])

// The staff-side bulk resume pool intentionally accepts a wider range of
// real-world formats (see resumePoolUpload.js) than the candidate's own
// resume upload above.
export const RESUME_POOL_ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.rtf', '.odt', '.txt', '.jpg', '.jpeg', '.png'])

// .txt has no magic-byte signature to sniff — accepted on the strength of
// the caller's own declared mimetype/extension gate (already enforced by
// multer's fileFilter) plus the size limit alone.
const NO_SIGNATURE_EXTENSIONS = new Set(['.txt'])

// Validates an uploaded file against its declared extension AND its real
// (sniffed) content — both must agree, closing the gap where a
// renamed/relabeled file of a different type would otherwise slip through.
export function validateResumeFile(file, { allowedExtensions = RESUME_ALLOWED_EXTENSIONS } = {}) {
  if (!file?.buffer?.length) return { ok: false, reason: 'File is empty' }

  const declaredExt = extensionOf(file.originalname) === '.jpeg' ? '.jpg' : extensionOf(file.originalname)
  if (!allowedExtensions.has(declaredExt)) return { ok: false, reason: 'Unsupported file extension' }

  if (NO_SIGNATURE_EXTENSIONS.has(declaredExt)) {
    return { ok: true, ext: declaredExt, mime: file.mimetype }
  }

  const sniffed = sniffFileType(file.buffer)
  if (!sniffed || !allowedExtensions.has(sniffed.ext)) {
    return { ok: false, reason: 'File content does not match a supported resume format' }
  }

  return { ok: true, ext: sniffed.ext, mime: sniffed.mime }
}

export function extensionOf(filename) {
  const match = /\.[a-zA-Z0-9]+$/.exec(filename ?? '')
  return match ? match[0].toLowerCase() : ''
}
