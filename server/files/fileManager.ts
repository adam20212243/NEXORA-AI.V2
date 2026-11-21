import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type {
  DataAnalysisSummary,
  DataColumnStat,
  DuplicateFileGroup,
  StorageStatsSummary,
  WorkspaceFileItem,
} from '../../src/shared/types.ts';
import { recordActivityLog, recordRecentFile } from '../db/database.ts';

const TEMP_EXTENSIONS = new Set(['.tmp', '.temp', '.bak', '.cache', '.dmp']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function resolveWorkspaceRoot(): string {
  const configured = process.env.NEXORA_WORKSPACE_DIR?.trim();
  const root = configured
    ? path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), 'workspace');
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
    // Seed a helpful README on first initialization if empty
    const welcomePath = path.join(root, 'welcome-nexora.txt');
    if (!fs.existsSync(welcomePath)) {
      fs.writeFileSync(
        welcomePath,
        'NEXORA AI Safe Workspace\nCreated for real file management, document analysis (TXT, JSON, CSV, DOCX, PDF, Images), and temporary file inspection.\n',
        'utf8'
      );
    }
  }
  return root;
}

/**
 * Strict path confinement: resolves relative user path inside workspaceRoot and rejects any traversal.
 */
export function resolveConfinedWorkspacePath(relativePath: string): {
  root: string;
  fullPath: string;
  normalizedRel: string;
} {
  const root = resolveWorkspaceRoot();
  const cleaned = relativePath.replace(/^[/\\]+/, '').trim();
  const fullPath = cleaned ? path.resolve(root, cleaned) : root;

  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error('Access denied: Path escapes the authorized NEXORA workspace boundary.');
  }

  const normalizedRel = fullPath === root ? '' : path.relative(root, fullPath).replace(/\\/g, '/');
  return { root, fullPath, normalizedRel };
}

function isTempCandidateFile(name: string, relPath: string): boolean {
  const lower = name.toLowerCase();
  const ext = path.extname(lower);
  if (TEMP_EXTENSIONS.has(ext)) return true;
  if (lower.startsWith('~$')) return true;
  if (/(?:^|\/)(?:tmp|temp|cache)\//i.test(relPath)) return true;
  return false;
}

function walkWorkspace(
  dirPath: string,
  root: string,
  items: WorkspaceFileItem[],
  depth = 0
): void {
  if (depth > 5 || items.length >= 400) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    try {
      const st = fs.statSync(full);
      const ext = entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase();
      items.push({
        name: entry.name,
        relativePath: rel,
        isDirectory: entry.isDirectory(),
        sizeBytes: entry.isDirectory() ? 0 : st.size,
        extension: ext,
        modifiedAt: st.mtime.toISOString(),
        isTempCandidate: !entry.isDirectory() && isTempCandidateFile(entry.name, rel),
      });
      if (entry.isDirectory()) {
        walkWorkspace(full, root, items, depth + 1);
      }
    } catch {
      // Ignore unreadable system entries
    }
  }
}

