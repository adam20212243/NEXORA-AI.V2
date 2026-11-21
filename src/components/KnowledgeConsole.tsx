import {
  CheckCircle2,
  Database,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { KNOWLEDGE_SECTIONS } from '../shared/constants.ts';
import type {
  AppLanguage,
  BatchJob,
  ConfidenceLevel,
  KnowledgeBaseStats,
  KnowledgeRecord,
  KnowledgeSectionId,
  ReviewStatus,
} from '../shared/types.ts';
import { apiClient } from '../services/apiClient.ts';

interface KnowledgeConsoleProps {
  lang: AppLanguage;
  stats: KnowledgeBaseStats | null;
  onStatsUpdated: (stats: KnowledgeBaseStats) => void;
}

export function KnowledgeConsole({
  lang,
  stats,
  onStatsUpdated,
}: KnowledgeConsoleProps) {
  const isAr = lang === 'ar';
  const [selectedSection, setSelectedSection] = useState<KnowledgeSectionId | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [records, setRecords] = useState<KnowledgeRecord[]>([]);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [batches, setBatches] = useState<BatchJob[]>([]);
  const [batchSection, setBatchSection] = useState<KnowledgeSectionId>('science');
  const [batchSize, setBatchSize] = useState(100);
  const [batchBusy, setBatchBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [inspected, setInspected] = useState<KnowledgeRecord | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [newRecord, setNewRecord] = useState({
    section: 'science' as KnowledgeSectionId,
    subcategory: 'Physics',
    title: '',
    detailed_content: '',
    simple_explanation: '',
    context: '',
    usage_limits: '',
    sourceName: '',
    sourceUrl: '',
    confidence_level: 'high' as ConfidenceLevel,
    keywords: '',
  });

  const loadRecords = async () => {
    setLoadingRecords(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.listKnowledgeRecords({
        section: selectedSection === 'all' ? undefined : selectedSection,
        status: statusFilter === 'all' ? undefined : statusFilter,
        q: searchQuery.trim() || undefined,
        limit: 40,
      });
      setRecords(res.records);
      setTotalFiltered(res.total);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed loading knowledge records.');
    } finally {
      setLoadingRecords(false);
    }
  };

  const loadBatches = async () => {
    try {
      const res = await apiClient.listBatches();
      setBatches(res.jobs);
    } catch {
      // Ignore transient batch fetch issues
    }
  };

  useEffect(() => {
    void loadRecords();
  }, [selectedSection, statusFilter]);

  useEffect(() => {
    void loadBatches();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadRecords();
  };

  const handleStartBatch = async () => {
    setBatchBusy(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const res = await apiClient.startBatch(batchSection, batchSize);
      onStatsUpdated(res.stats);
      await loadBatches();
      await loadRecords();
      setStatusMessage(
        isAr
          ? `تم تنفيذ دفعة الاستيراد: أُضيف ${res.job.inserted_count} سجل فريد، وتُرك ${res.job.duplicate_count} مكرر.`
          : `Batch executed: ${res.job.inserted_count} unique records saved, ${res.job.duplicate_count} duplicates skipped.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Batch execution error.');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleStepBatch = async (jobId: string) => {
    setBatchBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.stepBatch(jobId, 3);
      onStatsUpdated(res.stats);
      await loadBatches();
      await loadRecords();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed stepping batch.');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleResumeBatches = async () => {
    setBatchBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.resumeBatches();
      onStatsUpdated(res.stats);
      await loadBatches();
      await loadRecords();
      setStatusMessage(
        isAr
          ? `تم استئناف ${res.resumed} دفعة غير مكتملة.`
          : `Resumed ${res.resumed} incomplete batch job(s).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed resuming batches.');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      const data = await apiClient.exportKnowledge(
        selectedSection === 'all' ? undefined : selectedSection
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexora-knowledge-${selectedSection}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.records;
      if (!Array.isArray(list)) {
        throw new Error('JSON file must contain an array or { records: [...] }.');
      }
      const res = await apiClient.importKnowledge(list);
      const refreshedStats = await apiClient.getKnowledgeStats();
      onStatsUpdated(refreshedStats);
      await loadRecords();
      setStatusMessage(
        isAr
          ? `الاستيراد: أُضيف ${res.inserted}، مكرر ${res.duplicates}، مرفوض ${res.rejected}.`
          : `Import: inserted ${res.inserted}, duplicates ${res.duplicates}, rejected ${res.rejected}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      e.target.value = '';
    }
  };

  const handleBackup = async () => {
    try {
      const res = await apiClient.backupKnowledge();
      setStatusMessage(
        isAr
          ? `تم إنشاء نسخة احتياطية على الخادم (${res.sizeBytes.toLocaleString()} بايت).`
          : `Server backup created (${res.sizeBytes.toLocaleString()} bytes).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Backup failed.');
    }
  };

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiClient.createKnowledgeRecord({
        section: newRecord.section,
        subcategory: newRecord.subcategory,
        title: newRecord.title,
        detailed_content: newRecord.detailed_content,
        simple_explanation: newRecord.simple_explanation,
        context: newRecord.context || 'Manual verified entry',
        usage_limits: newRecord.usage_limits || 'Educational reference only.',
        sources: [newRecord.sourceName.trim()],
        source_urls: newRecord.sourceUrl.trim() ? [newRecord.sourceUrl.trim()] : [],
        confidence_level: newRecord.confidence_level,
        keywords: newRecord.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      });
      setShowCreateForm(false);
      setNewRecord({
        ...newRecord,
        title: '',
        detailed_content: '',
        simple_explanation: '',
        sourceName: '',
        sourceUrl: '',
        keywords: '',
      });
      onStatsUpdated(await apiClient.getKnowledgeStats());
      await loadRecords();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save record.');
    }
  };

  const handleUpdateStatus = async (id: string, reviewStatus: ReviewStatus) => {
    try {
      const updated = await apiClient.updateKnowledgeRecord(id, { review_status: reviewStatus });
      setInspected(updated);
      onStatsUpdated(await apiClient.getKnowledgeStats());
      await loadRecords();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  const handleDeleteRecord = async (id: string) => {
    try {
      await apiClient.deleteKnowledgeRecord(id);
      if (inspected?.id === id) setInspected(null);
      onStatsUpdated(await apiClient.getKnowledgeStats());
      await loadRecords();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {isAr ? 'قاعدة المعرفة الدائمة (5 أقسام)' : 'Persistent Knowledge Base (5 Sections)'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {isAr
                ? `السجلات المحفوظة فعليًا في SQLite: ${(stats?.totalRecords ?? 0).toLocaleString()} من أصل ${(stats?.targetTotal ?? 20000).toLocaleString()} سجل مستهدف.`
                : `Actual SQLite records stored: ${(stats?.totalRecords ?? 0).toLocaleString()} / ${(stats?.targetTotal ?? 20000).toLocaleString()} target.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{isAr ? 'إضافة سجل' : 'Add Record'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>{isAr ? 'تصدير JSON' : 'Export JSON'}</span>
            </button>
            <label className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap">
              <Upload className="w-4 h-4" />
              <span>{isAr ? 'استيراد JSON' : 'Import JSON'}</span>
              <input type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            </label>
            <button
              type="button"
              onClick={() => void handleBackup()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Database className="w-4 h-4" />
              <span>{isAr ? 'نسخة احتياطية' : 'Backup'}</span>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            {statusMessage}
          </div>
        )}
        {errorMsg && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* 5 Sections Real Counters Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {KNOWLEDGE_SECTIONS.map((sec) => {
            const sStat = stats?.sections.find((s) => s.section === sec.id);
            const count = sStat?.totalCount ?? 0;
            const verified = sStat?.verifiedCount ?? 0;
            const pct = Math.min(100, (count / sec.targetCount) * 100);
            const active = selectedSection === sec.id;

            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setSelectedSection(active ? 'all' : sec.id)}
                className={`text-start p-4 rounded-xl border transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">
                  {isAr ? sec.nameAr : sec.nameEn}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {count.toLocaleString()}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    / {sec.targetCount.toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {isAr ? `موثق: ${verified.toLocaleString()}` : `Verified: ${verified.toLocaleString()}`}
                </div>
              </button>
            );
          })}
        </div>

        {/* Manual Record Creator */}
        {showCreateForm && (
          <form
            onSubmit={handleCreateRecord}
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
          >
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'إضافة سجل معرفي موثق جديد' : 'Add Verified Knowledge Record'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={newRecord.section}
                onChange={(e) =>
                  setNewRecord({ ...newRecord, section: e.target.value as KnowledgeSectionId })
                }
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              >
                {KNOWLEDGE_SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder={isAr ? 'التصنيف الفرعي' : 'Subcategory'}
                value={newRecord.subcategory}
                onChange={(e) => setNewRecord({ ...newRecord, subcategory: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                placeholder={isAr ? 'عنوان المعلومة' : 'Record Title'}
                value={newRecord.title}
                onChange={(e) => setNewRecord({ ...newRecord, title: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </div>
            <textarea
              required
              rows={3}
              placeholder={isAr ? 'المحتوى التفصيلي (20 حرفًا على الأقل)' : 'Detailed content (min 20 chars)'}
              value={newRecord.detailed_content}
              onChange={(e) => setNewRecord({ ...newRecord, detailed_content: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                placeholder={isAr ? 'شرح مبسط' : 'Simple explanation'}
                value={newRecord.simple_explanation}
                onChange={(e) => setNewRecord({ ...newRecord, simple_explanation: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
              <input
                type="text"
                placeholder={isAr ? 'حدود الاستخدام' : 'Usage limits'}
                value={newRecord.usage_limits}
                onChange={(e) => setNewRecord({ ...newRecord, usage_limits: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                placeholder={isAr ? 'اسم المصدر الحقيقي' : 'Real source name'}
                value={newRecord.sourceName}
                onChange={(e) => setNewRecord({ ...newRecord, sourceName: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
              <input
                type="url"
                placeholder={isAr ? 'رابط المصدر (https://...)' : 'Source URL (https://...)'}
                value={newRecord.sourceUrl}
                onChange={(e) => setNewRecord({ ...newRecord, sourceUrl: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
              >
                {isAr ? 'حفظ والتحقق' : 'Save & Validate'}
              </button>
            </div>
          </form>
        )}

        {/* Batch Harvesting & Auto-Resume Panel */}
        <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isAr
                  ? 'محرك الإدخال الدفعي والتحقق والاستكمال التلقائي'
                  : 'Batch Ingestion, Verification & Auto-Resume Engine'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isAr
                  ? 'يجلب دفعات حقيقية وموثقة من واجهة Wikipedia الرسمية باللغتين العربية والإنجليزية مع منع التكرار وحفظ نقاط الاستكمال.'
                  : 'Harvests real verified entries from official Wikipedia APIs (EN & AR) with strict deduplication and crash-safe checkpoints.'}
              </p>
            </div>
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => void handleResumeBatches()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${batchBusy ? 'animate-spin' : ''}`} />
              <span>{isAr ? 'استكمال الدفعات المعلقة' : 'Resume Incomplete Batches'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={batchSection}
              onChange={(e) => setBatchSection(e.target.value as KnowledgeSectionId)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              {KNOWLEDGE_SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {isAr ? s.nameAr : s.nameEn}
                </option>
              ))}
            </select>

            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono tabular-nums"
            >
              <option value={50}>{isAr ? 'دفعة 50 سجلًا' : '50 records'}</option>
              <option value={100}>{isAr ? 'دفعة 100 سجل' : '100 records'}</option>
              <option value={250}>{isAr ? 'دفعة 250 سجلًا' : '250 records'}</option>
              <option value={500}>{isAr ? 'دفعة 500 سجل' : '500 records'}</option>
            </select>

            <button
              type="button"
              disabled={batchBusy}
              onClick={() => void handleStartBatch()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap"
            >
              {batchBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{isAr ? 'تشغيل دفعة جديدة' : 'Run New Batch'}</span>
            </button>
          </div>

          {batches.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 text-start font-medium">{isAr ? 'المهمة' : 'Job'}</th>
                    <th className="py-2 text-start font-medium">{isAr ? 'القسم' : 'Section'}</th>
                    <th className="py-2 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="py-2 text-end font-medium">{isAr ? 'مضاف' : 'Inserted'}</th>
                    <th className="py-2 text-end font-medium">{isAr ? 'مكرر' : 'Dupes'}</th>
                    <th className="py-2 text-end font-medium">{isAr ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {batches.slice(0, 6).map((job) => (
                    <tr key={job.id}>
                      <td className="py-2 font-mono text-slate-700 dark:text-slate-300">{job.id}</td>
                      <td className="py-2 text-slate-700 dark:text-slate-300">{job.section}</td>
                      <td className="py-2 text-slate-700 dark:text-slate-300">{job.status}</td>
                      <td className="py-2 text-end font-mono tabular-nums">
                        {job.inserted_count} / {job.target_batch_size}
                      </td>
                      <td className="py-2 text-end font-mono tabular-nums">{job.duplicate_count}</td>
                      <td className="py-2 text-end">
                        {job.status !== 'completed' && (
                          <button
                            type="button"
                            disabled={batchBusy}
                            onClick={() => void handleStepBatch(job.id)}
                            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                          >
                            {isAr ? 'متابعة' : 'Step'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Search & Records Table */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 min-w-[240px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isAr ? 'بحث نصي FTS5 في السجلات...' : 'FTS5 full-text search...'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ps-9 pe-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-medium whitespace-nowrap"
              >
                {isAr ? 'بحث' : 'Search'}
              </button>
            </form>

            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ReviewStatus | 'all')}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="all">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
                <option value="verified">{isAr ? 'موثق' : 'Verified'}</option>
                <option value="needs_review">{isAr ? 'يحتاج مراجعة' : 'Needs Review'}</option>
                <option value="rejected">{isAr ? 'مرفوض' : 'Rejected'}</option>
              </select>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {totalFiltered.toLocaleString()} {isAr ? 'نتيجة' : 'results'}
              </span>
            </div>
          </div>

          {loadingRecords ? (
            <div className="p-8 flex items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{isAr ? 'جاري تحميل السجلات...' : 'Loading records...'}</span>
            </div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              {isAr ? 'لا توجد سجلات مطابقة لمعايير البحث الحالية.' : 'No records match your current filters.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {records.map((rec) => (
                <div
                  key={rec.id}
                  className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setInspected(rec)}
                    className="flex-1 text-start min-w-0 space-y-1"
                  >
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {rec.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                      <span>{rec.section}</span>
                      <span aria-hidden="true">·</span>
                      <span>{rec.subcategory}</span>
                      <span aria-hidden="true">·</span>
                      <span>{rec.review_status}</span>
                      <span aria-hidden="true">·</span>
                      <span>{rec.confidence_level}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-1">
                      {rec.simple_explanation}
                    </p>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    {rec.review_status !== 'verified' && (
                      <button
                        type="button"
                        onClick={() => void handleUpdateStatus(rec.id, 'verified')}
                        className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                        title={isAr ? 'اعتماد السجل' : 'Mark Verified'}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDeleteRecord(rec.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      title={isAr ? 'حذف' : 'Delete'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Record Detail Inspector Modal */}
        {inspected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="max-w-2xl w-full max-h-[85vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {inspected.title}
                  </h3>
                  <div className="text-xs font-mono text-slate-500 mt-1">
                    {inspected.id} · {inspected.section} / {inspected.subcategory}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspected(null)}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {isAr ? 'إغلاق' : 'Close'}
                </button>
              </div>

              <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300">
                <div>
                  <span className="font-semibold block text-slate-900 dark:text-slate-100">
                    {isAr ? 'المحتوى التفصيلي:' : 'Detailed Content:'}
                  </span>
                  <p className="mt-1 leading-relaxed">{inspected.detailed_content}</p>
                </div>
                <div>
                  <span className="font-semibold block text-slate-900 dark:text-slate-100">
                    {isAr ? 'الشرح المبسط:' : 'Simple Explanation:'}
                  </span>
                  <p className="mt-1">{inspected.simple_explanation}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="font-semibold block">{isAr ? 'السياق:' : 'Context:'}</span>
                    <span>{inspected.context}</span>
                  </div>
                  <div>
                    <span className="font-semibold block">{isAr ? 'حدود الاستخدام:' : 'Usage Limits:'}</span>
                    <span>{inspected.usage_limits}</span>
                  </div>
                  <div>
                    <span className="font-semibold block">{isAr ? 'المصادر:' : 'Sources:'}</span>
                    <span>{inspected.sources.join(', ')}</span>
                  </div>
                  <div>
                    <span className="font-semibold block">{isAr ? 'تاريخ الوصول:' : 'Accessed At:'}</span>
                    <span className="font-mono">{inspected.accessed_at}</span>
                  </div>
                  <div>
                    <span className="font-semibold block">{isAr ? 'الكلمات المفتاحية:' : 'Keywords:'}</span>
                    <span>{inspected.keywords.join(', ')}</span>
                  </div>
                  <div>
                    <span className="font-semibold block">{isAr ? 'مفتاح منع التكرار:' : 'Dedup Key:'}</span>
                    <span className="font-mono break-all">{inspected.dedup_key}</span>
                  </div>
                </div>
                {inspected.source_urls.length > 0 && (
                  <div>
                    <span className="font-semibold block">{isAr ? 'روابط المصادر:' : 'Source URLs:'}</span>
                    <div className="flex flex-col gap-1 mt-1">
                      {inspected.source_urls.map((u) => (
                        <a
                          key={u}
                          href={u}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline break-all"
                        >
                          {u}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => void handleUpdateStatus(inspected.id, 'verified')}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                >
                  {isAr ? 'اعتماد (Verified)' : 'Mark Verified'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpdateStatus(inspected.id, 'needs_review')}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
                >
                  {isAr ? 'يحتاج مراجعة' : 'Needs Review'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
