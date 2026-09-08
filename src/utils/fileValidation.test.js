import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sniffFileType, validateResumeFile, RESUME_ALLOWED_EXTENSIONS, RESUME_POOL_ALLOWED_EXTENSIONS, extensionOf } from './fileValidation.js'

const PDF_BYTES = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n')
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const DOC_BYTES = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml')])
const RANDOM_BYTES = Buffer.from('this is just some plain text, not any known format at all')

describe('sniffFileType', () => {
  test('recognizes a real PDF by its magic bytes', () => {
    assert.equal(sniffFileType(PDF_BYTES).ext, '.pdf')
  })

  test('recognizes JPEG/PNG/DOC/DOCX by their signatures', () => {
    assert.equal(sniffFileType(JPEG_BYTES).ext, '.jpg')
    assert.equal(sniffFileType(PNG_BYTES).ext, '.png')
    assert.equal(sniffFileType(DOC_BYTES).ext, '.doc')
    assert.equal(sniffFileType(DOCX_BYTES).ext, '.docx')
  })

  test('returns null for content that matches no known signature', () => {
    assert.equal(sniffFileType(RANDOM_BYTES), null)
  })
})

describe('validateResumeFile', () => {
  test('accepts a real PDF named resume.pdf', () => {
    const result = validateResumeFile({ originalname: 'resume.pdf', buffer: PDF_BYTES })
    assert.equal(result.ok, true)
    assert.equal(result.ext, '.pdf')
  })

  test('rejects a JPEG renamed to resume.pdf — the whole point of sniffing over trusting the extension', () => {
    const result = validateResumeFile({ originalname: 'resume.pdf', buffer: JPEG_BYTES })
    assert.equal(result.ok, false)
  })

  test('rejects an extension outside the allowed set even if the content itself is a real PDF', () => {
    const result = validateResumeFile({ originalname: 'resume.exe', buffer: PDF_BYTES })
    assert.equal(result.ok, false)
  })

  test('rejects an empty buffer', () => {
    const result = validateResumeFile({ originalname: 'resume.pdf', buffer: Buffer.alloc(0) })
    assert.equal(result.ok, false)
  })

  test('the resume-pool allowlist additionally accepts a real JPEG (scanned resume photo)', () => {
    const result = validateResumeFile({ originalname: 'scan.jpg', buffer: JPEG_BYTES }, { allowedExtensions: RESUME_POOL_ALLOWED_EXTENSIONS })
    assert.equal(result.ok, true)
  })

  test('the candidate-facing allowlist rejects the same JPEG', () => {
    const result = validateResumeFile({ originalname: 'scan.jpg', buffer: JPEG_BYTES }, { allowedExtensions: RESUME_ALLOWED_EXTENSIONS })
    assert.equal(result.ok, false)
  })

  test('.txt has no signature to sniff — accepted on its declared extension alone', () => {
    const result = validateResumeFile({ originalname: 'resume.txt', mimetype: 'text/plain', buffer: Buffer.from('Jane Doe — Resume') }, { allowedExtensions: RESUME_POOL_ALLOWED_EXTENSIONS })
    assert.equal(result.ok, true)
  })
})

describe('extensionOf', () => {
  test('lowercases and extracts the extension', () => {
    assert.equal(extensionOf('Resume.PDF'), '.pdf')
    assert.equal(extensionOf('no-extension'), '')
  })
})
