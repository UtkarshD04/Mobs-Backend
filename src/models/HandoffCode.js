import { Schema, model } from 'mongoose'

// One-time auth handoff codes when Redis isn't configured. Lives in Mongo (not process
// memory) so a code minted by one server instance/cluster worker can be redeemed on another.
const handoffCodeSchema = new Schema({
  key: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
})

handoffCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default model('HandoffCode', handoffCodeSchema)
