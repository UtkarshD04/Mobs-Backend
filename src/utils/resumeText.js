// Pulls plain, searchable text out of an uploaded resume so the recruiter
// search can match words that only appear inside the CV file (not in the
// profile fields). PDF and DOCX are supported; legacy .doc, .rtf, .odt and
// scanned images yield '' — the profile fields still work for those.
//
// Contact details are stripped: this text rides along with the list response
// to employers who have not spent a credit on the candidate yet.
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { logger } from '../config/logger.js'

export const MAX_RESUME_TEXT = 6000

export function cleanResumeText(raw) {
  return String(raw ?? '')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ') // emails
    .replace(/https?:\/\/\S+|www\.\S+|(?:linkedin|github)\.com\S*/gi, ' ') // links
    .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ') // phone-like digit runs
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RESUME_TEXT)
}

/** @returns {Promise<string>} '' when the format is unsupported or unreadable — never throws. */
export async function extractResumeText(buffer, ext) {
  try {
    let text = ''
    if (ext === '.pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      try {
        text = (await parser.getText()).text
      } finally {
        await parser.destroy()
      }
    }
    else if (ext === '.docx') text = (await mammoth.extractRawText({ buffer })).value
    return cleanResumeText(text)
  } catch (err) {
    logger.warn({ err: err.message, ext }, 'Could not extract resume text')
    return ''
  }
}
