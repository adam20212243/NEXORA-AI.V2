import {
  AlertCircle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  RefreshCw,
  Smartphone,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient, type DownloadInfoResponse } from '../services/apiClient.ts';
import { openDefaultAssistantSettings } from '../services/deviceControlService.ts';
import type { AppLanguage } from '../shared/types.ts';

interface DownloadViewProps {
  lang: AppLanguage;
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DownloadView({ lang }: DownloadViewProps) {
  const isAr = lang === 'ar';
  const [info, setInfo] = useState<DownloadInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedApkUrl, setCopiedApkUrl] = useState(false);
  const [assistantNote, setAssistantNote] = useState<string | null>(null);

  const loadInfo = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    try {
      const data = await apiClient.getDownloadInfo(forceRefresh);
      setInfo(data);
    } catch {
      // Keep previous info if transient fetch fails
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadInfo(false);
  }, []);

  const currentWebUrl = info?.webUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const windowsBridgeCommand = 'node bridges/windows-agent/nexora-bridge.mjs';
  const formattedSize = formatBytes(info?.apkSizeBytes);

  const handleCopyCommand = () => {
    void navigator.clipboard?.writeText(windowsBridgeCommand);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  };

  const handleCopyApkUrl = () => {
    if (!info?.apkUrl) return;
    void navigator.clipboard?.writeText(info.apkUrl);
    setCopiedApkUrl(true);
    setTimeout(() => setCopiedApkUrl(false), 1800);
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {isAr ? 'تنزيل وتشغيل NEXORA AI على أجهزتك' : 'Download & Run NEXORA AI'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {isAr
                ? 'تنزيل حزمة Android APK المنشورة عبر GitHub Releases، تثبيت الويب، وجسر Windows بدون أي روابط وهمية.'
                : 'Verified GitHub Releases APK download, Web app shortcut, and Windows desktop companion.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadInfo(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{isAr ? 'تحديث حالة الإصدار' : 'Refresh Release Status'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Android Native APK Release Card */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-5 h-5 text-blue-600" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {isAr ? 'تطبيق Android (APK)' : 'Android Native App (APK)'}
                </h2>
              </div>
              {info?.apkAvailable && info.apkVersion && (
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
                  {info.apkVersion}
                </span>
              )}
            </div>

            {loading ? (
              <div className="text-xs text-slate-500 py-4">
                {isAr ? 'جاري التحقق من حالة إصدار APK المنشور...' : 'Verifying published APK release...'}
              </div>
            ) : info?.apkAvailable && info.apkUrl ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {isAr
                    ? 'تم التحقق من توفر ملف APK المنشور للتنزيل المباشر مع دعم الجسر الأصلي وخدمة الميكروفون الخلفية وتعيين NEXORA كمساعد رقمي افتراضي.'
                    : 'Verified published Android APK ready for direct download with native bridge, microphone foreground service, and Digital Assistant support.'}
                </p>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 text-[11px]">
                  {info.apkFileName && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">{isAr ? 'الملف:' : 'File:'}</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">{info.apkFileName}</span>
                    </div>
                  )}
                  {formattedSize && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">{isAr ? 'الحجم:' : 'Size:'}</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">{formattedSize}</span>
                    </div>
                  )}
                  {info.apkPublishedAt && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">{isAr ? 'تاريخ النشر:' : 'Published:'}</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {new Date(info.apkPublishedAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={info.apkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={info.apkFileName || 'nexora-ai-latest.apk'}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                  >
                    <Download className="w-4 h-4" />
                    <span>{isAr ? 'تنزيل NEXORA APK' : 'Download APK'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    type="button"
                    onClick={handleCopyApkUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium"
                  >
                    {copiedApkUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>{isAr ? 'تم النسخ' : 'Copied'}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>{isAr ? 'نسخ رابط APK' : 'Copy APK Link'}</span>
                      </>
                    )}
                  </button>

                  {info.releasePageUrl && (
                    <a
                      href={info.releasePageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline px-2"
                    >
                      <span>{isAr ? 'صفحة الإصدار على GitHub' : 'GitHub Release'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <div className="font-mono text-[11px] bg-slate-50 dark:bg-slate-800 px-2.5 py-2 rounded border border-slate-200 dark:border-slate-700 break-all" dir="ltr">
                  {info.apkUrl}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 space-y-2.5 text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {info?.apkStatus === 'no_release_yet'
                      ? isAr
                        ? 'لم يُنشر أي ملف APK في GitHub Releases بعد'
                        : 'No APK Published on GitHub Releases Yet'
                      : info?.apkStatus === 'unreachable'
                      ? isAr
                        ? 'رابط APK المُعد حاليًا لا يستجيب بملف صالح'
                        : 'Configured APK Link Is Unreachable'
                      : isAr
                      ? 'بانتظار نشر أول إصدار APK وربط المستودع'
                      : 'Awaiting First APK Release Publication'}
                  </span>
                </div>
                <p className="leading-relaxed">
                  {isAr
                    ? 'مشروع Android Gradle الكامل جاهز للتجميع التلقائي عبر GitHub Actions عند دفع وسم إصدار (مثل v1.0.0)، ولا يتم عرض زر تنزيل لملف غير موجود.'
                    : 'The complete Android Gradle wrapper project and GitHub Actions release workflow are ready. No download button is shown until an actual .apk release asset exists.'}
                </p>
                {info?.statusMessage && (
                  <p className="text-[11px] opacity-80 font-mono" dir="ltr">
                    {info.statusMessage}
                  </p>
                )}
                <div className="font-mono text-[11px] bg-white/80 dark:bg-slate-900/70 px-2.5 py-2 rounded border border-amber-200 dark:border-amber-800 space-y-1" dir="ltr">
                  <div>1. git tag v1.0.0 && git push origin v1.0.0</div>
                  <div>2. Set env NEXORA_GITHUB_REPO=&lt;owner&gt;/&lt;repo&gt;</div>
                  <div className="text-[10px] opacity-75">
                    or NEXORA_APK_RELEASE_URL=https://github.com/&lt;owner&gt;/&lt;repo&gt;/releases/latest/download/nexora-ai-latest.apk
                  </div>
                </div>
                {info?.releasePageUrl && (
                  <a
                    href={info.releasePageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium underline"
                  >
                    <span>{isAr ? 'فتح GitHub Releases' : 'Open GitHub Releases'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {isAr ? 'تعيين NEXORA لزر الباور على Android:' : 'Assigning NEXORA to Power Button:'}
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                {isAr
                  ? 'بعد تثبيت حزمة APK: الإعدادات ← التطبيقات ← التطبيقات الافتراضية ← تطبيق المساعد الرقمي ← اختر NEXORA AI.'
                  : 'After installing the APK: Settings → Apps → Default apps → Digital assistant app → Select NEXORA AI.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  const out = openDefaultAssistantSettings();
                  setAssistantNote(isAr ? out.messageAr : out.messageEn);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium"
              >
                {isAr ? 'فتح إعدادات المساعد الافتراضي' : 'Open Default Assistant Settings'}
              </button>
              {assistantNote && (
                <p className="text-amber-700 dark:text-amber-300">{assistantNote}</p>
              )}
            </div>
          </section>

          {/* Windows & Web PWA Install Card */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Laptop className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {isAr ? 'الويب وجسر Windows المحلي' : 'Web App & Windows Desktop Bridge'}
              </h2>
            </div>

            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {isAr ? 'تثبيت نسخة الويب كتطبيق على الهاتف أو الكمبيوتر:' : 'Install Web Version as App Shortcut:'}
              </div>
              <p className="leading-relaxed">
                {isAr
                  ? 'افتح الرابط الحالي في Chrome أو Edge ثم اختر "إضافة إلى الشاشة الرئيسية" أو "تثبيت التطبيق" (Install App) للوصول السريع.'
                  : 'Open the live URL in Chrome or Edge and choose "Add to Home Screen" or "Install App" for standalone launch.'}
              </p>
              {currentWebUrl && (
                <div className="font-mono text-[11px] bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 break-all" dir="ltr">
                  {currentWebUrl}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                <Terminal className="w-4 h-4 text-blue-600" />
                <span>
                  {isAr
                    ? `جسر التحكم بتطبيقات Windows (منفذ ${info?.windowsBridgePort ?? 48920}):`
                    : `Windows Local Companion Bridge (Port ${info?.windowsBridgePort ?? 48920}):`}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {isAr
                  ? 'لتشغيل أو إغلاق برامج Windows المسموح بها (الحاسبة، Excel، Word، VS Code، Chrome، Spotify) مباشرة من المتصفح، شغّل الجسر المحلي على جهازك:'
                  : 'To launch or close allowlisted desktop apps directly from the browser on Windows, run the companion bridge locally:'}
              </p>
              <div className="flex items-center justify-between gap-2 bg-slate-950 text-slate-100 rounded-lg px-3 py-2 font-mono text-[11px]">
                <span className="truncate" dir="ltr">{windowsBridgeCommand}</span>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="shrink-0 p-1 rounded hover:bg-slate-800 text-slate-300"
                  title={isAr ? 'نسخ الأمر' : 'Copy command'}
                >
                  {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
