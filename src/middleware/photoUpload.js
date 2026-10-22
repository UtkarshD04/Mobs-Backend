import multer from 'multer'

// Same memory-storage approach as upload.js; the real content check (magic bytes)
// happens in the controller.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png'])

export const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
}).single('photo')
