import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { memoizeTtl } from './memoizeTtl.js'

describe('memoizeTtl', () => {
  test('a second call within the TTL reuses the first result', async () => {
    let calls = 0
    const fn = memoizeTtl(async (field) => {
      calls += 1
      return `${field}-${calls}`
    }, 60_000)
    assert.equal(await fn('title'), 'title-1')
    assert.equal(await fn('title'), 'title-1')
    assert.equal(calls, 1)
  })

  test('different arguments are cached separately', async () => {
    let calls = 0
    const fn = memoizeTtl(async (field) => {
      calls += 1
      return field
    }, 60_000)
    assert.equal(await fn('title'), 'title')
    assert.equal(await fn('location'), 'location')
    assert.equal(calls, 2)
  })

  test('concurrent callers during a miss share one lookup', async () => {
    let calls = 0
    const fn = memoizeTtl(async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 'rows'
    }, 60_000)
    const results = await Promise.all([fn(), fn(), fn(), fn()])
    assert.deepEqual(results, ['rows', 'rows', 'rows', 'rows'])
    assert.equal(calls, 1)
  })

  test('an expired entry is looked up again', async () => {
    let calls = 0
    const fn = memoizeTtl(async () => {
      calls += 1
      return calls
    }, 5)
    assert.equal(await fn(), 1)
    await new Promise((resolve) => setTimeout(resolve, 15))
    assert.equal(await fn(), 2)
  })

  test('a failed lookup is not cached', async () => {
    let calls = 0
    const fn = memoizeTtl(async () => {
      calls += 1
      if (calls === 1) throw new Error('db down')
      return 'ok'
    }, 60_000)
    await assert.rejects(fn(), /db down/)
    assert.equal(await fn(), 'ok')
    assert.equal(calls, 2)
  })
})
