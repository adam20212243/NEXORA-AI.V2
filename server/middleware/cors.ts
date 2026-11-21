import type express from 'express';

const WEBVIEW_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  'app://localhost',
]);

const ADMIN_PROTECTED_PREFIXES = ['/api/admin', '/api/system', '/api/knowledge', '/api/search'];

function normalizeOrigin(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || /^(?:MY_|YOUR_|placeholder|<)/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'https:' ||
      parsed.protocol === 'http:' ||
      parsed.protocol === 'capacitor:' ||
      parsed.protocol === 'ionic:' ||
      parsed.protocol === 'app:'
    ) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    // ignore malformed URL
  }
  return null;
}

function parseAllowedOriginsFromEnv(): Set<string> {
  const set = new Set<string>();
  const rawList = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (rawList) {
    for (const part of rawList.split(',')) {
      const normalized = normalizeOrigin(part);
      if (normalized) set.add(normalized);
    }
  }
  for (const envUrl of [process.env.PUBLIC_APP_URL, process.env.APP_URL]) {
    const normalized = normalizeOrigin(envUrl);
    if (normalized) set.add(normalized);
  }
  return set;
}

function isAdminPath(reqPath: string): boolean {
  return ADMIN_PROTECTED_PREFIXES.some((prefix) => reqPath.startsWith(prefix));
}

export function createCorsMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const adminRoute = isAdminPath(req.originalUrl || req.path);

    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With'
    );
    res.setHeader('Access-Control-Max-Age', '86400');

    if (origin) {
      const envAllowlist = parseAllowedOriginsFromEnv();
      const explicitAllowlistConfigured = Boolean(process.env.CORS_ALLOWED_ORIGINS?.trim());
      const host = req.get('host');
      const proto = req.protocol || 'https';
      const sameOrigin = host ? `${proto}://${host}` : null;
      const sameHostAlt = host
        ? proto === 'https'
          ? `http://${host}`
          : `https://${host}`
        : null;

      let allowOrigin: string | null = null;

      if (origin === 'null') {
        // Local file:// WebViews send Origin: null; never allow on authenticated admin routes
        if (!adminRoute && !explicitAllowlistConfigured) {
          allowOrigin = 'null';
        }
      } else {
        const normalized = normalizeOrigin(origin);
        if (normalized) {
          const isSameOrigin = normalized === sameOrigin || normalized === sameHostAlt;
          const isConfiguredOrigin = envAllowlist.has(normalized);
          const isWebViewOrigin = WEBVIEW_ORIGINS.has(normalized);

          if (adminRoute) {
            if (isSameOrigin || isConfiguredOrigin || isWebViewOrigin) {
              allowOrigin = normalized;
            }
          } else if (
            isSameOrigin ||
            isConfiguredOrigin ||
            isWebViewOrigin ||
            !explicitAllowlistConfigured
          ) {
            // Public routes work from any public hosted domain or Android WebView
            // while reflecting the specific validated Origin (never wildcard '*').
            allowOrigin = normalized;
          }
        }
      }

      if (allowOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowOrigin);
      } else if (req.method === 'OPTIONS') {
        res.status(403).json({ error: 'CORS origin not permitted for this endpoint.' });
        return;
      }
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
