import { Schema, model, type Document, type Types } from 'mongoose';

export interface LoginAuditLogDocument extends Document {
  _id: Types.ObjectId;
  email: string;
  keycloak_id?: string;
  user_id?: string;
  success: boolean;
  reason?: string;
  ip?: string;
  user_agent?: string;
  occurred_at: Date;
  createdAt: Date;
}

const loginAuditLogSchema = new Schema<LoginAuditLogDocument>(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    keycloak_id: { type: String, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    success: { type: Boolean, required: true, index: true },
    reason: { type: String },
    ip: { type: String },
    user_agent: { type: String },
    occurred_at: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

/**
 * Indices secundarios del schema.
 *
 * @remarks
 * - TTL sobre `occurred_at` retiene los registros 90 días y, al ser un index
 *   real, también acelera consultas filtradas por fecha (no necesita
 *   `index: true` en el field).
 * - Compuesto `(email, success, occurred_at)` para listados admin del tipo
 *   "intentos fallidos de un email recientes".
 */
loginAuditLogSchema.index({ occurred_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
loginAuditLogSchema.index({ email: 1, success: 1, occurred_at: -1 });

export const LoginAuditLogModel = model<LoginAuditLogDocument>(
  'LoginAuditLog',
  loginAuditLogSchema,
);