export function listWorkspaceFiles(options?: {
  subPath?: string;
  searchQuery?: string;
  extension?: string;
}): {
  workspaceRoot: string;
  items: WorkspaceFileItem[];
} {
  const { root, fullPath } = resolveConfinedWorkspacePath(options?.subPath ?? '');
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Directory not found: ${options?.subPath ?? ''}`);
  }
  const allItems: WorkspaceFileItem[] = [];
  walkWorkspace(fullPath, root, allItems);

  let filtered = allItems;
  if (options?.searchQuery?.trim()) {
    const q = options.searchQuery.trim().toLowerCase();
    filtered = filtered.filter(
      (i) => i.name.toLowerCase().includes(q) || i.relativePath.toLowerCase().includes(q)
    );
  }
  if (options?.extension?.trim()) {
    const ext = options.extension.trim().toLowerCase();
    const dotExt = ext.startsWith('.') ? ext : `.${ext}`;
    filtered = filtered.filter((i) => !i.isDirectory && i.extension === dotExt);
  }

  filtered.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return {
    workspaceRoot: root,
    items: filtered,
  };
}

export function getWorkspaceStorageStats(): StorageStatsSummary {
  const root = resolveWorkspaceRoot();
  const items: WorkspaceFileItem[] = [];
  walkWorkspace(root, root, items);

  let totalFiles = 0;
  let totalFolders = 0;
  let totalSizeBytes = 0;
  const tempCandidates: WorkspaceFileItem[] = [];

  for (const item of items) {
    if (item.isDirectory) {
      totalFolders++;
    } else {
      totalFiles++;
      totalSizeBytes += item.sizeBytes;
      if (item.isTempCandidate) {
        tempCandidates.push(item);
      }
    }
  }

  const tempFilesSizeBytes = tempCandidates.reduce((acc, f) => acc + f.sizeBytes, 0);

  const fileOnlyItems = items.filter((i) => !i.isDirectory);
  const largeFiles = [...fileOnlyItems]
    .filter((i) => i.sizeBytes >= 256 * 1024)
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, 10);

  // Exact SHA-256 duplicate detection for files under 2MB grouped by identical byte size
  const sizeBuckets = new Map<number, WorkspaceFileItem[]>();
  for (const f of fileOnlyItems) {
    if (f.sizeBytes > 0 && f.sizeBytes <= 2_000_000) {
      const list = sizeBuckets.get(f.sizeBytes) ?? [];
      list.push(f);
      sizeBuckets.set(f.sizeBytes, list);
    }
  }
  const duplicateGroups: DuplicateFileGroup[] = [];
  for (const [sizeBytes, bucket] of sizeBuckets.entries()) {
    if (bucket.length < 2) continue;
    const hashMap = new Map<string, string[]>();
    for (const f of bucket) {
      try {
        const { fullPath } = resolveConfinedWorkspacePath(f.relativePath);
        const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex').slice(0, 16);
        const paths = hashMap.get(hash) ?? [];
        paths.push(f.relativePath);
        hashMap.set(hash, paths);
      } catch {
        // skip unreadable file
      }
    }
    for (const [hash, files] of hashMap.entries()) {
      if (files.length >= 2) {
        duplicateGroups.push({ hash, sizeBytes, files });
      }
    }
  }

  return {
    workspaceRoot: root,
    totalFiles,
    totalFolders,
    totalSizeBytes,
    tempFilesCount: tempCandidates.length,
    tempFilesSizeBytes,
    tempCandidates,
    largeFiles,
    duplicateGroups,
  };
}

export async function extractTextFromDocxBuffer(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const docXml = zip.file('word/document.xml');
  if (!docXml) {
    throw new Error('Invalid DOCX archive: word/document.xml missing.');
  }
  const xml = await docXml.async('text');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractBasicPdfText(buf: Buffer): string {
  // Lightweight literal string extraction from uncompressed PDF text operators for offline fallback
  const latin = buf.toString('latin1');
  const matches = latin.match(/\(([^()\\]{2,200})\)\s*Tj/g) ?? [];
  const extracted = matches
    .map((m) => m.replace(/^\(/, '').replace(/\)\s*Tj$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return extracted;
}

export function guessMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.md':
      return 'text/markdown';
    default:
      return 'text/plain';
  }
}

export async function readWorkspaceFile(relativePath: string): Promise<{
  fileName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  contentText: string;
  base64Data?: string;
}> {
  const { fullPath, normalizedRel } = resolveConfinedWorkspacePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  const st = fs.statSync(fullPath);
  if (st.isDirectory()) {
    throw new Error(`"${relativePath}" is a directory, not a file.`);
  }
  if (st.size > 4_000_000) {
    throw new Error(`File "${relativePath}" exceeds 4MB safe read limit.`);
  }

  const ext = path.extname(fullPath).toLowerCase();
  const fileName = path.basename(fullPath);
  const mimeType = guessMimeType(ext);
  const buf = fs.readFileSync(fullPath);

  let contentText = '';
  let base64Data: string | undefined;

  if (IMAGE_EXTENSIONS.has(ext)) {
    base64Data = buf.toString('base64');
    contentText = `[Image file: ${fileName}, ${st.size} bytes, ${mimeType}]`;
  } else if (ext === '.docx') {
    contentText = await extractTextFromDocxBuffer(buf);
  } else if (ext === '.xlsx') {
    base64Data = buf.toString('base64');
    const summary = await analyzeTabularBuffer({ buffer: buf, fileName });
    contentText = formatDataAnalysisAsText(summary);
  } else if (ext === '.pdf') {
    base64Data = buf.toString('base64');
    const extracted = extractBasicPdfText(buf);
    contentText =
      extracted ||
      `[PDF binary loaded (${st.size} bytes). Attach/analyze with Gemini for full visual & OCR PDF reading.]`;
  } else {
    contentText = buf.toString('utf8');
  }

  recordRecentFile({
    file_name: fileName,
    file_path: normalizedRel,
    mime_type: mimeType,
    size_bytes: st.size,
    source: 'workspace',
    summary: `Opened (${st.size} bytes)`,
  });

  recordActivityLog({
    category: 'file',
    action: 'read_file',
    target: normalizedRel,
    tool_id: 'file_manager',
    status: 'success',
    detail: `Read ${fileName} (${st.size} bytes)`,
  });

  return {
    fileName,
    relativePath: normalizedRel,
    mimeType,
    sizeBytes: st.size,
    contentText,
    base64Data,
  };
}

export function writeWorkspaceFile(options: {
  relativePath: string;
  content: string;
  append?: boolean;
  overwriteConfirmed?: boolean;
}): {
  relativePath: string;
  sizeBytes: number;
  requiresConfirmation?: boolean;
  message?: string;
} {
  const { fullPath, normalizedRel } = resolveConfinedWorkspacePath(options.relativePath);
  if (!normalizedRel) {
    throw new Error('File path cannot be empty.');
  }

  const exists = fs.existsSync(fullPath);
  if (exists && !options.append && options.overwriteConfirmed === false) {
    return {
      relativePath: normalizedRel,
      sizeBytes: fs.statSync(fullPath).size,
      requiresConfirmation: true,
      message: `الملف "${normalizedRel}" موجود بالفعل. هل تؤكد استبدال محتواه؟`,
    };
  }

  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (options.append && exists) {
    fs.appendFileSync(fullPath, options.content, 'utf8');
  } else {
    fs.writeFileSync(fullPath, options.content, 'utf8');
  }

  const sizeBytes = fs.statSync(fullPath).size;
  recordRecentFile({
    file_name: path.basename(fullPath),
    file_path: normalizedRel,
    mime_type: guessMimeType(path.extname(fullPath)),
    size_bytes: sizeBytes,
    source: 'workspace',
    summary: options.append ? 'Appended content' : 'Created / updated file',
  });
  recordActivityLog({
    category: 'file',
    action: options.append ? 'append_file' : 'write_file',
    target: normalizedRel,
    tool_id: 'file_manager',
    status: 'success',
    detail: `Wrote ${sizeBytes} bytes`,
  });

  return { relativePath: normalizedRel, sizeBytes };
}

export function transferWorkspaceFile(options: {
  sourcePath: string;
  destPath: string;
  mode: 'copy' | 'move';
}): { sourcePath: string; destPath: string; mode: 'copy' | 'move' } {
  const src = resolveConfinedWorkspacePath(options.sourcePath);
  const dst = resolveConfinedWorkspacePath(options.destPath);

  if (!fs.existsSync(src.fullPath)) {
    throw new Error(`Source file not found: ${options.sourcePath}`);
  }
  const destDir = path.dirname(dst.fullPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (options.mode === 'copy') {
    fs.copyFileSync(src.fullPath, dst.fullPath);
  } else {
    fs.renameSync(src.fullPath, dst.fullPath);
  }

  recordActivityLog({
    category: 'file',
    action: options.mode === 'copy' ? 'copy_file' : 'move_file',
    target: `${src.normalizedRel} -> ${dst.normalizedRel}`,
    tool_id: 'file_manager',
    status: 'success',
    detail: `${options.mode} completed inside workspace`,
  });

  return {
    sourcePath: src.normalizedRel,
    destPath: dst.normalizedRel,
    mode: options.mode,
  };
}

export function deleteWorkspaceFile(options: {
  relativePath: string;
  confirmed: boolean;
}): {
  deleted: boolean;
  requiresConfirmation?: boolean;
  relativePath: string;
  sizeBytes?: number;
  message: string;
} {
  const { fullPath, normalizedRel } = resolveConfinedWorkspacePath(options.relativePath);
  if (!normalizedRel || !fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${options.relativePath}`);
  }
  const st = fs.statSync(fullPath);

  if (!options.confirmed) {
    recordActivityLog({
      category: 'file',
      action: 'delete_file_requested',
      target: normalizedRel,
      tool_id: 'file_manager',
      status: 'pending_confirmation',
      detail: `Awaiting user confirmation to delete ${normalizedRel} (${st.size} bytes)`,
    });
    return {
      deleted: false,
      requiresConfirmation: true,
      relativePath: normalizedRel,
      sizeBytes: st.size,
      message: `تأكيد مطلوب: هل تريد حذف "${normalizedRel}" (${st.size} بايت) نهائيًا؟`,
    };
  }

  if (st.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: false });
  } else {
    fs.unlinkSync(fullPath);
  }

  recordActivityLog({
    category: 'file',
    action: 'delete_file',
    target: normalizedRel,
    tool_id: 'file_manager',
    status: 'success',
    detail: `Deleted after user confirmation (${st.size} bytes)`,
  });

  return {
    deleted: true,
    relativePath: normalizedRel,
    sizeBytes: st.size,
    message: `تم حذف "${normalizedRel}" بنجاح بعد تأكيدك.`,
  };
}

