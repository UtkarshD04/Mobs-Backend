import { asyncHandler } from '../utils/asyncHandler.js'
import { feeFor, resumesFor } from '../utils/jobPricing.js'
import { logActivity } from '../utils/activityLog.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { sendPush } from '../utils/push.js'
import Job from '../models/Job.js'
import Invoice from '../models/Invoice.js'
import Batch from '../models/Batch.js'
import Company from '../models/Company.js'
import StaffUser from '../models/StaffUser.js'
import StaffNotification from '../models/StaffNotification.js'

const REQUIRED_JOB_FIELDS = [
  'title',
  'department',
  'employmentType',
  'experienceMin',
  'experienceMax',
  'salaryMin',
  'salaryMax',
  'vacancies',
  'location',
  'workMode',
  'description',
  'deadline',
]

// Admin/Ops posting a role directly — no employer submission, no invoice —
// it's Mzobs's own listing, so it's saved already live on the candidate job
// board (same status/visibility a paid, sourcing employer job would have).
export const createJob = asyncHandler(async (req, res) => {
  const body = req.body ?? {}
  const missing = REQUIRED_JOB_FIELDS.filter((field) => body[field] === undefined || body[field] === null || body[field] === '')
  if (missing.length) return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` })

  const { companyId, companyName } = body
  if (!companyId && !companyName?.trim()) return res.status(400).json({ message: 'Select a company or enter a new company name' })

  let company
  if (companyId) {
    company = await Company.findById(companyId)
    if (!company) return res.status(404).json({ message: 'Company not found' })
  } else {
    company = await Company.create({ name: companyName.trim() })
  }

  const now = new Date()
  const job = await Job.create({
    company: company._id,
    postedByStaff: req.staff._id,
    title: body.title,
    department: body.department,
    employmentType: body.employmentType,
    experienceMin: body.experienceMin,
    experienceMax: body.experienceMax,
    salaryMin: body.salaryMin,
    salaryMax: body.salaryMax,
    vacancies: body.vacancies,
    location: body.location,
    workMode: body.workMode,
    skills: body.skills ?? [],
    track: body.track ?? '',
    description: body.description,
    benefits: body.benefits ?? [],
    deadline: body.deadline,
    status: 'sourcing',
    visibleToCandidates: true,
    submittedOn: now,
    postedOn: now,
    updatedOn: now,
  })

  await logStaffActivity(`${req.staff.name} posted "${job.title}" for ${company.name} — live on the candidate job board`, 'navy')

  res.status(201).json(await job.populate('company', 'name logo'))
})

export const listJobs = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (status && status !== 'all') query.status = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ title: regex }, { department: regex }, { location: regex }]
  }

  const { data, page, limit, total } = await paginate(Job, query, paginationParams(req), {
    sort: { updatedOn: -1 },
    populate: { path: 'company', select: 'name logo' },
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const getJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id).populate('company', 'name logo')
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json(job)
})

// Staff reviews a submitted requirement: confirms the final opening count,
// decides whether it should show on the employee-facing job board, and
// raises the sourcing-fee invoice.
export const approveJob = asyncHandler(async (req, res) => {
  const { vacancies, visibleToCandidates, track } = req.body ?? {}
  const job = await Job.findById(req.params.id)
  if (!job) return res.status(404).json({ message: 'Job not found' })

  if (vacancies !== undefined) job.vacancies = vacancies
  if (track !== undefined) job.track = track
  job.visibleToCandidates = visibleToCandidates ?? true
  job.feeTotal = feeFor(job.vacancies)
  job.resumesPromised = resumesFor(job.vacancies)
  job.status = 'awaiting_payment'
  job.updatedOn = new Date()

  let invoice = job.invoiceId ? await Invoice.findById(job.invoiceId) : null
  if (!invoice) {
    invoice = await Invoice.create({
      company: job.company,
      job: job._id,
      description: `${job.title} — ${job.vacancies} opening${job.vacancies === 1 ? '' : 's'}`,
      amount: job.feeTotal,
      status: 'due',
    })
    job.invoiceId = invoice._id.toString()
  } else {
    invoice.amount = job.feeTotal
    await invoice.save()
  }

  await job.save()
  await logActivity(job.company, `Mzobs approved "${job.title}" — invoice raised for ${job.feeTotal}`, 'navy')
  await logStaffActivity(`Approved "${job.title}" and raised invoice for ₹${job.feeTotal}`, 'navy')

  res.json(job)
})

// Records the employer's sourcing-fee payment and opens sourcing — creates
// the Batch row the employer will see resumes land in.
export const recordJobPayment = asyncHandler(async (req, res) => {
  const { paymentMode, reference } = req.body ?? {}
  const job = await Job.findById(req.params.id)
  if (!job) return res.status(404).json({ message: 'Job not found' })

  if (job.invoiceId) {
    await Invoice.findByIdAndUpdate(job.invoiceId, { status: 'paid', paymentMode: paymentMode ?? null, reference: reference ?? '' })
  }

  job.feeStatus = 'paid'
  job.paidOn = new Date()
  job.status = 'sourcing'
  if (!job.postedOn) job.postedOn = new Date()
  job.updatedOn = new Date()
  await job.save()

  let batch = await Batch.findOne({ job: job._id })
  if (!batch) {
    batch = await Batch.create({
      job: job._id,
      company: job.company,
      jobTitle: job.title,
      openings: job.vacancies,
      resumesPromised: job.resumesPromised,
      resumesDelivered: 0,
      status: 'preparing',
    })
  }

  await logActivity(job.company, `Payment received for "${job.title}" — Mzobs is now sourcing ${job.resumesPromised} resumes`, 'green')
  await logStaffActivity(`Payment recorded for "${job.title}" — sourcing started`, 'green')

  res.json({ job, batch })
})

// Operations broadcasts an open requirement to every HR so they know to
// check their shortlisted candidates for a fit.
export const notifyHr = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id).populate('company', 'name')
  if (!job) return res.status(404).json({ message: 'Job not found' })
  if (job.status !== 'sourcing') return res.status(400).json({ message: 'Only requirements that are sourcing can notify HR' })

  const hrStaff = await StaffUser.find({ accessLevel: 'staff', status: 'active' })
  const title = `${job.company?.name ?? 'An employer'} needs candidates for "${job.title}" (${job.vacancies} opening${job.vacancies === 1 ? '' : 's'}).`

  await Promise.all(
    hrStaff.map(async (staff) => {
      const notification = await StaffNotification.create({ staff: staff._id, category: 'requirements', title: 'Candidates needed', body: title })
      await sendPush(staff, { title: notification.title, body: notification.body })
    })
  )

  await logStaffActivity(`${req.staff.name} requested candidates from HR for "${job.title}"`, 'gold')

  res.json({ notified: hrStaff.length })
})
