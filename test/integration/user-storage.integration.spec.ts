import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { FakeKeycloakAdapter } from '../helpers/fake-keycloak.adapter.js';
import { FakeStorageAdapter } from '../helpers/fake-storage.adapter.js';
import { buildTestApp } from '../helpers/build-test-app.js';

/**
 * Integration coverage for /storage/me/* y /storage/users/:id/*.
 * Usa FakeStorageAdapter (en memoria) — sin LocalStack.
 */

interface Session {
  token: string;
  user: { id: string; slug: string; email: string };
}

async function registerAndLogin(
  app: Application,
  iam: FakeKeycloakAdapter,
  email: string,
  password: string,
  roles: string[],
): Promise<Session> {
  iam.seed(email, password, roles, email.split('@')[0]!, 'Doe');
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  return { token: login.body.data.access_token as string, user: login.body.data.user };
}

function encodeKey(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

describe('User storage integration', () => {
  let app: Application;
  let iam: FakeKeycloakAdapter;
  let storage: FakeStorageAdapter;

  beforeEach(() => {
    iam = new FakeKeycloakAdapter('test-secret-vitest-min-16-chars');
    storage = new FakeStorageAdapter();
    app = buildTestApp(iam, { storage });
  });

  describe('auth boundary', () => {
    it('rejects POST /storage/me/upload-url without bearer (401)', async () => {
      const res = await request(app)
        .post('/api/v1/storage/me/upload-url')
        .send({ category: 'avatars', filename: 'foto.png', contentType: 'image/png' });
      expect(res.status).toBe(401);
    });

    it('rejects admin route for non-admin (403)', async () => {
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);
      const res = await request(app)
        .post(`/api/v1/storage/users/${bob.user.id}/upload-url`)
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ category: 'avatars', filename: 'foto.png', contentType: 'image/png' });
      expect(res.status).toBe(403);
    });
  });

  describe('self flow (request-upload + list + download + delete)', () => {
    it('completes the full lifecycle for own user', async () => {
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);

      const upload = await request(app)
        .post('/api/v1/storage/me/upload-url')
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ category: 'avatars', filename: 'foto.png', contentType: 'image/png' });
      expect(upload.status).toBe(200);
      const key = upload.body.data.key as string;
      expect(key).toMatch(/^users\/[a-z0-9-]+\/avatars\/foto-[a-z0-9]{6}\.png$/);

      await storage.putObject(key, Buffer.from('binary'), 'image/png');

      const list = await request(app)
        .get('/api/v1/storage/me')
        .set('Authorization', `Bearer ${bob.token}`);
      expect(list.status).toBe(200);
      expect(list.body.data.objects).toHaveLength(1);
      expect(list.body.data.objects[0].key).toBe(key);

      const download = await request(app)
        .get(`/api/v1/storage/me/${encodeKey(key)}/download-url`)
        .set('Authorization', `Bearer ${bob.token}`);
      expect(download.status).toBe(200);
      expect(download.body.data.url).toContain('fake://signed/');

      const del = await request(app)
        .delete(`/api/v1/storage/me/${encodeKey(key)}`)
        .set('Authorization', `Bearer ${bob.token}`);
      expect(del.status).toBe(204);

      const listAfter = await request(app)
        .get('/api/v1/storage/me')
        .set('Authorization', `Bearer ${bob.token}`);
      expect(listAfter.body.data.objects).toHaveLength(0);
    });

    it('isolates listing per user (no leak between bob and alice)', async () => {
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);
      const alice = await registerAndLogin(app, iam, 'alice@example.com', 'pass1234', ['buyer']);
      await storage.putObject(`users/${alice.user.slug}/avatars/secret.png`, Buffer.from('a'));

      const list = await request(app)
        .get('/api/v1/storage/me')
        .set('Authorization', `Bearer ${bob.token}`);
      expect(list.body.data.objects).toHaveLength(0);
    });

    it('blocks cross-user delete crafted via base64url (403)', async () => {
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);
      const alice = await registerAndLogin(app, iam, 'alice@example.com', 'pass1234', ['buyer']);
      const aliceKey = `users/${alice.user.slug}/avatars/secret.png`;
      await storage.putObject(aliceKey, Buffer.from('a'));

      const res = await request(app)
        .delete(`/api/v1/storage/me/${encodeKey(aliceKey)}`)
        .set('Authorization', `Bearer ${bob.token}`);
      expect(res.status).toBe(403);
      expect(storage.size()).toBe(1);
    });
  });

  describe('validation', () => {
    it('rejects unknown category (400)', async () => {
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);
      const res = await request(app)
        .post('/api/v1/storage/me/upload-url')
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ category: 'unknown', filename: 'x.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    });

    it('rejects MIME mismatch (PDF on avatars) (400)', async () => {
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);
      const res = await request(app)
        .post('/api/v1/storage/me/upload-url')
        .set('Authorization', `Bearer ${bob.token}`)
        .send({ category: 'avatars', filename: 'doc.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(400);
    });
  });

  describe('admin flow', () => {
    it('admin issues upload-url on behalf of any user (key under target prefix)', async () => {
      const admin = await registerAndLogin(app, iam, 'admin@example.com', 'pass1234', ['admin']);
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);

      const res = await request(app)
        .post(`/api/v1/storage/users/${bob.user.id}/upload-url`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ category: 'avatars', filename: 'foto.png', contentType: 'image/png' });
      expect(res.status).toBe(200);
      expect(res.body.data.key).toMatch(
        new RegExp(`^users/${bob.user.slug}/avatars/foto-[a-z0-9]{6}\\.png$`),
      );
    });

    it('admin lists files of any user', async () => {
      const admin = await registerAndLogin(app, iam, 'admin@example.com', 'pass1234', ['admin']);
      const bob = await registerAndLogin(app, iam, 'bob@example.com', 'pass1234', ['buyer']);
      await storage.putObject(`users/${bob.user.slug}/avatars/a.png`, Buffer.from('a'));

      const res = await request(app)
        .get(`/api/v1/storage/users/${bob.user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.objects).toHaveLength(1);
    });

    it('admin returns 404 for unknown :id', async () => {
      const admin = await registerAndLogin(app, iam, 'admin@example.com', 'pass1234', ['admin']);
      const res = await request(app)
        .get('/api/v1/storage/users/507f1f77bcf86cd799439099')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
    });
  });
});
