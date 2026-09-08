import { signFileAccessToken } from './fileAccessToken.js'

// S3 object layout: candidates/{employeeId}/resume/v{version}{ext} — scoped
// by candidateId (the Employee's id) and versioned so a replaced resume
// doesn't clobber the previous version still referenced by resumeHistory.
export function employeeResumeKey(employeeId, version, ext) {
  return `candidates/${employeeId}/resume/v${version}${ext}`
}

export function resumePoolKey(resumeId, ext) {
  return `resume-pool/${resumeId}/resume${ext}`
}

// Builds a root-relative `/files/resume/:token` link — kept root-relative
// (not under /api) to match the existing `/uploads/...` static-file
// convention every frontend already builds on top of via FILE_BASE_URL.
export function buildResumeAccessPath(s3Key, filename, purpose) {
  const token = signFileAccessToken({ s3Key, filename, purpose })
  return `/files/resume/${token}`
}

// Mutates neither the mongoose doc nor the DB — s3Key is never sent to a
// client; only a fresh, short-lived access link derived from it is.
//
// Pre-migration resumes have a real `url` (a static `/uploads/...` path)
// and no `s3Key` — express.static still serves that route (see app.js), so
// that legacy url is left untouched rather than being blanked out. Only a
// resume that actually has an `s3Key` gets the token-gated `/files/...` link.
export function serializeResumeSubdoc(resume, purpose) {
  const plain = typeof resume?.toObject === 'function' ? resume.toObject() : resume ? { ...resume } : resume
  if (!plain) return plain
  const { s3Key, ...rest } = plain
  if (s3Key) rest.url = buildResumeAccessPath(s3Key, rest.file, purpose)
  return rest
}

export function serializeResumeHistory(history, purpose) {
  return (history ?? []).map((entry) => serializeResumeSubdoc(entry, purpose))
}
