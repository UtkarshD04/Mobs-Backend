import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { responseCache } from './responseCache.js'

describe('responseCache', () => {
  let server
  let base
  let calls = 0

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

  test('an error response is not cached', async () => {
    calls = 0
    await fetch(`${base}/missing`)
    const again = await fetch(`${base}/missing`)
    assert.equal(again.status, 404)
    assert.equal(again.headers.get('x-cache'), null)
    assert.equal(calls, 2)
  })
})
