import {
  Activity,
  CheckCircle2,
  Lock,
  Mic,
  Music,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  ambientMusicService,
  type AmbientMusicSnapshot,
} from '../services/ambientMusicService.ts';
import {
  apiClient,
  type AmbientAudioStatusResponse,
  type GeminiHealthResponse,
} from '../services/apiClient.ts';
import {
  checkLocalWindowsBridgeStatus,
  openDefaultAssistantSettings,
  openSystemSettingsSection,
} from '../services/deviceControlService.ts';
import {
  getAudioInputDevices,
  getAvailableTtsVoices,
  getMicrophonePermissionState,
  getVoiceAssistantStatus,
  getVoiceCapabilities,
  playReadyChime,
  speakText,
  startBackgroundVoiceService,
  stopAllSpeech,
  stopBackgroundVoiceService,
  testMicrophoneCapture,
  type AudioInputDeviceOption,
  type MicPermissionStatus,
} from '../services/voiceService.ts';
import { PERSONALITY_STYLES } from '../shared/constants.ts';
import type {
  ActivityLogEntry,
  AIProviderId,
  AppLanguage,
  AppSettings,
  AppTheme,
  PersonalityStyleId,
  ProviderStatus,
} from '../shared/types.ts';

interface SettingsViewProps {
  settings: AppSettings;
  providers: ProviderStatus[];
  ambientStatus?: AmbientAudioStatusResponse | null;
  onAmbientStatusChange?: (status: AmbientAudioStatusResponse) => void;
  onSaveSettings: (updates: Partial<AppSettings>) => Promise<void>;
  onResetSettings: () => Promise<void>;
  onOpenAdminPanel?: () => void;
}

type SettingsTab = 'general' | 'voice' | 'control_privacy' | 'activity';

