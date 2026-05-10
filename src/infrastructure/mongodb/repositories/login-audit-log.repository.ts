import type {
  LoginAuditLogCreateInput,
  LoginAuditLogEntity,
  LoginAuditLogRepositoryPort,
} from '#domain/audit/login-audit.entity';
import { LoginAuditLogModel, type LoginAuditLogDocument } from '../schemas/login-audit-log.schema.js';

export class LoginAuditLogRepository implements LoginAuditLogRepositoryPort {
  public async create(input: LoginAuditLogCreateInput): Promise<LoginAuditLogEntity> {
    const doc = await LoginAuditLogModel.create(input);
    return LoginAuditLogRepository.toEntity(doc);
  }

  public async findRecentByEmail(email: string, limit = 20): Promise<LoginAuditLogEntity[]> {
    const docs = await LoginAuditLogModel.find({ email: email.toLowerCase() })
      .sort({ occurred_at: -1 })
      .limit(limit);
    return docs.map(LoginAuditLogRepository.toEntity);
  }

  private static toEntity(doc: LoginAuditLogDocument): LoginAuditLogEntity {
    return doc.toJSON() as unknown as LoginAuditLogEntity;
  }
}
