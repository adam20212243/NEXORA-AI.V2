import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Mic,
  Search,
  Smartphone,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { SUPPORTED_APPS } from '../shared/supportedApps.ts';
import type {
  AppLanguage,
  ExternalSearchReport,
  ProviderStatus,
} from '../shared/types.ts';
import { apiClient } from '../services/apiClient.ts';
import { detectClientPlatform } from '../services/deviceControlService.ts';
import { getAvailableTtsVoices, getVoiceCapabilities } from '../services/voiceService.ts';

interface SystemProvidersViewProps {
  lang: AppLanguage;
  providers: ProviderStatus[];
  imageGenerationEnabled: boolean;
}

export function SystemProvidersView({
  lang,
  providers,
  imageGenerationEnabled,
}: SystemProvidersViewProps) {
  const isAr = lang === 'ar';
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchReport, setSearchReport] = useState<ExternalSearchReport | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const voiceCaps = getVoiceCapabilities();
  const ttsVoices = getAvailableTtsVoices();
  const currentPlatform = detectClientPlatform();

  const handleTestSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const report = await apiClient.runExternalSearch(searchQuery.trim(), isAr);
      setSearchReport(report);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {isAr ? 'لوحة المزودين والبحث الخارجي والصوت والتحكم' : 'Providers, Search, Voice & Device Bridge'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {isAr
              ? 'حالة الخادم الفعلية والقيود الشفافة دون كشف أي مفاتيح سرية. توليد الصور معطل كليًا.'
              : 'Real server capability status without exposing any API secrets. Image generation is strictly disabled.'}
          </p>
        </div>

        {/* AI Providers Matrix */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'إدارة مزودي الذكاء الاصطناعي (الطبقة الموحدة)' : 'Unified AI Provider Layer'}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isAr
                ? `توليد الصور: ${imageGenerationEnabled ? 'مفعل' : 'محذوف وممنوع'}`
                : `Image Generation: ${imageGenerationEnabled ? 'Enabled' : 'Disabled'}`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isAr ? p.nameAr : p.nameEn}
                  </span>
                  <span
                    className={`flex items-center gap-1 text-xs font-medium ${
                      p.configured
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {p.configured ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{isAr ? 'متاح على الخادم' : 'Configured'}</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{isAr ? 'غير مهيأ' : 'Not Configured'}</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {p.availableModels.join(' · ')}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {isAr ? p.freeTierNotesAr : p.freeTierNotesEn}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Live External Search Tester */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'محرك البحث الخارجي المستقل' : 'Independent External Search Engine'}
            </h2>
          </div>

          <form onSubmit={handleTestSearch} className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isAr
                  ? 'اختبر البحث الخارجي الحقيقي ومقارنة المصادر...'
                  : 'Test live external search and source comparison...'
              }
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={searching}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>{isAr ? 'بحث مباشر' : 'Search Live'}</span>
            </button>
          </form>

          {searchError && <p className="text-xs text-red-600 dark:text-red-400">{searchError}</p>}

          {searchReport && (
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400">
                <span>
                  {isAr ? 'المزود:' : 'Provider:'} <strong className="text-slate-800 dark:text-slate-200">{searchReport.providerUsed}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{searchReport.durationMs}ms</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{searchReport.results.length} {isAr ? 'نتيجة' : 'results'}</span>
              </div>

              {searchReport.error && (
                <p className="text-amber-700 dark:text-amber-400">{searchReport.error}</p>
              )}

              {searchReport.conflictsDetected.map((c, idx) => (
                <p key={idx} className="text-amber-700 dark:text-amber-400">
                  • {c}
                </p>
              ))}

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {searchReport.results.map((r) => (
                  <div key={r.url} className="py-2.5 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        <span>{r.title}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="font-mono tabular-nums text-slate-500">
                        {r.sourceName} · {Math.round(r.reliabilityScore * 100)}%
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{r.snippet}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Voice & Background Diagnostics */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'تشخيص نظام الصوت والعمل في الخلفية' : 'Voice System & Background Constraints'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">{isAr ? 'التعرف المباشر STT' : 'Web Speech STT'}</div>
              <div className="font-semibold mt-1">
                {voiceCaps.speechRecognitionSupported ? (isAr ? 'مدعوم' : 'Supported') : (isAr ? 'يستخدم بديل الخادم' : 'Server Fallback')}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">{isAr ? 'مسجل الصوت البديل' : 'MediaRecorder Fallback'}</div>
              <div className="font-semibold mt-1">
                {voiceCaps.mediaRecorderSupported ? (isAr ? 'متاح' : 'Available') : (isAr ? 'غير متاح' : 'Unavailable')}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">{isAr ? 'أصوات المتصفح TTS' : 'Browser TTS Voices'}</div>
              <div className="font-semibold font-mono tabular-nums mt-1">{ttsVoices.length}</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">{isAr ? 'جسر Android الأصلي' : 'Android Native Bridge'}</div>
              <div className="font-semibold mt-1">
                {voiceCaps.androidBridgeAvailable ? (isAr ? 'متصل' : 'Connected') : (isAr ? 'بيئة متصفح قياسية' : 'Standard Browser')}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {isAr
              ? 'توضيح قيود المتصفح: تمنع المتصفحات وأنظمة التشغيل استمرار استماع الميكروفون بعد إغلاق التبويب أو قفل الشاشة. تم تضمين جسر Kotlin أصلي (bridges/android/app/src/main/java/com/nexora/ai/bridge/NexoraBridge.kt) للتكامل مع Android ForegroundService عند التغليف كتطبيق أصلي، مع حفظ حالة المحادثة دائمًا في قاعدة البيانات.'
              : 'OS & Browser Constraint Notice: Browsers suspend continuous microphone capture when tabs close or screens lock. A native Android WebView bridge (bridges/android/app/src/main/java/com/nexora/ai/bridge/NexoraBridge.kt) is included for ForegroundService audio when packaged natively, while conversation state remains persisted in SQLite.'}
          </p>
        </section>

        {/* Supported Apps & Device Control Catalog */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isAr ? 'التطبيقات المدعومة للفتح والتحكم' : 'Supported Apps & Launch Protocols'}
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {isAr ? `المنصة الحالية: ${currentPlatform}` : `Current Platform: ${currentPlatform}`}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-start font-medium">{isAr ? 'التطبيق' : 'App'}</th>
                  <th className="py-2 text-start font-medium">{isAr ? 'الأوامر الصوتية/النصية' : 'Aliases'}</th>
                  <th className="py-2 text-start font-medium">Android Package</th>
                  <th className="py-2 text-start font-medium">Windows / Web URI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {SUPPORTED_APPS.map((app) => (
                  <tr key={app.id}>
                    <td className="py-2 font-medium text-slate-900 dark:text-slate-100">
                      {isAr ? app.labelAr : app.labelEn}
                    </td>
                    <td className="py-2 text-slate-600 dark:text-slate-400">
                      {app.aliases.slice(0, 3).join(', ')}
                    </td>
                    <td className="py-2 font-mono text-slate-500">{app.androidPackage ?? '—'}</td>
                    <td className="py-2 font-mono text-slate-500">
                      {app.windowsProtocol ?? app.webFallbackUrl ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
