import type { IamPort } from '#domain/auth/iam.port';
import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { UserRole } from '#domain/user/user.entity';
import type { EventBusPort } from '#domain/shared/events/event-bus.port';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import type { AdminEmailPattern } from '#domain/auth/admin-email-policy';
import { matchesAdminPattern } from '#domain/auth/admin-email-policy';
import { UserEvents } from '#domain/shared/events/user.events';

/**
 * Reconciler aditivo de roles admin en boot.
 *
 * @remarks
 * Recorre la colección `users` paginada y, para cada documento cuyo email
 * cumpla algún patrón de `adminEmailPatterns`, asegura que `admin` esté en
 * Mongo y en Keycloak. Es **idempotente** (no muta lo ya sincronizado) y
 * **aditivo** (jamás retira roles aunque el patrón deje de aplicar).
 *
 * Diseño: se ejecuta antes del `server.start()` del composition root. Fallo
 * por usuario → log + continúa. Fallo del propio scan → la app sigue
 * arrancando (responsabilidad del caller envolverlo en try/catch).
 *
 * `actorId` del evento publicado vale `bootstrap-reconciler` para
 * distinguirlo en el audit trail de mutaciones provocadas por humanos.
 */
export class BootstrapRoleReconciler {
  private static readonly PAGE_LIMIT = 100;
  private static readonly ACTOR_ID = 'bootstrap-reconciler';

  public constructor(
    private readonly iam: IamPort,
    private readonly userQuery: UserQueryRepositoryPort,
    private readonly userCommand: UserCommandRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly patterns: ReadonlyArray<AdminEmailPattern>,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Lanza el escaneo paginado. Resuelve cuando ha recorrido todas las
   * páginas. Cada error individual se loggea y NO interrumpe el bucle.
   */
  public async run(): Promise<void> {
    if (this.patterns.length === 0) {
      this.logger.info('Role reconciler skipped: empty admin patterns');
      return;
    }

    let scanned = 0;
    let matched = 0;
    let promoted = 0;
    let alreadyAdmin = 0;
    let failed = 0;

    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const result = await this.userQuery.findPaginated(
        { page, limit: BootstrapRoleReconciler.PAGE_LIMIT, order: 'asc' },
        {},
      );
      totalPages = result.pagination.totalPages || 1;

      for (const user of result.data) {
        scanned++;
        if (!matchesAdminPattern(user.email, this.patterns)) continue;
        matched++;

        if (user.roles.includes('admin')) {
          alreadyAdmin++;
          continue;
        }

        const before: UserRole[] = [...user.roles];
        const after: UserRole[] = Array.from(new Set<UserRole>([...before, 'admin']));

        try {
          await this.iam.assignRoles(user.keycloak_id, ['admin']);
          const updated = await this.userCommand.update(user.id, { roles: after });
          if (!updated) {
            failed++;
            this.logger.warn('Role reconciler: user vanished mid-update', {
              userId: user.id,
            });
            continue;
          }
          await this.eventBus.publish(
            UserEvents.roleChanged({
              userId: updated.id,
              keycloakId: user.keycloak_id,
              before,
              after,
              actorId: BootstrapRoleReconciler.ACTOR_ID,
            }),
          );
          promoted++;
        } catch (err) {
          failed++;
          this.logger.error('Role reconciler: failed to promote user', {
            userId: user.id,
            keycloakId: user.keycloak_id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      page++;
    }

    this.logger.info('Role reconciler completed', {
      scanned,
      matched,
      promoted,
      alreadyAdmin,
      failed,
    });
  }
}
