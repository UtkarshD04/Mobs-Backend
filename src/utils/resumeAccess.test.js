import 'dotenv/config'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { employeeResumeKey, resumePoolKey, buildResumeAccessPath, serializeResumeSubdoc, serializeResumeHistory } from './resumeAccess.js'
import { verifyFileAccessToken } from './fileAccessToken.js'

describe('employeeResumeKey / resumePoolKey', () => {
  test('scopes the key by candidateId (employeeId) and version, never by name/email/phone', () => {
    assert.equal(employeeResumeKey('CAND_1025', 3, '.pdf'), 'candidates/CAND_1025/resume/v3.pdf')
  })

  test('resume-pool keys are scoped by the pool resume id', () => {
    assert.equal(resumePoolKey('POOL_1', '.docx'), 'resume-pool/POOL_1/resume.docx')
  })
})

describe('buildResumeAccessPath', () => {
  test('returns a root-relative /files/resume/:token path (matches the /uploads/... convention frontends already build FILE_BASE_URL on top of)', () => {
    const path = buildResumeAccessPath('candidates/CAND_1025/resume/v1.pdf', 'my-resume.pdf', 'employee-resume')
    assert.match(path, /^\/files\/resume\/[\w-]+\.[\w-]+\.[\w-]+$/)

    const token = path.replace('/files/resume/', '')
    const payload = verifyFileAccessToken(token)
    assert.equal(payload.s3Key, 'candidates/CAND_1025/resume/v1.pdf')
    assert.equal(payload.filename, 'my-resume.pdf')
  })
})

describe('serializeResumeSubdoc', () => {
  test('strips s3Key and replaces it with a fresh url — the storage key never reaches the client', () => {
    const out = serializeResumeSubdoc({ file: 'resume.pdf', s3Key: 'candidates/CAND_1025/resume/v1.pdf', status: 'verified' }, 'employee-resume')
    assert.equal(out.s3Key, undefined)
    assert.match(out.url, /^\/files\/resume\//)
    assert.equal(out.status, 'verified')
  })

  test('leaves the schema-default empty url alone when there is no s3Key (no resume uploaded yet)', () => {
    const out = serializeResumeSubdoc({ file: '', url: '', status: 'none' }, 'employee-resume')
    assert.equal(out.url, '')
  })

  test('leaves a legacy static /uploads/... url untouched when there is no s3Key (pre-migration resume)', () => {
    const out = serializeResumeSubdoc({ file: 'old-resume.pdf', url: '/uploads/resumes/legacy-123.pdf', status: 'verified' }, 'employee-resume')
    assert.equal(out.url, '/uploads/resumes/legacy-123.pdf')
  })

  test('passes through null/undefined unchanged', () => {
    assert.equal(serializeResumeSubdoc(null, 'employee-resume'), null)
    assert.equal(serializeResumeSubdoc(undefined, 'employee-resume'), undefined)
  })
})

describe('serializeResumeHistory', () => {
  test('serializes every entry and defaults to an empty array', () => {
    const out = serializeResumeHistory([{ file: 'old.pdf', s3Key: 'candidates/CAND_1025/resume/v1.pdf' }], 'employee-resume')
    assert.equal(out.length, 1)
    assert.equal(out[0].s3Key, undefined)
    assert.match(out[0].url, /^\/files\/resume\//)
    assert.deepEqual(serializeResumeHistory(undefined, 'employee-resume'), [])
  })
})
