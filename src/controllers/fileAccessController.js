import path from 'path'
import { asyncHandler } from '../utils/asyncHandler.js'
import { verifyFileAccessToken } from '../utils/fileAccessToken.js'
import { getPresignedDownloadUrl, isS3Configured, sanitizeForHeader } from '../utils/s3.js'
import { logger } from '../config/logger.js'

// Legacy pre-S3-migration resumes are stored under Backend/uploads/ on
// local disk, e.g. a stored `url` of `/uploads/resumes/abc-123.pdf`. Only a
// path resolving inside this directory may ever be served — see the
// containment check below.
const UPLOADS_ROOT = path.join(process.cwd(), 'uploads')

// Redeems a short-lived `/files/resume/:token` link (minted by
// resumeAccess.js wherever a resume is returned to a client). Depending on
// how the resume was stored, this either redirects to a short-lived S3
// presigned GET URL, or (for a pre-migration resume) streams the file
// straight off local disk — there is no more unauthenticated
// express.static('/uploads') mount (see app.js) to serve it instead. The
// token itself IS the credential — see fileAccessToken.js for why no
// further authorization lookup happens here. Kept unauthenticated (no
// requireAuth/requireEmployeeAuth/requireStaffAuth) since a plain browser
// navigation (window.open) can't attach an Authorization header; the
// token's short expiry and narrow scope (one exact file) stand in for that.
//
// `?download=1` serves the file as an attachment (the browser saves it)
// instead of inline (the browser opens it) — a frontend "Download" button
// can't do that itself, since the `download` attribute is ignored for a
// cross-origin link like this one.
export const redeemResumeAccess = asyncHandler(async (req, res) => {
  const asAttachment = req.query.download === '1'
  let payload
  try {
    payload = verifyFileAccessToken(req.params.token)
  } catch {
    return res.status(401).json({ message: 'This resume link has expired. Please refresh the page and try again.' })
  }

  if (payload.localPath) {
    const resolved = path.join(UPLOADS_ROOT, payload.localPath.replace(/^\/?uploads\/?/, ''))
    if (resolved !== UPLOADS_ROOT && !resolved.startsWith(UPLOADS_ROOT + path.sep)) {
      logger.error({ localPath: payload.localPath }, 'Rejected legacy resume token pointing outside uploads root')
      return res.status(400).json({ message: 'Invalid file reference.' })
    }
    const onSent = (err) => {
      if (err && !res.headersSent) {
        logger.error({ err, purpose: payload.purpose }, 'Failed to serve legacy resume file')
        res.status(404).json({ message: 'This resume is no longer available.' })
      }
    }
    if (asAttachment) return res.download(resolved, sanitizeForHeader(payload.filename || path.basename(resolved)), onSent)
    return res.sendFile(resolved, onSent)
  }

  if (!isS3Configured()) return res.status(503).json({ message: 'File storage is not configured.' })

  let url
  try {
    url = await getPresignedDownloadUrl(payload.s3Key, {
      expiresIn: 60,
      filename: payload.filename,
      disposition: asAttachment ? 'attachment' : 'inline',
    })
  } catch (err) {
    logger.error({ err, purpose: payload.purpose }, 'Failed to generate resume presigned URL')
    return res.status(502).json({ message: 'Could not open this file right now. Please try again.' })
  }

  res.redirect(url)
})
