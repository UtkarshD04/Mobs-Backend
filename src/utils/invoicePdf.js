import PDFDocument from 'pdfkit'

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
  const rowY = tableTop + 26
  doc.text('Mzobs placement support programme — one-time fee', 50, rowY, { width: 380 })
  doc.text(`Rs. ${payment.amount.toFixed(2)}`, 450, rowY, { width: 100, align: 'right' })

  if (payment.discountAmount > 0) {
    const discY = rowY + 20
    doc.fillColor('#666').text(`Coupon (${payment.couponCode ?? ''}) discount`, 50, discY, { width: 380 })
    doc.text(`- Rs. ${payment.discountAmount.toFixed(2)}`, 450, discY, { width: 100, align: 'right' })
  }

  const totalY = rowY + (payment.discountAmount > 0 ? 50 : 30)
  doc.moveTo(50, totalY - 6).lineTo(550, totalY - 6).strokeColor('#ddd').stroke()
  doc.font('Helvetica-Bold').fillColor('#000').text('Total paid', 50, totalY, { width: 380 })
  doc.text(`Rs. ${payment.amount.toFixed(2)}`, 450, totalY, { width: 100, align: 'right' })

  doc.moveDown(4)
  doc.font('Helvetica').fontSize(9).fillColor('#999').text('This is a system-generated invoice for a one-time payment. No renewal or recurring charge applies.', 50, doc.y, { width: 500 })

  doc.end()
}
