import fs from 'fs'
import path from 'path'
import multer from 'multer'

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'resumes')
fs.mkdirSync(UPLOAD_ROOT, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${req.employee._id}-${Date.now()}${ext}`)
  },
})

const ALLOWED_MIME = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])

export const uploadResume = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
}).single('resume')
