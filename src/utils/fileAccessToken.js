import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

// Short-lived, single-purpose token embedded in a `/files/resume/:token`
// link (see fileAccessController.js). It carries the exact S3 key (or, for
// a pre-S3-migration resume, the exact legacy local file path) directly
// rather than a candidate/employee id, so redemption needs no further
// authorization lookup — anyone holding a valid, unexpired token was already
// authorized (by the endpoint that minted it) to see that one object, the
// same trust model as an S3 presigned URL itself. Minting is cheap (no I/O),
// so callers can attach one to every row of a list response without
// worrying about the cost.
const FILE_ACCESS_TYPE = 'file-access'

export function signFileAccessToken({ s3Key, localPath, filename, purpose }, expiresIn = '10m') {
  return jwt.sign({ type: FILE_ACCESS_TYPE, s3Key, localPath, filename, purpose }, env.jwtSecret, { expiresIn })
}

export function verifyFileAccessToken(token) {
  const payload = jwt.verify(token, env.jwtSecret)
  if (payload.type !== FILE_ACCESS_TYPE || (!payload.s3Key && !payload.localPath)) {
    throw new Error('Invalid file access token')
  }
  return payload
}
