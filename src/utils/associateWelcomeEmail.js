const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Sent once, when an associate's code is first issued.
export function associateWelcomeEmail({ contactName, companyName, code }) {
  const subject = `Welcome to the Mzobs network — your associate code ${code}`
  const text = `Hi ${contactName || 'there'},\n\n${companyName} is now an associate of Mzobs.\n\nYour associate code: ${code}\n\nPlease keep this code handy and quote it whenever you speak with the Mzobs team.\n\n— Team Mzobs`
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#0B1220;">Welcome to the Mzobs network</h2>
      <p>Hi ${escapeHtml(contactName) || 'there'},</p>
      <p>${escapeHtml(companyName)} is now an associate of Mzobs. Here is your associate code:</p>
      <div style="background:#f3f4f6;border-radius:12px;padding:16px 20px;margin:16px 0;text-align:center;">
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:2px;">${escapeHtml(code)}</p>
      </div>
      <p>Please keep this code handy and quote it whenever you speak with the Mzobs team.</p>
      <p>— Team Mzobs</p>
    </div>
  `
  return { subject, text, html }
}
