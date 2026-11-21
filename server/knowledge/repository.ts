import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  KNOWLEDGE_SECTIONS,
  KNOWLEDGE_SECTION_TARGET,
  KNOWLEDGE_TOTAL_TARGET,
} from '../../src/shared/constants.ts';
import type {
  ConfidenceLevel,
  KnowledgeBaseStats,
  KnowledgeRecord,
  KnowledgeRecordInput,
  KnowledgeSectionId,
  ReviewStatus,
  SectionStats,
} from '../../src/shared/types.ts';
import { getDatabase } from '../db/database.ts';

interface RawKnowledgeRow {
  id: string;
  section: KnowledgeSectionId;
  subcategory: string;
  title: string;
  detailed_content: string;
  simple_explanation: string;
  context: string;
  usage_limits: string;
  sources_json: string;
  source_urls_json: string;
  accessed_at: string;
  confidence_level: ConfidenceLevel;
  review_status: ReviewStatus;
  keywords_json: string;
  dedup_key: string;
  created_at: string;
  updated_at: string;
}

function safeParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: RawKnowledgeRow): KnowledgeRecord {
  return {
    id: row.id,
    section: row.section,
    subcategory: row.subcategory,
    title: row.title,
    detailed_content: row.detailed_content,
    simple_explanation: row.simple_explanation,
    context: row.context,
    usage_limits: row.usage_limits,
    sources: safeParseArray(row.sources_json),
    source_urls: safeParseArray(row.source_urls_json),
    accessed_at: row.accessed_at,
    confidence_level: row.confidence_level,
    review_status: row.review_status,
    keywords: safeParseArray(row.keywords_json),
    dedup_key: row.dedup_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function normalizeDedupKey(section: KnowledgeSectionId, title: string, customKey?: string): string {
  const base = (customKey && customKey.trim()) || `${section}::${title}`;
  const normalized = base
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
  return crypto.createHash('sha256').update(`${section}:${normalized}`).digest('hex').slice(0, 32);
}

export function validateKnowledgeInput(input: KnowledgeRecordInput): {
  valid: boolean;
  error?: string;
} {
  if (!input.title || input.title.trim().length < 2) {
    return { valid: false, error: 'Title must be at least 2 characters.' };
  }
  if (!input.detailed_content || input.detailed_content.trim().length < 20) {
    return { valid: false, error: 'Detailed content must be at least 20 characters.' };
  }
  if (!input.simple_explanation || input.simple_explanation.trim().length < 10) {
    return { valid: false, error: 'Simple explanation must be at least 10 characters.' };
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    return { valid: false, error: 'At least one real source citation is required.' };
  }
  for (const url of input.source_urls ?? []) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { valid: false, error: `Invalid source URL scheme: ${url}` };
      }
    } catch {
      return { valid: false, error: `Malformed source URL: ${url}` };
    }
  }
  return { valid: true };
}

