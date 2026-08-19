import { asyncHandler } from '../utils/asyncHandler.js'
import { feeFor, resumesFor } from '../utils/jobPricing.js'
import { logActivity } from '../utils/activityLog.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Job from '../models/Job.js'
import Invoice from '../models/Invoice.js'
import Batch from '../models/Batch.js'

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
