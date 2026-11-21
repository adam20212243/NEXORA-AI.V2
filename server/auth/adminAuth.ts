import crypto from 'node:crypto';
import type express from 'express';
import { getDatabase, logAuditEvent } from '../db/database.ts';

const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  return process.env.SESSION_SECRET?.trim() || EPHEMERAL_SIGNING_KEY;
}

function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyScryptHash(passcode: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(passcode, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function getEnvPasscode(): string | null {
  const raw = process.env.NEXORA_ADMIN_PASSCODE?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function getAdminSetupState(): {
  needsClaim: boolean;
  envPasscodeActive: boolean;
} {
  const envPass = getEnvPasscode();
  if (envPass) {
    return { needsClaim: false, envPasscodeActive: true };
  }
  const db = getDatabase();
  const row = db.prepare('SELECT id FROM admin_auth WHERE id = 1').get() as
    | { id: number }
    | undefined;
  return {
    needsClaim: !row,
    envPasscodeActive: false,
  };
}

export function claimAdminPasscode(passcode: string): {
  ok: boolean;
  token?: string;
  error?: string;
} {
  if (getEnvPasscode()) {
    return { ok: false, error: 'Admin passcode is managed via server environment.' };
  }
  if (!passcode || passcode.length < 6) {
    return { ok: false, error: 'Admin password must be at least 6 characters.' };
  }
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM admin_auth WHERE id = 1').get() as
    | { id: number }
    | undefined;
  if (existing) {
    return { ok: false, error: 'Admin password has already been claimed.' };
  }

  const hash = hashPasscode(passcode);
  db.prepare('INSERT INTO admin_auth (id, password_hash, claimed_at) VALUES (1, ?, ?)').run(
    hash,
    new Date().toISOString()
  );
  logAuditEvent('ADMIN_CLAIMED', 'Initial administrator credential configured.');
  return { ok: true, token: issueAdminToken() };
}

export function verifyAdminLogin(passcode: string): {
  ok: boolean;
  token?: string;
  error?: string;
} {
  const envPass = getEnvPasscode();
  if (envPass) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPass);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      logAuditEvent('ADMIN_LOGIN', 'Admin authenticated via environment passcode.');
      return { ok: true, token: issueAdminToken() };
    }
    return { ok: false, error: 'Invalid administrator password.' };
  }

  const db = getDatabase();
  const row = db.prepare('SELECT password_hash FROM admin_auth WHERE id = 1').get() as
    | { password_hash: string }
    | undefined;
  if (!row) {
    return { ok: false, error: 'Administrator account not initialized yet.' };
  }
  if (!verifyScryptHash(passcode, row.password_hash)) {
    return { ok: false, error: 'Invalid administrator password.' };
  }
  logAuditEvent('ADMIN_LOGIN', 'Admin authenticated via stored credential.');
  return { ok: true, token: issueAdminToken() };
}

export function issueAdminToken(): string {
  const exp = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp, nonce })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    if (decoded.role !== 'admin' || !decoded.exp || decoded.exp < Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

export function requireAdminAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const token = extractBearerToken(req);
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Administrator authentication required.' });
    return;
  }
  next();
}