export function insertKnowledgeRecord(
  input: KnowledgeRecordInput,
  db: DatabaseSync = getDatabase()
): { inserted: boolean; duplicate: boolean; record?: KnowledgeRecord; error?: string } {
  const validation = validateKnowledgeInput(input);
  if (!validation.valid) {
    return { inserted: false, duplicate: false, error: validation.error };
  }

  const now = new Date().toISOString();
  const dedupKey = normalizeDedupKey(input.section, input.title, input.dedup_key);
  const existing = db
    .prepare('SELECT id FROM knowledge_records WHERE dedup_key = ?')
    .get(dedupKey) as { id: string } | undefined;

  if (existing) {
    return { inserted: false, duplicate: true };
  }

  const id = input.id?.trim() || `kr_${crypto.randomUUID()}`;
  const reviewStatus: ReviewStatus =
    input.review_status ??
    (input.confidence_level === 'high' && (input.source_urls?.length ?? 0) > 0
      ? 'verified'
      : 'needs_review');

  db.prepare(
    `INSERT INTO knowledge_records (
      id, section, subcategory, title, detailed_content, simple_explanation,
      context, usage_limits, sources_json, source_urls_json, accessed_at,
      confidence_level, review_status, keywords_json, dedup_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.section,
    input.subcategory.trim() || 'General',
    input.title.trim(),
    input.detailed_content.trim(),
    input.simple_explanation.trim(),
    input.context.trim() || 'General verified reference',
    input.usage_limits.trim() || 'Educational and informational reference only.',
    JSON.stringify(input.sources),
    JSON.stringify(input.source_urls ?? []),
    input.accessed_at ?? now,
    input.confidence_level,
    reviewStatus,
    JSON.stringify(input.keywords ?? []),
    dedupKey,
    now,
    now
  );

  const saved = db.prepare('SELECT * FROM knowledge_records WHERE id = ?').get(id) as
    | RawKnowledgeRow
    | undefined;
  if (!saved) {
    return { inserted: false, duplicate: false, error: 'Failed to verify persisted record.' };
  }
  return { inserted: true, duplicate: false, record: rowToRecord(saved) };
}

export function insertKnowledgeBatch(
  inputs: KnowledgeRecordInput[],
  db: DatabaseSync = getDatabase()
): { inserted: number; duplicates: number; rejected: number; errors: string[] } {
  let inserted = 0;
  let duplicates = 0;
  let rejected = 0;
  const errors: string[] = [];

  const checkStmt = db.prepare('SELECT 1 FROM knowledge_records WHERE dedup_key = ?');
  const insertStmt = db.prepare(
    `INSERT INTO knowledge_records (
      id, section, subcategory, title, detailed_content, simple_explanation,
      context, usage_limits, sources_json, source_urls_json, accessed_at,
      confidence_level, review_status, keywords_json, dedup_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec('BEGIN');
  try {
    const now = new Date().toISOString();
    for (const item of inputs) {
      const validation = validateKnowledgeInput(item);
      if (!validation.valid) {
        rejected++;
        if (errors.length < 10 && validation.error) {
          errors.push(`${item.title || 'untitled'}: ${validation.error}`);
        }
        continue;
      }

      const dedupKey = normalizeDedupKey(item.section, item.title, item.dedup_key);
      if (checkStmt.get(dedupKey)) {
        duplicates++;
        continue;
      }

      const id = item.id?.trim() || `kr_${crypto.randomUUID()}`;
      const reviewStatus: ReviewStatus =
        item.review_status ??
        (item.confidence_level === 'high' && (item.source_urls?.length ?? 0) > 0
          ? 'verified'
          : 'needs_review');

      insertStmt.run(
        id,
        item.section,
        item.subcategory.trim() || 'General',
        item.title.trim(),
        item.detailed_content.trim(),
        item.simple_explanation.trim(),
        item.context.trim() || 'General verified reference',
        item.usage_limits.trim() || 'Educational and informational reference only.',
        JSON.stringify(item.sources),
        JSON.stringify(item.source_urls ?? []),
        item.accessed_at ?? now,
        item.confidence_level,
        reviewStatus,
        JSON.stringify(item.keywords ?? []),
        dedupKey,
        now,
        now
      );
      inserted++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { inserted, duplicates, rejected, errors };
}

export function getKnowledgeStats(db: DatabaseSync = getDatabase()): KnowledgeBaseStats {
  const rows = db
    .prepare(
      `SELECT section,
              COUNT(*) as totalCount,
              SUM(CASE WHEN review_status = 'verified' THEN 1 ELSE 0 END) as verifiedCount,
              SUM(CASE WHEN review_status = 'needs_review' THEN 1 ELSE 0 END) as needsReviewCount,
              SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
              MAX(updated_at) as lastUpdated
       FROM knowledge_records
       GROUP BY section`
    )
    .all() as Array<{
    section: KnowledgeSectionId;
    totalCount: number;
    verifiedCount: number;
    needsReviewCount: number;
    rejectedCount: number;
    lastUpdated: string | null;
  }>;

  const bySection = new Map(rows.map((r) => [r.section, r]));
  let totalRecords = 0;
  let verifiedTotal = 0;
  let needsReviewTotal = 0;
  let lastUpdatedAt: string | null = null;

  const sections: SectionStats[] = KNOWLEDGE_SECTIONS.map((def) => {
    const row = bySection.get(def.id);
    const totalCount = Number(row?.totalCount ?? 0);
    const verifiedCount = Number(row?.verifiedCount ?? 0);
    const needsReviewCount = Number(row?.needsReviewCount ?? 0);
    const rejectedCount = Number(row?.rejectedCount ?? 0);
    totalRecords += totalCount;
    verifiedTotal += verifiedCount;
    needsReviewTotal += needsReviewCount;
    if (row?.lastUpdated && (!lastUpdatedAt || row.lastUpdated > lastUpdatedAt)) {
      lastUpdatedAt = row.lastUpdated;
    }
    return {
      section: def.id,
      targetCount: KNOWLEDGE_SECTION_TARGET,
      totalCount,
      verifiedCount,
      needsReviewCount,
      rejectedCount,
    };
  });

  return {
    totalRecords,
    targetTotal: KNOWLEDGE_TOTAL_TARGET,
    verifiedTotal,
    needsReviewTotal,
    sections,
    lastUpdatedAt,
  };
}

export function listKnowledgeRecords(
  options: {
    section?: KnowledgeSectionId;
    reviewStatus?: ReviewStatus;
    query?: string;
    limit?: number;
    offset?: number;
  },
  db: DatabaseSync = getDatabase()
): { records: KnowledgeRecord[]; total: number } {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  if (options.query && options.query.trim().length > 0) {
    const results = searchKnowledgeRecords(
      options.query,
      options.section ? [options.section] : undefined,
      limit,
      options.reviewStatus,
      db
    );
    return { records: results, total: results.length };
  }

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.section) {
    conditions.push('section = ?');
    params.push(options.section);
  }
  if (options.reviewStatus) {
    conditions.push('review_status = ?');
    params.push(options.reviewStatus);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM knowledge_records ${where}`)
    .get(...params) as { cnt: number };

  const rows = db
    .prepare(
      `SELECT * FROM knowledge_records ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as unknown as RawKnowledgeRow[];

  return {
    records: rows.map(rowToRecord),
    total: Number(countRow.cnt ?? 0),
  };
}

const SEARCH_STOPWORDS = new Set([
  'من', 'في', 'على', 'إلى', 'الى', 'عن', 'مع', 'بين', 'هو', 'هي', 'هم', 'هن',
  'ما', 'ماذا', 'متى', 'أين', 'اين', 'كيف', 'لماذا', 'هل', 'كم', 'أي', 'اي',
  'هذا', 'هذه', 'ذلك', 'تلك', 'الذي', 'التي', 'الذين', 'كان', 'كانت', 'يكون',
  'أن', 'ان', 'إن', 'أو', 'او', 'ثم', 'لكن', 'بل', 'حتى', 'منذ', 'عند', 'لدى',
  'the', 'is', 'are', 'was', 'were', 'who', 'what', 'when', 'where', 'why', 'how',
  'which', 'that', 'this', 'these', 'those', 'and', 'for', 'with', 'from', 'into',
  'about', 'can', 'could', 'would', 'should', 'does', 'did', 'has', 'have', 'had',
]);

function buildSafeFtsQuery(rawQuery: string): string {
  const tokens = rawQuery
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !SEARCH_STOPWORDS.has(t.toLowerCase()))
    .slice(0, 8);

  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' OR ');
}

export function searchKnowledgeRecords(
  query: string,
  sections?: KnowledgeSectionId[],
  limit = 8,
  reviewStatus?: ReviewStatus,
  db: DatabaseSync = getDatabase()
): KnowledgeRecord[] {
  const safeFts = buildSafeFtsQuery(query);
  const boundedLimit = Math.min(Math.max(limit, 1), 100);

  if (!safeFts) {
    return [];
  }

  const conditions: string[] = [];
  const params: Array<string | number> = [safeFts];

  if (sections && sections.length > 0) {
    const placeholders = sections.map(() => '?').join(', ');
    conditions.push(`kr.section IN (${placeholders})`);
    params.push(...sections);
  }

  if (reviewStatus) {
    conditions.push('kr.review_status = ?');
    params.push(reviewStatus);
  } else {
    conditions.push("kr.review_status != 'rejected'");
  }

  const extraWhere = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
  params.push(boundedLimit);

  try {
    const rows = db
      .prepare(
        `SELECT kr.*
         FROM knowledge_fts fts
         JOIN knowledge_records kr ON kr.rowid = fts.rowid
         WHERE knowledge_fts MATCH ? ${extraWhere}
         ORDER BY bm25(knowledge_fts, 4.0, 2.0, 1.5, 1.0, 2.0) ASC,
                  CASE kr.review_status WHEN 'verified' THEN 0 ELSE 1 END ASC
         LIMIT ?`
      )
      .all(...params) as unknown as RawKnowledgeRow[];

    if (rows.length > 0) {
      return rows.map(rowToRecord);
    }
  } catch {
    // Fallback to LIKE scan if FTS syntax encounters edge punctuation
  }

  const likeTerm = `%${query.trim().slice(0, 80)}%`;
  const fallbackConditions = ['(title LIKE ? OR detailed_content LIKE ? OR keywords_json LIKE ?)'];
  const fallbackParams: Array<string | number> = [likeTerm, likeTerm, likeTerm];
  if (sections && sections.length > 0) {
    fallbackConditions.push(`section IN (${sections.map(() => '?').join(', ')})`);
    fallbackParams.push(...sections);
  }
  fallbackParams.push(boundedLimit);

  const fallbackRows = db
    .prepare(
      `SELECT * FROM knowledge_records
       WHERE ${fallbackConditions.join(' AND ')}
       LIMIT ?`
    )
    .all(...fallbackParams) as unknown as RawKnowledgeRow[];

  return fallbackRows.map(rowToRecord);
}

export function updateKnowledgeRecord(
  id: string,
  updates: Partial<KnowledgeRecordInput>,
  db: DatabaseSync = getDatabase()
): KnowledgeRecord | null {
  const existing = db.prepare('SELECT * FROM knowledge_records WHERE id = ?').get(id) as
    | RawKnowledgeRow
    | undefined;
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE knowledge_records
     SET subcategory = ?,
         title = ?,
         detailed_content = ?,
         simple_explanation = ?,
         context = ?,
         usage_limits = ?,
         sources_json = ?,
         source_urls_json = ?,
         confidence_level = ?,
         review_status = ?,
         keywords_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    updates.subcategory ?? existing.subcategory,
    updates.title ?? existing.title,
    updates.detailed_content ?? existing.detailed_content,
    updates.simple_explanation ?? existing.simple_explanation,
    updates.context ?? existing.context,
    updates.usage_limits ?? existing.usage_limits,
    updates.sources ? JSON.stringify(updates.sources) : existing.sources_json,
    updates.source_urls ? JSON.stringify(updates.source_urls) : existing.source_urls_json,
    updates.confidence_level ?? existing.confidence_level,
    updates.review_status ?? existing.review_status,
    updates.keywords ? JSON.stringify(updates.keywords) : existing.keywords_json,
    now,
    id
  );

  const updated = db.prepare('SELECT * FROM knowledge_records WHERE id = ?').get(id) as
    | RawKnowledgeRow
    | undefined;
  return updated ? rowToRecord(updated) : null;
}

export function deleteKnowledgeRecord(
  id: string,
  db: DatabaseSync = getDatabase()
): boolean {
  const result = db.prepare('DELETE FROM knowledge_records WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function exportKnowledgeRecords(
  section?: KnowledgeSectionId,
  db: DatabaseSync = getDatabase()
): KnowledgeRecord[] {
  const rows = section
    ? (db
        .prepare('SELECT * FROM knowledge_records WHERE section = ? ORDER BY created_at ASC')
        .all(section) as unknown as RawKnowledgeRow[])
    : (db
        .prepare('SELECT * FROM knowledge_records ORDER BY section, created_at ASC')
        .all() as unknown as RawKnowledgeRow[]);
  return rows.map(rowToRecord);
}
