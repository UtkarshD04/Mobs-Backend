import { asyncHandler } from '../utils/asyncHandler.js'
import { verifyWebhookSignature } from '../utils/razorpaySignature.js'
import { creditJobPayment } from '../utils/creditJobPayment.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import Employee from '../models/Employee.js'
import Job from '../models/Job.js'
import Payment from '../models/Payment.js'

// Asynchronous source of truth: Razorpay calls this directly, independent of
// whether the customer's browser stayed on the page long enough for the
// verify endpoint to run. Idempotent against both duplicate deliveries and a
// verify call that already landed first — each branch checks status before
// crediting anything.
export const razorpayWebhook = asyncHandler(async (req, res) => {
  if (!env.razorpayWebhookSecret) {
    logger.error('Razorpay webhook secret not configured — rejecting webhook')
    return res.status(503).end()
  }

  const signature = req.headers['x-razorpay-signature']
  if (!verifyWebhookSignature(req.body, signature)) {
    return res.status(400).json({ message: 'Invalid signature' })
  }

  const event = JSON.parse(req.body.toString('utf8'))
  const entity = event?.payload?.payment?.entity

  if (event.event === 'payment.captured' && entity?.order_id) {
    const payment = await Payment.findOne({ razorpayOrderId: entity.order_id })
    if (payment && payment.status !== 'paid') {
      payment.razorpayPaymentId = entity.id
      payment.status = 'paid'
      payment.paidAt = new Date()
      await payment.save()

      if (payment.purpose === 'employee_subscription') {
        const employee = await Employee.findById(payment.employee)
        if (employee && employee.subscription.status !== 'paid') {
          employee.subscription = { status: 'paid', amount: payment.amount, paidOn: payment.paidAt }
          await employee.save()
        }
      } else if (payment.purpose === 'employer_job_fee') {
        const job = await Job.findById(payment.job)
        if (job && job.feeStatus !== 'paid') {
          await creditJobPayment(job, payment)
        }
      }
    }
  } else if (event.event === 'payment.failed' && entity?.order_id) {
    await Payment.updateOne({ razorpayOrderId: entity.order_id, status: 'created' }, { $set: { status: 'failed' } })
  }

  res.status(200).json({ received: true })
})
