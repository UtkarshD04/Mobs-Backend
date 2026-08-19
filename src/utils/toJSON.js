// `renameRefs` maps a ref field (e.g. `job`) to the string-id field name the
// frontend mock shapes expect (e.g. `jobId`) — the ref is stored as an
// ObjectId for real relational integrity, but exposed the way the existing
// UI/services already read it, so no frontend page/hook needs to change.
export function applyIdTransform(schema, renameRefs = {}) {
  schema.set('toJSON', {
    virtuals: true,
    transform: (_doc, ret) => {
      ret.id = ret._id.toString()
      delete ret._id
      delete ret.__v
      for (const [refField, asField] of Object.entries(renameRefs)) {
        if (ret[refField] === undefined) continue
        const val = ret[refField]
        // A bare ObjectId is a BSON object too (and even exposes a legacy
        // `_id` getter that returns itself), so it must be excluded by BSON
        // type rather than by shape. A populated ref, by contrast, is a
        // plain object with a real `_id` — stringifying that would just
        // produce "[object Object]", so keep it as an object (id-normalized)
        // under its original key instead of renaming to the `xId` form.
        const isBareObjectId = val && typeof val === 'object' && val._bsontype === 'ObjectId'
        if (val && typeof val === 'object' && !isBareObjectId) {
          // The populated doc may have already run through its own model's
          // toJSON transform (id already normalized) or not, depending on
          // projection/recursion order — handle both.
          if (val.id === undefined && val._id !== undefined) {
            val.id = val._id.toString()
            delete val._id
          }
        } else {
          ret[asField] = val ? val.toString() : null
          delete ret[refField]
        }
      }
      return ret
    },
  })
}
