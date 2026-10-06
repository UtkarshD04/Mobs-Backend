import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlanEnquiryInput } from './planEnquiryInput.js'

const valid = { name: ' A Rao ', companyName: 'Rao Traders', phone: '98765 43210', email: 'rao@example.com', source: 'app' }

describe('parsePlanEnquiryInput', () => {
  test('trims and accepts a complete submission', () => {
    const { data, error } = parsePlanEnquiryInput(valid)
    assert.equal(error, undefined)
    assert.equal(data.name, 'A Rao')
    assert.equal(data.source, 'app')
  })

  test('unknown source falls back to website', () => {
    assert.equal(parsePlanEnquiryInput({ ...valid, source: 'x' }).data.source, 'website')
  })

  test('rejects missing fields, bad email and short phone', () => {
    assert.ok(parsePlanEnquiryInput({ ...valid, companyName: '' }).error)
    assert.ok(parsePlanEnquiryInput({ ...valid, email: 'nope' }).error)
    assert.ok(parsePlanEnquiryInput({ ...valid, phone: '123' }).error)
  })
})
