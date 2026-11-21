import type {
  ActivityLogEntry,
  AdminAuthStatus,
  AppSettings,
  AttachedDocumentInput,
  BatchJob,
  ChatMessage,
  Conversation,
  ExternalSearchReport,
  KnowledgeBaseStats,
  KnowledgeRecord,
  KnowledgeRecordInput,
  KnowledgeSectionId,
  ProviderStatus,
  RecentFileEntry,
  ReviewStatus,
  SearchHistoryEntry,
  StorageStatsSummary,
  ToolCapabilityDescriptor,
  UserPreferenceItem,
  UserTaskItem,
  WebPageBrowseResult,
  WorkspaceFileItem,
} from '../shared/types.ts';

// Optional standalone API base URL (defaults to same-origin relative /api/* routes)
const RAW_API_BASE =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL?.trim() ||
  '';
const API_BASE_URL = RAW_API_BASE.replace(/\/+$/, '');

export function buildApiUrl(path: string): string {
  if (!path) return API_BASE_URL || '/';
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

// Admin token held strictly in JS memory (never persisted to localStorage/sessionStorage)
let inMemoryAdminToken: string | null = null;

export function setAdminToken(token: string | null): void {
  inMemoryAdminToken = token;
}

export function getAdminToken(): string | null {
  return inMemoryAdminToken;
}

async function requestJson<T>(
  url: string,
  options?: RequestInit,
  includeAdminAuth = false
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (includeAdminAuth && inMemoryAdminToken) {
    headers.Authorization = `Bearer ${inMemoryAdminToken}`;
  }

  const res = await fetch(buildApiUrl(url), {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data as T;
}

export interface PublicCapabilitiesResponse {
  settings: AppSettings;
  providers: ProviderStatus[];
  tools: ToolCapabilityDescriptor[];
  supportedAppsCount: number;
  imageGenerationEnabled: boolean;
}

export interface SystemStatusResponse {
  providers: ProviderStatus[];
  settings: AppSettings;
  knowledgeStats: KnowledgeBaseStats;
  supportedAppsCount: number;
  imageGenerationEnabled: boolean;
  recentAudits: Array<{ id: number; event_type: string; detail: string; created_at: string }>;
}

export interface GeminiHealthResponse {
  configured: boolean;
  activeProvider: string;
  activeModel: string;
  supportsVision: boolean;
}

export interface DownloadInfoResponse {
  webUrl: string;
  apkUrl: string | null;
  apkAvailable: boolean;
  apkStatus: 'available' | 'not_configured' | 'no_release_yet' | 'unreachable';
  apkSource: 'github_release' | 'env_url' | 'none';
  githubRepo: string | null;
  apkVersion: string | null;
  apkFileName: string | null;
  apkSizeBytes: number | null;
  apkPublishedAt: string | null;
  releasePageUrl: string | null;
  statusMessage?: string;
  checkedAt?: string;
  apkCompiledInSandbox: boolean;
  androidSourcePath: string;
  windowsBridgePort: number;
}

export interface AmbientAudioStatusResponse {
  available: boolean;
  fileName: string;
  sizeBytes: number | null;
  audioUrl: string | null;
  expectedPath: string;
}

export const apiClient = {
  getPublicCapabilities: () =>
    requestJson<PublicCapabilitiesResponse>('/api/public/capabilities'),

  getGeminiHealth: () => requestJson<GeminiHealthResponse>('/api/gemini/health'),

  // Admin Auth & Diagnostics
  getAdminStatus: () => requestJson<AdminAuthStatus>('/api/admin/status', undefined, true),
  claimAdmin: async (passcode: string) => {
    const res = await requestJson<{ token: string }>('/api/admin/claim', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
    inMemoryAdminToken = res.token;
    return res;
  },
  loginAdmin: async (passcode: string) => {
    const res = await requestJson<{ token: string }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
    inMemoryAdminToken = res.token;
    return res;
  },
  logoutAdmin: () => {
    inMemoryAdminToken = null;
  },

  getSystemStatus: () => requestJson<SystemStatusResponse>('/api/system/status', undefined, true),

  getDownloadInfo: (refresh = false) =>
    requestJson<DownloadInfoResponse>(
      refresh ? '/api/app/download-info?refresh=1' : '/api/app/download-info'
    ),

  getAmbientAudioStatus: () =>
    requestJson<AmbientAudioStatusResponse>('/api/audio/ambient-status'),

  uploadAmbientAudio: (fileName: string, base64Data: string) =>
    requestJson<AmbientAudioStatusResponse>('/api/audio/ambient-upload', {
      method: 'POST',
      body: JSON.stringify({ fileName, base64Data }),
    }),

  getSettings: () => requestJson<AppSettings>('/api/settings'),
  updateSettings: (partial: Partial<AppSettings>) =>
    requestJson<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(partial),
    }),
  resetSettings: () =>
    requestJson<AppSettings>('/api/settings/reset', {
      method: 'POST',
    }),

  // Tools, Tasks & Consented Memory
  listTools: () => requestJson<{ tools: ToolCapabilityDescriptor[] }>('/api/tools'),
  listTasks: () => requestJson<{ tasks: UserTaskItem[] }>('/api/tasks'),
  createTask: (title: string, notes = '', priority: UserTaskItem['priority'] = 'medium') =>
    requestJson<UserTaskItem>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, notes, priority }),
    }),
  updateTaskStatus: (id: string, status: UserTaskItem['status']) =>
    requestJson<{ updated: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteTask: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  listPreferences: () =>
    requestJson<{ consentGranted: boolean; preferences: UserPreferenceItem[] }>('/api/preferences'),
  savePreference: (
    key: string,
    value: string,
    category: 'preference' | 'project' | 'saved_fact' = 'preference'
  ) =>
    requestJson<UserPreferenceItem>('/api/preferences', {
      method: 'POST',
      body: JSON.stringify({ key, value, category }),
    }),
  updatePreference: (
    id: string,
    updates: { key?: string; value?: string; category?: 'preference' | 'project' | 'saved_fact' }
  ) =>
    requestJson<UserPreferenceItem>(`/api/preferences/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  deletePreference: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/preferences/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Conversations & Chat
  listConversations: () => requestJson<{ conversations: Conversation[] }>('/api/conversations'),
  createConversation: (title?: string) =>
    requestJson<Conversation>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  renameOrPinConversation: (
    conversationId: string,
    updates: { title?: string; pinned?: boolean }
  ) =>
    requestJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  getMessages: (conversationId: string) =>
    requestJson<{ messages: ChatMessage[] }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`
    ),
  deleteConversation: (conversationId: string) =>
    requestJson<{ deleted: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    }),

  sendChatMessage: (payload: {
    query: string;
    conversationId?: string;
    attachments?: AttachedDocumentInput[];
    platform?: string;
    settingsOverride?: Partial<AppSettings>;
    incognito?: boolean;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) =>
    requestJson<{
      conversationId: string;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  streamChatMessage: async (
    payload: {
      query: string;
      conversationId?: string;
      attachments?: AttachedDocumentInput[];
      platform?: string;
      settingsOverride?: Partial<AppSettings>;
      incognito?: boolean;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
    handlers: {
      signal?: AbortSignal;
      onMeta?: (data: { conversationId: string; userMessage: ChatMessage }) => void;
      onToken: (chunk: string) => void;
      onDone: (data: {
        conversationId: string;
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      }) => void;
    }
  ): Promise<void> => {
    const res = await fetch(buildApiUrl('/api/chat/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: handlers.signal,
    });
    if (!res.ok || !res.body) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx = buffer.indexOf('\n\n');
      while (sepIdx !== -1) {
        const rawBlock = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        let eventName = 'message';
        let dataLine = '';
        for (const line of rawBlock.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          if (line.startsWith('data:')) dataLine += line.slice(5).trim();
        }
        if (dataLine) {
          const parsed = JSON.parse(dataLine) as Record<string, unknown>;
          if (eventName === 'meta') {
            handlers.onMeta?.(
              parsed as { conversationId: string; userMessage: ChatMessage }
            );
          } else if (eventName === 'token') {
            handlers.onToken(String(parsed.chunk ?? ''));
          } else if (eventName === 'done') {
            handlers.onDone(
              parsed as {
                conversationId: string;
                userMessage: ChatMessage;
                assistantMessage: ChatMessage;
              }
            );
          } else if (eventName === 'error') {
            throw new Error(String(parsed.error ?? 'Streaming error'));
          }
        }
        sepIdx = buffer.indexOf('\n\n');
      }
    }
  },

  editMessageAndRegenerate: (
    messageId: string,
    content: string,
    platform?: string
  ) =>
    requestJson<{ conversationId: string; messages: ChatMessage[] }>(
      `/api/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content, platform }),
      }
    ),

  restoreMessage: (messageId: string) =>
    requestJson<{ message: ChatMessage }>(
      `/api/messages/${encodeURIComponent(messageId)}/restore`,
      {
        method: 'POST',
      }
    ),

  regenerateLastReply: (conversationId: string, platform?: string) =>
    requestJson<{ messages: ChatMessage[] }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/regenerate`,
      {
        method: 'POST',
        body: JSON.stringify({ platform }),
      }
    ),

  // Real File Manager & Recent Files
  listWorkspaceFiles: (params?: { path?: string; q?: string; ext?: string }) => {
    const sp = new URLSearchParams();
    if (params?.path) sp.set('path', params.path);
    if (params?.q) sp.set('q', params.q);
    if (params?.ext) sp.set('ext', params.ext);
    const qs = sp.toString();
    return requestJson<{
      workspaceRoot: string;
      items: WorkspaceFileItem[];
      stats: StorageStatsSummary;
    }>(`/api/files${qs ? `?${qs}` : ''}`);
  },
  listRecentFiles: () => requestJson<{ files: RecentFileEntry[] }>('/api/files/recent'),
  clearRecentFiles: () =>
    requestJson<{ cleared: number }>('/api/files/recent', { method: 'DELETE' }),
  readWorkspaceFile: (path: string) =>
    requestJson<{
      fileName: string;
      relativePath: string;
      mimeType: string;
      sizeBytes: number;
      contentText: string;
      base64Data?: string;
    }>('/api/files/read', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  writeWorkspaceFile: (payload: {
    path: string;
    content: string;
    append?: boolean;
    overwriteConfirmed?: boolean;
  }) =>
    requestJson<{
      relativePath: string;
      sizeBytes: number;
      requiresConfirmation?: boolean;
      message?: string;
    }>('/api/files/write', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  renameWorkspaceFile: (sourcePath: string, newName: string) =>
    requestJson<{ sourcePath: string; destPath: string }>('/api/files/rename', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, newName }),
    }),
  transferWorkspaceFile: (payload: { sourcePath: string; destPath: string; mode: 'copy' | 'move' }) =>
    requestJson<{ completed: boolean; destPath: string }>('/api/files/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteWorkspaceFile: (path: string, confirmed: boolean) =>
    requestJson<{
      deleted: boolean;
      requiresConfirmation?: boolean;
      relativePath: string;
      sizeBytes?: number;
      message: string;
    }>('/api/files/delete', {
      method: 'POST',
      body: JSON.stringify({ path, confirmed }),
    }),
  cleanWorkspaceTempFiles: (paths: string[] | undefined, confirmed: boolean) =>
    requestJson<{
      cleanedCount: number;
      freedBytes: number;
      requiresConfirmation?: boolean;
      message: string;
    }>('/api/files/clean-temp', {
      method: 'POST',
      body: JSON.stringify({ paths, confirmed }),
    }),

  // Live Internet Search, Browse Mode & Search History
  searchWeb: (query: string, preferArabic: boolean) =>
    requestJson<ExternalSearchReport>('/api/web/search', {
      method: 'POST',
      body: JSON.stringify({ query, preferArabic }),
    }),
  browseWebPage: (url: string, searchWithin?: string) =>
    requestJson<WebPageBrowseResult>('/api/web/browse', {
      method: 'POST',
      body: JSON.stringify({ url, searchWithin }),
    }),
  listSearchHistory: () =>
    requestJson<{ history: SearchHistoryEntry[] }>('/api/web/history'),
  clearSearchHistory: () =>
    requestJson<{ cleared: number }>('/api/web/history', { method: 'DELETE' }),
  deleteSearchHistoryItem: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/web/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Activity Log
  listActivityLogs: (category?: ActivityLogEntry['category']) =>
    requestJson<{ logs: ActivityLogEntry[] }>(
      `/api/activity${category ? `?category=${encodeURIComponent(category)}` : ''}`
    ),
  clearActivityLogs: () =>
    requestJson<{ cleared: number }>('/api/activity', { method: 'DELETE' }),
  deleteActivityLogItem: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/activity/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Admin-Protected Knowledge Base Endpoints
  getKnowledgeStats: () =>
    requestJson<KnowledgeBaseStats>('/api/knowledge/stats', undefined, true),
  listKnowledgeRecords: (params: {
    section?: KnowledgeSectionId;
    status?: ReviewStatus;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params.section) sp.set('section', params.section);
    if (params.status) sp.set('status', params.status);
    if (params.q) sp.set('q', params.q);
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.offset) sp.set('offset', String(params.offset));
    return requestJson<{ records: KnowledgeRecord[]; total: number }>(
      `/api/knowledge/records?${sp.toString()}`,
      undefined,
      true
    );
  },
  createKnowledgeRecord: (input: KnowledgeRecordInput) =>
    requestJson<KnowledgeRecord>(
      '/api/knowledge/records',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      true
    ),
  updateKnowledgeRecord: (id: string, updates: Partial<KnowledgeRecordInput>) =>
    requestJson<KnowledgeRecord>(
      `/api/knowledge/records/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      },
      true
    ),
  deleteKnowledgeRecord: (id: string) =>
    requestJson<{ deleted: boolean }>(
      `/api/knowledge/records/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
      true
    ),
  exportKnowledge: (section?: KnowledgeSectionId) =>
    requestJson<{ exportedAt: string; total: number; records: KnowledgeRecord[] }>(
      `/api/knowledge/export${section ? `?section=${encodeURIComponent(section)}` : ''}`,
      undefined,
      true
    ),
  importKnowledge: (records: KnowledgeRecordInput[]) =>
    requestJson<{ inserted: number; duplicates: number; rejected: number; errors: string[] }>(
      '/api/knowledge/import',
      {
        method: 'POST',
        body: JSON.stringify({ records }),
      },
      true
    ),
  backupKnowledge: () =>
    requestJson<{ filePath: string; sizeBytes: number; createdAt: string }>(
      '/api/knowledge/backup',
      { method: 'POST' },
      true
    ),

  listBatches: () => requestJson<{ jobs: BatchJob[] }>('/api/knowledge/batches', undefined, true),
  startBatch: (section: KnowledgeSectionId, targetBatchSize: number) =>
    requestJson<{ job: BatchJob; stats: KnowledgeBaseStats }>(
      '/api/knowledge/batches',
      {
        method: 'POST',
        body: JSON.stringify({ section, targetBatchSize, runImmediately: true }),
      },
      true
    ),
  stepBatch: (jobId: string, maxSteps = 3) =>
    requestJson<{ job: BatchJob; stats: KnowledgeBaseStats }>(
      `/api/knowledge/batches/${encodeURIComponent(jobId)}/step`,
      {
        method: 'POST',
        body: JSON.stringify({ maxSteps }),
      },
      true
    ),
  resumeBatches: () =>
    requestJson<{ resumed: number; jobs: BatchJob[]; stats: KnowledgeBaseStats }>(
      '/api/knowledge/batches/resume',
      { method: 'POST' },
      true
    ),

  runExternalSearch: (query: string, preferArabic: boolean) =>
    requestJson<ExternalSearchReport>(
      '/api/search',
      {
        method: 'POST',
        body: JSON.stringify({ query, preferArabic }),
      },
      true
    ),

  transcribeAudioFallback: (audioBase64: string, mimeType: string, lang: 'ar-SA' | 'en-US') =>
    requestJson<{ transcript: string }>('/api/voice/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType, lang }),
    }),

  synthesizeServerTts: (text: string, voiceName = 'Kore') =>
    requestJson<{ audioBase64: string; mimeType: string }>('/api/voice/tts', {
      method: 'POST',
      body: JSON.stringify({ text, voiceName }),
    }),
};
