/**
 * Tiny async key→value store backed by SQLite (SQLCipher-encrypted via the
 * `expo-sqlite` config plugin). One table, two operations — enough to persist the
 * whole app state blob. All failures degrade to no-ops / null so the UI never
 * crashes on a storage hiccup.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'vibeflow.db';
let _db: Promise<SQLite.SQLiteDatabase> | null = null;

function database(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(
        'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
      );
      return db;
    });
  }
  return _db;
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    const db = await database();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?;',
      key,
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    const db = await database();
    await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?);', key, value);
  } catch {
    // best-effort persistence; ignore
  }
}

export async function kvRemove(key: string): Promise<void> {
  try {
    const db = await database();
    await db.runAsync('DELETE FROM kv WHERE key = ?;', key);
  } catch {
    // best-effort
  }
}
