import { asyncHandler } from '../utils/asyncHandler.js'
import { verifyFileAccessToken } from '../utils/fileAccessToken.js'
import { getPresignedDownloadUrl, isS3Configured } from '../utils/s3.js'
import { logger } from '../config/logger.js'

// Redeems a short-lived `/files/resume/:token` link (minted by
// resumeAccess.js wherever a resume is returned to a client) for a
// short-lived S3 presigned GET URL and redirects to it. The token itself IS
// the credential — see fileAccessToken.js for why no further authorization
// lookup happens here. Kept unauthenticated (no requireAuth/requireEmployeeAuth/
// requireStaffAuth) since a plain browser navigation (window.open) can't
// attach an Authorization header; the token's short expiry and narrow scope
// (one exact S3 key) stand in for that.
export const redeemResumeAccess = asyncHandler(async (req, res) => {
  let payload
  try {
    payload = verifyFileAccessToken(req.params.token)
  } catch {
    return res.status(401).json({ message: 'This resume link has expired. Please refresh the page and try again.' })
  }

  if (!isS3Configured()) return res.status(503).json({ message: 'File storage is not configured.' })

  let url
  try {
    url = await getPresignedDownloadUrl(payload.s3Key, { expiresIn: 60, filename: payload.filename })
  } catch (err) {
    logger.error({ err, purpose: payload.purpose }, 'Failed to generate resume presigned URL')
    return res.status(502).json({ message: 'Could not open this file right now. Please try again.' })
  }

  res.redirect(url)
})
