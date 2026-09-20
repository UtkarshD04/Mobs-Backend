import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createPushHandlers } from './pushController.js'

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'

function fakeDoc(pushTokens = []) {
  const doc = {
    _id: 'me',
    pushTokens,
    saved: 0,
    async save() {
      this.saved++
    },
  }
  doc.constructor = { pulled: [], async updateMany(filter, update) { this.pulled.push({ filter, update }) } }
  return doc
}

function run(handler, doc, body) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(v) { resolve({ status: this.statusCode, body: v }) }, end() { resolve({ status: this.statusCode }) } }
    handler({ body, __doc: doc }, res, reject)
  })
}

describe('expo push token registration', () => {
  const { registerExpoToken, unregisterExpoToken } = createPushHandlers((req) => req.__doc)

  test('rejects a missing or non-Expo token', async () => {
    assert.equal((await run(registerExpoToken, fakeDoc(), {})).status, 400)
    assert.equal((await run(registerExpoToken, fakeDoc(), { token: 'nope' })).status, 400)
  })

  test('stores the token and takes it away from any other account on the same phone', async () => {
    const doc = fakeDoc()
    const res = await run(registerExpoToken, doc, { token: TOKEN })
    assert.equal(res.status, 204)
    assert.deepEqual(doc.pushTokens, [TOKEN])
    const { filter, update } = doc.constructor.pulled[0]
    assert.deepEqual(filter, { pushTokens: TOKEN, _id: { $ne: 'me' } })
    assert.deepEqual(update, { $pull: { pushTokens: TOKEN } })
  })

  test('registering the same token twice does not duplicate it', async () => {
    const doc = fakeDoc([TOKEN])
    await run(registerExpoToken, doc, { token: TOKEN })
    assert.deepEqual(doc.pushTokens, [TOKEN])
    assert.equal(doc.saved, 0)
  })

  test('sign-out removes only this phone\'s token', async () => {
    const other = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'
    const doc = fakeDoc([TOKEN, other])
    const res = await run(unregisterExpoToken, doc, { token: TOKEN })
    assert.equal(res.status, 204)
    assert.deepEqual(doc.pushTokens, [other])
    assert.equal((await run(unregisterExpoToken, fakeDoc(), {})).status, 400)
  })
})
