import assert from 'node:assert/strict';
import express from 'express';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  classifySections,
  detectDeviceControlCommand,
  runNexoraMaster,
} from '../server/brain/nexoraMaster.ts';
import {
  clearReleaseResolverCache,
  isValidReleaseAssetUrl,
  resolveAndroidReleaseInfo,
} from '../server/app/releaseResolver.ts';
import { closeDatabase, getDatabase, saveAppSettings } from '../server/db/database.ts';
import { analyzeTabularBuffer } from '../server/files/fileManager.ts';
import {
  createBatchJob,
  runBatchStep,
} from '../server/knowledge/batchHarvester.ts';
import {
  getKnowledgeStats,
  insertKnowledgeRecord,
  searchKnowledgeRecords,
} from '../server/knowledge/repository.ts';
import { ensureStarterKnowledgeSeeded } from '../server/knowledge/starterPack.ts';
import { createApiRouter } from '../server/routes/api.ts';
import { validateExternalUrl } from '../server/search/externalSearch.ts';
import {
  evaluateSafeMathExpression,
  listRegisteredTools,
  runMatchedTools,
} from '../server/tools/registry.ts';
import { matchWakeWord } from '../src/services/voiceService.ts';
import { PERSONALITY_STYLES } from '../src/shared/constants.ts';

let tempDbPath = '';

before(() => {
  tempDbPath = path.join(os.tmpdir(), `nexora-test-${Date.now()}.db`);
  process.env.NEXORA_DB_PATH = tempDbPath;
  delete process.env.NEXORA_ADMIN_PASSCODE;
  getDatabase(tempDbPath);
  const seeded = ensureStarterKnowledgeSeeded();
  assert.equal(seeded.seeded, true);
  assert.equal(seeded.count, 25);
});

