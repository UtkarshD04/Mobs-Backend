import { asyncHandler } from '../utils/asyncHandler.js'

export const getResume = asyncHandler(async (req, res) => {
  res.json({ resume: req.employee.resume, resumeHistory: req.employee.resumeHistory })
})

export const uploadResumeFile = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'A PDF or Word resume file is required' })

  const employee = req.employee
  const nextVersion = (employee.resume?.version ?? 0) + 1
  const uploadedOn = new Date()
  const url = `/uploads/resumes/${req.file.filename}`

  if (employee.resume?.version) {
    employee.resumeHistory.push({
      version: employee.resume.version,
      file: employee.resume.file,
      url: employee.resume.url,
      uploadedOn: employee.resume.uploadedOn,
      score: employee.resume.score,
      status: employee.resume.status,
    })
  }

  employee.resume = {
    file: req.file.originalname,
    url,
    version: nextVersion,
    uploadedOn,
    status: 'pending',
    verifiedOn: null,
    reviewer: '',
    reviewerRole: '',
    score: null,
    note: '',
  }

  await employee.save()

  res.status(201).json({ resume: employee.resume, resumeHistory: employee.resumeHistory })
})
