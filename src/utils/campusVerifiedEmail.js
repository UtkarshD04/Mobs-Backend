const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Sent once, when a campus is verified and its code is first issued.
export function campusVerifiedEmail({ contactPerson, campusName, code }) {
  const subject = `${campusName} is verified on Mzobs — your campus code ${code}`
  const text = `Hi ${contactPerson || 'there'},\n\n${campusName} has been verified as a campus partner of Mzobs.\n\nYour campus code: ${code}\n\nPlease keep this code handy and quote it whenever you speak with the Mzobs team.\n\n— Team Mzobs`
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#0B1220;">Your campus is verified</h2>
      <p>Hi ${escapeHtml(contactPerson) || 'there'},</p>
      <p>${escapeHtml(campusName)} has been verified as a campus partner of Mzobs. Here is your campus code:</p>
      <div style="background:#f3f4f6;border-radius:12px;padding:16px 20px;margin:16px 0;text-align:center;">
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:2px;">${escapeHtml(code)}</p>
      </div>
      <p>Please keep this code handy and quote it whenever you speak with the Mzobs team.</p>
      <p>— Team Mzobs</p>
    </div>
  `
  return { subject, text, html }
}
