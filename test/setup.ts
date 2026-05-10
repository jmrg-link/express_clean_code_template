import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongod: MongoMemoryServer | undefined;

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret-vitest-min-16-chars';
process.env.KEYCLOAK_URL = 'http://localhost:8080';
process.env.KEYCLOAK_REALM = 'app';
process.env.KEYCLOAK_CLIENT_ID = 'app-api';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://placeholder:27017/test';

beforeAll(async () => {
  try {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    await mongoose.connect(process.env.MONGODB_URI);
  } catch (err) {
    console.warn(
      'MongoMemoryServer unavailable (offline?). Integration tests will skip.',
      (err as Error).message,
    );
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key]!.deleteMany({});
  }
});
