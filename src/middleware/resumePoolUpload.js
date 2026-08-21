import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import multer from 'multer'

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'resume-pool')
fs.mkdirSync(UPLOAD_ROOT, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`)
  },
})

// Real-world resumes show up in more formats than a strict PDF/Word gate
// allows — scanned photos, exported RTF/TXT, ODT from LibreOffice, etc.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'application/vnd.oasis.opendocument.text',
  'image/jpeg',
  'image/png',
])

export const uploadResumePool = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
}).array('resumes', 50)