export function cleanWorkspaceTempFiles(options: {
  paths?: string[];
  confirmed: boolean;
}): {
  cleanedCount: number;
  freedBytes: number;
  requiresConfirmation?: boolean;
  candidates: WorkspaceFileItem[];
  message: string;
} {
  const stats = getWorkspaceStorageStats();
  const targets =
    options.paths && options.paths.length > 0
      ? stats.tempCandidates.filter((c) => options.paths!.includes(c.relativePath))
      : stats.tempCandidates;

  if (targets.length === 0) {
    return {
      cleanedCount: 0,
      freedBytes: 0,
      candidates: [],
      message: 'لا توجد ملفات مؤقتة تحتاج للتنظيف داخل مساحة العمل حاليًا.',
    };
  }

  const totalBytes = targets.reduce((acc, t) => acc + t.sizeBytes, 0);
  if (!options.confirmed) {
    return {
      cleanedCount: 0,
      freedBytes: 0,
      requiresConfirmation: true,
      candidates: targets,
      message: `تم العثور على ${targets.length} ملف مؤقت (${totalBytes} بايت). يرجى التأكيد قبل الحذف.`,
    };
  }

  let cleanedCount = 0;
  let freedBytes = 0;
  for (const item of targets) {
    try {
      const { fullPath } = resolveConfinedWorkspacePath(item.relativePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        cleanedCount++;
        freedBytes += item.sizeBytes;
      }
    } catch {
      // Skip locked/missing entry
    }
  }

  recordActivityLog({
    category: 'file',
    action: 'clean_temp_files',
    target: `${cleanedCount} temp file(s)`,
    tool_id: 'file_manager',
    status: 'success',
    detail: `Cleaned ${cleanedCount} temp files, freed ${freedBytes} bytes`,
  });

  return {
    cleanedCount,
    freedBytes,
    candidates: targets,
    message: `تم تنظيف ${cleanedCount} ملف مؤقت وتحرير ${freedBytes} بايت.`,
  };
}

