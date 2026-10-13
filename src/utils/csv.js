// Spreadsheet-safe CSV: quotes every cell, doubles embedded quotes, and
// prefixes formula-looking text (=, +, -, @) so Excel can't execute it.
function cell(value) {
  if (value == null) return '""'
  let s = value instanceof Date ? value.toISOString() : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(',')]
  for (const row of rows) lines.push(row.map(cell).join(','))
  // BOM so Excel opens UTF-8 (Hindi names etc.) correctly.
  return `﻿${lines.join('\r\n')}\r\n`
}

export function sendCsv(res, filename, headers, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(toCsv(headers, rows))
}
