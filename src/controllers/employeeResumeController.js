import { asyncHandler } from '../utils/asyncHandler.js'
import { uploadObject, deleteObject, isS3Configured } from '../utils/s3.js'
import { validateResumeFile } from '../utils/fileValidation.js'
import { employeeResumeKey, serializeResumeSubdoc, serializeResumeHistory } from '../utils/resumeAccess.js'
import { logger } from '../config/logger.js'

function serialize(employee) {
  return {
    resume: serializeResumeSubdoc(employee.resume, 'employee-resume'),
    resumeHistory: serializeResumeHistory(employee.resumeHistory, 'employee-resume'),
  }
}

export const getResume = asyncHandler(async (req, res) => {
  res.json(serialize(req.employee))
})

export const uploadResumeFile = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'A PDF or Word resume file is required' })
  if (!isS3Configured()) return res.status(503).json({ message: 'Resume storage is not configured. Please contact support.' })

  const validated = validateResumeFile(req.file)
  if (!validated.ok) return res.status(400).json({ message: validated.reason })

  const employee = req.employee
  const nextVersion = (employee.resume?.version ?? 0) + 1
  const uploadedOn = new Date()
  const key = employeeResumeKey(employee._id, nextVersion, validated.ext)

  try {
    await uploadObject({ key, body: req.file.buffer, contentType: validated.mime })
  } catch (err) {
    logger.error({ err, employeeId: String(employee._id) }, 'Resume upload to S3 failed')
    return res.status(502).json({ message: 'Could not upload your resume right now. Please try again.' })
  }

  const previousResume = employee.resume?.version
    ? {
        version: employee.resume.version,
        file: employee.resume.file,
        s3Key: employee.resume.s3Key,
        uploadedOn: employee.resume.uploadedOn,
        score: employee.resume.score,
        status: employee.resume.status,
      }
    : null

  employee.resume = {
    file: req.file.originalname,
    s3Key: key,
    version: nextVersion,
    uploadedOn,
    // Verified immediately on upload — no staff review step to wait on.
    status: 'verified',
    verifiedOn: uploadedOn,
    reviewer: '',
    reviewerRole: '',
    score: null,
    note: '',
  }
  if (previousResume) employee.resumeHistory.push(previousResume)

  try {
    await employee.save()
  } catch (err) {
    // DB write failed after the S3 upload succeeded — clean up the orphaned
    // object rather than leaving it unreferenced in the bucket.
    await deleteObject(key).catch((cleanupErr) => logger.error({ err: cleanupErr, employeeId: String(employee._id) }, 'Failed to clean up orphaned resume object after a failed save'))
    throw err
  }

  logger.info({ employeeId: String(employee._id), version: nextVersion }, 'Resume uploaded')
  res.status(201).json(serialize(employee))
})

export const deleteResume = asyncHandler(async (req, res) => {
  const employee = req.employee
  const key = employee.resume?.s3Key
  if (!key) return res.status(404).json({ message: 'No resume on file' })

  employee.resume = {}
  await employee.save()

  try {
    await deleteObject(key)
  } catch (err) {
    // The DB record is already gone — the candidate's resume is deleted from
    // their perspective either way. Log so an orphaned object can be cleaned
    // up out-of-band rather than surfacing a confusing error to the user.
    logger.error({ err, employeeId: String(employee._id) }, 'Failed to delete resume object from S3')
  }

  logger.info({ employeeId: String(employee._id) }, 'Resume deleted')
  res.json(serialize(employee))
})