export function renameWorkspaceFile(options: {
  sourcePath: string;
  newName: string;
}): { sourcePath: string; destPath: string } {
  const src = resolveConfinedWorkspacePath(options.sourcePath);
  if (!src.normalizedRel || !fs.existsSync(src.fullPath)) {
    throw new Error(`Source path not found: ${options.sourcePath}`);
  }
  const cleanName = path.basename(options.newName.trim());
  if (!cleanName) {
    throw new Error('New file name cannot be empty.');
  }
  const parentRel = path.posix.dirname(src.normalizedRel);
  const destRel = parentRel === '.' ? cleanName : `${parentRel}/${cleanName}`;
  const out = transferWorkspaceFile({
    sourcePath: src.normalizedRel,
    destPath: destRel,
    mode: 'move',
  });
  return { sourcePath: out.sourcePath, destPath: out.destPath };
}

function colRefToIndex(colLetters: string): number {
  let idx = 0;
  for (const ch of colLetters.toUpperCase()) {
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseCsvRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === ',' || ch === ';' || ch === '\t') && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

async function parseXlsxRows(buf: Buffer): Promise<{ sheetName: string; rows: string[][] }> {
  const zip = await JSZip.loadAsync(buf);
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings: string[] = [];
  if (sharedStringsFile) {
    const ssXml = await sharedStringsFile.async('text');
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRe.exec(ssXml)) !== null) {
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let combined = '';
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRe.exec(siMatch[1])) !== null) {
        combined += decodeXmlEntities(tMatch[1]);
      }
      sharedStrings.push(combined);
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  if (sheetFiles.length === 0) {
    throw new Error('Invalid XLSX archive: no worksheet XML found.');
  }

  const sheetXml = await zip.file(sheetFiles[0])!.async('text');
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    const rowCells: string[] = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = cellRe.exec(rowMatch[1])) !== null) {
      const attrs = cMatch[1];
      const body = cMatch[2];
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
      const typeMatch = attrs.match(/\bt="([^"]+)"/i);
      const colIdx = refMatch ? colRefToIndex(refMatch[1]) : rowCells.length;
      const cellType = typeMatch?.[1] ?? '';

      let val = '';
      if (cellType === 'inlineStr') {
        const tMatch = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        val = tMatch ? decodeXmlEntities(tMatch[1]) : '';
      } else {
        const vMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const raw = vMatch ? vMatch[1].trim() : '';
        if (cellType === 's') {
          const sIdx = Number(raw);
          val = Number.isInteger(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : raw;
        } else {
          val = decodeXmlEntities(raw);
        }
      }

      while (rowCells.length <= colIdx) rowCells.push('');
      rowCells[colIdx] = val;
    }
    if (rowCells.some((c) => c.trim().length > 0)) {
      rows.push(rowCells);
    }
  }

  return { sheetName: path.basename(sheetFiles[0], '.xml'), rows };
}

