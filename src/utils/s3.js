import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env.js'

// Same "blank config = feature no-ops instead of crashing the app" pattern
// used for SMTP/VAPID/Razorpay/Google elsewhere in this codebase — lets the
// backend boot and serve everything else before AWS credentials exist.
export const isS3Configured = () => Boolean(env.aws.accessKeyId && env.aws.secretAccessKey && env.aws.bucket)

export class S3NotConfiguredError extends Error {
  constructor() {
    super('AWS S3 is not configured')
    this.name = 'S3NotConfiguredError'
    this.status = 503
  }
}

let client = null
function getClient() {
  if (!client) {
    client = new S3Client({
      region: env.aws.region,
      credentials: { accessKeyId: env.aws.accessKeyId, secretAccessKey: env.aws.secretAccessKey },
    })
  }
  return client
}

function requireClient() {
  if (!isS3Configured()) throw new S3NotConfiguredError()
  return getClient()
}

// Bucket has Block Public Access enabled and no ACLs are used — objects are
// only ever reachable through short-lived presigned URLs generated below.
// Server-side encryption (SSE-S3) is applied on every write.
export async function uploadObject({ key, body, contentType }) {
  const s3 = requireClient()
  await s3.send(
    new PutObjectCommand({
      Bucket: env.aws.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    })
  )
}

export async function deleteObject(key) {
  const s3 = requireClient()
  await s3.send(new DeleteObjectCommand({ Bucket: env.aws.bucket, Key: key }))
}

export async function objectExists(key) {
  const s3 = requireClient()
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.aws.bucket, Key: key }))
    return true
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false
    throw err
  }
}

// Strips characters that would break the Content-Disposition header value —
// the original filename is user-supplied.
function sanitizeForHeader(name) {
  return String(name ?? 'file').replace(/["\r\n]/g, '')
}

export async function getPresignedDownloadUrl(key, { expiresIn = 60, filename } = {}) {
  const s3 = requireClient()
  const command = new GetObjectCommand({
    Bucket: env.aws.bucket,
    Key: key,
    ...(filename ? { ResponseContentDisposition: `inline; filename="${sanitizeForHeader(filename)}"` } : {}),
  })
  return getSignedUrl(s3, command, { expiresIn })
}
