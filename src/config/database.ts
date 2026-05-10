import mongoose from 'mongoose';
import { env } from '#config/env';
import type { LoggerPort } from '#domain/shared/logger/logger.port';

/**
 * Wrapper de la conexión Mongo. Recibe `LoggerPort` por DI.
 *
 * Mantiene un flag estático para evitar `connect()` doble (test runs, hot
 * reload). Mongoose ya gestiona la pool internamente.
 */
export class MongoDatabase {
  private static connected = false;

  public static async connect(logger: LoggerPort): Promise<void> {
    if (MongoDatabase.connected) return;
    await mongoose.connect(env.mongo.uri, { serverSelectionTimeoutMS: 5000 });
    MongoDatabase.connected = true;
    logger.info('MongoDB connected', { uri: env.mongo.uri });
  }

  public static async disconnect(logger: LoggerPort): Promise<void> {
    if (!MongoDatabase.connected) return;
    await mongoose.disconnect();
    MongoDatabase.connected = false;
    logger.info('MongoDB disconnected');
  }

  public static isHealthy(): boolean {
    return mongoose.connection.readyState === 1;
  }
}
