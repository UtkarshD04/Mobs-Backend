import { asyncHandler } from '../utils/asyncHandler.js'
import { feeFor, resumesFor } from '../utils/jobPricing.js'
import { logActivity } from '../utils/activityLog.js'
import { creditJobPayment } from '../utils/creditJobPayment.js'
import { verifyOrderPaymentSignature } from '../utils/razorpaySignature.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { getRazorpayClient } from '../config/razorpay.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import Job from '../models/Job.js'
import Invoice from '../models/Invoice.js'
import Payment from '../models/Payment.js'

const INPUT_FIELDS = [
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
  'skills',
  'track',
  'description',
  'benefits',
  'deadline',
  'hiringTeam',
]

function pickInput(body) {
  const input = {}
  for (const field of INPUT_FIELDS) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}

async function findScopedJob(req) {
  return Job.findOne({ _id: req.params.id, company: req.company._id })
}

export const listJobs = asyncHandler(async (req, res) => {
  const { search, status, department } = req.query
  const query = { company: req.company._id }

  if (status && status !== 'all') query.status = status
  if (department && department !== 'all') query.department = department
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ title: regex }, { department: regex }, { location: regex }]
  }

  const { data, page, limit, total } = await paginate(Job, query, paginationParams(req), { sort: { updatedOn: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const getJob = asyncHandler(async (req, res) => {
  const job = await findScopedJob(req)
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json(job)
})

export const createJob = asyncHandler(async (req, res) => {
  const input = pickInput(req.body)
  const submitted = req.body.status === 'pending_review'

  const job = await Job.create({
    ...input,
    company: req.company._id,
    createdBy: req.user._id,
    status: req.body.status ?? 'draft',
    feeTotal: feeFor(input.vacancies),
    feeStatus: 'unpaid',
    resumesPromised: resumesFor(input.vacancies),
    candidatesShared: 0,
    hiresSelected: 0,
    submittedOn: submitted ? new Date() : null,
    postedOn: null,
    updatedOn: new Date(),
  })

  if (submitted) await logActivity(req.company._id, `Requirement "${job.title}" submitted to Mzobs for review`, 'navy')

  res.status(201).json(job)
})

export const updateJob = asyncHandler(async (req, res) => {
  const job = await findScopedJob(req)
  if (!job) return res.status(404).json({ message: 'Job not found' })

  const input = pickInput(req.body)
  Object.assign(job, input)
  if (input.vacancies !== undefined) {
    job.feeTotal = feeFor(input.vacancies)
    job.resumesPromised = resumesFor(input.vacancies)
  }
  job.updatedOn = new Date()

  await job.save()
  res.json(job)
})

export const setJobStatus = asyncHandler(async (req, res) => {
  const job = await findScopedJob(req)
  if (!job) return res.status(404).json({ message: 'Job not found' })

  const { status } = req.body ?? {}
  if (!status) return res.status(400).json({ message: 'status is required' })

  const enteringAwaitingPayment = status === 'awaiting_payment' && job.status !== 'awaiting_payment' && !job.invoiceId

  job.status = status
  if (status === 'pending_review' && !job.submittedOn) job.submittedOn = new Date()
  if (status === 'sourcing' && !job.postedOn) job.postedOn = new Date()
  job.updatedOn = new Date()

  if (enteringAwaitingPayment) {
    const invoice = await Invoice.create({
      company: req.company._id,
      job: job._id,
      description: `${job.title} — ${job.vacancies} opening${job.vacancies === 1 ? '' : 's'}`,
      amount: job.feeTotal,
      status: 'due',
    })
    job.invoiceId = invoice._id.toString()
  }

  await job.save()

  if (status === 'sourcing') await logActivity(req.company._id, `"${job.title}" released to Mzobs sourcing`, 'gold')
  if (status === 'pending_review') await logActivity(req.company._id, `Requirement "${job.title}" submitted to Mzobs for review`, 'navy')

  res.json(job)
})

// Creates a Razorpay order for the job's sourcing fee. The amount is always
// job.feeTotal as computed server-side by feeFor() — the client only ever
// gets back an order id to hand to Checkout, never a say in the amount.
export const createJobPaymentOrder = asyncHandler(async (req, res) => {
  const job = await findScopedJob(req)
  if (!job) return res.status(404).json({ message: 'Job not found' })
  if (job.feeStatus === 'paid') return res.status(409).json({ message: 'This requirement is already paid for' })
  if (!job.feeTotal || job.feeTotal <= 0) return res.status(400).json({ message: 'Nothing to pay for this requirement' })

  const receipt = `job_${job._id}_${Date.now()}`
  const order = await getRazorpayClient().orders.create({
    amount: Math.round(job.feeTotal * 100), // paise
    currency: 'INR',
    receipt,
    notes: { purpose: 'employer_job_fee', jobId: job._id.toString(), companyId: req.company._id.toString() },
  })

  await Payment.create({
    purpose: 'employer_job_fee',
    company: req.company._id,
    job: job._id,
    razorpayOrderId: order.id,
    amount: job.feeTotal,
    currency: 'INR',
    status: 'created',
    receipt,
  })

  res.status(201).json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: env.razorpayKeyId,
    name: 'Mzobs',
    description: `${job.title} — sourcing fee`,
    prefill: { name: req.user.name, email: req.user.email },
  })
})

// Confirms the checkout redirect result: HMAC signature proves it came from
// Razorpay for this order, then payments.fetch confirms it actually settled
// as 'captured' before the requirement is released into sourcing.
export const verifyJobPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {}
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing payment details' })
  }

  const job = await findScopedJob(req)
  if (!job) return res.status(404).json({ message: 'Job not found' })

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, company: req.company._id, job: job._id })
  if (!payment) return res.status(404).json({ message: 'Order not found' })

  if (payment.status === 'paid') return res.json(job)
  if (payment.status !== 'created') {
    return res.status(400).json({ message: 'This order can no longer be verified' })
  }

  if (!verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    payment.status = 'failed'
    await payment.save()
    logger.warn({ orderId: razorpay_order_id, jobId: job._id.toString() }, 'Razorpay signature verification failed')
    return res.status(400).json({ message: 'Payment verification failed' })
  }

  const captured = await getRazorpayClient().payments.fetch(razorpay_payment_id)
  if (captured.order_id !== razorpay_order_id || captured.status !== 'captured') {
    payment.status = 'failed'
    await payment.save()
    return res.status(400).json({ message: 'Payment was not captured' })
  }

  payment.razorpayPaymentId = razorpay_payment_id
  payment.razorpaySignature = razorpay_signature
  payment.status = 'paid'
  payment.paidAt = new Date()
  await payment.save()

  await creditJobPayment(job, payment)

  res.json(job)
})

