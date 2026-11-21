export type KnowledgeSectionId =
  | 'science'
  | 'programming'
  | 'medicine'
  | 'history_culture'
  | 'logic_creativity';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ReviewStatus = 'verified' | 'needs_review' | 'rejected';

export type PersonalityStyleId =
  | 'friendly'
  | 'professional'
  | 'concise'
  | 'simple'
  | 'scientific'
  | 'expert'
  | 'analytical'
  | 'creative';

export type AIProviderId =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openai-compatible'
  | 'local';

export type AppLanguage = 'ar' | 'en';

export type AppTheme = 'light' | 'dark';

export interface KnowledgeRecord {
  id: string;
  section: KnowledgeSectionId;
  subcategory: string;
  title: string;
  detailed_content: string;
  simple_explanation: string;
  context: string;
  usage_limits: string;
  sources: string[];
  source_urls: string[];
  accessed_at: string;
  confidence_level: ConfidenceLevel;
  review_status: ReviewStatus;
  keywords: string[];
  dedup_key: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeRecordInput {
  id?: string;
  section: KnowledgeSectionId;
  subcategory: string;
  title: string;
  detailed_content: string;
  simple_explanation: string;
  context: string;
  usage_limits: string;
  sources: string[];
  source_urls: string[];
  accessed_at?: string;
  confidence_level: ConfidenceLevel;
  review_status?: ReviewStatus;
  keywords: string[];
  dedup_key?: string;
}

export interface SectionStats {
  section: KnowledgeSectionId;
  targetCount: number;
  totalCount: number;
  verifiedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
}

export interface KnowledgeBaseStats {
  totalRecords: number;
  targetTotal: number;
  verifiedTotal: number;
  needsReviewTotal: number;
  sections: SectionStats[];
  lastUpdatedAt: string | null;
}

export interface BatchJob {
  id: string;
  section: KnowledgeSectionId;
  source_type: 'wikipedia' | 'curated' | 'ai_assisted' | 'import';
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  target_batch_size: number;
  processed_count: number;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  cursor_category_index: number;
  cursor_continue_token: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalSearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
  publishedAt: string | null;
  accessedAt: string;
  reliabilityScore: number;
  provider: 'gemini_google_search' | 'wikipedia_api' | 'openalex_api';
}

export interface ExternalSearchReport {
  query: string;
  executed: boolean;
  providerUsed: string;
  results: ExternalSearchResult[];
  conflictsDetected: string[];
  error: string | null;
  durationMs: number;
}

export interface DeviceControlCommand {
  detected: boolean;
  action: 'open_app' | 'close_app' | 'open_url' | 'system_setting' | 'file_action' | 'none';
  rawQuery: string;
  extractedAppName: string | null;
  matchedAppId: string | null;
  matchedAppLabel: string | null;
  targetPlatform: 'android' | 'windows' | 'macos' | 'linux' | 'ios' | 'web';
  supportedOnCurrentPlatform: boolean;
  requiresConfirmation: boolean;
  autoLaunchRecommended: boolean;
  launchUri: string | null;
  androidPackage: string | null;
  androidIntentUri: string | null;
  windowsProtocol: string | null;
  pendingFileAction?: {
    operation: 'delete' | 'clean_temp' | 'move' | 'copy' | 'create' | 'list' | 'search' | 'storage_stats';
    targetPath?: string;
    destPath?: string;
    content?: string;
  };
  messageAr: string;
  messageEn: string;
}

export interface ChatSourceWeb {
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  reliabilityScore: number;
}

export interface ToolCapabilityDescriptor {
  id: string;
  category:
    | 'research'
    | 'writing'
    | 'coding'
    | 'math_science'
    | 'files'
    | 'productivity'
    | 'voice_device';
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  requiredPermissionsAr?: string;
  requiredPermissionsEn?: string;
  connectionStatus?: 'ready' | 'requires_permission' | 'requires_api_key' | 'native_bridge_optional';
  samplePromptAr: string;
  samplePromptEn: string;
}

export interface ToolExecutionTrace {
  toolId: string;
  toolNameAr: string;
  toolNameEn: string;
  success: boolean;
  summary: string;
  error?: string;
}

export interface AttachedDocumentInput {
  fileName: string;
  mimeType: string;
  contentText?: string;
  base64Data?: string;
  sizeBytes?: number;
}

export interface UserPreferenceItem {
  id: string;
  key: string;
  value: string;
  category?: 'preference' | 'project' | 'saved_fact';
  consented: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserTaskItem {
  id: string;
  title: string;
  notes: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  created_at: string;
}

export interface SearchHistoryEntry {
  id: string;
  site_name: string;
  url: string;
  query: string;
  summary: string;
  mode: 'search' | 'browse';
  visited_at: string;
}

export interface RecentFileEntry {
  id: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  source: 'workspace' | 'upload' | 'browser_fs';
  summary: string;
  accessed_at: string;
}

export interface ActivityLogEntry {
  id: string;
  category: 'search' | 'browse' | 'file' | 'command' | 'tool' | 'ai';
  action: string;
  target: string;
  tool_id: string | null;
  status: 'success' | 'failed' | 'pending_confirmation';
  detail: string;
  created_at: string;
}

export interface WorkspaceFileItem {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  extension: string;
  modifiedAt: string;
  isTempCandidate: boolean;
}

export interface DuplicateFileGroup {
  hash: string;
  sizeBytes: number;
  files: string[];
}

export interface StorageStatsSummary {
  workspaceRoot: string;
  totalFiles: number;
  totalFolders: number;
  totalSizeBytes: number;
  tempFilesCount: number;
  tempFilesSizeBytes: number;
  tempCandidates: WorkspaceFileItem[];
  largeFiles?: WorkspaceFileItem[];
  duplicateGroups?: DuplicateFileGroup[];
}

export interface WebPageBrowseResult {
  url: string;
  finalUrl: string;
  siteName: string;
  title: string;
  textExcerpt: string;
  inPageMatches: string[];
  links: Array<{ text: string; url: string }>;
  forms: Array<{ action: string; method: string; inputs: string[] }>;
  fetchedAt: string;
}

export interface ReferenceImageItem {
  title: string;
  imageUrl: string;
  thumbUrl: string;
  pageUrl: string;
  sourceName: string;
}

export interface DataColumnStat {
  column: string;
  count: number;
  missing: number;
  min: number;
  max: number;
  mean: number;
  sum: number;
}

export interface DataAnalysisSummary {
  fileName: string;
  sheetName?: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  numericStats: DataColumnStat[];
  chartSeries?: Array<{ label: string; value: number }>;
  sampleRows: Array<Record<string, string | number>>;
}

export interface MasterResponsePayload {
  answer: string;
  language: AppLanguage;
  personalityStyle: PersonalityStyleId;
  providerUsed: AIProviderId | 'kb_offline_synthesis' | 'error';
  modelUsed: string;
  questionDomain?:
    | 'science'
    | 'programming'
    | 'medicine'
    | 'history_geography'
    | 'thinking_creative'
    | 'math'
    | 'image_analysis'
    | 'file_operation'
    | 'device_control'
    | 'web_search'
    | 'general';
  apiErrorCode?:
    | 'NOT_CONFIGURED'
    | 'QUOTA_EXCEEDED'
    | 'INVALID_KEY'
    | 'MODEL_NOT_FOUND'
    | 'VISION_UNSUPPORTED'
    | 'NETWORK_ERROR'
    | 'UPSTREAM_ERROR';
  toolsExecuted: ToolExecutionTrace[];
  webSources: ChatSourceWeb[];
  referenceImages?: ReferenceImageItem[];
  dataAnalysis?: DataAnalysisSummary;
  uncertaintyLevel: 'low' | 'medium' | 'high';
  medicalDisclaimerIncluded: boolean;
  deviceCommand: DeviceControlCommand | null;
  externalSearchExecuted: boolean;
  externalSearchError: string | null;
  processingMs: number;
  // Internal telemetry (never rendered to regular users in chat UI)
  internalUsedKbCount?: number;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  original_content?: string | null;
  is_edited?: boolean;
  metadata?: Partial<MasterResponsePayload>;
  attachmentsPreview?: Array<{ fileName: string; mimeType: string; dataUrl?: string }>;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  pinned?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderStatus {
  id: AIProviderId;
  nameAr: string;
  nameEn: string;
  configured: boolean;
  modelDefault: string;
  availableModels: string[];
  freeTierNotesAr: string;
  freeTierNotesEn: string;
  supportsSearchGrounding: boolean;
  supportsVision?: boolean;
}

export interface AppSettings {
  language: AppLanguage;
  theme: AppTheme;
  personalityStyle: PersonalityStyleId;
  activeProvider: AIProviderId;
  activeModel: string;
  enableExternalSearch: boolean;
  enableReferenceImages: boolean;
  enableProviderFallback: boolean;
  voiceSttLang: 'ar-SA' | 'en-US';
  voiceInputDeviceId: string;
  voiceMicMode: 'record_send' | 'live_dictation';
  voiceTtsEnabled: boolean;
  voiceTtsRate: number;
  voiceTtsVolume: number;
  voiceTtsVoiceName: string;
  autoSpeakResponses: boolean;
  autoSendVoiceTranscript: boolean;
  useServerTtsFallback: boolean;
  enableWakeWord: boolean;
  allowBackgroundTts: boolean;
  enableBackgroundVoiceAssistant: boolean;
  enableFloatingVoiceButton: boolean;
  enableFileManagerAccess: boolean;
  enableDeviceControl: boolean;
  confirmDestructiveActions: boolean;
  saveSearchHistory: boolean;
  saveActivityLog: boolean;
  enableNotifications: boolean;
  requireConfirmationForWebActions: boolean;
  memoryConsentGranted: boolean;
  ambientMusicEnabled: boolean;
  ambientMusicMuted: boolean;
  ambientMusicVolume: number;
}

export interface AdminAuthStatus {
  needsClaim: boolean;
  authenticated: boolean;
  envPasscodeActive: boolean;
}
