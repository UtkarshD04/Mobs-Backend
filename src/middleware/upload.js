import multer from 'multer'

// Memory storage: the file lands in req.file.buffer instead of on local
// disk, since it goes straight to S3 (see employeeResumeController.js).
// fileFilter here is just a fast reject on obviously-wrong mimetypes —
// the real content check (magic-byte sniffing) happens in the controller,
// since a client-supplied mimetype can't be trusted on its own.
const ALLOWED_MIME = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])

export const uploadResume = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
}).single('resume')
