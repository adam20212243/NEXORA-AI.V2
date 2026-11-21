import { Check, Copy, ExternalLink, Globe, History, Loader2, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.ts';
import type {
  AppSettings,
  ExternalSearchReport,
  SearchHistoryEntry,
  WebPageBrowseResult,
} from '../shared/types.ts';

interface WebResearchViewProps {
  settings: AppSettings;
  onUseSummaryInChat: (prompt: string) => void;
}

export function WebResearchView({ settings, onUseSummaryInChat }: WebResearchViewProps) {
  const isAr = settings.language === 'ar';
  const [mode, setMode] = useState<'search' | 'browse'>('search');

  // Search mode state
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchReport, setSearchReport] = useState<ExternalSearchReport | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Browse & Execute mode state
  const [browseUrl, setBrowseUrl] = useState('https://en.wikipedia.org/wiki/Isaac_Newton');
  const [searchWithin, setSearchWithin] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [pageData, setPageData] = useState<WebPageBrowseResult | null>(null);
  const [pendingActionUrl, setPendingActionUrl] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCopyLink = (url: string) => {
    void navigator.clipboard?.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl((c) => (c === url ? null : c)), 1800);
  };

  const loadHistory = async () => {
    try {
      const res = await apiClient.listSearchHistory();
      setHistory(res.history);
    } catch {
      // Ignore history load error
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const handleRunSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setErrorMsg(null);
    try {
      const report = await apiClient.searchWeb(searchQuery.trim(), isAr);
      setSearchReport(report);
      if (report.error && report.results.length === 0) {
        setErrorMsg(report.error);
      }
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const openPageInBrowseMode = async (targetUrl: string, withinQuery = searchWithin) => {
    setMode('browse');
    setBrowseUrl(targetUrl);
    setBrowsing(true);
    setErrorMsg(null);
    setPendingActionUrl(null);
    try {
      const result = await apiClient.browseWebPage(targetUrl, withinQuery.trim() || undefined);
      setPageData(result);
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed loading web page.');
    } finally {
      setBrowsing(false);
    }
  };

  const handleBrowseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!browseUrl.trim()) return;
    void openPageInBrowseMode(browseUrl.trim(), searchWithin);
  };

  const handleClearHistory = async () => {
    await apiClient.clearSearchHistory();
    setHistory([]);
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {isAr ? 'البحث المباشر ووضع تصفح المواقع' : 'Live Search & Web Browse Mode'}
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              {isAr
                ? 'وضعان حقيقيان: البحث عن المصادر المباشرة، أو فتح وقراءة المواقع الآمنة والبحث بداخلها.'
                : 'Two live modes: real-time web search with citations, or HTTPS page reading and in-page inspection.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium border ${
                mode === 'search'
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              {isAr ? '1. وضع البحث' : '1. Search Mode'}
            </button>
            <button
              type="button"
              onClick={() => setMode('browse')}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium border ${
                mode === 'browse'
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              {isAr ? '2. وضع التصفح والقراءة' : '2. Browse & Read Mode'}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Mode 1: Real Search Mode */}
        {mode === 'search' && (
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <form onSubmit={handleRunSearch} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isAr ? 'ابحث في الإنترنت عن موضوع، خبر، أو معلومة...' : 'Search the live web...'}
                className="flex-1 min-w-52 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={searching}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
              >
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>{isAr ? 'بحث مباشر' : 'Live Search'}</span>
              </button>
            </form>

            {searchReport && (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">
                  {isAr ? 'المحرك المستخدم:' : 'Provider:'} <span className="font-mono">{searchReport.providerUsed}</span> ·{' '}
                  {searchReport.results.length} {isAr ? 'نتيجة' : 'results'} ({searchReport.durationMs}ms)
                </div>

                {searchReport.results.map((r) => (
                  <div
                    key={r.url}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        <span>{r.title}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <span className="text-[11px] text-slate-500">{r.sourceName}</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                      {r.snippet}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
                      <button
                        type="button"
                        onClick={() => void openPageInBrowseMode(r.url)}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {isAr ? 'فتح وقراءة الصفحة الآن' : 'Browse & Read Page'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(r.url)}
                        className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:underline"
                      >
                        {copiedUrl === r.url ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{copiedUrl === r.url ? (isAr ? 'تم النسخ' : 'Copied') : isAr ? 'نسخ الرابط' : 'Copy Link'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUseSummaryInChat(
                            isAr
                              ? `لخص هذه النتيجة وأجب بدقة: ${r.title} (${r.url})\n${r.snippet}`
                              : `Summarize this result accurately: ${r.title} (${r.url})\n${r.snippet}`
                          )
                        }
                        className="text-slate-600 dark:text-slate-300 hover:underline"
                      >
                        {isAr ? 'إرسال إلى المحادثة' : 'Send to Chat'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Mode 2: Browse & Read Mode */}
        {mode === 'browse' && (
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <form onSubmit={handleBrowseSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="url"
                value={browseUrl}
                onChange={(e) => setBrowseUrl(e.target.value)}
                placeholder="https://..."
                className="md:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
              />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchWithin}
                  onChange={(e) => setSearchWithin(e.target.value)}
                  placeholder={isAr ? 'بحث داخل الصفحة...' : 'Find in page...'}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  disabled={browsing}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                >
                  {browsing ? <Loader2 className="w-4 h-4 animate-spin" /> : (isAr ? 'فتح وقراءة' : 'Open & Read')}
                </button>
              </div>
            </form>

            {pendingActionUrl && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-amber-900 dark:text-amber-200">
                  {isAr
                    ? `تأكيد تنفيذ إجراء التصفح / الانتقال إلى: ${pendingActionUrl}`
                    : `Confirm executing web navigation/action to: ${pendingActionUrl}`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingActionUrl(null)}
                    className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700"
                  >
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openPageInBrowseMode(pendingActionUrl)}
                    className="px-2.5 py-1 rounded bg-blue-600 text-white"
                  >
                    {isAr ? 'تأكيد وتنفيذ' : 'Confirm & Execute'}
                  </button>
                </div>
              </div>
            )}

            {pageData && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{pageData.title}</h2>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {pageData.siteName} · {pageData.finalUrl}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUseSummaryInChat(
                        isAr
                          ? `لخص محتوى صفحة "${pageData.title}" (${pageData.finalUrl}):\n\n${pageData.textExcerpt.slice(0, 3000)}`
                          : `Summarize web page "${pageData.title}" (${pageData.finalUrl}):\n\n${pageData.textExcerpt.slice(0, 3000)}`
                      )
                    }
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                  >
                    {isAr ? 'تلخيص الصفحة في المحادثة' : 'Summarize in Chat'}
                  </button>
                </div>

                {pageData.inPageMatches.length > 0 && (
                  <div className="rounded-lg bg-blue-50/70 dark:bg-blue-950/30 p-3 space-y-1 text-xs">
                    <div className="font-semibold text-blue-800 dark:text-blue-300">
                      {isAr ? 'نتائج البحث داخل الصفحة:' : 'In-Page Matches:'}
                    </div>
                    {pageData.inPageMatches.map((m, idx) => (
                      <p key={idx} className="text-slate-700 dark:text-slate-300">
                        · {m}
                      </p>
                    ))}
                  </div>
                )}

                <div className="text-xs leading-relaxed whitespace-pre-wrap bg-slate-50 dark:bg-slate-800 p-3.5 rounded-lg max-h-64 overflow-y-auto text-slate-800 dark:text-slate-200">
                  {pageData.textExcerpt}
                </div>

                {pageData.links.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {isAr ? `الروابط المستخرجة (${pageData.links.length}):` : `Extracted Links (${pageData.links.length}):`}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto text-xs">
                      {pageData.links.map((lnk, idx) => (
                        <div
                          key={`${lnk.url}-${idx}`}
                          className="flex items-center justify-between gap-1 px-2 py-1 rounded bg-slate-50 dark:bg-slate-800/70"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (settings.requireConfirmationForWebActions) {
                                setPendingActionUrl(lnk.url);
                              } else {
                                void openPageInBrowseMode(lnk.url);
                              }
                            }}
                            className="text-start truncate text-blue-600 dark:text-blue-400 hover:underline flex-1 min-w-0"
                            title={lnk.url}
                          >
                            <Globe className="w-3 h-3 inline me-1" />
                            {lnk.text || lnk.url}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyLink(lnk.url)}
                            className="p-1 text-slate-400 hover:text-blue-600 shrink-0"
                            title={isAr ? 'نسخ الرابط' : 'Copy Link'}
                          >
                            {copiedUrl === lnk.url ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pageData.forms.length > 0 && (
                  <div className="text-xs text-slate-500">
                    {isAr
                      ? `تم رصد ${pageData.forms.length} نموذج صفحة (يتطلب إرسال النماذج الحساسة موافقة صريحة منك).`
                      : `Detected ${pageData.forms.length} page forms (explicit confirmation enforced before web actions).`}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Search & Browse History */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <History className="w-4 h-4 text-blue-600" />
              <span>{isAr ? 'سجل البحث والتصفح' : 'Search & Browse History'}</span>
              <span className="text-xs font-normal text-slate-500">
                ({settings.saveSearchHistory ? (isAr ? 'التسجيل مفعّل' : 'Recording On') : (isAr ? 'التسجيل متوقف' : 'Recording Off')})
              </span>
            </div>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => void handleClearHistory()}
                className="flex items-center gap-1 text-xs text-red-600 hover:underline"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isAr ? 'مسح السجل' : 'Clear History'}</span>
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <p className="text-xs text-slate-500">
              {isAr ? 'لا يوجد سجل بحث أو تصفح محفوظ حتى الآن.' : 'No saved search or browse history yet.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
              {history.map((h) => (
                <div key={h.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {h.site_name}
                      </span>
                      {h.query && (
                        <span className="text-slate-500">· &quot;{h.query}&quot;</span>
                      )}
                      {h.url && (
                        <button
                          type="button"
                          onClick={() => void openPageInBrowseMode(h.url)}
                          className="text-blue-600 dark:text-blue-400 hover:underline truncate max-w-xs"
                        >
                          {h.url}
                        </button>
                      )}
                    </div>
                    {h.summary && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {h.summary}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono text-slate-400">
                      {new Date(h.visited_at).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiClient.deleteSearchHistoryItem(h.id);
                        setHistory((prev) => prev.filter((item) => item.id !== h.id));
                      }}
                      className="p-1 text-slate-400 hover:text-red-600"
                      aria-label={isAr ? 'حذف العنصر' : 'Delete history entry'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
