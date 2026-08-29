// Shared "here are your new/reset credentials" template for internal staff —
// used by both createTeammate (account created) and resetTeammatePassword
// (password reset), same layout as passwordReset.js's reset-link email.
export function staffCredentialsEmailHtml({ name, email, tempPassword, loginUrl, isNewAccount }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#0B1220;">${isNewAccount ? 'Your Mzobs staff account is ready' : 'Your Mzobs staff password has been reset'}</h2>
      <p>Hi ${name || 'there'},</p>
      <p>${isNewAccount ? "An admin created a staff account for you on Mzobs's internal portal." : 'An admin reset your staff account password.'} Here are your credentials:</p>
      <div style="background:#f3f4f6;border-radius:12px;padding:16px 20px;margin:16px 0;">
        <p style="margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
        <p style="margin:0;"><strong>Temporary password:</strong> ${tempPassword}</p>
      </div>
      <p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#333333;color:#fff;border-radius:999px;text-decoration:none;">Sign in</a></p>
      <p>This is a temporary password — you can change it after signing in.</p>
    </div>
  `
}
