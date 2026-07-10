/**
 * Synchronous, cross-platform preference store for the handful of launch-critical
 * values (theme, palette) that must resolve BEFORE React first renders. Those
 * can't use the async SQLite blob store (`kv.ts`), and must persist on Android —
 * unlike the iOS-only App Group, which silently no-ops off-iOS and was the cause
 * of theme/palette not sticking on Android.
 *
 * Backed by expo-sqlite's *synchronous* API (available at JS launch). All failures
 * degrade to no-ops / null so a storage hiccup never crashes startup.
 */
import * as SQLite from 'expo-sqlite';

// undefined = not yet opened, null = open failed (degrade to no-op)
let _db: SQLite.SQLiteDatabase | null | undefined;

function db(): SQLite.SQLiteDatabase | null {
  if (_db !== undefined) return _db;
  try {
    const handle = SQLite.openDatabaseSync('vibeflow-prefs.db');
    handle.execSync(
      'CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
    );
    _db = handle;
  } catch {
    _db = null;
  }
  return _db;
}

export function prefGet(key: string): string | null {
  try {
    const row = db()?.getFirstSync<{ value: string }>(
      'SELECT value FROM prefs WHERE key = ?;',
      key,
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function prefSet(key: string, value: string): void {
  try {
    db()?.runSync('INSERT OR REPLACE INTO prefs (key, value) VALUES (?, ?);', key, value);
  } catch {
    // best-effort; ignore
  }
}

export function prefRemove(key: string): void {
  try {
    db()?.runSync('DELETE FROM prefs WHERE key = ?;', key);
  } catch {
    // best-effort; ignore
  }
}
