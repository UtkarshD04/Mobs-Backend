import 'dotenv/config'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeForHeader, getPresignedDownloadUrl, isS3Configured } from './s3.js'

describe('sanitizeForHeader', () => {
  test('decodes a filename that was stored already URL-encoded', () => {
    assert.equal(sanitizeForHeader('CV%20Ankit%20Nishad%20(2).pdf'), 'CV Ankit Nishad (2).pdf')
  })

  test('keeps a name with a stray % that is not valid percent-encoding', () => {
    assert.equal(sanitizeForHeader('100%zz.pdf'), '100%zz.pdf')
    assert.equal(sanitizeForHeader('bad %E0%A4 seq.pdf'), 'bad %E0%A4 seq.pdf')
  })

  test('strips characters that would break the header value', () => {
    assert.equal(sanitizeForHeader('my "cv"\r\n.pdf'), 'my cv.pdf')
  })

  test('falls back to "file" when there is no name', () => {
    assert.equal(sanitizeForHeader(undefined), 'file')
  })
})

// Presigning is a local HMAC computation — no request reaches AWS.
describe('getPresignedDownloadUrl', { skip: !isS3Configured() && 'AWS S3 env vars not set' }, () => {
  test('is inline by default, so a browser tab or iframe renders the file', async () => {
    const url = new URL(await getPresignedDownloadUrl('candidates/x/resume/v1.pdf', { filename: 'cv.pdf' }))
    assert.equal(url.searchParams.get('response-content-disposition'), 'inline; filename="cv.pdf"')
  })

  test("disposition 'attachment' makes the browser save the file instead", async () => {
    const url = new URL(await getPresignedDownloadUrl('candidates/x/resume/v1.pdf', { filename: 'CV%20Ankit.pdf', disposition: 'attachment' }))
    assert.equal(url.searchParams.get('response-content-disposition'), 'attachment; filename="CV Ankit.pdf"')
  })
})
