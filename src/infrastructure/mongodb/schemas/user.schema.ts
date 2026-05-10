import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import { USER_ROLES, USER_PROVIDERS } from '#domain/user/user.entity';
import type { UserRole, UserProvider } from '#domain/user/user.entity';

/**
 * Schema Mongoose. Detalle de infraestructura.
 *
 * `toJSON.transform` mapea `_id → id` y elimina `__v` automáticamente.
 *
 * Campos nuevos en v3:
 *   - `slug`: URL-friendly único (índice unique sparse).
 *   - `last_login_at`: timestamp del último login exitoso.
 *   - `failed_login_attempts`: contador de fallos consecutivos (defensa).
 *   - `avatar_url`: clave del objeto en S3 (URL firmada se calcula al servir).
 *
 * Índices compuestos: `is_active + roles` y `roles + createdAt` aceleran las
 * listas filtradas que el admin endpoint hace por rol y estado.
 */
export interface UserDocument extends Document {
  _id: Types.ObjectId;
  keycloak_id: string;
  email: string;
  name: string;
  slug: string;
  phone?: string;
  picture?: string;
  avatar_url?: string;
  email_verified: boolean;
  provider: UserProvider;
  roles: UserRole[];
  is_active: boolean;
  last_login_at?: Date;
  failed_login_attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

interface UserModelType extends Model<UserDocument> {
  findByKeycloakId(keycloakId: string): Promise<UserDocument | null>;
  findByEmail(email: string): Promise<UserDocument | null>;
  findBySlug(slug: string): Promise<UserDocument | null>;
}

const userSchema = new Schema<UserDocument, UserModelType>(
  {
    keycloak_id: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    phone: { type: String },
    picture: { type: String },
    avatar_url: { type: String },
    email_verified: { type: Boolean, default: false },
    provider: {
      type: String,
      required: true,
      enum: { values: [...USER_PROVIDERS], message: '{VALUE} is not a valid provider' },
    },
    roles: {
      type: [String],
      enum: { values: [...USER_ROLES], message: '{VALUE} is not a valid role' },
      default: ['buyer'],
    },
    is_active: { type: Boolean, default: false, index: true },
    last_login_at: { type: Date },
    failed_login_attempts: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

userSchema.index({ is_active: 1, roles: 1 });
userSchema.index({ roles: 1, createdAt: -1 });

userSchema.static('findByKeycloakId', function (keycloakId: string) {
  return this.findOne({ keycloak_id: keycloakId });
});

userSchema.static('findByEmail', function (email: string) {
  return this.findOne({ email: email.toLowerCase() });
});

userSchema.static('findBySlug', function (slug: string) {
  return this.findOne({ slug: slug.toLowerCase() });
});

export const UserModel = model<UserDocument, UserModelType>('User', userSchema);
