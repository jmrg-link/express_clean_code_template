/**
 * Audit log de intentos de login.
 *
 * Se persiste en una colección dedicada (no mezclar con User para no inflar
 * el documento principal). Lo escribe el `AuditLoginObserver` reaccionando a
 * los eventos `user.logged_in` y `user.login_failed`.
 */
export interface LoginAuditLogEntity {
  id: string;
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

export interface LoginAuditLogCreateInput {
  email: string;
  keycloak_id?: string;
  user_id?: string;
  success: boolean;
  reason?: string;
  ip?: string;
  user_agent?: string;
  occurred_at: Date;
}

export interface LoginAuditLogRepositoryPort {
  create(input: LoginAuditLogCreateInput): Promise<LoginAuditLogEntity>;
  findRecentByEmail(email: string, limit?: number): Promise<LoginAuditLogEntity[]>;
}
