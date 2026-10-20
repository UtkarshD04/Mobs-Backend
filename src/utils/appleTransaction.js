import crypto from 'node:crypto'

// Verifies a StoreKit 2 signed transaction (the JWS the iOS app gets after an App Store
// purchase) without calling Apple: the signing certificate chain in the JWS header must lead
// to Apple's own root, and the signature must match. Nothing here needs an Apple key or an
// account. See https://developer.apple.com/documentation/appstoreserverapi/jwstransaction

// Apple Root CA - G3 (https://www.apple.com/certificateauthority/), valid until 2039.
// SHA-256 fingerprint 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`

// Marker extensions Apple puts only on its StoreKit signing certificates. Without checking
// them, any certificate Apple has signed (e.g. a developer's own) would pass the chain check.
const LEAF_OID = Buffer.from('060a2a864886f76364060b01', 'hex') // 1.2.840.113635.100.6.11.1
const INTERMEDIATE_OID = Buffer.from('060a2a864886f76364060201', 'hex') // 1.2.840.113635.100.6.2.1

let pinnedRoot = null

function fail(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

const b64url = (s) => Buffer.from(s, 'base64url')

// `rootPem` is only overridden by tests. Returns the transaction payload (productId, transactionId, originalTransactionId, bundleId,
// environment, price, currency, revocationDate, ...) once the JWS is proven to come from Apple.
export function verifyAppleTransaction(jws, { rootPem = APPLE_ROOT_CA_G3 } = {}) {
  if (typeof jws !== 'string') throw fail('Missing transaction')
  const parts = jws.split('.')
  if (parts.length !== 3) throw fail('Malformed transaction')
  const [h, p, s] = parts

  let header
  let payload
  try {
    header = JSON.parse(b64url(h).toString('utf8'))
    payload = JSON.parse(b64url(p).toString('utf8'))
  } catch {
    throw fail('Malformed transaction')
  }
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw fail('Unsupported transaction signature')

  let leaf
  let intermediate
  let root
  try {
    ;[leaf, intermediate, root] = header.x5c.map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')))
  } catch {
    throw fail('Malformed transaction certificate')
  }

  const appleRoot = rootPem === APPLE_ROOT_CA_G3 ? (pinnedRoot ??= new crypto.X509Certificate(APPLE_ROOT_CA_G3)) : new crypto.X509Certificate(rootPem)
  if (root.fingerprint256 !== appleRoot.fingerprint256) throw fail('Transaction is not signed by Apple')
  if (!root.verify(appleRoot.publicKey) || !intermediate.verify(root.publicKey) || !leaf.verify(intermediate.publicKey)) {
    throw fail('Transaction certificate chain is invalid')
  }
  if (!leaf.raw.includes(LEAF_OID) || !intermediate.raw.includes(INTERMEDIATE_OID)) throw fail('Not an App Store signing certificate')

  // Apple rotates these certificates, so judge them at the time the transaction was signed.
  const at = new Date(Number(payload.signedDate) || Date.now())
  for (const cert of [leaf, intermediate, root]) {
    if (at < new Date(cert.validFrom) || at > new Date(cert.validTo)) throw fail('Transaction certificate has expired')
  }

  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, b64url(s))
  if (!ok) throw fail('Transaction signature is invalid')
  return payload
}
