import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseAssociateInput } from './associateInput.js'

const valid = {
  companyName: ' Rao Placements ',
  contactName: 'A Rao',
  email: 'rao@example.com',
  phone: '98765 43210',
  city: 'Kanpur',
  state: 'Uttar Pradesh',
  about: 'We place freshers in sales and support roles.',
}

describe('parseAssociateInput', () => {
  test('trims and accepts a complete submission, website optional', () => {
    const { data, error } = parseAssociateInput(valid)
    assert.equal(error, undefined)
    assert.equal(data.companyName, 'Rao Placements')
    assert.equal(data.website, '')
  })

  test('rejects missing required fields', () => {
    assert.match(parseAssociateInput({ ...valid, about: '  ' }).error, /required/)
    assert.match(parseAssociateInput({}).error, /required/)
  })

  test('rejects a bad email, a short phone and an unknown state', () => {
    assert.match(parseAssociateInput({ ...valid, email: 'nope' }).error, /email/)
    assert.match(parseAssociateInput({ ...valid, phone: '12345' }).error, /mobile/)
    assert.match(parseAssociateInput({ ...valid, state: 'Atlantis' }).error, /state/)
  })

  test('accepts only real Indian mobile numbers', () => {
    for (const phone of ['9876543210', '98765 43210', '98765-43210', '+14155550123', '+971501234567']) assert.ok(parseAssociateInput({ ...valid, phone }).data, phone)
    for (const phone of ['+1415', '+0123456789', '+91 98765 43210', '09876543210', '5876543210', '0000000000', '98765432101', '98765abcde', '1234567890']) assert.match(parseAssociateInput({ ...valid, phone }).error, /mobile/, phone)
  })

  test('ignores non-string values instead of throwing', () => {
    assert.ok(parseAssociateInput({ ...valid, email: { $ne: 1 } }).error)
  })
})
