import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { FakeKeycloakAdapter } from '../helpers/fake-keycloak.adapter.js';
import { buildTestApp } from '../helpers/build-test-app.js';

/**
 * Integration coverage for `/users/:id/roles` CRUD endpoints.
 *
 * - GET / PUT / POST :role / DELETE :role
 * - Auth + checkRole('admin')
 * - Self-demotion guard (PUT + DELETE)
 * - Idempotency on POST/DELETE
 * - Param validation (ObjectId, role enum)
 */

async function loginAs(
  app: Application,
  iam: FakeKeycloakAdapter,
  email: string,
  password: string,
  roles: string[],
): Promise<{ token: string }> {
  iam.seed(email, password, roles, email.split('@')[0]!, 'Doe');
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  return { token: login.body.data.access_token as string };
}

async function createTargetUser(
  app: Application,
  adminToken: string,
  email = 'target@example.com',
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      keycloak_id: `kc-target-${Date.now()}`,
      email,
      firstName: 'Target',
      lastName: 'User',
      provider: 'password',
      roles: ['buyer'],
    });
  return res.body.data.id as string;
}

describe('User Roles integration', () => {
  let app: Application;
  let iam: FakeKeycloakAdapter;

  beforeEach(() => {
    iam = new FakeKeycloakAdapter('test-secret-vitest-min-16-chars');
    app = buildTestApp(iam);
  });

  describe('auth boundary', () => {
    it('rejects without bearer token (401)', async () => {
      const res = await request(app).get('/api/v1/users/507f1f77bcf86cd799439011/roles');
      expect(res.status).toBe(401);
    });

    it('rejects non-admin caller (403)', async () => {
      const { token } = await loginAs(app, iam, 'buyer1@example.com', 'pass1234', ['buyer']);
      const res = await request(app)
        .get('/api/v1/users/507f1f77bcf86cd799439011/roles')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('path validation', () => {
    it('rejects malformed ObjectId (400)', async () => {
      const { token } = await loginAs(app, iam, 'admin1@example.com', 'pass1234', ['admin']);
      const res = await request(app)
        .get('/api/v1/users/not-an-id/roles')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('rejects invalid :role enum (400)', async () => {
      const { token } = await loginAs(app, iam, 'admin2@example.com', 'pass1234', ['admin']);
      const target = await createTargetUser(app, token, 'tgt1@example.com');
      const res = await request(app)
        .post(`/api/v1/users/${target}/roles/superuser`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /users/:id/roles', () => {
    it('returns 404 for unknown user', async () => {
      const { token } = await loginAs(app, iam, 'admin3@example.com', 'pass1234', ['admin']);
      const res = await request(app)
        .get('/api/v1/users/507f1f77bcf86cd799439099/roles')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns roles for valid user', async () => {
      const { token } = await loginAs(app, iam, 'admin4@example.com', 'pass1234', ['admin']);
      const target = await createTargetUser(app, token, 'tgt2@example.com');
      const res = await request(app)
        .get(`/api/v1/users/${target}/roles`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.roles).toEqual(['buyer']);
    });
  });

  describe('PUT /users/:id/roles', () => {
    it('replaces the full role set', async () => {
      const { token } = await loginAs(app, iam, 'admin5@example.com', 'pass1234', ['admin']);
      const target = await createTargetUser(app, token, 'tgt3@example.com');
      const res = await request(app)
        .put(`/api/v1/users/${target}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ roles: ['seller', 'operator'] });
      expect(res.status).toBe(200);
      expect(res.body.data.roles.sort()).toEqual(['operator', 'seller']);
    });

    it('rejects empty roles array (400)', async () => {
      const { token } = await loginAs(app, iam, 'admin6@example.com', 'pass1234', ['admin']);
      const target = await createTargetUser(app, token, 'tgt4@example.com');
      const res = await request(app)
        .put(`/api/v1/users/${target}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ roles: [] });
      expect(res.status).toBe(400);
    });

    it('blocks self-demotion of admin (400)', async () => {
      const { token } = await loginAs(app, iam, 'admin7@example.com', 'pass1234', ['admin']);
      const mongoId = (
        await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)
      ).body.data.id as string;
      const res = await request(app)
        .put(`/api/v1/users/${mongoId}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ roles: ['buyer'] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/self-demote/i);
    });
  });

  describe('POST /users/:id/roles/:role', () => {
    it('adds role idempotently (204 even if already present)', async () => {
      const { token } = await loginAs(app, iam, 'admin8@example.com', 'pass1234', ['admin']);
      const target = await createTargetUser(app, token, 'tgt5@example.com');
      const first = await request(app)
        .post(`/api/v1/users/${target}/roles/seller`)
        .set('Authorization', `Bearer ${token}`);
      const second = await request(app)
        .post(`/api/v1/users/${target}/roles/seller`)
        .set('Authorization', `Bearer ${token}`);
      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      const after = await request(app)
        .get(`/api/v1/users/${target}/roles`)
        .set('Authorization', `Bearer ${token}`);
      expect(after.body.data.roles.sort()).toEqual(['buyer', 'seller']);
    });
  });

  describe('DELETE /users/:id/roles/:role', () => {
    it('removes role idempotently', async () => {
      const { token } = await loginAs(app, iam, 'admin9@example.com', 'pass1234', ['admin']);
      const target = await createTargetUser(app, token, 'tgt6@example.com');
      await request(app)
        .post(`/api/v1/users/${target}/roles/seller`)
        .set('Authorization', `Bearer ${token}`);
      const first = await request(app)
        .delete(`/api/v1/users/${target}/roles/seller`)
        .set('Authorization', `Bearer ${token}`);
      const second = await request(app)
        .delete(`/api/v1/users/${target}/roles/seller`)
        .set('Authorization', `Bearer ${token}`);
      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      const after = await request(app)
        .get(`/api/v1/users/${target}/roles`)
        .set('Authorization', `Bearer ${token}`);
      expect(after.body.data.roles).toEqual(['buyer']);
    });

    it('blocks self-demotion when removing own admin (400)', async () => {
      const { token } = await loginAs(app, iam, 'admin10@example.com', 'pass1234', ['admin']);
      const mongoId = (
        await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)
      ).body.data.id as string;
      const res = await request(app)
        .delete(`/api/v1/users/${mongoId}/roles/admin`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/self-demote/i);
    });
  });
});
