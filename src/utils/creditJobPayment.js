import Invoice from '../models/Invoice.js'
import Batch from '../models/Batch.js'
import { logActivity } from './activityLog.js'

// Shared by the verify endpoint (browser round-trip) and the webhook
// (server-to-server) so a job only ever gets credited once no matter which
// path gets there first — both call sites check payment/job status before
// calling this, but it stays idempotent in its own right too.
export async function creditJobPayment(job, payment) {
  if (job.feeStatus === 'paid') return job

  if (job.invoiceId) {
    await Invoice.findByIdAndUpdate(job.invoiceId, {
      status: 'paid',
      paymentMode: 'Razorpay',
      reference: payment.razorpayPaymentId ?? '',
    })
  }

  job.feeStatus = 'paid'
  job.paidOn = payment.paidAt ?? new Date()
  job.status = 'sourcing'
  if (!job.postedOn) job.postedOn = new Date()
  job.updatedOn = new Date()
  await job.save()

  const existingBatch = await Batch.findOne({ job: job._id })
  if (!existingBatch) {
    await Batch.create({
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

  return job
}
