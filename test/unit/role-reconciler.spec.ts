import { describe, it, expect } from 'vitest';
import type { IamPort } from '#domain/auth/iam.port';
import type {
  UserCommandRepositoryPort,
  UserQueryRepositoryPort,
} from '#domain/user/user.repository.port';
import type { UserEntity } from '#domain/user/user.entity';
import type { LoggerPort } from '#domain/shared/logger/logger.port';
import type { DomainEvent, EventBusPort } from '#domain/shared/events/event-bus.port';
import { BootstrapRoleReconciler } from '#application/bootstrap/role-reconciler';

const PATTERNS = ['*@example.com'];

function makeUser(overrides: Partial<UserEntity>): UserEntity {
  return {
    id: 'mongo-id',
    keycloak_id: 'kc-sub',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    slug: 'test-user',
    email_verified: true,
    provider: 'password',
    roles: ['buyer'],
    is_active: true,
    failed_login_attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStubs(seed: UserEntity[]) {
  const assignCalls: Array<{ userId: string; roles: string[] }> = [];
  const updateCalls: Array<{ id: string; data: Partial<UserEntity> }> = [];
  const events: DomainEvent[] = [];
  const logs: Array<{ level: string; msg: string }> = [];

  const iam: IamPort = {
    login: async () => ({ access_token: '', refresh_token: '', expires_in: 0 }),
    refresh: async () => ({ access_token: '', refresh_token: '', expires_in: 0 }),
    registerUser: async () => '',
    assignRoles: async (userId, roles) => {
      assignCalls.push({ userId, roles });
    },
    removeRoles: async () => undefined,
    verifyToken: async () => ({ id: '', email: '', name: '', roles: [] }),
    decodeToken: () => ({ id: '', email: '', name: '', roles: [] }),
  };

  const queryRepo: UserQueryRepositoryPort = {
    findById: async () => null,
    findByEmail: async () => null,
    findByKeycloakId: async () => null,
    findBySlug: async () => null,
    findPaginated: async ({ page, limit }) => {
      const start = (page - 1) * limit;
      const data = seed.slice(start, start + limit);
      const total = seed.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      return {
        data,
        pagination: {
          page,
          limit,
          count: total,
          totalPages,
          nextPage: page < totalPages,
          previousPage: page > 1,
        },
      };
    },
  };

  const commandRepo: UserCommandRepositoryPort = {
    create: async () => seed[0]!,
    update: async (id, data) => {
      updateCalls.push({ id, data });
      const found = seed.find((u) => u.id === id);
      if (!found) return null;
      return { ...found, ...data } as UserEntity;
    },
    softDelete: async () => null,
    recordLoginSuccess: async () => undefined,
    recordLoginFailure: async () => undefined,
  };

  const eventBus: EventBusPort = {
    publish: async (event) => {
      events.push(event);
    },
    subscribe: () => undefined,
  };

  const logger: LoggerPort = {
    debug: () => undefined,
    info: (msg) => logs.push({ level: 'info', msg }),
    warn: (msg) => logs.push({ level: 'warn', msg }),
    error: (msg) => logs.push({ level: 'error', msg }),
    child: () => logger,
  };

  return { iam, queryRepo, commandRepo, eventBus, logger, assignCalls, updateCalls, events, logs };
}

describe('BootstrapRoleReconciler', () => {
  it('skips when patterns are empty', async () => {
    const stubs = makeStubs([makeUser({})]);
    const r = new BootstrapRoleReconciler(
      stubs.iam,
      stubs.queryRepo,
      stubs.commandRepo,
      stubs.eventBus,
      [],
      stubs.logger,
    );
    await r.run();
    expect(stubs.assignCalls).toHaveLength(0);
    expect(stubs.updateCalls).toHaveLength(0);
    expect(stubs.events).toHaveLength(0);
  });

  it('promotes a matching user lacking admin', async () => {
    const stubs = makeStubs([makeUser({ id: 'u1', keycloak_id: 'kc1', roles: ['buyer'] })]);
    const r = new BootstrapRoleReconciler(
      stubs.iam,
      stubs.queryRepo,
      stubs.commandRepo,
      stubs.eventBus,
      PATTERNS,
      stubs.logger,
    );
    await r.run();
    expect(stubs.assignCalls).toEqual([{ userId: 'kc1', roles: ['admin'] }]);
    expect(stubs.updateCalls[0]!.data.roles).toEqual(['buyer', 'admin']);
    expect(stubs.events).toHaveLength(1);
    expect(stubs.events[0]!.type).toBe('user.role_changed');
  });

  it('is idempotent for users already admin', async () => {
    const stubs = makeStubs([makeUser({ id: 'u2', roles: ['buyer', 'admin'] })]);
    const r = new BootstrapRoleReconciler(
      stubs.iam,
      stubs.queryRepo,
      stubs.commandRepo,
      stubs.eventBus,
      PATTERNS,
      stubs.logger,
    );
    await r.run();
    expect(stubs.assignCalls).toHaveLength(0);
    expect(stubs.updateCalls).toHaveLength(0);
    expect(stubs.events).toHaveLength(0);
  });

  it('skips users whose email does not match', async () => {
    const stubs = makeStubs([
      makeUser({ id: 'u3', email: 'outside@other.org', roles: ['buyer'] }),
    ]);
    const r = new BootstrapRoleReconciler(
      stubs.iam,
      stubs.queryRepo,
      stubs.commandRepo,
      stubs.eventBus,
      PATTERNS,
      stubs.logger,
    );
    await r.run();
    expect(stubs.assignCalls).toHaveLength(0);
  });

  it('continues on per-user IAM failure and logs error', async () => {
    const stubs = makeStubs([
      makeUser({ id: 'fail', email: 'fail@example.com', keycloak_id: 'kc-fail' }),
      makeUser({ id: 'ok', email: 'ok@example.com', keycloak_id: 'kc-ok' }),
    ]);
    let firstCall = true;
    stubs.iam.assignRoles = async (userId, roles) => {
      if (firstCall) {
        firstCall = false;
        throw new Error('boom');
      }
      stubs.assignCalls.push({ userId, roles });
    };
    const r = new BootstrapRoleReconciler(
      stubs.iam,
      stubs.queryRepo,
      stubs.commandRepo,
      stubs.eventBus,
      PATTERNS,
      stubs.logger,
    );
    await r.run();
    expect(stubs.assignCalls).toHaveLength(1);
    expect(stubs.assignCalls[0]!.userId).toBe('kc-ok');
    expect(stubs.logs.some((l) => l.level === 'error')).toBe(true);
  });
});
