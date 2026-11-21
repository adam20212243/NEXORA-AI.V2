import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from './server/db/database.ts';
import { ensureStarterKnowledgeSeeded } from './server/knowledge/starterPack.ts';
import { createCorsMiddleware } from './server/middleware/cors.ts';
import { createApiRouter } from './server/routes/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const raw = process.env.PORT?.trim();
  if (!raw) return 3000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 3000;
}

function resolveDistDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(__dirname, 'dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

async function startServer() {
  const db = getDatabase();
  const seedInfo = ensureStarterKnowledgeSeeded();
  if (seedInfo.seeded) {
    console.log(`[NEXORA] Seeded ${seedInfo.count} foundational verified knowledge records.`);
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20mb' }));
  app.use(createCorsMiddleware());

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, service: 'NEXORA AI' });
  });

  app.use('/api', createApiRouter());

  const port = resolvePort();
  const host = '0.0.0.0';
  const distDir = resolveDistDir();
  const isExplicitDev =
    process.env.NODE_ENV === 'development' ||
    process.env.npm_lifecycle_event === 'dev';
  const isProd = process.env.NODE_ENV === 'production' || (Boolean(distDir) && !isExplicitDev);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (distDir) {
    app.use(express.static(distDir, { index: 'index.html' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    console.warn('[NEXORA AI] Production mode active, but dist/index.html was not found. Run "npm run build" first.');
    app.get('/', (_req, res) => {
      res.status(200).json({
        ok: true,
        service: 'NEXORA AI',
        warning: 'Frontend bundle not built yet (dist/index.html missing).',
      });
    });
  }

  const server = app.listen(port, host, () => {
    console.log(
      `[NEXORA AI] Server started in ${isProd ? 'production' : 'development'} mode on port ${port} (http://${host}:${port})`
    );
    if (isProd && distDir) {
      console.log(`[NEXORA AI] Serving Vite production build from ${distDir}`);
    }
    const publicUrl =
      process.env.PUBLIC_APP_URL?.trim() ||
      (process.env.APP_URL?.trim() && process.env.APP_URL.trim() !== 'MY_APP_URL'
        ? process.env.APP_URL.trim()
        : '');
    if (publicUrl) {
      console.log(`[NEXORA AI] Public URL configured: ${publicUrl}`);
    }
    console.log(`[NEXORA AI] Database active (${db ? 'connected' : 'unavailable'})`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[NEXORA AI] Server failed to bind ${host}:${port}:`, err.message);
    process.exit(1);
  });

  return server;
}

startServer().catch((err) => {
  console.error('[NEXORA AI] Fatal startup error:', err);
  process.exit(1);
});
