import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { verifyAppleTransaction } from './appleTransaction.js'

// Builds a stand-in for Apple's root -> intermediate -> leaf chain (with the same marker
// extensions) so the verifier can be exercised without a real App Store transaction.
function buildChain({ leafMarker = '1.2.840.113635.100.6.11.1' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'apple-chain-'))
  const run = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
  const ext = (name, oid) => writeFileSync(path.join(dir, name), `basicConstraints=CA:${name.startsWith('leaf') ? 'FALSE' : 'TRUE'}\n${oid}=ASN1:NULL\n`)
  for (const n of ['root', 'inter', 'leaf']) run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${n}.key`)
  run('req', '-new', '-x509', '-key', 'root.key', '-subj', '/CN=Test Root', '-days', '30', '-out', 'root.pem')
  ext('inter.ext', '1.2.840.113635.100.6.2.1')
  ext('leaf.ext', leafMarker)
  for (const [n, issuer] of [['inter', 'root'], ['leaf', 'inter']]) {
    run('req', '-new', '-key', `${n}.key`, '-subj', `/CN=Test ${n}`, '-out', `${n}.csr`)
    run('x509', '-req', '-in', `${n}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', '30', '-extfile', `${n}.ext`, '-out', `${n}.pem`)
  }
  const der = (n) => Buffer.from(readFileSync(path.join(dir, `${n}.pem`), 'utf8').replace(/-----[A-Z ]+-----|\s/g, ''), 'base64').toString('base64')
  return { rootPem: readFileSync(path.join(dir, 'root.pem'), 'utf8'), x5c: [der('leaf'), der('inter'), der('root')], leafKey: readFileSync(path.join(dir, 'leaf.key'), 'utf8') }
}

function sign({ x5c, leafKey }, payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${enc({ alg: 'ES256', x5c })}.${enc(payload)}`
  const sig = crypto.sign('sha256', Buffer.from(data), { key: leafKey, dsaEncoding: 'ieee-p1363' })
  return `${data}.${sig.toString('base64url')}`
}

const payload = { bundleId: 'com.mzobs.app', productId: 'com.mzobs.app.premium_lifetime', transactionId: '1', originalTransactionId: '1', signedDate: Date.now() }

test('a transaction signed through the trusted chain verifies', () => {
  const chain = buildChain()
  assert.equal(verifyAppleTransaction(sign(chain, payload), { rootPem: chain.rootPem }).productId, payload.productId)
})

test('a tampered payload is rejected', () => {
  const chain = buildChain()
  const [h, , s] = sign(chain, payload).split('.')
  const forged = Buffer.from(JSON.stringify({ ...payload, productId: 'free' })).toString('base64url')
  assert.throws(() => verifyAppleTransaction(`${h}.${forged}.${s}`, { rootPem: chain.rootPem }), /signature/i)
})

test('a chain that does not lead to Apple\'s root is rejected', () => {
  const chain = buildChain()
  assert.throws(() => verifyAppleTransaction(sign(chain, payload)), /not signed by Apple/)
})

test('a certificate without the App Store marker is rejected', () => {
  const chain = buildChain({ leafMarker: '1.2.3.4.5' })
  assert.throws(() => verifyAppleTransaction(sign(chain, payload), { rootPem: chain.rootPem }), /marker|App Store signing/i)
})

test('garbage is rejected', () => {
  assert.throws(() => verifyAppleTransaction('not.a.jws'))
  assert.throws(() => verifyAppleTransaction(undefined))
})
