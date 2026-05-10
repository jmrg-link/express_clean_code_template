import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { FakeKeycloakAdapter } from '../helpers/fake-keycloak.adapter.js';
import { buildTestApp } from '../helpers/build-test-app.js';

async function loginAs(
  app: Application,
  iam: FakeKeycloakAdapter,
  email: string,
  password: string,
  roles: string[],
): Promise<string> {
  iam.seed(email, password, roles, email.split('@')[0]!);
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data.access_token as string;
}

describe('Users integration', () => {
  let app: Application;
  let iam: FakeKeycloakAdapter;

  beforeEach(() => {
    iam = new FakeKeycloakAdapter('test-secret-vitest-min-16-chars');
    app = buildTestApp(iam);
  });

  it('rejects /users without authentication (401)', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it('rejects /users for non-admin roles (403)', async () => {
    const token = await loginAs(app, iam, 'buyer@example.com', 'pass1234', ['buyer']);
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('lists users for admin with pagination', async () => {
    const token = await loginAs(app, iam, 'admin@example.com', 'pass1234', ['admin']);
    const res = await request(app)
      .get('/api/v1/users?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.count).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 for invalid ObjectId in path', async () => {
    const token = await loginAs(app, iam, 'admin@example.com', 'pass1234', ['admin']);
    const res = await request(app)
      .get('/api/v1/users/not-an-objectid')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid id/);
  });

  it('admin can soft-delete a user (is_active=false)', async () => {
    const token = await loginAs(app, iam, 'admin@example.com', 'pass1234', ['admin']);

    const created = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        keycloak_id: 'kc-fake-1',
        email: 'target@example.com',
        name: 'Target',
        provider: 'password',
        roles: ['buyer'],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const del = await request(app)
      .delete(`/api/v1/users/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.data.is_active).toBe(false);
  });
});
