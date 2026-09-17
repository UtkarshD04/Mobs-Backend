// Google's OAuth client only accepts an https:// redirect_uri (no custom app
// scheme), so the mobile app's browser-based sign-in points Google here.
// Google returns the id_token as a URL *fragment* (`#id_token=...`), which
// never reaches the server — only client-side JS on this page can read it
// and forward it into the app via the "mzobs://" scheme. See
// Mobile-App/src/lib/googleSignIn.js for the request side of this flow.
export function googleMobileCallback(req, res) {
  // Overrides helmet's default CSP for this one response — the redirect can
  // only happen from an inline script, since the fragment isn't available
  // server-side to bake into a server-rendered redirect.
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'")
  res.type('html').send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Signing in…</title></head>
  <body>
    <script>
      window.location.replace('mzobs://redirect' + window.location.hash);
    </script>
  </body>
</html>`)
}