export async function analyzeTabularBuffer(options: {
  buffer?: Buffer;
  textContent?: string;
  fileName: string;
}): Promise<DataAnalysisSummary> {
  const lower = options.fileName.toLowerCase();
  let columns: string[] = [];
  let dataRows: Array<Record<string, string | number>> = [];
  let sheetName: string | undefined;

  if (lower.endsWith('.xlsx')) {
    if (!options.buffer) {
      throw new Error('Binary buffer required for XLSX analysis.');
    }
    const parsed = await parseXlsxRows(options.buffer);
    sheetName = parsed.sheetName;
    if (parsed.rows.length > 0) {
      columns = parsed.rows[0].map((c, idx) => c || `Column_${idx + 1}`);
      for (const r of parsed.rows.slice(1)) {
        const obj: Record<string, string | number> = {};
        columns.forEach((col, i) => {
          const raw = r[i] ?? '';
          const num = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
          obj[col] = num;
        });
        dataRows.push(obj);
      }
    }
  } else if (lower.endsWith('.json')) {
    const raw = options.textContent ?? options.buffer?.toString('utf8') ?? '[]';
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const colSet = new Set<string>();
    for (const item of arr) {
      if (item && typeof item === 'object') {
        for (const k of Object.keys(item as Record<string, unknown>)) {
          colSet.add(k);
        }
      }
    }
    columns = Array.from(colSet);
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const obj: Record<string, string | number> = {};
        for (const col of columns) {
          const val = (item as Record<string, unknown>)[col];
          obj[col] =
            typeof val === 'number'
              ? val
              : val === null || val === undefined
              ? ''
              : String(val);
        }
        dataRows.push(obj);
      }
    }
  } else {
    const raw = options.textContent ?? options.buffer?.toString('utf8') ?? '';
    const rows = parseCsvRows(raw);
    if (rows.length > 0) {
      columns = rows[0].map((c, idx) => c || `Column_${idx + 1}`);
      for (const r of rows.slice(1)) {
        const obj: Record<string, string | number> = {};
        columns.forEach((col, i) => {
          const cell = r[i] ?? '';
          const num = cell !== '' && !Number.isNaN(Number(cell)) ? Number(cell) : cell;
          obj[col] = num;
        });
        dataRows.push(obj);
      }
    }
  }

  const numericStats: DataColumnStat[] = [];
  for (const col of columns) {
    const nums: number[] = [];
    let missing = 0;
    for (const row of dataRows) {
      const val = row[col];
      if (val === '' || val === undefined || val === null) {
        missing++;
      } else if (typeof val === 'number' && Number.isFinite(val)) {
        nums.push(val);
      }
    }
    if (nums.length > 0) {
      const sum = nums.reduce((a, b) => a + b, 0);
      numericStats.push({
        column: col,
        count: nums.length,
        missing,
        min: Math.min(...nums),
        max: Math.max(...nums),
        mean: Number((sum / nums.length).toFixed(4)),
        sum: Number(sum.toFixed(4)),
      });
    }
  }

  // Build lightweight chart series if there is at least one numeric stat and label/row series
  let chartSeries: Array<{ label: string; value: number }> | undefined;
  if (numericStats.length > 0 && dataRows.length > 0) {
    const primaryNumCol = numericStats[0].column;
    const labelCol = columns.find((c) => c !== primaryNumCol) ?? columns[0];
    chartSeries = dataRows.slice(0, 12).map((row, idx) => ({
      label: String(row[labelCol] || `#${idx + 1}`).slice(0, 20),
      value: typeof row[primaryNumCol] === 'number' ? (row[primaryNumCol] as number) : 0,
    }));
  }

  return {
    fileName: options.fileName,
    sheetName,
    rowCount: dataRows.length,
    columnCount: columns.length,
    columns,
    numericStats,
    chartSeries,
    sampleRows: dataRows.slice(0, 5),
  };
}

export function formatDataAnalysisAsText(summary: DataAnalysisSummary): string {
  const lines = [
    `File: ${summary.fileName}${summary.sheetName ? ` (${summary.sheetName})` : ''}`,
    `Rows: ${summary.rowCount} | Columns (${summary.columnCount}): ${summary.columns.join(', ')}`,
  ];
  if (summary.numericStats.length > 0) {
    lines.push('Numeric Column Statistics:');
    for (const s of summary.numericStats) {
      lines.push(
        `- ${s.column}: count=${s.count}, missing=${s.missing}, min=${s.min}, max=${s.max}, mean=${s.mean}, sum=${s.sum}`
      );
    }
  }
  if (summary.sampleRows.length > 0) {
    lines.push(`Sample Rows (first ${summary.sampleRows.length}):`);
    lines.push(JSON.stringify(summary.sampleRows, null, 2));
  }
  return lines.join('\n');
}

