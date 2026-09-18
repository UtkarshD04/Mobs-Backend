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

// Same as buildResumeAccessPath, but for a pre-S3-migration resume that only
// has a legacy static `/uploads/...` path (no s3Key). There is no more
// unauthenticated `express.static('/uploads')` mount (see app.js) — every
// legacy file, like every S3 one, is now only reachable by redeeming one of
// these short-lived tokens (see fileAccessController.js), scoped to that
// exact file and to whatever authorization the caller already did before
// serializing this resume.
export function buildLegacyResumeAccessPath(legacyUrl, filename, purpose) {
  const token = signFileAccessToken({ localPath: legacyUrl, filename, purpose })
  return `/files/resume/${token}`
}

// Mutates neither the mongoose doc nor the DB — s3Key is never sent to a
// client; only a fresh, short-lived access link derived from it is.
//
// Pre-migration resumes have a real `url` (a static `/uploads/...` path)
// and no `s3Key` — that gets wrapped into the same kind of token-gated
// `/files/...` link as an S3-backed resume, rather than left as a
// permanent, unauthenticated static path.
export function serializeResumeSubdoc(resume, purpose) {
  const plain = typeof resume?.toObject === 'function' ? resume.toObject() : resume ? { ...resume } : resume
  if (!plain) return plain
  const { s3Key, ...rest } = plain
  if (s3Key) rest.url = buildResumeAccessPath(s3Key, rest.file, purpose)
  else if (rest.url) rest.url = buildLegacyResumeAccessPath(rest.url, rest.file, purpose)
  return rest
}

export function serializeResumeHistory(history, purpose) {
  return (history ?? []).map((entry) => serializeResumeSubdoc(entry, purpose))
}
