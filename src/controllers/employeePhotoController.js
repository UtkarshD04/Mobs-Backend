import { asyncHandler } from '../utils/asyncHandler.js'
import { uploadObject, deleteObject, isS3Configured } from '../utils/s3.js'
import { validateResumeFile } from '../utils/fileValidation.js'
import { employeePhotoKey, photoUrlOf } from '../utils/resumeAccess.js'
import { logger } from '../config/logger.js'

const PHOTO_EXTENSIONS = new Set(['.jpg', '.png'])

// POST /api/employee/photo - multipart field `photo` (JPG/PNG, up to 3 MB).
// Asked for while the candidate creates their profile; this one image is their
// profile icon and what recruiters see in search.
export const uploadPhotoFile = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'A JPG or PNG photo is required' })
  if (!isS3Configured()) return res.status(503).json({ message: 'Photo storage is not configured. Please contact support.' })

  const validated = validateResumeFile(req.file, { allowedExtensions: PHOTO_EXTENSIONS })
  if (!validated.ok) return res.status(400).json({ message: 'That file is not a valid JPG or PNG image' })

  const employee = req.employee
  const previousKey = employee.photo?.s3Key
  const version = (employee.photo?.version ?? 0) + 1
  const key = employeePhotoKey(employee._id, version, validated.ext)

  try {
    await uploadObject({ key, body: req.file.buffer, contentType: validated.mime })
  } catch (err) {
    logger.error({ err, employeeId: String(employee._id) }, 'Photo upload to S3 failed')
    return res.status(502).json({ message: 'Could not upload your photo right now. Please try again.' })
  }

  employee.photo = { s3Key: key, version, uploadedOn: new Date() }
  try {
    await employee.save()
  } catch (err) {
    await deleteObject(key).catch((cleanupErr) => logger.error({ err: cleanupErr, employeeId: String(employee._id) }, 'Failed to clean up orphaned photo object'))
    throw err
  }
  if (previousKey && previousKey !== key) await deleteObject(previousKey).catch((err) => logger.warn({ err, employeeId: String(employee._id) }, 'Failed to delete the replaced photo'))

  res.status(201).json({ photoUrl: photoUrlOf(employee) })
})

export const deletePhoto = asyncHandler(async (req, res) => {
  const employee = req.employee
  const key = employee.photo?.s3Key
  if (!key) return res.status(404).json({ message: 'No photo on file' })

  employee.photo = {}
  await employee.save()
  await deleteObject(key).catch((err) => logger.error({ err, employeeId: String(employee._id) }, 'Failed to delete photo object from S3'))
  res.json({ photoUrl: '' })
})
