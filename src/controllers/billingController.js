import { asyncHandler } from '../utils/asyncHandler.js'
import { FEE_PER_OPENING, RESUMES_PER_OPENING } from '../utils/jobPricing.js'
import Job from '../models/Job.js'
import Invoice from '../models/Invoice.js'

export const getBillingSummary = asyncHandler(async (req, res) => {
  const jobs = await Job.find({ company: req.company._id })
  const billable = jobs.filter((j) => j.status !== 'draft')
  const paid = billable.filter((j) => j.feeStatus === 'paid')
  const unpaid = billable.filter((j) => j.feeStatus === 'unpaid' && j.status !== 'pending_review')

  const sum = (rows, field) => rows.reduce((total, r) => total + (r[field] ?? 0), 0)

  res.json({
    perOpeningFee: FEE_PER_OPENING,
    resumesPerOpening: RESUMES_PER_OPENING,
    openingsPaid: sum(paid, 'vacancies'),
    totalBilled: sum(paid, 'feeTotal'),
    outstanding: sum(unpaid, 'feeTotal'),
    outstandingCount: unpaid.length,
    resumesPromised: sum(paid, 'resumesPromised'),
    resumesDelivered: sum(paid, 'candidatesShared'),
    hires: sum(jobs, 'hiresSelected'),
    verificationStatus: req.company.verificationStatus,
    paymentMethod: { brand: 'Visa', last4: '4242', expiry: '08/28' },
  })
})

export const listInvoices = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find({ company: req.company._id }).sort({ date: -1 })
  res.json(invoices)
})
