#!/usr/bin/env node
/**
 * One-shot Mongo migration: legacy `User.name` → `firstName` + `lastName`.
 *
 * @remarks
 * Idempotent. Splits `name` by the LAST space:
 *   - "Bob Smith"          → firstName="Bob",          lastName="Smith"
 *   - "Juan Pérez García"  → firstName="Juan Pérez",   lastName="García"
 *   - "Alice"              → firstName="Alice",        lastName=""  (flagged)
 *
 * Documents already containing both new fields and no legacy `name` are
 * skipped. Documents containing both new fields plus a leftover `name` get
 * a cleanup pass (`$unset name`).
 *
 * Excepción documentada a la regla "no `console.*`": este script es un
 * runner de operaciones, no parte del runtime de la app. Usa `console.log`
 * a propósito.
 *
 * @example Local dry run
 *   node scripts/migrate-user-name-split.mjs --env=local --dry-run
 *
 * @example Staging live (with SSM tunnel open)
 *   ./scripts/ssm-mongo-staging.sh -p jmrg-mac-cli &
 *   node scripts/migrate-user-name-split.mjs --env=staging
 *
 * @example Rollback
 *   node scripts/migrate-user-name-split.mjs --env=local --rollback
 *
 * @returns Exit code 0 on success (or dry-run with no driver errors); 1 on
 *   connection failure, missing env, or any per-doc write error.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';

/**
 * Parses `process.argv` into a flat options object.
 *
 * @returns {{env: string|undefined, dryRun: boolean, rollback: boolean, help: boolean}}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { env: undefined, dryRun: false, rollback: false, help: false };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--rollback') opts.rollback = true;
    else if (arg.startsWith('--env=')) opts.env = arg.slice('--env='.length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/migrate-user-name-split.mjs --env=<local|staging|prod> [--dry-run] [--rollback]

Flags:
  --env=<env>   required. Loads .env.<env> from CWD.
  --dry-run     plan only, no writes.
  --rollback    inverse op: name = "firstName + ' ' + lastName"; drops new fields.
  --help, -h    this message.

Pre-requisites:
  - For staging/prod: SSM tunnel open via scripts/ssm-mongo-<env>.sh.
  - .env.<env> contains MONGODB_URI pointing to the right Mongo (host + DB in path).
`);
  process.exit(0);
}

/**
 * Splits a full name by the LAST space.
 *
 * @param {string} full - source string.
 * @returns {{ firstName: string, lastName: string, singleWord: boolean }}
 */
function splitByLastSpace(full) {
  const trimmed = (full ?? '').trim();
  if (!trimmed) return { firstName: '', lastName: '', singleWord: false };
  const idx = trimmed.lastIndexOf(' ');
  if (idx < 0) return { firstName: trimmed, lastName: '', singleWord: true };
  return {
    firstName: trimmed.slice(0, idx).trim(),
    lastName: trimmed.slice(idx + 1).trim(),
    singleWord: false,
  };
}

/**
 * Extracts the database name from a Mongo connection URI.
 *
 * @param {string} uri
 * @returns {string|undefined}
 */
function dbFromUri(uri) {
  try {
    const u = new URL(uri);
    const pathPart = (u.pathname ?? '').replace(/^\//, '');
    return pathPart || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hides credentials from a Mongo URI for safe logging.
 *
 * @param {string} uri
 * @returns {string}
 */
function redactUri(uri) {
  return uri.replace(/\/\/([^:@]+):([^@]+)@/, '//$1:***@');
}

async function main() {
  const opts = parseArgs();
  if (opts.help) printHelpAndExit();
  if (!opts.env) {
    console.error('Missing --env flag. See --help.');
    process.exit(1);
  }
  if (opts.dryRun && opts.rollback) {
    console.error('--dry-run + --rollback is allowed (dry rollback). Continuing.');
  }

  const envPath = path.resolve(process.cwd(), `.env.${opts.env}`);
  const loaded = dotenv.config({ path: envPath, override: true });
  if (loaded.error) {
    console.error(`Failed to load ${envPath}: ${loaded.error.message}`);
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not defined after loading env file.');
    process.exit(1);
  }
  const dbName = dbFromUri(uri);
  if (!dbName) {
    console.error('Cannot derive DB name from MONGODB_URI path segment.');
    process.exit(1);
  }

  console.log(`[migrate-user-name-split] env=${opts.env} db=${dbName} dryRun=${opts.dryRun} rollback=${opts.rollback}`);
  console.log(`[migrate-user-name-split] uri=${redactUri(uri)}`);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    console.error(`Mongo connection failed: ${err.message}`);
    process.exit(1);
  }

  const db = mongoose.connection.db;
  if (!db) {
    console.error('Mongoose connection has no active database handle.');
    await mongoose.disconnect();
    process.exit(1);
  }
  const users = db.collection('users');

  let migrated = 0;
  let skipped = 0;
  let flagged = 0;
  let errors = 0;

  const cursor = users.find({}, { projection: { _id: 1, name: 1, firstName: 1, lastName: 1 } }).batchSize(500);

  try {
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) break;

      const hasNew = typeof doc.firstName === 'string' && typeof doc.lastName === 'string';
      const hasLegacy = typeof doc.name === 'string';

      if (opts.rollback) {
        if (!hasNew) {
          skipped++;
          continue;
        }
        const merged = `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim();
        if (opts.dryRun) {
          console.log(`[DRY rollback] _id=${doc._id} → name="${merged}"`);
        } else {
          try {
            await users.updateOne(
              { _id: doc._id },
              { $set: { name: merged }, $unset: { firstName: '', lastName: '' } },
            );
            migrated++;
          } catch (err) {
            console.error(`[ERR] _id=${doc._id} rollback failed: ${err.message}`);
            errors++;
          }
        }
        continue;
      }

      if (hasNew && !hasLegacy) {
        skipped++;
        continue;
      }
      if (hasNew && hasLegacy) {
        if (opts.dryRun) {
          console.log(`[DRY cleanup] _id=${doc._id} drop legacy name="${doc.name}"`);
        } else {
          try {
            await users.updateOne({ _id: doc._id }, { $unset: { name: '' } });
            migrated++;
          } catch (err) {
            console.error(`[ERR] _id=${doc._id} cleanup failed: ${err.message}`);
            errors++;
          }
        }
        continue;
      }

      const source = typeof doc.name === 'string' ? doc.name : '';
      const { firstName, lastName, singleWord } = splitByLastSpace(source);
      if (singleWord || !lastName) {
        flagged++;
        console.log(`[MANUAL REVIEW] _id=${doc._id} name="${source}" → firstName="${firstName}" lastName=""`);
      }

      if (opts.dryRun) {
        console.log(`[DRY] _id=${doc._id} name="${source}" → firstName="${firstName}" lastName="${lastName}"`);
      } else {
        try {
          await users.updateOne(
            { _id: doc._id },
            { $set: { firstName, lastName }, $unset: { name: '' } },
          );
          migrated++;
        } catch (err) {
          console.error(`[ERR] _id=${doc._id} update failed: ${err.message}`);
          errors++;
        }
      }
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log(`[migrate-user-name-split] migrated=${migrated} skipped=${skipped} flagged=${flagged} errors=${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err?.stack ?? err}`);
  process.exit(1);
});
