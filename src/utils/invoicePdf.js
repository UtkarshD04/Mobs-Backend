import PDFDocument from 'pdfkit'
import { env } from '../config/env.js'

const PAGE_WIDTH = 595.28
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2 // 495.28
const RIGHT_COL_X = MARGIN + CONTENT_WIDTH / 2 + 10

const INK = '#171a17'
const GOLD = '#9a6b14'
const GREY = '#6b7280'
const GREY_LIGHT = '#9ca3af'
const BORDER = '#e2e4e0'

function money(n) {
  return n.toFixed(2)
}

function labelValue(doc, x, y, label, valueLines) {
  doc.font('Helvetica').fontSize(9.5).fillColor(GREY_LIGHT).text(label, x, y)
  doc.font('Helvetica').fontSize(10.5).fillColor(INK)
  let ly = y + 16
  for (const line of [].concat(valueLines)) {
    if (!line) continue
    doc.text(line, x, ly, { width: CONTENT_WIDTH / 2 - 20 })
    ly += 15
  }
  return ly
}

// Streams a one-page tax invoice PDF straight to `res` for a paid
// subscription Payment — plain, document-style layout (no template
// engine/headless browser needed for something this static, so pdfkit
// draws it directly).
export function streamSubscriptionInvoice(res, { payment, employee }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const filename = `mzobs-invoice-${payment.receipt}.pdf`

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  doc.pipe(res)

  // ---- Wordmark + heading ------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(22).fillColor(GOLD).text('M', MARGIN, 45, { continued: true })
  doc.fillColor(INK).text('zobs')

  doc.font('Helvetica').fontSize(26).fillColor(INK).text('Tax Invoice', MARGIN, 95)

  // ---- Invoice Date / Invoice no. ----------------------------------------
  const paidOn = payment.paidAt ? new Date(payment.paidAt) : new Date()
  const dateStr = paidOn.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })

  let y = 165
  let bottomA = labelValue(doc, MARGIN, y, 'Invoice Date', dateStr)
  let bottomB = labelValue(doc, RIGHT_COL_X, y, 'Invoice no.', payment.receipt)
  y = Math.max(bottomA, bottomB) + 20

  // ---- To / From -----------------------------------------------------------
  bottomA = labelValue(doc, MARGIN, y, 'To', [employee.name, employee.email, employee.phone])
  const fromLines = ['Mzobs']
  if (env.gst.number) fromLines.push(`GSTIN ${env.gst.number}`, `${env.gst.state}, India`)
  bottomB = labelValue(doc, RIGHT_COL_X, y, 'From', fromLines)
  y = Math.max(bottomA, bottomB) + 30

  // ---- Line item -------------------------------------------------------------
  doc.font('Helvetica').fontSize(9.5).fillColor(GREY_LIGHT).text('Placement Programme', MARGIN, y)
  y += 24

  const amtX = PAGE_WIDTH - MARGIN - 120
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Mzobs Placement Support Programme', MARGIN, y, { width: 320 })
  doc.font('Helvetica-Bold').fontSize(11).text(money(payment.amount), amtX, y, { width: 120, align: 'right' })
  y += 17
  doc.font('Helvetica').fontSize(9).fillColor(GREY_LIGHT).text(payment.receipt, MARGIN, y)
  y += 13
  doc.text(dateStr, MARGIN, y)
  y += 24

  if (payment.discountAmount > 0) {
    doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(`Coupon applied — ${payment.couponCode ?? ''}`, MARGIN, y, { width: 320 })
    doc.text(`- ${money(payment.discountAmount)}`, amtX, y, { width: 120, align: 'right' })
    y += 22
  }

  // ---- Divider ------------------------------------------------------------
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).strokeColor(BORDER).lineWidth(1).stroke()
  y += 22

  // ---- Footer note (left) + totals (right) --------------------------------
  const noteY = y
  doc.font('Helvetica').fontSize(9).fillColor(GREY)
  doc.text(
    'Payments are processed via Razorpay. This is a one-time fee — no renewal or recurring charge applies.',
    MARGIN,
    noteY,
    { width: RIGHT_COL_X - MARGIN - 30 }
  )

  const summaryLabelW = 110
  const summaryX = RIGHT_COL_X + 30
  let sy = y
  function summaryRow(label, value, bold) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? INK : GREY)
    doc.text(label, summaryX, sy, { width: summaryLabelW })
    doc.text(value, amtX, sy, { width: 120, align: 'right' })
    sy += 17
  }

  const rate = env.gst.number ? env.gst.ratePercent : 0
  const taxable = rate > 0 ? Math.round((payment.amount / (1 + rate / 100)) * 100) / 100 : payment.amount
  const totalTax = Math.round((payment.amount - taxable) * 100) / 100

  summaryRow('Total', money(payment.amount))
  if (rate > 0) summaryRow(`Includes ${rate}% tax`, money(totalTax))
  sy += 4
  doc.moveTo(summaryX, sy).lineTo(PAGE_WIDTH - MARGIN, sy).strokeColor(BORDER).lineWidth(1).stroke()
  sy += 10
  summaryRow('Total charged', money(payment.amount), true)

  y = Math.max(noteY + 30, sy) + 40

  // ---- Legal footer ---------------------------------------------------------
  doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text('Please retain for your records.', MARGIN, y)
  y += 20
  doc.fontSize(9).fillColor(GREY_LIGHT)
  const legalLines = []
  if (env.gst.number) legalLines.push(`GSTIN ${env.gst.number} · ${env.gst.state}, India`)
  legalLines.push(`Copyright © ${paidOn.getFullYear()} Mzobs. All rights reserved.`)
  for (const line of legalLines) {
    doc.text(line, MARGIN, y, { width: CONTENT_WIDTH })
    y += 14
  }

  doc.end()
}
