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
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'")
  res.type('html').send(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Signing in…</title></head>
  <body>
    <!-- Android Custom Tabs / ASWebAuthenticationSession sometimes silently
         block a scheme navigation that isn't tied to a user gesture on this
         page (a bare location.replace() on load can get swallowed, leaving
         the tab stuck). The visible link below is a fallback the user can
         tap directly — a real tap always gets through. -->
    <a id="continueLink" href="#" style="font-family:sans-serif;font-size:18px">Tap here to continue</a>
    <script>
      var target = 'mzobs://redirect' + window.location.hash;
      document.getElementById('continueLink').href = target;
      window.location.replace(target);
    </script>
  </body>
</html>`)
}