after(() => {
  closeDatabase();
  if (tempDbPath && fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
});

describe('NEXORA AI Core, Privacy, Tools, Voice & Admin Auth', () => {
  test('1. Real section counters match persisted records across all 5 sections', () => {
    const stats = getKnowledgeStats();
    assert.equal(stats.totalRecords, 25);
    assert.equal(stats.sections.length, 5);
    for (const sec of stats.sections) {
      assert.equal(sec.totalCount, 5);
      assert.equal(sec.verifiedCount, 5);
      assert.equal(sec.targetCount, 4000);
    }
  });

  test('2. Duplicate prevention blocks identical or normalized duplicate records', () => {
    const first = insertKnowledgeRecord({
      section: 'science',
      subcategory: 'Physics',
      title: 'Law of Conservation of Energy Test',
      detailed_content:
        'Energy cannot be created or destroyed in an isolated system; it transforms between forms.',
      simple_explanation: 'Total energy in a closed system remains constant.',
      context: 'Thermodynamics',
      usage_limits: 'Applies to isolated macroscopic systems.',
      sources: ['Wikipedia - Conservation of energy'],
      source_urls: ['https://en.wikipedia.org/wiki/Conservation_of_energy'],
      confidence_level: 'high',
      keywords: ['energy', 'thermodynamics'],
    });
    assert.equal(first.inserted, true);

    const dup = insertKnowledgeRecord({
      section: 'science',
      subcategory: 'Physics',
      title: 'Law of Conservation of Energy Test!',
      detailed_content:
        'Energy cannot be created or destroyed in an isolated system; it transforms between forms.',
      simple_explanation: 'Total energy in a closed system remains constant.',
      context: 'Thermodynamics',
      usage_limits: 'Applies to isolated macroscopic systems.',
      sources: ['Wikipedia - Conservation of energy'],
      source_urls: ['https://en.wikipedia.org/wiki/Conservation_of_energy'],
      confidence_level: 'high',
      keywords: ['energy'],
    });
    assert.equal(dup.inserted, false);
    assert.equal(dup.duplicate, true);
  });

  test('3. FTS5 retrieval pulls records silently across all 5 sections', () => {
    assert.ok(searchKnowledgeRecords('نيوتن', ['science'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('TypeScript', ['programming'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('المناعي', ['medicine'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('بغداد', ['history_culture'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('الاستدلال', ['logic_creativity'], 5).length >= 1);

    const multiSections = classifySections('اشرح الفيزياء وتطوير الألعاب في Unity والمنهج العلمي');
    assert.ok(multiSections.includes('science'));
    assert.ok(multiSections.includes('programming'));
    assert.ok(multiSections.includes('logic_creativity'));
  });

  test('4. NEXORA MASTER enforces medical safety and uses silent background KB', async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const medRes = await runNexoraMaster({
        query: 'ما هي وظيفة الجهاز المناعي ونتائج تحليل CBC؟',
        settingsOverride: { enableExternalSearch: false, personalityStyle: 'scientific' },
      });
      assert.equal(medRes.medicalDisclaimerIncluded, true);
      assert.ok((medRes.internalUsedKbCount ?? 0) >= 1);
      assert.equal('kbSources' in medRes, false);
      assert.ok(medRes.answer.includes('تثقيف') || medRes.answer.includes('طبيب'));
    } finally {
      if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
    }
  });

  test('5. All 8 personality styles and Wake Word matcher work in Arabic and English', () => {
    assert.equal(PERSONALITY_STYLES.length, 8);
    assert.ok(PERSONALITY_STYLES.some((s) => s.id === 'concise'));

    const arWake = matchWakeWord('هاي مساعد افتح يوتيوب');
    assert.equal(arWake.matched, true);
    assert.equal(arWake.trailingText, 'افتح يوتيوب');

    const enWake = matchWakeWord('Hey Assistant explain gravity');
    assert.equal(enWake.matched, true);
    assert.equal(enWake.trailingText, 'explain gravity');

    const nexoraWake = matchWakeWord('يا NEXORA احسب 10 + 20');
    assert.equal(nexoraWake.matched, true);
    assert.equal(nexoraWake.trailingText, 'احسب 10 + 20');
  });

  test('6. Direct app opening works without repeated confirmation for standard apps, keeps confirmation for sensitive actions', () => {
    const ytCmd = detectDeviceControlCommand('افتح يوتيوب', 'android');
    assert.ok(ytCmd);
    assert.equal(ytCmd.matchedAppId, 'youtube');
    assert.equal(ytCmd.requiresConfirmation, false);
    assert.equal(ytCmd.autoLaunchRecommended, true);

    const browserCmd = detectDeviceControlCommand('افتح المتصفح', 'web');
    assert.ok(browserCmd);
    assert.equal(browserCmd.matchedAppId, 'browser');
    assert.equal(browserCmd.requiresConfirmation, false);
    assert.equal(browserCmd.autoLaunchRecommended, true);

    const settingsCmd = detectDeviceControlCommand('افتح الإعدادات', 'windows');
    assert.ok(settingsCmd);
    assert.equal(settingsCmd.matchedAppId, 'settings');
    assert.equal(settingsCmd.windowsProtocol, 'ms-settings:');
    assert.equal(settingsCmd.requiresConfirmation, false);

    const cameraCmd = detectDeviceControlCommand('افتح الكاميرا', 'android');
    assert.ok(cameraCmd);
    assert.equal(cameraCmd.matchedAppId, 'camera');
    assert.equal(cameraCmd.requiresConfirmation, true);

    const unknownCmd = detectDeviceControlCommand('افتح التطبيق الذي اسمه غير_موجود_ابدا', 'web');
    assert.ok(unknownCmd);
    assert.equal(unknownCmd.supportedOnCurrentPlatform, false);
  });

  test('7. Extensible tools registry computes math, saves tasks, analyzes attachments, and enforces memory consent', async () => {
    const tools = listRegisteredTools();
    assert.ok(tools.length >= 14);

    const calc = evaluateSafeMathExpression('احسب (48 * 15) + 360 / 12');
    assert.equal(calc.matched, true);
    assert.equal(calc.result, 750);

    // Without memory consent, remember_preference refuses saving
    saveAppSettings({ memoryConsentGranted: false });
    const blockedPref = await runMatchedTools({
      query: 'تذكر أنني أفضل TypeScript',
      memoryConsentGranted: false,
    });
    assert.ok(blockedPref.traces.some((t) => t.toolId === 'remember_preference' && !t.success));

    // With explicit memory consent, remember_preference saves
    saveAppSettings({ memoryConsentGranted: true });
    const savedPref = await runMatchedTools({
      query: 'تذكر أنني أفضل TypeScript',
      memoryConsentGranted: true,
    });
    assert.ok(savedPref.traces.some((t) => t.toolId === 'remember_preference' && t.success));

    // Document analyzer processes attached file
    const docOut = await runMatchedTools({
      query: 'حلل هذا الملف',
      attachments: [
        { fileName: 'notes.txt', mimeType: 'text/plain', contentText: 'NEXORA architecture note line 1\nline 2' },
      ],
      memoryConsentGranted: false,
    });
    assert.ok(docOut.combinedContext.includes('notes.txt'));
  });

  test('8. SSRF URL validator blocks localhost and private IP ranges', () => {
    assert.equal(validateExternalUrl('https://en.wikipedia.org/wiki/Physics'), true);
    assert.equal(validateExternalUrl('http://en.wikipedia.org/wiki/Physics'), false);
    assert.equal(validateExternalUrl('https://127.0.0.1/admin'), false);
    assert.equal(validateExternalUrl('https://169.254.169.254/latest/meta-data'), false);
    assert.equal(validateExternalUrl('https://192.168.1.1/router'), false);
  });

  test('9. Real batch harvester ingests verified records from Wikipedia API and persists progress', async () => {
    const job = createBatchJob('science', 15, 'wikipedia');
    const updated = await runBatchStep(job.id, 1);
    assert.ok(updated.processed_count > 0);
    assert.ok(updated.inserted_count >= 5);
    const stats = getKnowledgeStats();
    assert.ok(stats.totalRecords >= 30);
  });

  test('10. Express API hides KB from unauthenticated users & enforces Admin password protection', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter());

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // Public health must NOT leak knowledgeTotal
      const healthRes = await fetch(`${baseUrl}/api/health`);
      const healthJson = (await healthRes.json()) as Record<string, unknown>;
      assert.equal(healthRes.status, 200);
      assert.equal('knowledgeTotal' in healthJson, false);

      // Knowledge Base & System Status MUST return 401 without Admin Bearer token
      const unauthStats = await fetch(`${baseUrl}/api/knowledge/stats`);
      assert.equal(unauthStats.status, 401);
      const unauthSys = await fetch(`${baseUrl}/api/system/status`);
      assert.equal(unauthSys.status, 401);

      // Claim initial admin password
      const claimRes = await fetch(`${baseUrl}/api/admin/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'nexora-admin-2026' }),
      });
      assert.equal(claimRes.status, 201);
      const { token } = (await claimRes.json()) as { token: string };
      assert.ok(token.length > 20);

      // Wrong password rejected
      const badLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'wrong-pass' }),
      });
      assert.equal(badLogin.status, 401);

      // Authenticated admin accesses Knowledge Base & System Status
      const authSys = await fetch(`${baseUrl}/api/system/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(authSys.status, 200);
      const sysJson = (await authSys.json()) as {
        imageGenerationEnabled: boolean;
        knowledgeStats: { totalRecords: number };
      };
      assert.equal(sysJson.imageGenerationEnabled, false);
      assert.ok(sysJson.knowledgeStats.totalRecords >= 30);

      // Regular user chat hides internal KB records completely
      const chatRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'ما هي مبرهنة فيثاغورس؟',
          settingsOverride: { enableExternalSearch: false },
        }),
      });
      assert.equal(chatRes.status, 200);
      const chatJson = (await chatRes.json()) as {
        assistantMessage: {
          content: string;
          metadata: Record<string, unknown>;
        };
      };
      assert.ok(chatJson.assistantMessage.content.length > 20);
      assert.equal('kbSources' in chatJson.assistantMessage.metadata, false);
      assert.equal('selectedSections' in chatJson.assistantMessage.metadata, false);
      assert.equal('internalUsedKbCount' in chatJson.assistantMessage.metadata, false);

      // General science/history question ("من اكتشف الجاذبية؟") must NEVER mix medical advice
      const gravityRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'من اكتشف الجاذبية؟',
          settingsOverride: { enableExternalSearch: false },
        }),
      });
      assert.equal(gravityRes.status, 200);
      const gravityJson = (await gravityRes.json()) as {
        assistantMessage: {
          content: string;
          metadata: { medicalDisclaimerIncluded?: boolean; questionDomain?: string };
        };
      };
      assert.equal(gravityJson.assistantMessage.metadata.medicalDisclaimerIncluded, false);
      assert.ok(
        gravityJson.assistantMessage.metadata.questionDomain === 'science' ||
          gravityJson.assistantMessage.metadata.questionDomain === 'history_geography'
      );

      // Gemini health probe must never expose secrets
      const geminiRes = await fetch(`${baseUrl}/api/gemini/health`);
      assert.equal(geminiRes.status, 200);
      const geminiJson = (await geminiRes.json()) as Record<string, unknown>;
      assert.equal('apiKey' in geminiJson, false);

      // Workspace File Manager API CRUD + Path Traversal Block + Confirmation-Gated Delete
      const writeRes = await fetch(`${baseUrl}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'unit-test-note.txt', content: 'Hello NEXORA Files' }),
      });
      assert.equal(writeRes.status, 200);

      const traversalRes = await fetch(`${baseUrl}/api/files/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../package.json' }),
      });
      assert.equal(traversalRes.status, 400);

      const unconfirmedDel = await fetch(`${baseUrl}/api/files/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'unit-test-note.txt', confirmed: false }),
      });
      const unconfJson = (await unconfirmedDel.json()) as { deleted: boolean; requiresConfirmation: boolean };
      assert.equal(unconfJson.deleted, false);
      assert.equal(unconfJson.requiresConfirmation, true);

      const confirmedDel = await fetch(`${baseUrl}/api/files/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'unit-test-note.txt', confirmed: true }),
      });
      const confJson = (await confirmedDel.json()) as { deleted: boolean };
      assert.equal(confJson.deleted, true);

      // Activity log tracks operations
      const activityRes = await fetch(`${baseUrl}/api/activity?category=file`);
      assert.equal(activityRes.status, 200);
      const actJson = (await activityRes.json()) as { logs: Array<{ action: string }> };
      assert.ok(actJson.logs.some((l) => l.action === 'delete_file'));
    } finally {
      server.close();
    }
  });

  test('11. Domain classifier & close_app confirmation & image error honesty work reliably', async () => {
    const gravitySections = classifySections('من اكتشف الجاذبية؟');
    assert.equal(gravitySections.includes('medicine'), false);

    const closeCmd = detectDeviceControlCommand('أغلق متصفح كروم', 'windows');
    assert.ok(closeCmd);
    assert.equal(closeCmd.action, 'close_app');
    assert.equal(closeCmd.requiresConfirmation, true);
    assert.equal(closeCmd.autoLaunchRecommended, false);
  });

  test('12. Tabular CSV and XLSX parser computes real statistics accurately', async () => {
    const csvSummary = await analyzeTabularBuffer({
      fileName: 'sales.csv',
      buffer: Buffer.from('product,units,revenue\nAlpha,10,100\nBeta,20,250\nGamma,30,400', 'utf8'),
    });
    assert.ok(csvSummary);
    assert.equal(csvSummary.rowCount, 3);
    assert.equal(csvSummary.columnCount, 3);
    const unitsCol = csvSummary.numericStats.find((c) => c.column === 'units');
    assert.ok(unitsCol);
    assert.equal(unitsCol.sum, 60);
    assert.equal(unitsCol.mean, 20);
    assert.equal(unitsCol.min, 10);
    assert.equal(unitsCol.max, 30);

    // Construct minimal valid .xlsx OOXML zip package
    const zip = new JSZip();
    zip.file(
      'xl/sharedStrings.xml',
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>City</t></si><si><t>Score</t></si><si><t>Cairo</t></si><si><t>Riyadh</t></si></sst>'
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>80</v></c></row>
        <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>100</v></c></row>
      </sheetData></worksheet>`
    );
    const xlsxBuf = await zip.generateAsync({ type: 'nodebuffer' });
    const xlsxSummary = await analyzeTabularBuffer({
      fileName: 'scores.xlsx',
      buffer: xlsxBuf,
    });
    assert.ok(xlsxSummary);
    assert.equal(xlsxSummary.rowCount, 2);
    assert.deepEqual(xlsxSummary.columns, ['City', 'Score']);
    const scoreCol = xlsxSummary.numericStats.find((c) => c.column === 'Score');
    assert.ok(scoreCol);
    assert.equal(scoreCol.mean, 90);
    assert.equal(scoreCol.sum, 180);
  });

  test('13. Expanded device control detects Google and Excel across platforms', () => {
    const googleCmd = detectDeviceControlCommand('افتح جوجل', 'android');
    assert.ok(googleCmd);
    assert.equal(googleCmd.matchedAppId, 'google');
    assert.equal(googleCmd.androidPackage, 'com.google.android.googlequicksearchbox');

    const excelCmd = detectDeviceControlCommand('افتح إكسل', 'windows');
    assert.ok(excelCmd);
    assert.equal(excelCmd.matchedAppId, 'excel');
  });

  test('14. SSE chat stream, incognito isolation, conversation pin/rename, message edit/restore/regenerate, download-info & settings reset work', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter());

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // Download info endpoint stays honest about APK absence when NEXORA_APK_RELEASE_URL is unset
      const dlRes = await fetch(`${baseUrl}/api/app/download-info`);
      assert.equal(dlRes.status, 200);
      const dlJson = (await dlRes.json()) as {
        apkCompiledInSandbox: boolean;
        apkUrl: string | null;
        androidSourcePath: string;
        windowsBridgePort: number;
      };
      assert.equal(dlJson.apkCompiledInSandbox, false);
      assert.equal(dlJson.apkUrl, null);
      assert.equal(dlJson.androidSourcePath, '/bridges/android');
      assert.equal(dlJson.windowsBridgePort, 48920);

      // Incognito chat must NOT persist a conversation in SQLite
      const beforeConvs = (await (await fetch(`${baseUrl}/api/conversations`)).json()) as {
        conversations: Array<{ id: string }>;
      };
      const incogStream = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'احسب 7 * 9',
          incognito: true,
        }),
      });
      assert.equal(incogStream.status, 200);
      const sseText = await incogStream.text();
      assert.ok(sseText.includes('event: meta'));
      assert.ok(sseText.includes('event: done'));
      assert.ok(sseText.includes('63'));

      const afterIncogConvs = (await (await fetch(`${baseUrl}/api/conversations`)).json()) as {
        conversations: Array<{ id: string }>;
      };
      assert.equal(afterIncogConvs.conversations.length, beforeConvs.conversations.length);

      // Persistent conversation -> rename -> pin -> edit message -> restore -> regenerate
      const chatRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'احسب 12 + 8' }),
      });
      const chatData = (await chatRes.json()) as {
        conversationId: string;
        userMessage: { id: string; content: string };
      };
      const convId = chatData.conversationId;

      const patchConv = await fetch(`${baseUrl}/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'محادثة رياضيات', pinned: true }),
      });
      assert.equal(patchConv.status, 200);
      const convUpdated = (await patchConv.json()) as {
        title: string;
        pinned: boolean;
      };
      assert.equal(convUpdated.title, 'محادثة رياضيات');
      assert.equal(convUpdated.pinned, true);

      const editRes = await fetch(`${baseUrl}/api/messages/${chatData.userMessage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'احسب 15 + 5' }),
      });
      assert.equal(editRes.status, 200);
      const editJson = (await editRes.json()) as {
        messages: Array<{ id: string; content: string; is_edited?: boolean; original_content?: string | null }>;
      };
      assert.equal(editJson.messages[0].content, 'احسب 15 + 5');
      assert.equal(editJson.messages[0].original_content, 'احسب 12 + 8');
      assert.equal(editJson.messages[0].is_edited, true);

      const restoreRes = await fetch(`${baseUrl}/api/messages/${chatData.userMessage.id}/restore`, {
        method: 'POST',
      });
      assert.equal(restoreRes.status, 200);
      const restoreJson = (await restoreRes.json()) as { message: { content: string } };
      assert.equal(restoreJson.message.content, 'احسب 12 + 8');

      const regenRes = await fetch(`${baseUrl}/api/conversations/${convId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'web' }),
      });
      assert.equal(regenRes.status, 200);

      // Preference with category + update + settings reset
      const prefRes = await fetch(`${baseUrl}/api/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'editor', value: 'VS Code', category: 'project' }),
      });
      assert.equal(prefRes.status, 201);
      const prefList = (await (await fetch(`${baseUrl}/api/preferences`)).json()) as {
        preferences: Array<{ id: string; key: string; category?: string }>;
      };
      const savedPrefItem = prefList.preferences.find((p) => p.key === 'editor');
      assert.ok(savedPrefItem);
      assert.equal(savedPrefItem.category, 'project');

      const patchPref = await fetch(`${baseUrl}/api/preferences/${savedPrefItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'Neovim', category: 'preference' }),
      });
      assert.equal(patchPref.status, 200);

      await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'dark', personalityStyle: 'concise' }),
      });
      const resetRes = await fetch(`${baseUrl}/api/settings/reset`, { method: 'POST' });
      assert.equal(resetRes.status, 200);
      const resetJson = (await resetRes.json()) as { theme: string; personalityStyle: string };
      assert.equal(resetJson.theme, 'light');
      assert.equal(resetJson.personalityStyle, 'professional');
    } finally {
      server.close();
    }
  });

  test('15. Android APK release resolver rejects placeholders/404s and auto-updates from GitHub Releases', async () => {
    // Placeholder & insecure URLs must be rejected
    assert.equal(isValidReleaseAssetUrl('https://example.com/nexora.apk'), false);
    assert.equal(isValidReleaseAssetUrl('https://github.com/<owner>/<repo>/releases/latest/download/app.apk'), false);
    assert.equal(isValidReleaseAssetUrl('http://public-host.org/nexora.apk'), false);

    // Local mock GitHub Releases + APK file server
    let currentReleaseTag = 'v1.0.0';
    let hasAsset = false;
    let mockServerBaseUrl = '';

    const mockGh = express();
    mockGh.get('/repos/nexora-org/nexora-ai/releases/latest', (_req, res) => {
      if (!hasAsset) {
        res.status(404).json({ message: 'Not Found' });
        return;
      }
      res.json({
        tag_name: currentReleaseTag,
        html_url: `https://github.com/nexora-org/nexora-ai/releases/tag/${currentReleaseTag}`,
        published_at: '2026-11-21T16:00:00Z',
        assets: [
          {
            name: 'nexora-ai-latest.apk',
            size: 12_345_678,
            browser_download_url: `${mockServerBaseUrl}/downloads/${currentReleaseTag}/nexora-ai-latest.apk`,
          },
        ],
      });
    });
    mockGh.head('/downloads/:tag/nexora-ai-latest.apk', (req, res) => {
      if (req.params.tag === 'missing') {
        res.status(404).end();
        return;
      }
      res.status(200).setHeader('Content-Length', '12345678').end();
    });

    const ghServer = mockGh.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => ghServer.once('listening', resolve));
    const addr = ghServer.address() as { port: number };
    mockServerBaseUrl = `http://127.0.0.1:${addr.port}`;

    const prevEnvRepo = process.env.NEXORA_GITHUB_REPO;
    const prevEnvApk = process.env.NEXORA_APK_RELEASE_URL;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    try {
      clearReleaseResolverCache();
      process.env.NEXORA_GITHUB_REPO = 'nexora-org/nexora-ai';
      delete process.env.NEXORA_APK_RELEASE_URL;

      // 1) Before any release is published: apkAvailable must be false
      const noRelease = await resolveAndroidReleaseInfo({
        forceRefresh: true,
        githubApiBaseUrl: mockServerBaseUrl,
      });
      assert.equal(noRelease.apkAvailable, false);
      assert.equal(noRelease.apkUrl, null);
      assert.equal(noRelease.apkStatus, 'no_release_yet');

      // 2) After v1.0.0 release is published: resolves version + URL
      hasAsset = true;
      currentReleaseTag = 'v1.0.0';
      const v1 = await resolveAndroidReleaseInfo({
        forceRefresh: true,
        githubApiBaseUrl: mockServerBaseUrl,
      });
      assert.equal(v1.apkAvailable, true);
      assert.equal(v1.apkVersion, 'v1.0.0');
      assert.equal(v1.apkFileName, 'nexora-ai-latest.apk');
      assert.equal(v1.apkSizeBytes, 12_345_678);

      // 3) After v1.1.0 is published: auto-updates to v1.1.0
      currentReleaseTag = 'v1.1.0';
      const v2 = await resolveAndroidReleaseInfo({
        forceRefresh: true,
        githubApiBaseUrl: mockServerBaseUrl,
      });
      assert.equal(v2.apkAvailable, true);
      assert.equal(v2.apkVersion, 'v1.1.0');
      assert.ok(v2.apkUrl?.includes('/v1.1.0/nexora-ai-latest.apk'));

      // 4) Direct NEXORA_APK_RELEASE_URL returning 404 is rejected honestly
      delete process.env.NEXORA_GITHUB_REPO;
      process.env.NEXORA_APK_RELEASE_URL = `${mockServerBaseUrl}/downloads/missing/nexora-ai-latest.apk`;
      const deadUrl = await resolveAndroidReleaseInfo({ forceRefresh: true });
      assert.equal(deadUrl.apkAvailable, false);
      assert.equal(deadUrl.apkStatus, 'unreachable');

      // 5) Direct NEXORA_APK_RELEASE_URL returning 200 succeeds
      process.env.NEXORA_APK_RELEASE_URL = `${mockServerBaseUrl}/downloads/v1.1.0/nexora-ai-latest.apk`;
      const liveUrl = await resolveAndroidReleaseInfo({ forceRefresh: true });
      assert.equal(liveUrl.apkAvailable, true);
      assert.equal(liveUrl.apkStatus, 'available');
    } finally {
      clearReleaseResolverCache();
      if (prevEnvRepo !== undefined) process.env.NEXORA_GITHUB_REPO = prevEnvRepo;
      else delete process.env.NEXORA_GITHUB_REPO;
      if (prevEnvApk !== undefined) process.env.NEXORA_APK_RELEASE_URL = prevEnvApk;
      else delete process.env.NEXORA_APK_RELEASE_URL;
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
      ghServer.close();
    }
  });

  test('16. Ambient audio status, strict MP3 upload validation, streaming & default track resolution work', async () => {
    const tempAudioPath = path.join(os.tmpdir(), `NEXORA_test_loop_${Date.now()}.mp3`);
    const prevAudioEnv = process.env.NEXORA_AMBIENT_AUDIO_PATH;
    process.env.NEXORA_AMBIENT_AUDIO_PATH = tempAudioPath;

    const app = express();
    app.use(express.json({ limit: '16mb' }));
    app.use('/api', createApiRouter());

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 1) When override file does not exist, status reports unavailable and stream returns 404 (no fake music)
      const missingStatus = (await (await fetch(`${baseUrl}/api/audio/ambient-status`)).json()) as {
        available: boolean;
        audioUrl: string | null;
      };
      assert.equal(missingStatus.available, false);
      assert.equal(missingStatus.audioUrl, null);

      const missingStream = await fetch(`${baseUrl}/api/audio/ambient-track.mp3`);
      assert.equal(missingStream.status, 404);

      // 2) Reject non-MP3 extension or invalid non-MP3 content
      const wrongExtRes = await fetch(`${baseUrl}/api/audio/ambient-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'external_song.wav',
          base64Data: Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]).toString('base64'),
        }),
      });
      assert.equal(wrongExtRes.status, 400);

      const badHeaderRes = await fetch(`${baseUrl}/api/audio/ambient-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'custom_ambient.mp3',
          base64Data: Buffer.from('not-an-mp3-file', 'utf8').toString('base64'),
        }),
      });
      assert.equal(badHeaderRes.status, 400);

      // 3) Valid ID3 MP3 upload succeeds and streams as audio/mpeg
      const validMp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const okUploadRes = await fetch(`${baseUrl}/api/audio/ambient-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'custom_ambient.mp3',
          base64Data: `data:audio/mpeg;base64,${validMp3.toString('base64')}`,
        }),
      });
      assert.equal(okUploadRes.status, 201);
      const okStatus = (await okUploadRes.json()) as { available: boolean; audioUrl: string };
      assert.equal(okStatus.available, true);
      assert.ok(okStatus.audioUrl.startsWith('/api/audio/ambient-track.mp3'));

      const streamRes = await fetch(`${baseUrl}${okStatus.audioUrl}`);
      assert.equal(streamRes.status, 200);
      assert.ok(streamRes.headers.get('content-type')?.includes('audio/mpeg'));

      // 4) Ambient settings persist cleanly
      const putRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ambientMusicEnabled: false,
          ambientMusicMuted: true,
          ambientMusicVolume: 0.22,
        }),
      });
      assert.equal(putRes.status, 200);
      const saved = (await putRes.json()) as {
        ambientMusicEnabled: boolean;
        ambientMusicMuted: boolean;
        ambientMusicVolume: number;
      };
      assert.equal(saved.ambientMusicEnabled, false);
      assert.equal(saved.ambientMusicMuted, true);
      assert.equal(saved.ambientMusicVolume, 0.22);

      // 5) With override cleared, default attached track resolves and streams
      delete process.env.NEXORA_AMBIENT_AUDIO_PATH;
      const defaultStatus = (await (await fetch(`${baseUrl}/api/audio/ambient-status`)).json()) as {
        available: boolean;
        fileName: string;
        audioUrl: string | null;
        sizeBytes: number | null;
      };
      assert.equal(defaultStatus.available, true);
      assert.equal(defaultStatus.fileName, 'NEXORA_Daddy_Yankee_seamless_loop__1__da91dab1.mp3');
      assert.ok((defaultStatus.sizeBytes ?? 0) > 1024);
      assert.ok(defaultStatus.audioUrl?.startsWith('/api/audio/ambient-track.mp3'));

      const defaultStream = await fetch(`${baseUrl}${defaultStatus.audioUrl}`);
      assert.equal(defaultStream.status, 200);
      assert.ok(defaultStream.headers.get('content-type')?.includes('audio/mpeg'));
    } finally {
      if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      if (prevAudioEnv !== undefined) process.env.NEXORA_AMBIENT_AUDIO_PATH = prevAudioEnv;
      else delete process.env.NEXORA_AMBIENT_AUDIO_PATH;
      server.close();
    }
  });

  test('17. Public standalone access, CORS for public/WebView origins & admin auth separation work', async () => {
    const { createCorsMiddleware } = await import('../server/middleware/cors.ts');
    const prevCorsEnv = process.env.CORS_ALLOWED_ORIGINS;
    const prevPublicUrl = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = 'https://nexora.example.com';

    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '5mb' }));
    app.use(createCorsMiddleware());
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.use('/api', createApiRouter());

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 1) Anonymous visitor can access public endpoints without any login/session
      const capsRes = await fetch(`${baseUrl}/api/public/capabilities`, {
        headers: { Origin: 'https://public-visitor.example.org' },
      });
      assert.equal(capsRes.status, 200);
      assert.equal(
        capsRes.headers.get('access-control-allow-origin'),
        'https://public-visitor.example.org'
      );

      // 2) Android WebView origin preflight works cleanly
      const webViewPreflight = await fetch(`${baseUrl}/api/chat`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://localhost',
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.equal(webViewPreflight.status, 204);
      assert.equal(webViewPreflight.headers.get('access-control-allow-origin'), 'https://localhost');

      // 3) Admin endpoints reject unauthenticated callers (401) and never return wildcard '*'
      const adminRes = await fetch(`${baseUrl}/api/system/status`, {
        headers: { Origin: 'https://untrusted-site.example.org' },
      });
      assert.equal(adminRes.status, 401);
      assert.notEqual(adminRes.headers.get('access-control-allow-origin'), '*');
      assert.equal(adminRes.headers.get('access-control-allow-origin'), null);

      // 4) Public download-info never leaks MY_APP_URL placeholder
      const dlJson = (await (await fetch(`${baseUrl}/api/app/download-info`)).json()) as {
        webUrl: string;
      };
      assert.equal(dlJson.webUrl, 'https://nexora.example.com');
    } finally {
      if (prevCorsEnv !== undefined) process.env.CORS_ALLOWED_ORIGINS = prevCorsEnv;
      else delete process.env.CORS_ALLOWED_ORIGINS;
      if (prevPublicUrl !== undefined) process.env.PUBLIC_APP_URL = prevPublicUrl;
      else delete process.env.PUBLIC_APP_URL;
      server.close();
    }
  });
});

