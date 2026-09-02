import PDFDocument from 'pdfkit'
import { env } from '../config/env.js'

const PAGE_WIDTH = 595.28
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2 // 495.28

// Brand palette — matches the candidate site's --color-navy (actually a
// deep green) / --color-gold tokens in Website/Frontend/src/index.css, so
// the PDF doesn't look like a different product from the page it's downloaded from.
const INK = '#142016'
const INK_SOFT = '#3d5c34'
const GOLD = '#9a6b14'
const GOLD_TINT = '#fbf3de'
const GREY = '#6b7280'
const GREY_LIGHT = '#9ca3af'
const BORDER = '#e5e7eb'

function money(n) {
  return `Rs. ${n.toFixed(2)}`
}

// Streams a one-page invoice PDF straight to `res` for a paid subscription
// Payment — no template engine/headless browser needed for a document this
// plain, so pdfkit (draws directly, no HTML step) is enough.
export function streamSubscriptionInvoice(res, { payment, employee }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const filename = `mzobs-invoice-${payment.receipt}.pdf`

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  doc.pipe(res)

  // ---- Header band ------------------------------------------------------
  const headerHeight = 118
  doc.rect(0, 0, PAGE_WIDTH, headerHeight).fill(INK)

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('Mzobs', MARGIN, 32)
  doc.font('Helvetica').fontSize(9.5).fillColor('#c9d4c5')
  doc.text('Solace Technologies', MARGIN, 60)
  if (env.gst.number) doc.text(`GSTIN ${env.gst.number}`, MARGIN, 74)

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text('INVOICE', MARGIN, 32, { width: CONTENT_WIDTH, align: 'right' })
  doc.font('Helvetica').fontSize(9.5).fillColor('#c9d4c5')
  doc.text(payment.receipt, MARGIN, 58, { width: CONTENT_WIDTH, align: 'right' })

  // ---- Meta strip: billed-to / invoice details --------------------------
  const paidOn = payment.paidAt ? new Date(payment.paidAt) : new Date()
  const dateStr = paidOn.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  let y = headerHeight + 30
  const colGap = 20
  const colWidth = (CONTENT_WIDTH - colGap) / 2

  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY_LIGHT).text('BILLED TO', MARGIN, y)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY_LIGHT).text('PAYMENT DETAILS', MARGIN + colWidth + colGap, y)
  y += 15

  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(employee.name, MARGIN, y, { width: colWidth })
  const detailRows = [
    ['Date', dateStr],
    ['Payment ID', payment.razorpayPaymentId ?? '—'],
    ...(env.gst.number ? [['Place of supply', env.gst.state]] : []),
  ]
  let detailY = y
  for (const [label, value] of detailRows) {
    doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(label, MARGIN + colWidth + colGap, detailY, { width: 90, continued: false })
    doc.fillColor(INK).text(value, MARGIN + colWidth + colGap + 95, detailY, { width: colWidth - 95 })
    detailY += 16
  }

  doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(employee.email, MARGIN, y + 16, { width: colWidth })

  y = Math.max(y + 40, detailY + 10)

  // ---- Line items table ---------------------------------------------------
  const descX = MARGIN + 14
  const amtColW = 120
  const amtX = PAGE_WIDTH - MARGIN - amtColW - 14

  doc.rect(MARGIN, y, CONTENT_WIDTH, 26).fill(INK)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
  doc.text('DESCRIPTION', descX, y + 8)
  doc.text('AMOUNT', amtX, y + 8, { width: amtColW, align: 'right' })
  y += 26

  const lineItemTop = y
  doc.font('Helvetica').fontSize(10.5).fillColor(INK)
  doc.text('Mzobs placement support programme — one-time fee', descX, y + 12, { width: CONTENT_WIDTH - amtColW - 28 })
  doc.text(money(payment.amount), amtX, y + 12, { width: amtColW, align: 'right' })
  y += 36

  if (payment.discountAmount > 0) {
    doc.fontSize(9.5).fillColor(GREY)
    doc.text(`Coupon applied — ${payment.couponCode ?? ''}`, descX, y, { width: CONTENT_WIDTH - amtColW - 28 })
    doc.text(`- ${money(payment.discountAmount)}`, amtX, y, { width: amtColW, align: 'right' })
    y += 20
  }
  doc.rect(MARGIN, lineItemTop, CONTENT_WIDTH, y - lineItemTop).strokeColor(BORDER).lineWidth(1).stroke()

  // ---- Tax summary (right-aligned mini table) ----------------------------
  y += 16
  if (env.gst.number && env.gst.ratePercent > 0) {
    const rate = env.gst.ratePercent
    const taxable = Math.round((payment.amount / (1 + rate / 100)) * 100) / 100
    const totalTax = Math.round((payment.amount - taxable) * 100) / 100
    const halfTax = Math.round((totalTax / 2) * 100) / 100

    const summaryRows = [
      ['Taxable value', money(taxable)],
      [`CGST @ ${(rate / 2).toFixed(1)}%`, money(halfTax)],
      [`SGST @ ${(rate / 2).toFixed(1)}%`, money(halfTax)],
    ]
    const labelX = PAGE_WIDTH - MARGIN - amtColW - 160
    doc.font('Helvetica').fontSize(9.5).fillColor(GREY)
    for (const [label, value] of summaryRows) {
      doc.text(label, labelX, y, { width: 150, align: 'right' })
      doc.fillColor(INK).text(value, amtX, y, { width: amtColW, align: 'right' })
      doc.fillColor(GREY)
      y += 17
    }
    y += 8
  }

  // ---- Total paid banner --------------------------------------------------
  doc.rect(MARGIN, y, CONTENT_WIDTH, 40).fill(GOLD_TINT)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD).text('TOTAL PAID', descX, y + 13)
  doc.fontSize(13).text(money(payment.amount), amtX, y + 11, { width: amtColW, align: 'right' })
  y += 40

  // ---- What this covers ----------------------------------------------------
  y += 32
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY_LIGHT).text('WHAT THIS COVERS', MARGIN, y)
  y += 16
  const covers = ['Resume verification', 'Mock interview with our panel', 'Skill track assignment', 'Profile dispatch to employers']
  doc.font('Helvetica').fontSize(9.5).fillColor(INK_SOFT)
  covers.forEach((item, i) => {
    const colX = MARGIN + (i % 2) * (CONTENT_WIDTH / 2)
    const rowY = y + Math.floor(i / 2) * 18
    doc.text(`•  ${item}`, colX, rowY, { width: CONTENT_WIDTH / 2 - 10 })
  })
  y += Math.ceil(covers.length / 2) * 18 + 20

  // ---- Footer ---------------------------------------------------------------
  const footerY = 770
  doc.moveTo(MARGIN, footerY).lineTo(PAGE_WIDTH - MARGIN, footerY).strokeColor(BORDER).lineWidth(1).stroke()
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY_LIGHT)
  doc.text('This is a system-generated invoice for a one-time payment — no renewal or recurring charge applies.', MARGIN, footerY + 14, {
    width: CONTENT_WIDTH,
  })
  doc.moveDown(0.6)
  doc.text('Placement support is not a job guarantee.', MARGIN, doc.y, { width: CONTENT_WIDTH })
  doc.moveDown(0.8)
  doc.fillColor(GREY).text('Mzobs · Solace Technologies', MARGIN, doc.y)

  doc.end()
}
