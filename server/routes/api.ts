import crypto from 'node:crypto';
import express from 'express';
import {
  KNOWLEDGE_SECTIONS,
  PERSONALITY_STYLES,
} from '../../src/shared/constants.ts';
import { SUPPORTED_APPS } from '../../src/shared/supportedApps.ts';
import type {
  ActivityLogEntry,
  AppSettings,
  AttachedDocumentInput,
  ChatMessage,
  Conversation,
  KnowledgeRecordInput,
  KnowledgeSectionId,
  ReviewStatus,
  UserTaskItem,
} from '../../src/shared/types.ts';
import {
  clearReleaseResolverCache,
  resolveAndroidReleaseInfo,
} from '../app/releaseResolver.ts';
import {
  AMBIENT_FILE_NAME,
  getAmbientAudioStatus,
  resolveAmbientAudioPath,
  saveUploadedAmbientAudio,
} from '../audio/ambientAudio.ts';
import {
  claimAdminPasscode,
  extractBearerToken,
  getAdminSetupState,
  requireAdminAuth,
  verifyAdminLogin,
  verifyAdminToken,
} from '../auth/adminAuth.ts';
import {
  detectDeviceControlCommand,
  runNexoraMaster,
  streamNexoraMaster,
} from '../brain/nexoraMaster.ts';
import {
  clearActivityLogs,
  clearRecentFiles,
  clearSearchHistory,
  createDatabaseBackup,
  createUserTask,
  deleteActivityLogById,
  deleteSearchHistoryById,
  deleteUserPreference,
  deleteUserTask,
  editMessageAndTrimFollowing,
  getAppSettings,
  getConversationMessages,
  getDatabase,
  listActivityLogs,
  listRecentFiles,
  listSearchHistory,
  listUserPreferences,
  listUserTasks,
  logAuditEvent,
  recordActivityLog,
  resetAppSettings,
  restoreOriginalMessage,
  saveAppSettings,
  updateConversation,
  updateUserPreferenceById,
  updateUserTaskStatus,
  upsertUserPreference,
} from '../db/database.ts';
import {
  cleanWorkspaceTempFiles,
  deleteWorkspaceFile,
  getWorkspaceStorageStats,
  listWorkspaceFiles,
  readWorkspaceFile,
  renameWorkspaceFile,
  transferWorkspaceFile,
  writeWorkspaceFile,
} from '../files/fileManager.ts';
import {
  createBatchJob,
  listBatchJobs,
  resumeIncompleteBatches,
  runBatchStep,
} from '../knowledge/batchHarvester.ts';
import {
  deleteKnowledgeRecord,
  exportKnowledgeRecords,
  getKnowledgeStats,
  insertKnowledgeBatch,
  insertKnowledgeRecord,
  listKnowledgeRecords,
  updateKnowledgeRecord,
} from '../knowledge/repository.ts';
import { createGeminiClient, getProvidersStatus, ProviderError } from '../providers/manager.ts';
import { browseAndReadWebPage, runExternalSearch } from '../search/externalSearch.ts';
import { listRegisteredTools } from '../tools/registry.ts';

