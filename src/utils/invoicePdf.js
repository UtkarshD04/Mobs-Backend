import PDFDocument from 'pdfkit'
import { env } from '../config/env.js'

// Streams a simple one-page invoice PDF straight to `res` for a paid
// subscription Payment — no template engine/headless browser needed for
// a document this plain, so pdfkit (draws directly, no HTML step) is enough.
export function streamSubscriptionInvoice(res, { payment, employee }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const filename = `mzobs-invoice-${payment.receipt}.pdf`

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  doc.pipe(res)

  doc.fontSize(20).font('Helvetica-Bold').text('Mzobs', { continued: false })
  doc.fontSize(10).font('Helvetica').fillColor('#666').text('Solace Technologies')
  if (env.gst.number) doc.text(`GSTIN: ${env.gst.number}`)
  doc.moveDown(1.5)

  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text('Invoice')
  doc.moveDown(0.5)

  const paidOn = payment.paidAt ? new Date(payment.paidAt) : new Date()
  const rows = [
    ['Invoice / receipt no.', payment.receipt],
    ['Payment ID', payment.razorpayPaymentId ?? '—'],
    ['Date', paidOn.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })],
    ['Billed to', employee.name],
    ['Email', employee.email],
  ]
  if (env.gst.number) rows.push(['Place of supply', env.gst.state])

  doc.fontSize(10).font('Helvetica')
  for (const [label, value] of rows) {
    const y = doc.y
    doc.fillColor('#666').text(label, 50, y, { width: 140, lineBreak: false })
    doc.fillColor('#000').text(String(value), 190, y, { width: 360, lineBreak: false })
    doc.y = y
    doc.moveDown(1)
  }

  doc.moveDown(1)
  const tableTop = doc.y
  doc.font('Helvetica-Bold').fontSize(10)
  doc.text('Description', 50, tableTop)
  doc.text('Amount', 450, tableTop, { width: 100, align: 'right' })
  doc.moveTo(50, tableTop + 16).lineTo(550, tableTop + 16).strokeColor('#ddd').stroke()

  doc.font('Helvetica').fontSize(10)
  let y = tableTop + 26
  doc.fillColor('#000').text('Mzobs placement support programme — one-time fee', 50, y, { width: 380 })
  doc.text(`Rs. ${payment.amount.toFixed(2)}`, 450, y, { width: 100, align: 'right' })
  y += 20

  if (payment.discountAmount > 0) {
    doc.fillColor('#666').text(`Coupon (${payment.couponCode ?? ''}) discount`, 50, y, { width: 380 })
    doc.text(`- Rs. ${payment.discountAmount.toFixed(2)}`, 450, y, { width: 100, align: 'right' })
    y += 20
  }

  // The fee is tax-inclusive — GST is carved out of `payment.amount` rather
  // than added on top, so the candidate's checkout price is unaffected.
  if (env.gst.number && env.gst.ratePercent > 0) {
    const rate = env.gst.ratePercent
    const taxable = Math.round((payment.amount / (1 + rate / 100)) * 100) / 100
    const totalTax = Math.round((payment.amount - taxable) * 100) / 100
    const halfTax = Math.round((totalTax / 2) * 100) / 100

    doc.moveTo(50, y).lineTo(550, y).strokeColor('#eee').stroke()
    y += 10

    doc.fillColor('#666')
    doc.text('Taxable value', 50, y, { width: 380 })
    doc.text(`Rs. ${taxable.toFixed(2)}`, 450, y, { width: 100, align: 'right' })
    y += 18
    doc.text(`CGST @ ${(rate / 2).toFixed(1)}%`, 50, y, { width: 380 })
    doc.text(`Rs. ${halfTax.toFixed(2)}`, 450, y, { width: 100, align: 'right' })
    y += 18
    doc.text(`SGST @ ${(rate / 2).toFixed(1)}%`, 50, y, { width: 380 })
    doc.text(`Rs. ${halfTax.toFixed(2)}`, 450, y, { width: 100, align: 'right' })
    y += 20
  }

  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ddd').stroke()
  y += 10
  doc.font('Helvetica-Bold').fillColor('#000').text('Total paid', 50, y, { width: 380 })
  doc.text(`Rs. ${payment.amount.toFixed(2)}`, 450, y, { width: 100, align: 'right' })

  doc.y = y
  doc.moveDown(4)
  doc.font('Helvetica').fontSize(9).fillColor('#999').text('This is a system-generated invoice for a one-time payment. No renewal or recurring charge applies.', 50, doc.y, { width: 500 })

  doc.end()
}
