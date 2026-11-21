/**
 * NEXORA AI Local Windows Companion Bridge (Optional Local Trusted Component)
 * Listens strictly on 127.0.0.1:48920 and executes ONLY explicitly allowlisted
 * Windows open/close commands after user confirmation. Never uses shell interpolation.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';

const ALLOWED_WINDOWS_APPS = {
  calculator: { command: 'calc.exe', args: [], processName: 'CalculatorApp.exe' },
  settings: { command: 'explorer.exe', args: ['ms-settings:'], processName: 'SystemSettings.exe' },
  notepad: { command: 'notepad.exe', args: [], processName: 'notepad.exe' },
  notes: { command: 'notepad.exe', args: [], processName: 'notepad.exe' },
  vscode: { command: 'code', args: [], processName: 'Code.exe' },
  browser: { command: 'msedge.exe', args: [], processName: 'msedge.exe' },
  google: { command: 'explorer.exe', args: ['https://www.google.com'], processName: 'msedge.exe' },
  spotify: { command: 'explorer.exe', args: ['spotify:'], processName: 'Spotify.exe' },
  camera: { command: 'explorer.exe', args: ['microsoft.windows.camera:'], processName: 'WindowsCamera.exe' },
  excel: { command: 'explorer.exe', args: ['ms-excel:'], processName: 'EXCEL.EXE' },
  word: { command: 'explorer.exe', args: ['ms-word:'], processName: 'WINWORD.EXE' },
  powerpoint: { command: 'explorer.exe', args: ['ms-powerpoint:'], processName: 'POWERPNT.EXE' },
  files: { command: 'explorer.exe', args: [], processName: 'explorer.exe' },
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON request.'));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.end(
      JSON.stringify({
        ok: true,
        platform: 'windows',
        allowlisted: Object.keys(ALLOWED_WINDOWS_APPS),
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/launch') {
    try {
      const parsed = await readJsonBody(req);
      const appId = String(parsed.appId || '');
      const confirmed = Boolean(parsed.confirmed);
      if (!confirmed) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Explicit user confirmation required.' }));
        return;
      }
      const entry = ALLOWED_WINDOWS_APPS[appId];
      if (!entry) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'App is not in the trusted Windows allowlist.' }));
        return;
      }
      const child = spawn(entry.command, entry.args, {
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
      child.unref();
      res.end(JSON.stringify({ launched: true, appId }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid request.' }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/close') {
    try {
      const parsed = await readJsonBody(req);
      const appId = String(parsed.appId || '');
      const confirmed = Boolean(parsed.confirmed);
      if (!confirmed) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Explicit user confirmation required before closing apps.' }));
        return;
      }
      const entry = ALLOWED_WINDOWS_APPS[appId];
      if (!entry || !entry.processName) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'App cannot be closed via allowlisted bridge.' }));
        return;
      }
      const child = spawn('taskkill.exe', ['/IM', entry.processName], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
      child.unref();
      res.end(JSON.stringify({ closed: true, appId, processName: entry.processName }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid request.' }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(48920, '127.0.0.1', () => {
  console.log('[NEXORA Windows Bridge] Listening on http://127.0.0.1:48920');
});