export function SettingsView({
  settings,
  providers,
  ambientStatus,
  onAmbientStatusChange,
  onSaveSettings,
  onResetSettings,
  onOpenAdminPanel,
}: SettingsViewProps) {
  const isAr = settings.language === 'ar';
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [micDevices, setMicDevices] = useState<AudioInputDeviceOption[]>([]);
  const [micPermission, setMicPermission] = useState<MicPermissionStatus>('prompt');
  const [micTestResult, setMicTestResult] = useState<string | null>(null);
  const [testingMic, setTestingMic] = useState(false);
  const [speakerTestStatus, setSpeakerTestStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // Ambient background music state
  const [ambientSnap, setAmbientSnap] = useState<AmbientMusicSnapshot>(() =>
    ambientMusicService.getSnapshot()
  );
  const [ambientUploadMsg, setAmbientUploadMsg] = useState<string | null>(null);
  const [uploadingAmbient, setUploadingAmbient] = useState(false);

  // Live service & bridge checks
  const [geminiHealth, setGeminiHealth] = useState<GeminiHealthResponse | null>(null);
  const [windowsBridge, setWindowsBridge] = useState<{ connected: boolean; allowlisted: string[] } | null>(null);
  const [systemActionMsg, setSystemActionMsg] = useState<string | null>(null);

  // Real persisted activity logs
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>('all');
  const [loadingActivity, setLoadingActivity] = useState(false);

  const voiceCaps = getVoiceCapabilities();
  const assistantStatus = getVoiceAssistantStatus(draft.enableWakeWord);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    const unsub = ambientMusicService.subscribe(() => {
      setAmbientSnap(ambientMusicService.getSnapshot());
    });
    return unsub;
  }, []);

  const refreshHardwareInfo = async () => {
    setVoices(getAvailableTtsVoices());
    setMicPermission(await getMicrophonePermissionState());
    setMicDevices(await getAudioInputDevices());
    try {
      setGeminiHealth(await apiClient.getGeminiHealth());
    } catch {
      // ignore probe failure
    }
    setWindowsBridge(await checkLocalWindowsBridgeStatus());
  };

  const loadActivityLogs = async (filter = activityFilter) => {
    setLoadingActivity(true);
    try {
      const cat =
        filter !== 'all' ? (filter as ActivityLogEntry['category']) : undefined;
      const res = await apiClient.listActivityLogs(cat);
      setActivityLogs(res.logs);
    } catch {
      // ignore
    } finally {
      setLoadingActivity(false);
    }
  };

  useEffect(() => {
    void refreshHardwareInfo();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const onVoices = () => setVoices(getAvailableTtsVoices());
      window.speechSynthesis.addEventListener('voiceschanged', onVoices);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (activeTab === 'activity') {
      void loadActivityLogs(activityFilter);
    }
  }, [activeTab, activityFilter]);

  const selectedProviderMeta = providers.find((p) => p.id === draft.activeProvider);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings(draft);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestMicrophone = async () => {
    setTestingMic(true);
    setMicTestResult(null);
    const res = await testMicrophoneCapture(draft.voiceInputDeviceId || undefined);
    await refreshHardwareInfo();
    setTestingMic(false);
    if (!res.ok) {
      setMicTestResult(
        isAr ? `فشل اختبار الميكروفون: ${res.error}` : `Microphone test failed: ${res.error}`
      );
    } else {
      const pct = Math.round(res.peakLevel * 100);
      setMicTestResult(
        isAr
          ? `الميكروفون يعمل! أعلى مستوى صوت ملتقط: ${pct}%`
          : `Microphone active! Peak input signal measured: ${pct}%`
      );
    }
  };

  const handleTestSpeakers = async () => {
    setSpeakerTestStatus(isAr ? 'جاري اختبار السماعات...' : 'Testing speakers...');
    playReadyChime();
    await speakText({
      text: isAr
        ? 'مرحبًا، هذا اختبار صوتي للتأكد من عمل السماعات ومستوى الصوت في NEXORA AI.'
        : 'Hello, this is a speaker, volume, and voice synthesis test for NEXORA AI.',
      lang: draft.language,
      rate: draft.voiceTtsRate,
      volume: draft.voiceTtsVolume,
      preferredVoiceName: draft.voiceTtsVoiceName,
      useServerFallback: draft.useServerTtsFallback,
      onEnd: () =>
        setSpeakerTestStatus(isAr ? 'اكتمل اختبار السماعات بنجاح.' : 'Speaker test completed.'),
      onError: (err) => setSpeakerTestStatus(err),
    });
  };

  const handleToggleAmbientPlay = async () => {
    const nextEnabled = !draft.ambientMusicEnabled;
    const updates: Partial<AppSettings> = {
      ambientMusicEnabled: nextEnabled,
      ambientMusicMuted: nextEnabled ? false : draft.ambientMusicMuted,
    };
    setDraft((prev) => ({ ...prev, ...updates }));
    ambientMusicService.configure({
      enabled: nextEnabled,
      muted: updates.ambientMusicMuted,
    });
    await onSaveSettings(updates);
  };

  const handleToggleAmbientMute = async () => {
    const nextMuted = !draft.ambientMusicMuted;
    const updates: Partial<AppSettings> = { ambientMusicMuted: nextMuted };
    setDraft((prev) => ({ ...prev, ...updates }));
    ambientMusicService.configure({ muted: nextMuted });
    await onSaveSettings(updates);
  };

  const handleAmbientVolumeChange = (nextVolume: number) => {
    const clamped = Math.max(0.02, Math.min(0.6, nextVolume));
    setDraft((prev) => ({ ...prev, ambientMusicVolume: clamped }));
    ambientMusicService.configure({ volume: clamped });
  };

  const handleAmbientFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAmbient(true);
    setAmbientUploadMsg(null);
    try {
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Failed reading MP3 file.'));
        reader.readAsDataURL(file);
      });
      const updated = await apiClient.uploadAmbientAudio(file.name, base64Data);
      onAmbientStatusChange?.(updated);
      setAmbientUploadMsg(
        isAr
          ? `تم حفظ ${updated.fileName} وتشغيله بالخلفية بنجاح.`
          : `${updated.fileName} saved and ready.`
      );
    } catch (err) {
      setAmbientUploadMsg(
        err instanceof Error
          ? err.message
          : isAr
          ? 'تعذر رفع ملف الموسيقى.'
          : 'Failed uploading MP3.'
      );
    } finally {
      setUploadingAmbient(false);
    }
  };

  const activeAmbientFileName =
    ambientStatus?.fileName || 'NEXORA_Daddy_Yankee_seamless_loop__1__da91dab1.mp3';

  const ambientStatusLabel = (() => {
    if (!ambientStatus?.available && !ambientSnap.available) {
      return isAr ? 'ملف الموسيقى الخلفية غير متوفر' : 'Ambient track unavailable';
    }
    switch (ambientSnap.status) {
      case 'playing':
        return isAr ? 'قيد التشغيل بهدوء (تكرار سلس)' : 'Playing smoothly (seamless loop)';
      case 'muted':
        return isAr ? 'مكتوم' : 'Muted';
      case 'awaiting_interaction':
        return isAr ? 'يبدأ عند أول تفاعل (قيود المتصفح/Android)' : 'Starts on first tap (Autoplay policy)';
      case 'stopped':
        return isAr ? 'متوقف' : 'Stopped';
      default:
        return isAr ? 'جاهز' : 'Ready';
    }
  })();

  const permLabel: Record<MicPermissionStatus, { ar: string; en: string }> = {
    granted: { ar: 'مسموح (Granted)', en: 'Granted' },
    denied: { ar: 'مرفوض (Denied)', en: 'Denied' },
    prompt: { ar: 'يتطلب موافقة عند التشغيل', en: 'Prompt on Use' },
    unsupported: { ar: 'غير مدعوم في هذه البيئة', en: 'Unsupported' },
  };

  const tabs: Array<{ id: SettingsTab; labelAr: string; labelEn: string; icon: typeof Sliders }> = [
    { id: 'general', labelAr: 'عام والذكاء الاصطناعي', labelEn: 'AI & General', icon: Sliders },
    { id: 'voice', labelAr: 'الصوت والمساعد الخلفي', labelEn: 'Voice & Assistant', icon: Mic },
    {
      id: 'control_privacy',
      labelAr: 'الملفات والتحكم والخصوصية',
      labelEn: 'Control, Files & Privacy',
      icon: Shield,
    },
    { id: 'activity', labelAr: 'سجل النشاط', labelEn: 'Activity Log', icon: Activity },
  ];

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <form onSubmit={handleSave} className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {isAr ? 'الإعدادات المتقدمة وسجل النشاط' : 'Advanced Settings & Activity Log'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {isAr
                ? 'إعدادات Gemini، الصوت، المساعد الخلفي، التحكم، الصلاحيات، الخصوصية، وسجل النشاط الحقيقي.'
                : 'Configure Gemini connection, voice, background assistant, permissions, privacy, and activity logs.'}
            </p>
          </div>
          {activeTab !== 'activity' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await onResetSettings();
                  setSavedNotice(true);
                  setTimeout(() => setSavedNotice(false), 3000);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isAr ? 'إعادة الإعدادات الافتراضية' : 'Reset Defaults'}</span>
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ الإعدادات' : 'Save Settings')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Section Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{isAr ? tab.labelAr : tab.labelEn}</span>
              </button>
            );
          })}
        </div>

        {savedNotice && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            {isAr ? 'تم حفظ الإعدادات وتطبيقها بنجاح.' : 'Settings saved and applied.'}
          </div>
        )}

        {/* TAB 1: General & AI Connection */}
        {activeTab === 'general' && (
          <div className="space-y-5">
            {/* Gemini & AI Connection Health */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isAr ? 'الاتصال بـ Gemini ومزود الذكاء الاصطناعي' : 'Gemini & AI Provider Connection'}
                </h2>
                <span className="text-xs flex items-center gap-1.5">
                  {geminiHealth?.configured ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {isAr ? 'GEMINI_API_KEY متصل بالخادم' : 'GEMINI_API_KEY Active on Server'}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-amber-700 dark:text-amber-400">
                        {isAr ? 'GEMINI_API_KEY غير مهيأ حاليًا' : 'GEMINI_API_KEY Not Configured'}
                      </span>
                    </>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr ? 'المزود النشط' : 'Active Provider'}
                  </label>
                  <select
                    value={draft.activeProvider}
                    onChange={(e) => {
                      const nextId = e.target.value as AIProviderId;
                      const meta = providers.find((p) => p.id === nextId);
                      setDraft({
                        ...draft,
                        activeProvider: nextId,
                        activeModel: meta?.modelDefault ?? draft.activeModel,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {isAr ? p.nameAr : p.nameEn}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr ? 'النموذج النشط (يدعم تحليل الصور عند التوفر)' : 'Active Model (Vision-capable when supported)'}
                  </label>
                  <select
                    value={draft.activeModel}
                    onChange={(e) => setDraft({ ...draft, activeModel: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
                  >
                    {(selectedProviderMeta?.availableModels ?? [draft.activeModel]).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-6 pt-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableExternalSearch}
                    onChange={(e) => setDraft({ ...draft, enableExternalSearch: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'تفعيل البحث الخارجي الموثق عند الحاجة' : 'Enable External Search Grounding'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableReferenceImages}
                    onChange={(e) => setDraft({ ...draft, enableReferenceImages: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'جلب صور مرجعية حقيقية من الويب عند الحاجة' : 'Fetch real Web reference images'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableProviderFallback}
                    onChange={(e) => setDraft({ ...draft, enableProviderFallback: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'الانتقال التلقائي لمزود بديل عند الفشل' : 'Auto-fallback to backup provider'}</span>
                </label>
              </div>
            </section>

            {/* 8 Personality Styles */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isAr ? `أسلوب شخصية NEXORA (${PERSONALITY_STYLES.length} أساليب)` : `NEXORA Personality Style (${PERSONALITY_STYLES.length} Modes)`}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isAr
                    ? 'يؤثر الأسلوب المختار على طريقة الشرح فقط مع الحفاظ على الإجابات المباشرة والمختصرة.'
                    : 'Selected style adjusts phrasing while keeping answers accurate and concise.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {PERSONALITY_STYLES.map((style) => {
                  const selected = draft.personalityStyle === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, personalityStyle: style.id as PersonalityStyleId })
                      }
                      className={`text-start p-3.5 rounded-lg border transition-colors ${
                        selected
                          ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {isAr ? style.nameAr : style.nameEn}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        {isAr ? style.descriptionAr : style.descriptionEn}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Language, Theme, Notifications & Memory */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-900 dark:text-slate-100 block">
                  {isAr ? 'لغة الواجهة والاتجاه' : 'Interface Language & Direction'}
                </label>
                <select
                  value={draft.language}
                  onChange={(e) => setDraft({ ...draft, language: e.target.value as AppLanguage })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                >
                  <option value="ar">العربية (RTL)</option>
                  <option value="en">English (LTR)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-900 dark:text-slate-100 block">
                  {isAr ? 'المظهر' : 'Theme'}
                </label>
                <select
                  value={draft.theme}
                  onChange={(e) => setDraft({ ...draft, theme: e.target.value as AppTheme })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                >
                  <option value="light">{isAr ? 'نهاري (Light)' : 'Light'}</option>
                  <option value="dark">{isAr ? 'ليلي (Dark)' : 'Dark'}</option>
                </select>
              </div>

              <div className="sm:col-span-2 flex flex-wrap gap-6 pt-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.memoryConsentGranted}
                    onChange={(e) => setDraft({ ...draft, memoryConsentGranted: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    {isAr
                      ? 'السماح بحفظ تفضيلات المستخدم الشخصية لتخصيص الردود'
                      : 'Consent to remembering personal preferences'}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableNotifications}
                    onChange={(e) => setDraft({ ...draft, enableNotifications: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'تفعيل إشعارات سطح المكتب عند وصول رد في الخلفية' : 'Enable Desktop Notifications'}</span>
                </label>
              </div>

              {/* Quick Ambient Music Bar right inside General Settings */}
              <div className="sm:col-span-2 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <Music className="w-4 h-4 text-blue-600 shrink-0" />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {isAr ? 'الموسيقى الخلفية الهادئة:' : 'Ambient Background Music:'}
                    </span>{' '}
                    <span className="text-slate-500 dark:text-slate-400">{ambientStatusLabel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleToggleAmbientPlay()}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
                      draft.ambientMusicEnabled
                        ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {draft.ambientMusicEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{draft.ambientMusicEnabled ? (isAr ? 'إيقاف' : 'Stop') : (isAr ? 'تشغيل' : 'Play')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleAmbientMute()}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
                      draft.ambientMusicMuted
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {draft.ambientMusicMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span>{draft.ambientMusicMuted ? (isAr ? 'إلغاء الكتم' : 'Unmute') : (isAr ? 'كتم الصوت' : 'Mute')}</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: Voice, Microphone, Volume & Background Voice Assistant */}
        {activeTab === 'voice' && (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isAr ? 'الميكروفون، النطق، ومستوى الصوت' : 'Microphone, TTS Voice, Rate & Volume'}
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {isAr ? 'حالة إذن الميكروفون:' : 'Mic Permission:'}{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {isAr ? permLabel[micPermission].ar : permLabel[micPermission].en}
                  </strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr ? 'لغة التحدث (STT)' : 'Speech Language'}
                  </label>
                  <select
                    value={draft.voiceSttLang}
                    onChange={(e) =>
                      setDraft({ ...draft, voiceSttLang: e.target.value as 'ar-SA' | 'en-US' })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                  >
                    <option value="ar-SA">العربية (ar-SA)</option>
                    <option value="en-US">English (en-US)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr ? 'وضع زر الميكروفون' : 'Microphone Input Mode'}
                  </label>
                  <select
                    value={draft.voiceMicMode}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        voiceMicMode: e.target.value as 'record_send' | 'live_dictation',
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                  >
                    <option value="record_send">
                      {isAr ? 'التسجيل والمراجعة قبل الإرسال' : 'Record & Review Before Send'}
                    </option>
                    <option value="live_dictation">
                      {isAr ? 'الإملاء المباشر أثناء التحدث' : 'Live Dictation into Input'}
                    </option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr ? 'جهاز الميكروفون' : 'Microphone Device'}
                  </label>
                  <select
                    value={draft.voiceInputDeviceId}
                    onChange={(e) => setDraft({ ...draft, voiceInputDeviceId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                  >
                    <option value="">{isAr ? 'الميكروفون الافتراضي' : 'System Default Mic'}</option>
                    {micDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr ? 'اختيار الصوت (TTS)' : 'Voice Selection'}
                  </label>
                  <select
                    value={draft.voiceTtsVoiceName}
                    onChange={(e) => setDraft({ ...draft, voiceTtsVoiceName: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                  >
                    <option value="">{isAr ? 'تلقائي حسب اللغة' : 'Auto by Language'}</option>
                    {voices.map((v) => (
                      <option key={`${v.name}-${v.lang}`} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr ? `سرعة الكلام (${draft.voiceTtsRate.toFixed(1)}x)` : `Rate (${draft.voiceTtsRate.toFixed(1)}x)`}
                  </label>
                  <input
                    type="range"
                    min="0.6"
                    max="1.8"
                    step="0.1"
                    value={draft.voiceTtsRate}
                    onChange={(e) => setDraft({ ...draft, voiceTtsRate: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr
                      ? `مستوى الصوت (${Math.round(draft.voiceTtsVolume * 100)}%)`
                      : `Volume (${Math.round(draft.voiceTtsVolume * 100)}%)`}
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={draft.voiceTtsVolume}
                    onChange={(e) => setDraft({ ...draft, voiceTtsVolume: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.voiceTtsEnabled}
                    onChange={(e) => setDraft({ ...draft, voiceTtsEnabled: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'تفعيل نظام قراءة الردود الصوتية (TTS)' : 'Enable Voice Responses (TTS)'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.autoSpeakResponses}
                    onChange={(e) => setDraft({ ...draft, autoSpeakResponses: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'قراءة الردود تلقائيًا عند وصولها' : 'Auto-speak assistant replies'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.autoSendVoiceTranscript}
                    onChange={(e) => setDraft({ ...draft, autoSendVoiceTranscript: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'إرسال النص الصوتي تلقائيًا بعد التعرف عليه' : 'Auto-send recognized speech'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableWakeWord}
                    onChange={(e) => setDraft({ ...draft, enableWakeWord: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'تفعيل التنبيه الصوتي ("هاي مساعد" / "يا NEXORA")' : 'Enable Wake Word ("Hey Assistant")'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.useServerTtsFallback}
                    onChange={(e) => setDraft({ ...draft, useServerTtsFallback: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'استخدام محرك صوت الخادم عند نقص أصوات المتصفح' : 'Server TTS fallback'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowBackgroundTts}
                    onChange={(e) => setDraft({ ...draft, allowBackgroundTts: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'السماح باستمرار القراءة عند تصغير الشاشة' : 'Allow background TTS playback'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableFloatingVoiceButton}
                    onChange={(e) => setDraft({ ...draft, enableFloatingVoiceButton: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'إظهار زر المساعد الصوتي العائم (Floating Button)' : 'Show Floating Voice Assistant Button'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableBackgroundVoiceAssistant}
                    onChange={(e) =>
                      setDraft({ ...draft, enableBackgroundVoiceAssistant: e.target.checked })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'تفعيل وضع المساعد الصوتي NEXORA' : 'Enable NEXORA Voice Assistant Mode'}</span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={testingMic}
                  onClick={() => void handleTestMicrophone()}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Mic className="w-3.5 h-3.5 text-blue-600" />
                  <span>{testingMic ? (isAr ? 'جاري الاختبار...' : 'Testing Mic...') : (isAr ? 'اختبار الميكروفون' : 'Test Microphone')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleTestSpeakers()}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>{isAr ? 'اختبار السماعات' : 'Test Speakers'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    stopAllSpeech();
                    setSpeakerTestStatus(isAr ? 'تم إيقاف الصوت فورًا.' : 'Audio stopped immediately.');
                  }}
                  className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  {isAr ? 'إيقاف الصوت فورًا' : 'Stop Audio Now'}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const res = await openSystemSettingsSection('microphone');
                    setSystemActionMsg(isAr ? res.messageAr : res.messageEn);
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300"
                >
                  {isAr ? 'فتح إذن الميكروفون بالنظام' : 'OS Microphone Settings'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const res = openDefaultAssistantSettings();
                    setSystemActionMsg(isAr ? res.messageAr : res.messageEn);
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300"
                >
                  {isAr ? 'تعيين كمساعد رقمي (زر الباور)' : 'Default Assistant (Power Button)'}
                </button>

                {micTestResult && (
                  <span className="text-xs text-slate-700 dark:text-slate-300">{micTestResult}</span>
                )}
                {speakerTestStatus && (
                  <span className="text-xs text-slate-700 dark:text-slate-300">{speakerTestStatus}</span>
                )}
                {systemActionMsg && (
                  <span className="text-xs text-blue-700 dark:text-blue-300">{systemActionMsg}</span>
                )}
              </div>
            </section>

            {/* Ambient Background Music Card */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isAr ? 'مشغل الموسيقى الخلفية' : 'Ambient Background Music'}
                  </h2>
                </div>
                <span className="px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  {ambientStatusLabel}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>
                  {isAr ? 'المقطع النشط:' : 'Active track:'}{' '}
                  <code className="font-mono text-[11px] text-slate-800 dark:text-slate-200">
                    {activeAmbientFileName}
                  </code>
                </span>
                {ambientStatus?.available && (
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <Upload className="w-3 h-3" />
                    <span>
                      {uploadingAmbient
                        ? isAr
                          ? 'جاري الرفع...'
                          : 'Uploading...'
                        : isAr
                        ? 'تغيير المقطع (.mp3)'
                        : 'Change Track (.mp3)'}
                    </span>
                    <input
                      type="file"
                      accept=".mp3,audio/mpeg"
                      disabled={uploadingAmbient}
                      onChange={(e) => void handleAmbientFileUpload(e)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {isAr
                  ? 'تكرار مستمر بانتقال تلاشي سلس (1.6 ثانية) ومستوى صوت هادئ مع خفض تلقائي أثناء الميكروفون أو قراءة الردود. يستمر التشغيل أثناء تنقلك بين جميع صفحات NEXORA دون تكرار.'
                  : 'Continuous seamless crossfade loop (1.6s) at calm volume with automatic voice ducking during microphone capture or TTS, persisting across all views without duplicate instances.'}
              </p>

              {!ambientStatus?.available && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-3 space-y-2 text-xs text-amber-900 dark:text-amber-200">
                  <div className="font-semibold">
                    {isAr
                      ? 'ملف الموسيقى الخلفية غير موجود بعد'
                      : 'Ambient audio file is not present on the server yet'}
                  </div>
                  <p className="leading-relaxed">
                    {isAr
                      ? 'لا يشغّل NEXORA أي موسيقى خارجية تلقائيًا. يمكنك رفع ملف MP3 محلي مباشرة هنا:'
                      : 'No external audio is ever fetched. Upload a local MP3 file directly here:'}
                  </p>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-medium cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {uploadingAmbient
                        ? isAr
                          ? 'جاري الرفع...'
                          : 'Uploading...'
                        : isAr
                        ? 'اختيار ورفع ملف MP3'
                        : 'Select & Upload MP3'}
                    </span>
                    <input
                      type="file"
                      accept=".mp3,audio/mpeg"
                      disabled={uploadingAmbient}
                      onChange={(e) => void handleAmbientFileUpload(e)}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {ambientUploadMsg && (
                <p className="text-xs text-blue-700 dark:text-blue-300">{ambientUploadMsg}</p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleToggleAmbientPlay()}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border ${
                    draft.ambientMusicEnabled
                      ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                      : 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {draft.ambientMusicEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>
                    {draft.ambientMusicEnabled
                      ? isAr
                        ? 'إيقاف الموسيقى'
                        : 'Stop Ambient Music'
                      : isAr
                      ? 'تشغيل الموسيقى'
                      : 'Play Ambient Music'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleToggleAmbientMute()}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border ${
                    draft.ambientMusicMuted
                      ? 'bg-amber-100 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {draft.ambientMusicMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>
                    {draft.ambientMusicMuted
                      ? isAr
                        ? 'إلغاء كتم الموسيقى'
                        : 'Unmute Music'
                      : isAr
                      ? 'كتم الصوت'
                      : 'Mute Music'}
                  </span>
                </button>

                <div className="flex-1 min-w-[200px] space-y-1">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                    {isAr
                      ? `مستوى الصوت الهادئ (${Math.round(draft.ambientMusicVolume * 100)}%)`
                      : `Calm Volume (${Math.round(draft.ambientMusicVolume * 100)}%)`}
                  </label>
                  <input
                    type="range"
                    min="0.02"
                    max="0.6"
                    step="0.02"
                    value={draft.ambientMusicVolume}
                    onChange={(e) => handleAmbientVolumeChange(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            </section>

            {/* Background Voice Assistant Transparency Box */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  NEXORA Voice Assistant ({isAr ? 'المساعد الخلفي' : 'Background Service'})
                </h2>
                <span className="font-mono text-slate-500">
                  {voiceCaps.androidBridgeAvailable ? 'Android Native APK' : 'Web Browser'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {isAr ? assistantStatus.reasonAr : assistantStatus.reasonEn}
              </p>
              {voiceCaps.androidBridgeAvailable && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const out = startBackgroundVoiceService();
                      setSystemActionMsg(
                        out.ok
                          ? isAr
                            ? 'تم تشغيل خدمة الصوت في الخلفية.'
                            : 'Background service started.'
                          : out.error || null
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium"
                  >
                    {isAr ? 'تشغيل خدمة الصوت في الخلفية' : 'Start Foreground Voice Service'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const out = stopBackgroundVoiceService();
                      setSystemActionMsg(
                        out.ok
                          ? isAr
                            ? 'تم إيقاف خدمة الصوت في الخلفية.'
                            : 'Background service stopped.'
                          : out.error || null
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
                  >
                    {isAr ? 'إيقاف خدمة الخلفية' : 'Stop Service'}
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 3: Files, Device Control, Web Safety & Privacy */}
        {activeTab === 'control_privacy' && (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isAr ? 'صلاحيات الملفات، التحكم بالجهاز، والخصوصية' : 'Files, Device Control & Privacy'}
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableFileManagerAccess}
                    onChange={(e) => setDraft({ ...draft, enableFileManagerAccess: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'صلاحية الوصول إلى مدير الملفات ومساحة العمل' : 'Enable File Manager & Workspace Access'}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableDeviceControl}
                    onChange={(e) => setDraft({ ...draft, enableDeviceControl: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'تفعيل أوامر فتح التطبيقات والتحكم بالجهاز' : 'Enable Device Control & App Commands'}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.confirmDestructiveActions}
                    onChange={(e) =>
                      setDraft({ ...draft, confirmDestructiveActions: e.target.checked })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    {isAr
                      ? 'طلب تأكيد صريح قبل حذف الملفات أو إغلاق التطبيقات'
                      : 'Always confirm before deleting files or closing apps'}
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.requireConfirmationForWebActions}
                    onChange={(e) =>
                      setDraft({ ...draft, requireConfirmationForWebActions: e.target.checked })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    {isAr
                      ? 'طلب تأكيد قبل تنفيذ إجراءات المواقع في وضع التصفح'
                      : 'Confirm before executing web browse actions'}
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.saveSearchHistory}
                    onChange={(e) => setDraft({ ...draft, saveSearchHistory: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'حفظ سجل البحث والمواقع التي تمت زيارتها' : 'Save Search & Browse History'}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.saveActivityLog}
                    onChange={(e) => setDraft({ ...draft, saveActivityLog: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>{isAr ? 'تسجيل العمليات داخل سجل النشاط' : 'Record Actions in Activity Log'}</span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {isAr ? 'جسر Windows المحلي (127.0.0.1:48920):' : 'Local Windows Bridge:'}{' '}
                  </span>
                  <span className={windowsBridge?.connected ? 'text-emerald-600' : 'text-slate-500'}>
                    {windowsBridge?.connected
                      ? isAr
                        ? `متصل (${windowsBridge.allowlisted.join(', ')})`
                        : `Connected (${windowsBridge.allowlisted.join(', ')})`
                      : isAr
                      ? 'غير متصل (تعمل الروابط المباشرة وبروتوكولات الويب بدونه)'
                      : 'Offline (browser protocols & links still available)'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const out = await openSystemSettingsSection('main');
                      setSystemActionMsg(isAr ? out.messageAr : out.messageEn);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {isAr ? 'فتح إعدادات الجهاز' : 'Open OS Settings'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiClient.clearSearchHistory();
                      setSystemActionMsg(isAr ? 'تم مسح سجل البحث.' : 'Search history cleared.');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    {isAr ? 'مسح سجل البحث' : 'Clear Search History'}
                  </button>
                  {onOpenAdminPanel && (
                    <button
                      type="button"
                      onClick={onOpenAdminPanel}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{isAr ? 'لوحة الإدارة المحمية' : 'Admin Security Panel'}</span>
                    </button>
                  )}
                </div>
              </div>
              {systemActionMsg && (
                <div className="text-xs text-blue-700 dark:text-blue-300">{systemActionMsg}</div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: Real Activity Log */}
        {activeTab === 'activity' && (
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isAr ? 'سجل النشاط الحقيقي (Activity Log)' : 'Real Activity Log'}
                </h2>
                <p className="text-xs text-slate-500">
                  {isAr
                    ? 'يسجل عمليات البحث، تصفح المواقع، قراءة/تعديل الملفات، الأوامر، وحالة التنفيذ الفعلية.'
                    : 'Tracks searches, visited websites, file operations, executed commands, and outcome statuses.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs"
                >
                  <option value="all">{isAr ? 'جميع الأنشطة' : 'All Categories'}</option>
                  <option value="search">{isAr ? 'البحث' : 'Search'}</option>
                  <option value="browse">{isAr ? 'تصفح المواقع' : 'Web Browse'}</option>
                  <option value="file">{isAr ? 'الملفات' : 'Files'}</option>
                  <option value="command">{isAr ? 'أوامر الجهاز' : 'Device Commands'}</option>
                  <option value="ai">{isAr ? 'محادثات AI' : 'AI Responses'}</option>
                </select>
                <button
                  type="button"
                  onClick={() => void loadActivityLogs(activityFilter)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingActivity ? 'animate-spin' : ''}`} />
                  <span>{isAr ? 'تحديث' : 'Refresh'}</span>
                </button>
                {activityLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      await apiClient.clearActivityLogs();
                      setActivityLogs([]);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-xs text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isAr ? 'مسح السجل' : 'Clear Log'}</span>
                  </button>
                )}
              </div>
            </div>

            {activityLogs.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                {isAr ? 'لا توجد أنشطة مسجلة في هذا التصنيف.' : 'No recorded activities in this category.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[28rem] overflow-y-auto">
                {activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">
                          [{log.category}]
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {log.action}
                        </span>
                        {log.target && (
                          <span className="text-slate-600 dark:text-slate-400 truncate max-w-sm">
                            · {log.target}
                          </span>
                        )}
                      </div>
                      {log.detail && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {log.detail}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-[11px]">
                      <span
                        className={
                          log.status === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : log.status === 'failed'
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : 'text-amber-600 dark:text-amber-400 font-medium'
                        }
                      >
                        {log.status === 'success'
                          ? isAr
                            ? 'نجحت'
                            : 'Success'
                          : log.status === 'failed'
                          ? isAr
                            ? 'فشلت'
                            : 'Failed'
                          : isAr
                          ? 'بانتظار التأكيد'
                          : 'Pending Confirm'}
                      </span>
                      <span className="font-mono text-slate-400">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiClient.deleteActivityLogItem(log.id);
                          setActivityLogs((prev) => prev.filter((item) => item.id !== log.id));
                        }}
                        className="p-1 text-slate-400 hover:text-red-600"
                        aria-label={isAr ? 'حذف السجل' : 'Delete log item'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </form>
    </div>
  );
}
