import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS } from '../../src/shared/constants.ts';
import type {
  ActivityLogEntry,
  AppSettings,
  ChatMessage,
  RecentFileEntry,
  SearchHistoryEntry,
  UserPreferenceItem,
  UserTaskItem,
} from '../../src/shared/types.ts';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function resolveDatabasePath(): string {
  const configured = process.env.NEXORA_DB_PATH?.trim();
  if (configured === ':memory:') {
    return ':memory:';
  }
  const baseDir = process.cwd();
  const target = configured
    ? path.resolve(baseDir, configured)
    : path.resolve(baseDir, 'data', 'nexora.db');

  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return target;
}

export function getDatabase(overridePath?: string): DatabaseSync {
  const targetPath = overridePath ?? resolveDatabasePath();
  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore close errors during re-init
    }
  }

  const db = new DatabaseSync(targetPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  initializeSchema(db);
  dbInstance = db;
  currentDbPath = targetPath;
  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    currentDbPath = null;
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_records (
      id TEXT PRIMARY KEY,
      section TEXT NOT NULL CHECK (section IN ('science', 'programming', 'medicine', 'history_culture', 'logic_creativity')),
      subcategory TEXT NOT NULL,
      title TEXT NOT NULL,
      detailed_content TEXT NOT NULL,
      simple_explanation TEXT NOT NULL,
      context TEXT NOT NULL,
      usage_limits TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      source_urls_json TEXT NOT NULL,
      accessed_at TEXT NOT NULL,
      confidence_level TEXT NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low')),
      review_status TEXT NOT NULL CHECK (review_status IN ('verified', 'needs_review', 'rejected')),
      keywords_json TEXT NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kr_section ON knowledge_records(section);
    CREATE INDEX IF NOT EXISTS idx_kr_status ON knowledge_records(review_status);
    CREATE INDEX IF NOT EXISTS idx_kr_section_status ON knowledge_records(section, review_status);
    CREATE INDEX IF NOT EXISTS idx_kr_subcategory ON knowledge_records(subcategory);

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      id UNINDEXED,
      section UNINDEXED,
      title,
      subcategory,
      detailed_content,
      simple_explanation,
      keywords_json,
      content='knowledge_records',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS kr_ai AFTER INSERT ON knowledge_records BEGIN
      INSERT INTO knowledge_fts(rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES (new.rowid, new.id, new.section, new.title, new.subcategory, new.detailed_content, new.simple_explanation, new.keywords_json);
    END;

    CREATE TRIGGER IF NOT EXISTS kr_ad AFTER DELETE ON knowledge_records BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES ('delete', old.rowid, old.id, old.section, old.title, old.subcategory, old.detailed_content, old.simple_explanation, old.keywords_json);
    END;

    CREATE TRIGGER IF NOT EXISTS kr_au AFTER UPDATE ON knowledge_records BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES ('delete', old.rowid, old.id, old.section, old.title, old.subcategory, old.detailed_content, old.simple_explanation, old.keywords_json);
      INSERT INTO knowledge_fts(rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES (new.rowid, new.id, new.section, new.title, new.subcategory, new.detailed_content, new.simple_explanation, new.keywords_json);
    END;

    CREATE TABLE IF NOT EXISTS batch_jobs (
      id TEXT PRIMARY KEY,
      section TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
      target_batch_size INTEGER NOT NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      cursor_category_index INTEGER NOT NULL DEFAULT 0,
      cursor_continue_token TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      claimed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      pref_key TEXT NOT NULL UNIQUE,
      pref_value TEXT NOT NULL,
      consented INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')) DEFAULT 'todo',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id TEXT PRIMARY KEY,
      site_name TEXT NOT NULL,
      url TEXT NOT NULL,
      query TEXT NOT NULL,
      summary TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('search', 'browse')) DEFAULT 'search',
      visited_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_search_history_time ON search_history(visited_at DESC);

    CREATE TABLE IF NOT EXISTS recent_files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL CHECK (source IN ('workspace', 'upload', 'browser_fs')) DEFAULT 'workspace',
      summary TEXT NOT NULL,
      accessed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recent_files_time ON recent_files(accessed_at DESC);

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('search', 'browse', 'file', 'command', 'tool', 'ai')),
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      tool_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending_confirmation')),
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_logs_time ON activity_logs(created_at DESC);
  `);

  // Safe idempotent column migrations for existing databases
  const ensureColumn = (table: string, col: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };
  ensureColumn('conversations', 'pinned', 'pinned INTEGER NOT NULL DEFAULT 0');
  ensureColumn('messages', 'original_content', 'original_content TEXT');
  ensureColumn('user_preferences', 'category', "category TEXT NOT NULL DEFAULT 'preference'");

  const existing = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  if (!existing) {
    db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'app_settings',
      JSON.stringify(DEFAULT_SETTINGS),
      new Date().toISOString()
    );
  }
}

export function getAppSettings(db: DatabaseSync = getDatabase()): AppSettings {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAppSettings(
  partial: Partial<AppSettings>,
  db: DatabaseSync = getDatabase()
): AppSettings {
  const current = getAppSettings(db);
  const next: AppSettings = { ...current, ...partial };
  db.prepare(
    'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
  ).run('app_settings', JSON.stringify(next), new Date().toISOString());
  return next;
}

export function resetAppSettings(db: DatabaseSync = getDatabase()): AppSettings {
  const next: AppSettings = { ...DEFAULT_SETTINGS };
  db.prepare(
    'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
  ).run('app_settings', JSON.stringify(next), new Date().toISOString());
  return next;
}

export function listUserPreferences(db: DatabaseSync = getDatabase()): UserPreferenceItem[] {
  const rows = db
    .prepare(
      'SELECT id, pref_key, pref_value, category, consented, created_at, updated_at FROM user_preferences ORDER BY updated_at DESC'
    )
    .all() as Array<{
    id: string;
    pref_key: string;
    pref_value: string;
    category: string | null;
    consented: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    key: r.pref_key,
    value: r.pref_value,
    category:
      r.category === 'project' || r.category === 'saved_fact' ? r.category : 'preference',
    consented: Boolean(r.consented),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function upsertUserPreference(
  id: string,
  key: string,
  value: string,
  dbOrCategory: DatabaseSync | 'preference' | 'project' | 'saved_fact' = 'preference',
  maybeDb?: DatabaseSync
): UserPreferenceItem {
  const category = typeof dbOrCategory === 'string' ? dbOrCategory : 'preference';
  const db = typeof dbOrCategory === 'string' ? maybeDb ?? getDatabase() : dbOrCategory;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_preferences (id, pref_key, pref_value, category, consented, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(pref_key) DO UPDATE SET pref_value = excluded.pref_value, category = excluded.category, updated_at = excluded.updated_at`
  ).run(id, key.trim(), value.trim(), category, now, now);
  return {
    id,
    key: key.trim(),
    value: value.trim(),
    category,
    consented: true,
    created_at: now,
    updated_at: now,
  };
}

export function updateUserPreferenceById(
  id: string,
  updates: { key?: string; value?: string; category?: 'preference' | 'project' | 'saved_fact' },
  db: DatabaseSync = getDatabase()
): UserPreferenceItem | null {
  const row = db
    .prepare(
      'SELECT id, pref_key, pref_value, category, consented, created_at, updated_at FROM user_preferences WHERE id = ?'
    )
    .get(id) as
    | {
        id: string;
        pref_key: string;
        pref_value: string;
        category: string;
        consented: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;

  const nextKey = updates.key?.trim() || row.pref_key;
  const nextVal = updates.value?.trim() || row.pref_value;
  const nextCat = updates.category ?? (row.category as 'preference' | 'project' | 'saved_fact');
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE user_preferences SET pref_key = ?, pref_value = ?, category = ?, updated_at = ? WHERE id = ?'
  ).run(nextKey, nextVal, nextCat, now, id);
  return {
    id,
    key: nextKey,
    value: nextVal,
    category: nextCat,
    consented: Boolean(row.consented),
    created_at: row.created_at,
    updated_at: now,
  };
}

export function deleteUserPreference(id: string, db: DatabaseSync = getDatabase()): boolean {
  const res = db.prepare('DELETE FROM user_preferences WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function updateConversation(
  id: string,
  updates: { title?: string; pinned?: boolean },
  db: DatabaseSync = getDatabase()
): { id: string; title: string; pinned: boolean; created_at: string; updated_at: string } | null {
  const existing = db
    .prepare('SELECT id, title, pinned, created_at, updated_at FROM conversations WHERE id = ?')
    .get(id) as
    | { id: string; title: string; pinned: number; created_at: string; updated_at: string }
    | undefined;
  if (!existing) return null;

  const nextTitle = updates.title !== undefined ? updates.title.trim().slice(0, 120) || existing.title : existing.title;
  const nextPinned = updates.pinned !== undefined ? (updates.pinned ? 1 : 0) : existing.pinned;
  const now = new Date().toISOString();
  db.prepare('UPDATE conversations SET title = ?, pinned = ?, updated_at = ? WHERE id = ?').run(
    nextTitle,
    nextPinned,
    now,
    id
  );
  return {
    id,
    title: nextTitle,
    pinned: Boolean(nextPinned),
    created_at: existing.created_at,
    updated_at: now,
  };
}

export function getConversationMessages(
  conversationId: string,
  db: DatabaseSync = getDatabase()
): ChatMessage[] {
  const rows = db
    .prepare(
      'SELECT id, conversation_id, role, content, original_content, metadata_json, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    original_content: string | null;
    metadata_json: string | null;
    created_at: string;
  }>;

  return rows.map((r) => {
    const parsedMeta = r.metadata_json ? JSON.parse(r.metadata_json) : undefined;
    if (parsedMeta) {
      delete parsedMeta.kbSources;
      delete parsedMeta.selectedSections;
    }
    return {
      id: r.id,
      conversation_id: r.conversation_id,
      role: r.role,
      content: r.content,
      original_content: r.original_content,
      is_edited: Boolean(r.original_content && r.original_content !== r.content),
      metadata: parsedMeta,
      created_at: r.created_at,
    };
  });
}

export function editMessageAndTrimFollowing(
  messageId: string,
  newContent: string,
  db: DatabaseSync = getDatabase()
): { conversationId: string; message: ChatMessage; deletedFollowingCount: number } | null {
  const row = db
    .prepare(
      'SELECT id, conversation_id, role, content, original_content, metadata_json, created_at FROM messages WHERE id = ?'
    )
    .get(messageId) as
    | {
        id: string;
        conversation_id: string;
        role: 'user' | 'assistant';
        content: string;
        original_content: string | null;
        metadata_json: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;

  const originalToKeep = row.original_content ?? row.content;
  const clean = newContent.trim();
  db.prepare('UPDATE messages SET content = ?, original_content = ? WHERE id = ?').run(
    clean,
    originalToKeep,
    messageId
  );

  // Remove subsequent messages in this conversation so a fresh reply branch is generated cleanly
  const delRes = db
    .prepare('DELETE FROM messages WHERE conversation_id = ? AND created_at > ?')
    .run(row.conversation_id, row.created_at);

  return {
    conversationId: row.conversation_id,
    deletedFollowingCount: Number(delRes.changes),
    message: {
      id: row.id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: clean,
      original_content: originalToKeep,
      is_edited: originalToKeep !== clean,
      created_at: row.created_at,
    },
  };
}

export function restoreOriginalMessage(
  messageId: string,
  db: DatabaseSync = getDatabase()
): ChatMessage | null {
  const row = db
    .prepare(
      'SELECT id, conversation_id, role, content, original_content, metadata_json, created_at FROM messages WHERE id = ?'
    )
    .get(messageId) as
    | {
        id: string;
        conversation_id: string;
        role: 'user' | 'assistant';
        content: string;
        original_content: string | null;
        metadata_json: string | null;
        created_at: string;
      }
    | undefined;
  if (!row || !row.original_content) return null;

  db.prepare('UPDATE messages SET content = ?, original_content = NULL WHERE id = ?').run(
    row.original_content,
    messageId
  );
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.original_content,
    original_content: null,
    is_edited: false,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    created_at: row.created_at,
  };
}

export function listUserTasks(db: DatabaseSync = getDatabase()): UserTaskItem[] {
  return db
    .prepare('SELECT id, title, notes, status, priority, created_at FROM user_tasks ORDER BY created_at DESC LIMIT 100')
    .all() as unknown as UserTaskItem[];
}

export function createUserTask(
  task: Omit<UserTaskItem, 'created_at'>,
  db: DatabaseSync = getDatabase()
): UserTaskItem {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO user_tasks (id, title, notes, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(task.id, task.title, task.notes, task.status, task.priority, now);
  return { ...task, created_at: now };
}

export function updateUserTaskStatus(
  id: string,
  status: UserTaskItem['status'],
  db: DatabaseSync = getDatabase()
): boolean {
  const res = db.prepare('UPDATE user_tasks SET status = ? WHERE id = ?').run(status, id);
  return Number(res.changes) > 0;
}

export function deleteUserTask(id: string, db: DatabaseSync = getDatabase()): boolean {
  const res = db.prepare('DELETE FROM user_tasks WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function logAuditEvent(
  eventType: string,
  detail: string,
  db: DatabaseSync = getDatabase()
): void {
  const safeDetail = detail.slice(0, 500);
  db.prepare('INSERT INTO audit_logs (event_type, detail, created_at) VALUES (?, ?, ?)').run(
    eventType,
    safeDetail,
    new Date().toISOString()
  );
}

export function createDatabaseBackup(db: DatabaseSync = getDatabase()): {
  filePath: string;
  sizeBytes: number;
  createdAt: string;
} {
  const backupsDir = path.resolve(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `nexora-backup-${timestamp}.json`);
  const records = db.prepare('SELECT * FROM knowledge_records ORDER BY created_at ASC').all();
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    totalRecords: records.length,
    records,
  };
  const serialized = JSON.stringify(payload, null, 2);
  fs.writeFileSync(backupPath, serialized, 'utf8');
  return {
    filePath: backupPath,
    sizeBytes: Buffer.byteLength(serialized, 'utf8'),
    createdAt: payload.exportedAt,
  };
}

export function recordSearchHistory(
  entry: Omit<SearchHistoryEntry, 'id' | 'visited_at'>,
  db: DatabaseSync = getDatabase()
): SearchHistoryEntry | null {
  const settings = getAppSettings(db);
  if (!settings.saveSearchHistory) {
    return null;
  }
  const id = `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const visitedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO search_history (id, site_name, url, query, summary, mode, visited_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    entry.site_name.slice(0, 120),
    entry.url.slice(0, 600),
    entry.query.slice(0, 240),
    entry.summary.slice(0, 600),
    entry.mode,
    visitedAt
  );
  return { id, ...entry, visited_at: visitedAt };
}

export function listSearchHistory(
  limit = 60,
  db: DatabaseSync = getDatabase()
): SearchHistoryEntry[] {
  const bounded = Math.min(Math.max(limit, 1), 200);
  return db
    .prepare(
      'SELECT id, site_name, url, query, summary, mode, visited_at FROM search_history ORDER BY visited_at DESC LIMIT ?'
    )
    .all(bounded) as unknown as SearchHistoryEntry[];
}

export function clearSearchHistory(db: DatabaseSync = getDatabase()): number {
  const res = db.prepare('DELETE FROM search_history').run();
  return Number(res.changes);
}

export function deleteSearchHistoryById(id: string, db: DatabaseSync = getDatabase()): boolean {
  const res = db.prepare('DELETE FROM search_history WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function recordRecentFile(
  entry: Omit<RecentFileEntry, 'id' | 'accessed_at'>,
  db: DatabaseSync = getDatabase()
): RecentFileEntry {
  const id = `rf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const accessedAt = new Date().toISOString();
  db.prepare('DELETE FROM recent_files WHERE file_path = ? AND source = ?').run(
    entry.file_path,
    entry.source
  );
  db.prepare(
    `INSERT INTO recent_files (id, file_name, file_path, mime_type, size_bytes, source, summary, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    entry.file_name.slice(0, 160),
    entry.file_path.slice(0, 400),
    entry.mime_type.slice(0, 100),
    Number(entry.size_bytes) || 0,
    entry.source,
    entry.summary.slice(0, 320),
    accessedAt
  );
  return { id, ...entry, accessed_at: accessedAt };
}

export function listRecentFiles(
  limit = 30,
  db: DatabaseSync = getDatabase()
): RecentFileEntry[] {
  const bounded = Math.min(Math.max(limit, 1), 100);
  return db
    .prepare(
      'SELECT id, file_name, file_path, mime_type, size_bytes, source, summary, accessed_at FROM recent_files ORDER BY accessed_at DESC LIMIT ?'
    )
    .all(bounded) as unknown as RecentFileEntry[];
}

export function clearRecentFiles(db: DatabaseSync = getDatabase()): number {
  const res = db.prepare('DELETE FROM recent_files').run();
  return Number(res.changes);
}

export function recordActivityLog(
  entry: Omit<ActivityLogEntry, 'id' | 'created_at'>,
  db: DatabaseSync = getDatabase()
): ActivityLogEntry | null {
  const settings = getAppSettings(db);
  if (!settings.saveActivityLog) {
    return null;
  }
  const id = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_logs (id, category, action, target, tool_id, status, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    entry.category,
    entry.action.slice(0, 140),
    entry.target.slice(0, 300),
    entry.tool_id ? entry.tool_id.slice(0, 80) : null,
    entry.status,
    entry.detail.slice(0, 400),
    createdAt
  );
  return { id, ...entry, created_at: createdAt };
}

export function listActivityLogs(
  options?: { category?: ActivityLogEntry['category']; limit?: number },
  db: DatabaseSync = getDatabase()
): ActivityLogEntry[] {
  const bounded = Math.min(Math.max(options?.limit ?? 80, 1), 250);
  if (options?.category) {
    return db
      .prepare(
        'SELECT id, category, action, target, tool_id, status, detail, created_at FROM activity_logs WHERE category = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(options.category, bounded) as unknown as ActivityLogEntry[];
  }
  return db
    .prepare(
      'SELECT id, category, action, target, tool_id, status, detail, created_at FROM activity_logs ORDER BY created_at DESC LIMIT ?'
    )
    .all(bounded) as unknown as ActivityLogEntry[];
}

export function clearActivityLogs(db: DatabaseSync = getDatabase()): number {
  const res = db.prepare('DELETE FROM activity_logs').run();
  return Number(res.changes);
}

export function deleteActivityLogById(id: string, db: DatabaseSync = getDatabase()): boolean {
  const res = db.prepare('DELETE FROM activity_logs WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}
