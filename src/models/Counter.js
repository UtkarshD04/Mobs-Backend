import { Schema, model } from 'mongoose'

// Named, atomically-incremented sequences (e.g. the next associate code number).
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { versionKey: false })

const Counter = model('Counter', counterSchema)

// $inc on an upserted doc is atomic, so two requests can never get the same number.
export async function nextSequence(name) {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true })
  return doc.seq
}

export default Counter
