import 'dotenv/config'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { signFileAccessToken, verifyFileAccessToken } from './fileAccessToken.js'

describe('signFileAccessToken / verifyFileAccessToken', () => {
  test('round-trips the s3Key, filename and purpose', () => {
    const token = signFileAccessToken({ s3Key: 'candidates/abc123/resume/v1.pdf', filename: 'resume.pdf', purpose: 'employee-resume' })
    const payload = verifyFileAccessToken(token)
    assert.equal(payload.s3Key, 'candidates/abc123/resume/v1.pdf')
    assert.equal(payload.filename, 'resume.pdf')
    assert.equal(payload.purpose, 'employee-resume')
  })

  test('rejects a token of the wrong type, even if signed with the right secret — closes the replay gap between employee/staff/employer auth tokens and file-access tokens', () => {
    const otherToken = jwt.sign({ type: 'employee', sub: 'someone' }, env.jwtSecret, { expiresIn: '1h' })
    assert.throws(() => verifyFileAccessToken(otherToken))
  })

  test('rejects an expired token', () => {
    const expired = jwt.sign({ type: 'file-access', s3Key: 'candidates/abc123/resume/v1.pdf' }, env.jwtSecret, { expiresIn: -10 })
    assert.throws(() => verifyFileAccessToken(expired))
  })

  test('rejects a token signed with a different secret (tampered/forged)', () => {
    const forged = jwt.sign({ type: 'file-access', s3Key: 'candidates/other-id/resume/v1.pdf' }, 'wrong-secret', { expiresIn: '10m' })
    assert.throws(() => verifyFileAccessToken(forged))
  })
})