export const duplicateJob = asyncHandler(async (req, res) => {
  const src = await findScopedJob(req)
  if (!src) return res.status(404).json({ message: 'Job not found' })

  const copy = await Job.create({
    company: src.company,
    createdBy: req.user._id,
    title: `${src.title} (Copy)`,
    department: src.department,
    employmentType: src.employmentType,
    experienceMin: src.experienceMin,
    experienceMax: src.experienceMax,
    salaryMin: src.salaryMin,
    salaryMax: src.salaryMax,
    vacancies: src.vacancies,
    location: src.location,
    workMode: src.workMode,
    skills: src.skills,
    track: src.track,
    description: src.description,
    benefits: src.benefits,
    deadline: src.deadline,
    hiringTeam: src.hiringTeam,
    status: 'draft',
    feeTotal: feeFor(src.vacancies),
    feeStatus: 'unpaid',
    resumesPromised: resumesFor(src.vacancies),
    candidatesShared: 0,
    hiresSelected: 0,
    submittedOn: null,
    postedOn: null,
    updatedOn: new Date(),
  })

  res.status(201).json(copy)
})

export const deleteJob = asyncHandler(async (req, res) => {
  const job = await Job.findOneAndDelete({ _id: req.params.id, company: req.company._id })
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json({ success: true })
})
