import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { FakeKeycloakAdapter } from '../helpers/fake-keycloak.adapter.js';
import { buildTestApp } from '../helpers/build-test-app.js';

describe('Auth integration', () => {
  let app: Application;
  let iam: FakeKeycloakAdapter;

  beforeEach(() => {
    iam = new FakeKeycloakAdapter('test-secret-vitest-min-16-chars');
    app = buildTestApp(iam);
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns tokens', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'alice@example.com',
        password: 'supersecret',
        firstName: 'Alice',
        lastName: 'Wonder',
      });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Registration successful');
      expect(res.body.data.access_token).toBeTypeOf('string');
      expect(res.body.data.refresh_token).toBeTypeOf('string');
      expect(res.body.data.user.email).toBe('alice@example.com');
      expect(res.body.data.user.firstName).toBe('Alice');
      expect(res.body.data.user.lastName).toBe('Wonder');
      expect(res.body.data.user.is_active).toBe(true);
    });

    it('rejects duplicated email with 409', async () => {
      await request(app).post('/api/v1/auth/register').send({
        email: 'bob@example.com',
        password: 'supersecret',
        firstName: 'Bob',
        lastName: 'Builder',
      });

      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'bob@example.com',
        password: 'supersecret',
        firstName: 'Bob',
        lastName: 'Twin',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already/i);
    });

    it('rejects invalid email with 400 and field errors', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'not-an-email',
        password: 'supersecret',
        firstName: 'Xavier',
        lastName: 'Y',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation error');
      expect(res.body.errors).toBeInstanceOf(Array);
    });

    it('rejects missing lastName with 400', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'zoe@example.com',
        password: 'supersecret',
        firstName: 'Zoe',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation error');
      expect(res.body.errors).toBeInstanceOf(Array);
      expect(JSON.stringify(res.body.errors)).toMatch(/lastName/);
    });

    it('grants admin role when email matches ADMIN_EMAIL_PATTERNS', async () => {
      const localIam = new FakeKeycloakAdapter('test-secret-vitest-min-16-chars');
      const policyApp = buildTestApp(localIam, { adminEmailPatterns: ['*@example.org'] });
      const res = await request(policyApp).post('/api/v1/auth/register').send({
        email: 'owner@example.org',
        password: 'supersecret',
        firstName: 'Owner',
        lastName: 'One',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.user.roles).toEqual(['admin']);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in an existing Keycloak user and auto-syncs to local DB', async () => {
      iam.seed('charlie@example.com', 'pass1234', ['buyer'], 'Charlie', '');
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'charlie@example.com',
        password: 'pass1234',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.keycloak_id).toBeTypeOf('string');
      expect(res.body.data.user.email).toBe('charlie@example.com');
      expect(res.body.data.user.firstName).toBe('Charlie');
      expect(res.body.data.user.lastName).toBe('');
    });

    it('rejects bad credentials with 401', async () => {
      iam.seed('dora@example.com', 'pass1234');
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'dora@example.com',
        password: 'wrong',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns the profile of the authenticated user', async () => {
      iam.seed('eve@example.com', 'pass1234', ['buyer'], 'Eve', 'Polastri');
      const login = await request(app).post('/api/v1/auth/login').send({
        email: 'eve@example.com',
        password: 'pass1234',
      });
      const token = login.body.data.access_token;
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('eve@example.com');
    });

    it('rejects requests without Bearer token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
