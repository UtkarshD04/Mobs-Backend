import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { gunzipSync } from 'node:zlib'
import express from 'express'
import compression from 'compression'
import { responseCache } from './responseCache.js'

// fetch() always asks for and silently unpacks gzip, so raw http shows what was really sent.
function rawGet(url, acceptEncoding) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {} }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }))
      })
      .on('error', reject)
  })
}

describe('responseCache', () => {
  let server
  let base
  let calls = 0
  let slowCalls = 0
  let shortCalls = 0

  before(async () => {
    const app = express()
    app.get('/jobs', responseCache(60), (req, res) => {
      calls += 1
      res.set('X-Total-Count', '42')
      res.set('X-Page', String(req.query.page ?? 1))
      res.set('X-Limit', '20')
      res.json([{ id: 'job-1', call: calls }])
    })
    app.get('/missing', responseCache(60), (_req, res) => {
      calls += 1
      res.status(404).json({ message: 'nope' })
    })
    app.get('/slow', responseCache(60), (_req, res) => {
      slowCalls += 1
      setTimeout(() => res.json({ call: slowCalls }), 50)
    })
    app.get('/big', compression(), responseCache(60), (_req, res) => {
      res.json(Array.from({ length: 200 }, (_, i) => ({ id: `job-${i}`, title: 'Software engineer' })))
    })
    app.get('/short', responseCache(1), (_req, res) => {
      shortCalls += 1
      setTimeout(() => res.json({ call: shortCalls }), 100)
    })
    await new Promise((resolve) => {
      server = app.listen(0, resolve)
    })
    base = `http://127.0.0.1:${server.address().port}`
  })

  after(() => server.close())

  test('a HIT serves the stored body without running the handler again', async () => {
    calls = 0
    const first = await fetch(`${base}/jobs?page=1`)
    const second = await fetch(`${base}/jobs?page=1`)
    assert.deepEqual(await first.json(), [{ id: 'job-1', call: 1 }])
    assert.deepEqual(await second.json(), [{ id: 'job-1', call: 1 }])
    assert.equal(second.headers.get('x-cache'), 'HIT')
    assert.equal(calls, 1)
  })

  test('a HIT replays the pagination headers', async () => {
    await fetch(`${base}/jobs?page=2`)
    const hit = await fetch(`${base}/jobs?page=2`)
    assert.equal(hit.headers.get('x-cache'), 'HIT')
    assert.equal(hit.headers.get('x-total-count'), '42')
    assert.equal(hit.headers.get('x-page'), '2')
    assert.equal(hit.headers.get('x-limit'), '20')
  })

  test('requests arriving together on a cold cache run the handler once', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => fetch(`${base}/slow`)))
    const bodies = await Promise.all(responses.map((r) => r.json()))
    assert.equal(slowCalls, 1)
    assert.ok(bodies.every((b) => b.call === 1))
  })

  test('once expired, one request refreshes while the rest get the stale copy', async () => {
    await fetch(`${base}/short`)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const responses = await Promise.all(Array.from({ length: 6 }, () => fetch(`${base}/short`)))
    const stale = responses.filter((r) => r.headers.get('x-cache') === 'STALE')
    assert.equal(shortCalls, 2)
    assert.equal(stale.length, 5)
    const fresh = await fetch(`${base}/short`)
    assert.equal(fresh.headers.get('x-cache'), 'HIT')
    assert.deepEqual(await fresh.json(), { call: 2 })
  })

  test('a large HIT is served pre-gzipped to clients that accept gzip', async () => {
    await rawGet(`${base}/big`, 'gzip')
    const hit = await rawGet(`${base}/big`, 'gzip, deflate, br')
    assert.equal(hit.headers['x-cache'], 'HIT')
    assert.equal(hit.headers['content-encoding'], 'gzip')
    assert.match(hit.headers['vary'] ?? '', /Accept-Encoding/i)
    assert.equal(JSON.parse(gunzipSync(hit.body).toString()).length, 200)
  })

  test('a client that does not accept gzip gets the plain body', async () => {
    const plain = await rawGet(`${base}/big`)
    assert.equal(plain.headers['x-cache'], 'HIT')
    assert.equal(plain.headers['content-encoding'], undefined)
    assert.equal(JSON.parse(plain.body.toString()).length, 200)
    const refused = await rawGet(`${base}/big`, 'gzip;q=0, identity')
    assert.equal(refused.headers['content-encoding'], undefined)
  })

  test('an error response is not cached', async () => {
    calls = 0
    await fetch(`${base}/missing`)
    const again = await fetch(`${base}/missing`)
    assert.equal(again.status, 404)
    assert.equal(again.headers.get('x-cache'), null)
    assert.equal(calls, 2)
  })
})
