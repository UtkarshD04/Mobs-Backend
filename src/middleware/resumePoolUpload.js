import multer from 'multer'

// Memory storage: files land in req.files[].buffer instead of on local
// disk, since they go straight to S3 (see resumePoolController.js).
// fileFilter is just a fast reject on obviously-wrong mimetypes — the real
// content check (magic-byte sniffing) happens in the controller.
//
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
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
}).array('resumes', 50)