const VALID_SECTIONS = new Set<KnowledgeSectionId>(KNOWLEDGE_SECTIONS.map((s) => s.id));

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Minimal public health endpoint (no internal KB counts or details exposed)
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'NEXORA AI',
      timestamp: new Date().toISOString(),
    });
  });

  // Public Capabilities & Safe Runtime Info (no internal KB/DB/audit details)
  router.get('/public/capabilities', (_req, res) => {
    const settings = getAppSettings();
    const providers = getProvidersStatus();
    res.json({
      settings,
      providers,
      tools: listRegisteredTools(),
      supportedAppsCount: SUPPORTED_APPS.length,
      imageGenerationEnabled: false,
    });
  });

  // Honest Multi-Platform Download & Verified GitHub Release Resolver
  router.get('/app/download-info', async (req, res) => {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    if (forceRefresh) {
      clearReleaseResolverCache();
    }
    const release = await resolveAndroidReleaseInfo({ forceRefresh });
    const configuredWebUrl = [process.env.PUBLIC_APP_URL, process.env.APP_URL]
      .map((v) => v?.trim() || '')
      .find((v) => v.length > 0 && !/^(?:MY_|YOUR_|<)/i.test(v));
    const requestHost = req.get('host')?.trim();
    const derivedWebUrl = requestHost ? `${req.protocol || 'https'}://${requestHost}` : '';

    res.json({
      webUrl: configuredWebUrl || derivedWebUrl,
      apkUrl: release.apkUrl,
      apkAvailable: release.apkAvailable,
      apkStatus: release.apkStatus,
      apkSource: release.apkSource,
      githubRepo: release.githubRepo,
      apkVersion: release.apkVersion,
      apkFileName: release.apkFileName,
      apkSizeBytes: release.apkSizeBytes,
      apkPublishedAt: release.apkPublishedAt,
      releasePageUrl: release.releasePageUrl,
      statusMessage: release.statusMessage,
      checkedAt: release.checkedAt,
      apkCompiledInSandbox: false,
      androidSourcePath: '/bridges/android',
      windowsBridgePort: 48920,
    });
  });

  // Ambient Background Music Status, Streaming & Verified File Upload
  router.get('/audio/ambient-status', (_req, res) => {
    res.json(getAmbientAudioStatus());
  });

  const serveAmbientAudio = (_req: express.Request, res: express.Response) => {
    const filePath = resolveAmbientAudioPath();
    if (!filePath) {
      res.status(404).json({
        error: `Ambient audio file (${AMBIENT_FILE_NAME}) was not found.`,
      });
      return;
    }
    res.type('audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(filePath);
  };

  router.get('/audio/ambient-track.mp3', serveAmbientAudio);
  router.get(`/audio/${AMBIENT_FILE_NAME}`, serveAmbientAudio);

  router.post('/audio/ambient-upload', (req, res) => {
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : '';
    const base64Data = typeof req.body?.base64Data === 'string' ? req.body.base64Data : '';
    if (!fileName || !base64Data) {
      res.status(400).json({ error: 'fileName and base64Data are required.' });
      return;
    }
    try {
      const saved = saveUploadedAmbientAudio(fileName, base64Data);
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed saving ambient audio file.',
      });
    }
  });

  // Admin Authentication Endpoints
  router.get('/admin/status', (req, res) => {
    const setup = getAdminSetupState();
    const token = extractBearerToken(req);
    res.json({
      needsClaim: setup.needsClaim,
      envPasscodeActive: setup.envPasscodeActive,
      authenticated: verifyAdminToken(token),
    });
  });

  router.post('/admin/claim', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const result = claimAdminPasscode(passcode);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ token: result.token });
  });

  router.post('/admin/login', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const result = verifyAdminLogin(passcode);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({ token: result.token });
  });

  // Protected Admin System Diagnostics (requires Admin Bearer token)
  router.get('/system/status', requireAdminAuth, (_req, res) => {
    const db = getDatabase();
    const stats = getKnowledgeStats(db);
    const providers = getProvidersStatus();
    const settings = getAppSettings(db);
    const recentAudits = db
      .prepare('SELECT id, event_type, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT 15')
      .all();

    res.json({
      providers,
      settings,
      knowledgeStats: stats,
      supportedAppsCount: SUPPORTED_APPS.length,
      imageGenerationEnabled: false,
      recentAudits,
    });
  });

  // User Settings
  router.get('/settings', (_req, res) => {
    res.json(getAppSettings());
  });

  router.put('/settings', (req, res) => {
    const body = req.body as Partial<AppSettings>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid settings payload.' });
      return;
    }
    const allowed: Partial<AppSettings> = {};
    if (body.language === 'ar' || body.language === 'en') allowed.language = body.language;
    if (body.theme === 'light' || body.theme === 'dark') allowed.theme = body.theme;
    if (PERSONALITY_STYLES.some((s) => s.id === body.personalityStyle)) {
      allowed.personalityStyle = body.personalityStyle;
    }
    if (
      body.activeProvider &&
      ['gemini', 'openai', 'anthropic', 'openai-compatible', 'local'].includes(body.activeProvider)
    ) {
      allowed.activeProvider = body.activeProvider;
    }
    if (typeof body.activeModel === 'string' && body.activeModel.trim()) {
      allowed.activeModel = body.activeModel.trim().slice(0, 100);
    }
    if (typeof body.enableExternalSearch === 'boolean') {
      allowed.enableExternalSearch = body.enableExternalSearch;
    }
    if (typeof body.enableReferenceImages === 'boolean') {
      allowed.enableReferenceImages = body.enableReferenceImages;
    }
    if (typeof body.enableProviderFallback === 'boolean') {
      allowed.enableProviderFallback = body.enableProviderFallback;
    }
    if (body.voiceSttLang === 'ar-SA' || body.voiceSttLang === 'en-US') {
      allowed.voiceSttLang = body.voiceSttLang;
    }
    if (body.voiceMicMode === 'record_send' || body.voiceMicMode === 'live_dictation') {
      allowed.voiceMicMode = body.voiceMicMode;
    }
    if (typeof body.voiceInputDeviceId === 'string') {
      allowed.voiceInputDeviceId = body.voiceInputDeviceId.slice(0, 160);
    }
    if (typeof body.voiceTtsEnabled === 'boolean') {
      allowed.voiceTtsEnabled = body.voiceTtsEnabled;
    }
    if (typeof body.voiceTtsRate === 'number' && body.voiceTtsRate >= 0.5 && body.voiceTtsRate <= 2.0) {
      allowed.voiceTtsRate = body.voiceTtsRate;
    }
    if (typeof body.voiceTtsVolume === 'number' && body.voiceTtsVolume >= 0.1 && body.voiceTtsVolume <= 1.0) {
      allowed.voiceTtsVolume = body.voiceTtsVolume;
    }
    if (typeof body.voiceTtsVoiceName === 'string') {
      allowed.voiceTtsVoiceName = body.voiceTtsVoiceName.slice(0, 120);
    }
    if (typeof body.autoSpeakResponses === 'boolean') {
      allowed.autoSpeakResponses = body.autoSpeakResponses;
    }
    if (typeof body.autoSendVoiceTranscript === 'boolean') {
      allowed.autoSendVoiceTranscript = body.autoSendVoiceTranscript;
    }
    if (typeof body.useServerTtsFallback === 'boolean') {
      allowed.useServerTtsFallback = body.useServerTtsFallback;
    }
    if (typeof body.enableWakeWord === 'boolean') {
      allowed.enableWakeWord = body.enableWakeWord;
    }
    if (typeof body.allowBackgroundTts === 'boolean') {
      allowed.allowBackgroundTts = body.allowBackgroundTts;
    }
    if (typeof body.enableBackgroundVoiceAssistant === 'boolean') {
      allowed.enableBackgroundVoiceAssistant = body.enableBackgroundVoiceAssistant;
    }
    if (typeof body.enableFloatingVoiceButton === 'boolean') {
      allowed.enableFloatingVoiceButton = body.enableFloatingVoiceButton;
    }
    if (typeof body.enableFileManagerAccess === 'boolean') {
      allowed.enableFileManagerAccess = body.enableFileManagerAccess;
    }
    if (typeof body.enableDeviceControl === 'boolean') {
      allowed.enableDeviceControl = body.enableDeviceControl;
    }
    if (typeof body.confirmDestructiveActions === 'boolean') {
      allowed.confirmDestructiveActions = body.confirmDestructiveActions;
    }
    if (typeof body.saveSearchHistory === 'boolean') {
      allowed.saveSearchHistory = body.saveSearchHistory;
    }
    if (typeof body.saveActivityLog === 'boolean') {
      allowed.saveActivityLog = body.saveActivityLog;
    }
    if (typeof body.enableNotifications === 'boolean') {
      allowed.enableNotifications = body.enableNotifications;
    }
    if (typeof body.requireConfirmationForWebActions === 'boolean') {
      allowed.requireConfirmationForWebActions = body.requireConfirmationForWebActions;
    }
    if (typeof body.memoryConsentGranted === 'boolean') {
      allowed.memoryConsentGranted = body.memoryConsentGranted;
    }
    if (typeof body.ambientMusicEnabled === 'boolean') {
      allowed.ambientMusicEnabled = body.ambientMusicEnabled;
    }
    if (typeof body.ambientMusicMuted === 'boolean') {
      allowed.ambientMusicMuted = body.ambientMusicMuted;
    }
    if (
      typeof body.ambientMusicVolume === 'number' &&
      Number.isFinite(body.ambientMusicVolume) &&
      body.ambientMusicVolume >= 0 &&
      body.ambientMusicVolume <= 1
    ) {
      allowed.ambientMusicVolume = body.ambientMusicVolume;
    }

    const updated = saveAppSettings(allowed);
    logAuditEvent('SETTINGS_UPDATED', `Updated settings (${Object.keys(allowed).join(', ')})`);
    res.json(updated);
  });

  router.post('/settings/reset', (_req, res) => {
    const reset = resetAppSettings();
    logAuditEvent('SETTINGS_RESET', 'Reset settings to defaults');
    res.json(reset);
  });

  // Tools, User Tasks & Consented Preferences
  router.get('/tools', (_req, res) => {
    res.json({ tools: listRegisteredTools() });
  });

  router.get('/tasks', (_req, res) => {
    res.json({ tasks: listUserTasks() });
  });

  router.post('/tasks', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }
    const priority = ['low', 'medium', 'high'].includes(req.body?.priority)
      ? req.body.priority
      : 'medium';
    const created = createUserTask({
      id: `task_${crypto.randomUUID().slice(0, 10)}`,
      title: title.slice(0, 140),
      notes: typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 400) : '',
      status: 'todo',
      priority,
    });
    res.status(201).json(created);
  });

  router.patch('/tasks/:id', (req, res) => {
    const status = req.body?.status as UserTaskItem['status'];
    if (!['todo', 'in_progress', 'done'].includes(status)) {
      res.status(400).json({ error: 'Invalid task status.' });
      return;
    }
    const ok = updateUserTaskStatus(req.params.id, status);
    res.json({ updated: ok });
  });

  router.delete('/tasks/:id', (req, res) => {
    res.json({ deleted: deleteUserTask(req.params.id) });
  });

  router.get('/preferences', (_req, res) => {
    const settings = getAppSettings();
    res.json({
      consentGranted: settings.memoryConsentGranted,
      preferences: listUserPreferences(),
    });
  });

  router.post('/preferences', (req, res) => {
    const settings = getAppSettings();
    if (!settings.memoryConsentGranted) {
      res.status(403).json({ error: 'User consent for preference memory is required.' });
      return;
    }
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';
    const category =
      req.body?.category === 'project' || req.body?.category === 'saved_fact'
        ? req.body.category
        : 'preference';
    if (!key || !value) {
      res.status(400).json({ error: 'Both key and value are required.' });
      return;
    }
    const saved = upsertUserPreference(
      `up_${crypto.randomUUID().slice(0, 10)}`,
      key,
      value,
      category
    );
    res.status(201).json(saved);
  });

  router.patch('/preferences/:id', (req, res) => {
    const settings = getAppSettings();
    if (!settings.memoryConsentGranted) {
      res.status(403).json({ error: 'User consent for preference memory is required.' });
      return;
    }
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : undefined;
    const value = typeof req.body?.value === 'string' ? req.body.value.trim() : undefined;
    const category =
      req.body?.category === 'preference' ||
      req.body?.category === 'project' ||
      req.body?.category === 'saved_fact'
        ? req.body.category
        : undefined;
    const updated = updateUserPreferenceById(req.params.id, { key, value, category });
    if (!updated) {
      res.status(404).json({ error: 'Preference not found.' });
      return;
    }
    res.json(updated);
  });

  router.delete('/preferences/:id', (req, res) => {
    res.json({ deleted: deleteUserPreference(req.params.id) });
  });

  // Conversations & History
  router.get('/conversations', (_req, res) => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT id, title, pinned, created_at, updated_at FROM conversations ORDER BY pinned DESC, updated_at DESC LIMIT 50')
      .all() as Array<{ id: string; title: string; pinned: number; created_at: string; updated_at: string }>;
    const list: Conversation[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      pinned: Boolean(r.pinned),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    res.json({ conversations: list });
  });

  router.post('/conversations', (req, res) => {
    const db = getDatabase();
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 120)
        : 'محادثة جديدة';
    const now = new Date().toISOString();
    const id = `conv_${crypto.randomUUID().slice(0, 12)}`;
    db.prepare('INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(
      id,
      title,
      now,
      now
    );
    res.status(201).json({ id, title, pinned: false, created_at: now, updated_at: now });
  });

  router.patch('/conversations/:id', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const pinned = typeof req.body?.pinned === 'boolean' ? req.body.pinned : undefined;
    const updated = updateConversation(req.params.id, { title, pinned });
    if (!updated) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json(updated);
  });

  router.get('/conversations/:id/messages', (req, res) => {
    res.json({ messages: getConversationMessages(req.params.id) });
  });

  router.delete('/conversations/:id', (req, res) => {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
    res.json({ deleted: Number(result.changes) > 0 });
  });

  // Primary NEXORA MASTER Chat Endpoint
  router.post('/chat', async (req, res) => {
    const db = getDatabase();
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Query text is required.' });
      return;
    }

    const attachmentsRaw = Array.isArray(req.body?.attachments)
      ? (req.body.attachments as AttachedDocumentInput[])
      : [];
    const attachments: AttachedDocumentInput[] = attachmentsRaw
      .filter(
        (a) =>
          a &&
          typeof a.fileName === 'string' &&
          ((typeof a.contentText === 'string' && a.contentText.length > 0) ||
            (typeof a.base64Data === 'string' && a.base64Data.length > 0))
      )
      .slice(0, 3)
      .map((a) => ({
        fileName: a.fileName.slice(0, 120),
        mimeType: typeof a.mimeType === 'string' ? a.mimeType.slice(0, 120) : 'text/plain',
        contentText: typeof a.contentText === 'string' ? a.contentText.slice(0, 30000) : undefined,
        base64Data: typeof a.base64Data === 'string' ? a.base64Data.slice(0, 6_000_000) : undefined,
        sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : undefined,
      }));

    const incognito = Boolean(req.body?.incognito);
    let conversationId =
      typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
        ? req.body.conversationId.trim()
        : '';

    const now = new Date().toISOString();
    const storedUserText =
      attachments.length > 0
        ? `${query}\n\n[مرفق: ${attachments.map((a) => a.fileName).join(', ')}]`
        : query;

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(req.body?.history)
      ? (req.body.history as Array<{ role: 'user' | 'assistant'; content: string }>).slice(-8)
      : [];

    const userMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
    if (!incognito) {
      if (!conversationId) {
        conversationId = `conv_${crypto.randomUUID().slice(0, 12)}`;
        db.prepare('INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(
          conversationId,
          query.slice(0, 60),
          now,
          now
        );
      } else {
        const exists = db
          .prepare('SELECT id FROM conversations WHERE id = ?')
          .get(conversationId) as { id: string } | undefined;
        if (!exists) {
          db.prepare(
            'INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
          ).run(conversationId, query.slice(0, 60), now, now);
        }
      }

      const prevRows = db
        .prepare(
          'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 8'
        )
        .all(conversationId) as Array<{ role: 'user' | 'assistant'; content: string }>;
      history = prevRows.reverse();

      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userMsgId, conversationId, 'user', storedUserText, null, now);
    } else if (!conversationId) {
      conversationId = `incog_${crypto.randomUUID().slice(0, 10)}`;
    }

    try {
      const platform = req.body?.platform ?? 'web';
      const settingsOverride = req.body?.settingsOverride as Partial<AppSettings> | undefined;
      const masterResult = await runNexoraMaster({
        query,
        history,
        attachments,
        platform,
        settingsOverride,
        incognito,
      });

      const assistantTime = new Date().toISOString();
      const assistantMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
      const { answer, internalUsedKbCount: _internalCount, ...publicMetadata } = masterResult;

      if (!incognito) {
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          assistantMsgId,
          conversationId,
          'assistant',
          answer,
          JSON.stringify(publicMetadata),
          assistantTime
        );
        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
          assistantTime,
          conversationId
        );
      }

      res.json({
        conversationId,
        userMessage: {
          id: userMsgId,
          conversation_id: conversationId,
          role: 'user',
          content: storedUserText,
          created_at: now,
        },
        assistantMessage: {
          id: assistantMsgId,
          conversation_id: conversationId,
          role: 'assistant',
          content: answer,
          metadata: publicMetadata,
          created_at: assistantTime,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected NEXORA MASTER error.';
      res.status(500).json({ error: msg });
    }
  });

  // SSE Streaming Chat Endpoint (supports Abort / Stop Generation + Incognito Mode)
  router.post('/chat/stream', async (req, res) => {
    const db = getDatabase();
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Query text is required.' });
      return;
    }

    const attachmentsRaw = Array.isArray(req.body?.attachments)
      ? (req.body.attachments as AttachedDocumentInput[])
      : [];
    const attachments: AttachedDocumentInput[] = attachmentsRaw
      .filter(
        (a) =>
          a &&
          typeof a.fileName === 'string' &&
          ((typeof a.contentText === 'string' && a.contentText.length > 0) ||
            (typeof a.base64Data === 'string' && a.base64Data.length > 0))
      )
      .slice(0, 3)
      .map((a) => ({
        fileName: a.fileName.slice(0, 120),
        mimeType: typeof a.mimeType === 'string' ? a.mimeType.slice(0, 120) : 'text/plain',
        contentText: typeof a.contentText === 'string' ? a.contentText.slice(0, 30000) : undefined,
        base64Data: typeof a.base64Data === 'string' ? a.base64Data.slice(0, 6_000_000) : undefined,
        sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : undefined,
      }));

    const incognito = Boolean(req.body?.incognito);
    let conversationId =
      typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
        ? req.body.conversationId.trim()
        : '';

    const now = new Date().toISOString();
    const storedUserText =
      attachments.length > 0
        ? `${query}\n\n[مرفق: ${attachments.map((a) => a.fileName).join(', ')}]`
        : query;

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(req.body?.history)
      ? (req.body.history as Array<{ role: 'user' | 'assistant'; content: string }>).slice(-8)
      : [];

    const userMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
    if (!incognito) {
      if (!conversationId) {
        conversationId = `conv_${crypto.randomUUID().slice(0, 12)}`;
        db.prepare('INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(
          conversationId,
          query.slice(0, 60),
          now,
          now
        );
      } else {
        const exists = db
          .prepare('SELECT id FROM conversations WHERE id = ?')
          .get(conversationId) as { id: string } | undefined;
        if (!exists) {
          db.prepare(
            'INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
          ).run(conversationId, query.slice(0, 60), now, now);
        }
      }

      const prevRows = db
        .prepare(
          'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 8'
        )
        .all(conversationId) as Array<{ role: 'user' | 'assistant'; content: string }>;
      history = prevRows.reverse();

      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userMsgId, conversationId, 'user', storedUserText, null, now);
    } else if (!conversationId) {
      conversationId = `incog_${crypto.randomUUID().slice(0, 10)}`;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeEvent = (event: string, data: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const controller = new AbortController();
    req.on('close', () => {
      controller.abort();
    });

    const userMessage: ChatMessage = {
      id: userMsgId,
      conversation_id: conversationId,
      role: 'user',
      content: storedUserText,
      created_at: now,
    };
    writeEvent('meta', { conversationId, userMessage });

    try {
      const platform = req.body?.platform ?? 'web';
      const settingsOverride = req.body?.settingsOverride as Partial<AppSettings> | undefined;
      const masterResult = await streamNexoraMaster(
        {
          query,
          history,
          attachments,
          platform,
          settingsOverride,
          incognito,
        },
        {
          signal: controller.signal,
          onToken: (chunk) => {
            writeEvent('token', { chunk });
          },
        }
      );

      const assistantTime = new Date().toISOString();
      const assistantMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
      const { answer, internalUsedKbCount: _internalCount, ...publicMetadata } = masterResult;

      if (!incognito) {
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          assistantMsgId,
          conversationId,
          'assistant',
          answer,
          JSON.stringify(publicMetadata),
          assistantTime
        );
        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
          assistantTime,
          conversationId
        );
      }

      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        conversation_id: conversationId,
        role: 'assistant',
        content: answer,
        metadata: publicMetadata,
        created_at: assistantTime,
      };
      writeEvent('done', { conversationId, userMessage, assistantMessage });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Streaming failed.';
      writeEvent('error', { error: msg });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // Edit User Message -> Trim Subsequent Branch -> Regenerate Assistant Reply
  router.patch('/messages/:id', async (req, res) => {
    const newContent = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!newContent) {
      res.status(400).json({ error: 'Updated message content is required.' });
      return;
    }
    const edited = editMessageAndTrimFollowing(req.params.id, newContent);
    if (!edited) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    const db = getDatabase();
    const priorMessages = getConversationMessages(edited.conversationId, db).filter(
      (m) => m.id !== edited.message.id
    );
    const history = priorMessages.slice(-8).map((m) => ({ role: m.role, content: m.content }));

    try {
      const platform = req.body?.platform ?? 'web';
      const settingsOverride = req.body?.settingsOverride as Partial<AppSettings> | undefined;
      const masterResult = await runNexoraMaster({
        query: newContent,
        history,
        platform,
        settingsOverride,
      });

      const assistantTime = new Date(Date.now() + 5).toISOString();
      const assistantMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
      const { answer, internalUsedKbCount: _internalCount, ...publicMetadata } = masterResult;
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        assistantMsgId,
        edited.conversationId,
        'assistant',
        answer,
        JSON.stringify(publicMetadata),
        assistantTime
      );
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
        assistantTime,
        edited.conversationId
      );

      res.json({
        conversationId: edited.conversationId,
        messages: getConversationMessages(edited.conversationId, db),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed regenerating after edit.',
      });
    }
  });

  router.post('/messages/:id/restore', (req, res) => {
    const restored = restoreOriginalMessage(req.params.id);
    if (!restored) {
      res.status(404).json({ error: 'Original content unavailable for this message.' });
      return;
    }
    res.json({ message: restored });
  });

  router.post('/conversations/:id/regenerate', async (req, res) => {
    const db = getDatabase();
    const messages = getConversationMessages(req.params.id, db);
    if (messages.length === 0) {
      res.status(404).json({ error: 'Conversation has no messages.' });
      return;
    }

    // Remove trailing assistant reply if present, then re-run last user prompt
    const last = messages[messages.length - 1];
    if (last.role === 'assistant') {
      db.prepare('DELETE FROM messages WHERE id = ?').run(last.id);
    }

    const updatedMsgs = getConversationMessages(req.params.id, db);
    const lastUser = [...updatedMsgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      res.status(400).json({ error: 'No user prompt found to regenerate.' });
      return;
    }

    const history = updatedMsgs
      .filter((m) => m.id !== lastUser.id)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const platform = req.body?.platform ?? 'web';
      const settingsOverride = req.body?.settingsOverride as Partial<AppSettings> | undefined;
      const masterResult = await runNexoraMaster({
        query: lastUser.content,
        history,
        platform,
        settingsOverride,
      });

      const assistantTime = new Date().toISOString();
      const assistantMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
      const { answer, internalUsedKbCount: _internalCount, ...publicMetadata } = masterResult;

      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        assistantMsgId,
        req.params.id,
        'assistant',
        answer,
        JSON.stringify(publicMetadata),
        assistantTime
      );
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
        assistantTime,
        req.params.id
      );

      res.json({ messages: getConversationMessages(req.params.id, db) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed regenerating response.',
      });
    }
  });

  // ADMIN-ONLY Knowledge Base Management Routes
  router.get('/knowledge/stats', requireAdminAuth, (_req, res) => {
    res.json(getKnowledgeStats());
  });

  router.get('/knowledge/records', requireAdminAuth, (req, res) => {
    const sectionRaw = typeof req.query.section === 'string' ? req.query.section : undefined;
    const section =
      sectionRaw && VALID_SECTIONS.has(sectionRaw as KnowledgeSectionId)
        ? (sectionRaw as KnowledgeSectionId)
        : undefined;
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const reviewStatus =
      statusRaw && ['verified', 'needs_review', 'rejected'].includes(statusRaw)
        ? (statusRaw as ReviewStatus)
        : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const limit = Number(req.query.limit ?? 30);
    const offset = Number(req.query.offset ?? 0);

    res.json(
      listKnowledgeRecords({
        section,
        reviewStatus,
        query,
        limit: Number.isFinite(limit) ? limit : 30,
        offset: Number.isFinite(offset) ? offset : 0,
      })
    );
  });

  router.post('/knowledge/records', requireAdminAuth, (req, res) => {
    const input = req.body as KnowledgeRecordInput;
    if (!input || !VALID_SECTIONS.has(input.section)) {
      res.status(400).json({ error: 'Valid section and record fields are required.' });
      return;
    }
    const result = insertKnowledgeRecord(input);
    if (result.duplicate) {
      res.status(409).json({ error: 'Duplicate knowledge record blocked.', duplicate: true });
      return;
    }
    if (!result.inserted) {
      res.status(400).json({ error: result.error ?? 'Failed to insert record.' });
      return;
    }
    res.status(201).json(result.record);
  });

  router.patch('/knowledge/records/:id', requireAdminAuth, (req, res) => {
    const updated = updateKnowledgeRecord(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
    res.json(updated);
  });

  router.delete('/knowledge/records/:id', requireAdminAuth, (req, res) => {
    const deleted = deleteKnowledgeRecord(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  router.get('/knowledge/export', requireAdminAuth, (req, res) => {
    const sectionRaw = typeof req.query.section === 'string' ? req.query.section : undefined;
    const section =
      sectionRaw && VALID_SECTIONS.has(sectionRaw as KnowledgeSectionId)
        ? (sectionRaw as KnowledgeSectionId)
        : undefined;
    const records = exportKnowledgeRecords(section);
    res.json({
      exportedAt: new Date().toISOString(),
      total: records.length,
      records,
    });
  });

  router.post('/knowledge/import', requireAdminAuth, (req, res) => {
    const records = Array.isArray(req.body?.records) ? (req.body.records as KnowledgeRecordInput[]) : null;
    if (!records) {
      res.status(400).json({ error: 'Expected { records: [...] } array.' });
      return;
    }
    const summary = insertKnowledgeBatch(records.slice(0, 2000));
    logAuditEvent(
      'KNOWLEDGE_IMPORT',
      `Imported=${summary.inserted}, duplicates=${summary.duplicates}, rejected=${summary.rejected}`
    );
    res.json(summary);
  });

  router.post('/knowledge/backup', requireAdminAuth, (_req, res) => {
    const backup = createDatabaseBackup();
    logAuditEvent('KNOWLEDGE_BACKUP', `Created backup (${backup.sizeBytes} bytes)`);
    res.json(backup);
  });

  router.get('/knowledge/batches', requireAdminAuth, (_req, res) => {
    res.json({ jobs: listBatchJobs() });
  });

  router.post('/knowledge/batches', requireAdminAuth, async (req, res) => {
    const section = req.body?.section as KnowledgeSectionId;
    const batchSize = Number(req.body?.targetBatchSize ?? 100);
    const runImmediately = req.body?.runImmediately !== false;

    if (!VALID_SECTIONS.has(section)) {
      res.status(400).json({ error: 'Invalid knowledge section.' });
      return;
    }

    try {
      let job = createBatchJob(section, Number.isFinite(batchSize) ? batchSize : 100, 'wikipedia');
      if (runImmediately) {
        job = await runBatchStep(job.id, 3);
      }
      res.status(201).json({ job, stats: getKnowledgeStats() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Batch execution error',
        stats: getKnowledgeStats(),
      });
    }
  });

  router.post('/knowledge/batches/:id/step', requireAdminAuth, async (req, res) => {
    try {
      const steps = Math.min(Math.max(Number(req.body?.maxSteps ?? 3), 1), 10);
      const job = await runBatchStep(req.params.id, steps);
      res.json({ job, stats: getKnowledgeStats() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed batch step',
        stats: getKnowledgeStats(),
      });
    }
  });

  router.post('/knowledge/batches/resume', requireAdminAuth, async (_req, res) => {
    try {
      const jobs = await resumeIncompleteBatches();
      res.json({ resumed: jobs.length, jobs, stats: getKnowledgeStats() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed resuming batches',
      });
    }
  });

  // External Search Engine Route (accessible to admin search tester and tools)
  router.post('/search', requireAdminAuth, async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }
    const preferArabic = Boolean(req.body?.preferArabic);
    const report = await runExternalSearch(query, preferArabic);
    res.json(report);
  });

  // Voice STT / TTS Server Endpoints (real audio transcription & WAV TTS synthesis)
  router.post('/voice/transcribe', async (req, res) => {
    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'audio/webm';
    const langHint = req.body?.lang === 'en-US' ? 'English' : 'Arabic or English';

    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64 is required.' });
      return;
    }

    try {
      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: `Transcribe this spoken audio accurately in ${langHint}. Return ONLY the exact spoken words, or an empty string if the audio contains only silence or noise.`,
            },
          ],
        },
      });
      res.json({ transcript: (response.text ?? '').trim() });
    } catch (err) {
      const status = err instanceof ProviderError ? err.statusCode : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Audio transcription failed.',
      });
    }
  });

  router.post('/voice/tts', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 1500) : '';
    const voiceName =
      typeof req.body?.voiceName === 'string' &&
      ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].includes(req.body.voiceName)
        ? req.body.voiceName
        : 'Kore';

    if (!text) {
      res.status(400).json({ error: 'Text is required for TTS synthesis.' });
      return;
    }

    try {
      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  style: 'Clear, natural, articulate assistant voice',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ error: 'TTS model did not return audio data.' });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
      });
    } catch (err) {
      const status = err instanceof ProviderError ? err.statusCode : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Server TTS synthesis failed.',
      });
    }
  });

  // Device Control & Supported Apps
  router.get('/device/apps', (_req, res) => {
    res.json({ apps: SUPPORTED_APPS });
  });

  router.post('/device/parse', (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const platform = req.body?.platform ?? 'web';
    const command = detectDeviceControlCommand(query, platform);
    res.json({ command });
  });

  // Safe Gemini Connection Health Probe (never leaks any key)
  router.get('/gemini/health', (_req, res) => {
    const providers = getProvidersStatus();
    const gemini = providers.find((p) => p.id === 'gemini');
    const settings = getAppSettings();
    res.json({
      configured: Boolean(gemini?.configured),
      activeProvider: settings.activeProvider,
      activeModel: settings.activeModel,
      supportsVision: Boolean(providers.find((p) => p.id === settings.activeProvider)?.supportsVision),
    });
  });

  // Real File Manager Routes (strictly confined to authorized workspace + recent files metadata)
  router.get('/files', (req, res) => {
    const settings = getAppSettings();
    if (!settings.enableFileManagerAccess) {
      res.status(403).json({ error: 'صلاحية مدير الملفات معطلة في الإعدادات.' });
      return;
    }
    try {
      const subPath = typeof req.query.path === 'string' ? req.query.path : '';
      const searchQuery = typeof req.query.q === 'string' ? req.query.q : '';
      const extension = typeof req.query.ext === 'string' ? req.query.ext : '';
      const listed = listWorkspaceFiles({ subPath, searchQuery, extension });
      const stats = getWorkspaceStorageStats();
      res.json({
        workspaceRoot: listed.workspaceRoot,
        items: listed.items,
        stats,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed listing files.' });
    }
  });

  router.get('/files/recent', (_req, res) => {
    res.json({ files: listRecentFiles(40) });
  });

  router.delete('/files/recent', (_req, res) => {
    const cleared = clearRecentFiles();
    res.json({ cleared });
  });

  router.post('/files/read', async (req, res) => {
    const settings = getAppSettings();
    if (!settings.enableFileManagerAccess) {
      res.status(403).json({ error: 'صلاحية مدير الملفات معطلة في الإعدادات.' });
      return;
    }
    const relPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    if (!relPath) {
      res.status(400).json({ error: 'File path is required.' });
      return;
    }
    try {
      const fileData = await readWorkspaceFile(relPath);
      res.json(fileData);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed reading file.' });
    }
  });

  router.post('/files/write', (req, res) => {
    const settings = getAppSettings();
    if (!settings.enableFileManagerAccess) {
      res.status(403).json({ error: 'صلاحية مدير الملفات معطلة في الإعدادات.' });
      return;
    }
    const relPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const append = Boolean(req.body?.append);
    const overwriteConfirmed = req.body?.overwriteConfirmed !== false;
    try {
      const out = writeWorkspaceFile({ relativePath: relPath, content, append, overwriteConfirmed });
      res.status(out.requiresConfirmation ? 409 : 200).json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed writing file.' });
    }
  });

  router.post('/files/rename', (req, res) => {
    const settings = getAppSettings();
    if (!settings.enableFileManagerAccess) {
      res.status(403).json({ error: 'صلاحية مدير الملفات معطلة في الإعدادات.' });
      return;
    }
    const sourcePath = typeof req.body?.sourcePath === 'string' ? req.body.sourcePath.trim() : '';
    const newName = typeof req.body?.newName === 'string' ? req.body.newName.trim() : '';
    try {
      const out = renameWorkspaceFile({ sourcePath, newName });
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed renaming file.' });
    }
  });

  router.post('/files/transfer', (req, res) => {
    const settings = getAppSettings();
    if (!settings.enableFileManagerAccess) {
      res.status(403).json({ error: 'صلاحية مدير الملفات معطلة في الإعدادات.' });
      return;
    }
    const sourcePath = typeof req.body?.sourcePath === 'string' ? req.body.sourcePath.trim() : '';
    const destPath = typeof req.body?.destPath === 'string' ? req.body.destPath.trim() : '';
    const mode = req.body?.mode === 'move' ? 'move' : 'copy';
    try {
      const out = transferWorkspaceFile({ sourcePath, destPath, mode });
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed transferring file.' });
    }
  });

  router.post('/files/delete', (req, res) => {
    const settings = getAppSettings();
    if (!settings.enableFileManagerAccess) {
      res.status(403).json({ error: 'صلاحية مدير الملفات معطلة في الإعدادات.' });
      return;
    }
    const relPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const confirmed = Boolean(req.body?.confirmed);
    if (!relPath) {
      res.status(400).json({ error: 'File path is required.' });
      return;
    }
    try {
      const out = deleteWorkspaceFile({ relativePath: relPath, confirmed });
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed deleting file.' });
    }
  });

  router.post('/files/clean-temp', (req, res) => {
    const settings = getAppSettings();
    if (!settings.enableFileManagerAccess) {
      res.status(403).json({ error: 'صلاحية مدير الملفات معطلة في الإعدادات.' });
      return;
    }
    const paths = Array.isArray(req.body?.paths) ? (req.body.paths as string[]) : undefined;
    const confirmed = Boolean(req.body?.confirmed);
    try {
      const out = cleanWorkspaceTempFiles({ paths, confirmed });
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed cleaning temp files.' });
    }
  });

  // Public Web Search, Browse & Search History Routes
  router.post('/web/search', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }
    const preferArabic = Boolean(req.body?.preferArabic);
    const report = await runExternalSearch(query, preferArabic);
    res.json(report);
  });

  router.post('/web/browse', async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const searchWithin = typeof req.body?.searchWithin === 'string' ? req.body.searchWithin.trim() : undefined;
    if (!url) {
      res.status(400).json({ error: 'HTTPS URL is required.' });
      return;
    }
    try {
      const result = await browseAndReadWebPage(url, searchWithin);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed loading page.' });
    }
  });

  router.get('/web/history', (_req, res) => {
    res.json({ history: listSearchHistory(80) });
  });

  router.delete('/web/history', (_req, res) => {
    const cleared = clearSearchHistory();
    recordActivityLog({
      category: 'search',
      action: 'clear_search_history',
      target: 'search_history',
      tool_id: null,
      status: 'success',
      detail: `Cleared ${cleared} search history entries`,
    });
    res.json({ cleared });
  });

  router.delete('/web/history/:id', (req, res) => {
    const deleted = deleteSearchHistoryById(req.params.id);
    res.json({ deleted });
  });

  // Activity Log Routes (real tracked actions only)
  router.get('/activity', (req, res) => {
    const category = typeof req.query.category === 'string'
      ? (req.query.category as ActivityLogEntry['category'])
      : undefined;
    const validCategories = new Set(['search', 'browse', 'file', 'command', 'tool', 'ai']);
    const logs = listActivityLogs({
      category: category && validCategories.has(category) ? category : undefined,
      limit: 120,
    });
    res.json({ logs });
  });

  router.delete('/activity', (_req, res) => {
    const cleared = clearActivityLogs();
    res.json({ cleared });
  });

  router.delete('/activity/:id', (req, res) => {
    const deleted = deleteActivityLogById(req.params.id);
    res.json({ deleted });
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  return router;
}
