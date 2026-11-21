import {
  Check,
  FileCode2,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.ts';
import type {
  AppSettings,
  AttachedDocumentInput,
  RecentFileEntry,
  StorageStatsSummary,
  WorkspaceFileItem,
} from '../shared/types.ts';

interface FileManagerViewProps {
  settings: AppSettings;
  onAttachToChatAndOpen: (attachment: AttachedDocumentInput, suggestedPrompt: string) => void;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function FileManagerView({
  settings,
  onAttachToChatAndOpen,
}: FileManagerViewProps) {
  const isAr = settings.language === 'ar';
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [currentSubPath, setCurrentSubPath] = useState('');
  const [items, setItems] = useState<WorkspaceFileItem[]>([]);
  const [stats, setStats] = useState<StorageStatsSummary | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [extFilter, setExtFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Selected file preview
  const [previewData, setPreviewData] = useState<{
    fileName: string;
    relativePath: string;
    mimeType: string;
    sizeBytes: number;
    contentText: string;
    base64Data?: string;
  } | null>(null);

  // Create/Save file panel
  const [createPath, setCreatePath] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Delete & Rename confirmation target
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [pendingTempClean, setPendingTempClean] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Browser File System Access API local folder state
  const [browserFolderName, setBrowserFolderName] = useState<string | null>(null);
  const [browserLocalFiles, setBrowserLocalFiles] = useState<
    Array<{ name: string; file: File }>
  >([]);

  const loadFiles = async (sub = currentSubPath, q = searchQuery, ext = extFilter) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [listRes, recentRes] = await Promise.all([
        apiClient.listWorkspaceFiles({ path: sub, q, ext }),
        apiClient.listRecentFiles(),
      ]);
      setWorkspaceRoot(listRes.workspaceRoot);
      setItems(listRes.items);
      setStats(listRes.stats);
      setRecentFiles(recentRes.files);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed loading files.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (settings.enableFileManagerAccess) {
      void loadFiles('', '', '');
    }
  }, [settings.enableFileManagerAccess]);

  const handleOpenItem = async (item: WorkspaceFileItem) => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (item.isDirectory) {
      setCurrentSubPath(item.relativePath);
      void loadFiles(item.relativePath, searchQuery, extFilter);
      return;
    }
    try {
      const data = await apiClient.readWorkspaceFile(item.relativePath);
      setPreviewData(data);
      const recentRes = await apiClient.listRecentFiles();
      setRecentFiles(recentRes.files);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed reading file.');
    }
  };

  const handleCreateOrSaveFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createPath.trim()) return;
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await apiClient.writeWorkspaceFile({
        path: createPath.trim(),
        content: createContent,
        overwriteConfirmed: true,
      });
      setInfoMsg(
        isAr
          ? `تم حفظ الملف "${res.relativePath}" (${formatBytes(res.sizeBytes)}).`
          : `Saved "${res.relativePath}" (${formatBytes(res.sizeBytes)}).`
      );
      setCreatePath('');
      setCreateContent('');
      setShowCreateForm(false);
      await loadFiles(currentSubPath, searchQuery, extFilter);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed writing file.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeletePath) return;
    setErrorMsg(null);
    try {
      const res = await apiClient.deleteWorkspaceFile(pendingDeletePath, true);
      setInfoMsg(res.message);
      if (previewData?.relativePath === pendingDeletePath) {
        setPreviewData(null);
      }
      setPendingDeletePath(null);
      await loadFiles(currentSubPath, searchQuery, extFilter);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const handleConfirmCleanTemp = async () => {
    setErrorMsg(null);
    try {
      const res = await apiClient.cleanWorkspaceTempFiles(undefined, true);
      setInfoMsg(res.message);
      setPendingTempClean(false);
      await loadFiles(currentSubPath, searchQuery, extFilter);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Cleanup failed.');
    }
  };

  const handleConfirmRename = async (sourcePath: string) => {
    const clean = renameDraft.trim();
    if (!clean) return;
    setErrorMsg(null);
    try {
      const res = await apiClient.renameWorkspaceFile(sourcePath, clean);
      setInfoMsg(
        isAr
          ? `تمت إعادة التسمية إلى "${res.destPath}".`
          : `Renamed to "${res.destPath}".`
      );
      setRenamingPath(null);
      setRenameDraft('');
      await loadFiles(currentSubPath, searchQuery, extFilter);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Rename failed.');
    }
  };

  const handlePickLocalBrowserFolder = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setErrorMsg(
        isAr
          ? 'المتصفح الحالي لا يدعم اختيار المجلد المحلي مباشرة (تعمل هذه الميزة في Chrome/Edge على الكمبيوتر). استخدم زر إرفاق الملف داخل المحادثة.'
          : 'Browser directory picker is unsupported here (available on desktop Chrome/Edge). Use the file attachment button in Chat.'
      );
      return;
    }
    try {
      const handle = await picker();
      setBrowserFolderName(handle.name);
      const found: Array<{ name: string; file: File }> = [];
      for await (const [, entry] of (handle as unknown as {
        entries: () => AsyncIterable<[string, FileSystemHandle]>;
      }).entries()) {
        if (entry.kind === 'file') {
          const file = await (entry as FileSystemFileHandle).getFile();
          found.push({ name: file.name, file });
          if (found.length >= 60) break;
        }
      }
      setBrowserLocalFiles(found);
      setInfoMsg(
        isAr
          ? `تمت قراءة ${found.length} ملف من المجلد المحلي "${handle.name}".`
          : `Loaded ${found.length} files from local folder "${handle.name}".`
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setErrorMsg(err instanceof Error ? err.message : 'Failed reading local folder.');
    }
  };

  const handleOpenLocalBrowserFile = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    if (isImage) {
      const base64 = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onloadend = () => {
          const full = String(r.result || '');
          const idx = full.indexOf(',');
          resolve(idx >= 0 ? full.slice(idx + 1) : full);
        };
        r.readAsDataURL(file);
      });
      setPreviewData({
        fileName: file.name,
        relativePath: `${browserFolderName ?? 'local'}/${file.name}`,
        mimeType: file.type,
        sizeBytes: file.size,
        contentText: `[Image file: ${file.name}]`,
        base64Data: base64,
      });
    } else {
      const text = (await file.text()).slice(0, 30000);
      setPreviewData({
        fileName: file.name,
        relativePath: `${browserFolderName ?? 'local'}/${file.name}`,
        mimeType: file.type || 'text/plain',
        sizeBytes: file.size,
        contentText: text,
      });
    }
  };

  const handleAnalyzePreviewInChat = () => {
    if (!previewData) return;
    const isImage = previewData.mimeType.startsWith('image/');
    onAttachToChatAndOpen(
      {
        fileName: previewData.fileName,
        mimeType: previewData.mimeType,
        contentText: isImage ? undefined : previewData.contentText,
        base64Data: previewData.base64Data,
        sizeBytes: previewData.sizeBytes,
      },
      isImage
        ? isAr
          ? `صف محتوى هذه الصورة "${previewData.fileName}" واستخرج أي نص واضح فيها بدقة.`
          : `Describe image "${previewData.fileName}" and extract any visible text accurately.`
        : isAr
        ? `لخص وحلل ملف "${previewData.fileName}" واستخرج أهم النقاط.`
        : `Summarize and analyze "${previewData.fileName}" with key takeaways.`
    );
  };

  if (!settings.enableFileManagerAccess) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center space-y-2">
          <HardDrive className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isAr ? 'مدير الملفات معطل من الإعدادات' : 'File Manager Access Disabled'}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {isAr
              ? 'فعّل خيار "صلاحية الوصول إلى مدير الملفات" من تبويب الإعدادات لاستعراض وتحليل الملفات.'
              : 'Enable "File Manager Access" inside Settings to browse and analyze workspace files.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {isAr ? 'مدير الملفات والملفات الحديثة' : 'File Manager & Recent Files'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
              {workspaceRoot || './workspace'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePickLocalBrowserFolder()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <FolderOpen className="w-4 h-4 text-blue-600" />
              <span>{isAr ? 'فتح مجلد من الجهاز' : 'Open Device Folder'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>{isAr ? 'إنشاء / حفظ ملف' : 'New File'}</span>
            </button>
          </div>
        </div>

        {/* Storage Metrics, Large Files, Duplicate Detection & Temp Cleanup Card */}
        {stats && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-5">
                <span>
                  {isAr ? 'الملفات:' : 'Files:'}{' '}
                  <strong className="font-mono">{stats.totalFiles}</strong>
                </span>
                <span>
                  {isAr ? 'المجلدات:' : 'Folders:'}{' '}
                  <strong className="font-mono">{stats.totalFolders}</strong>
                </span>
                <span>
                  {isAr ? 'المساحة المستخدمة:' : 'Workspace Size:'}{' '}
                  <strong className="font-mono">{formatBytes(stats.totalSizeBytes)}</strong>
                </span>
                <span>
                  {isAr ? 'ملفات مؤقتة:' : 'Temp Candidates:'}{' '}
                  <strong className="font-mono">
                    {stats.tempFilesCount} ({formatBytes(stats.tempFilesSizeBytes)})
                  </strong>
                </span>
              </div>

              {stats.tempFilesCount > 0 && (
                <button
                  type="button"
                  onClick={() => setPendingTempClean(true)}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 font-medium"
                >
                  {isAr ? 'مراجعة وتنظيف الملفات المؤقتة' : 'Review & Clean Temp Files'}
                </button>
              )}
            </div>

            {((stats.largeFiles && stats.largeFiles.length > 0) ||
              (stats.duplicateGroups && stats.duplicateGroups.length > 0)) && (
              <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3">
                {stats.largeFiles && stats.largeFiles.length > 0 && (
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 space-y-1">
                    <div className="font-semibold text-slate-700 dark:text-slate-200">
                      {isAr
                        ? `الملفات الكبيرة (≥256KB): ${stats.largeFiles.length}`
                        : `Large Files (≥256KB): ${stats.largeFiles.length}`}
                    </div>
                    <div className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                      {stats.largeFiles.slice(0, 4).map((lf) => (
                        <div key={lf.relativePath} className="flex justify-between gap-2 font-mono">
                          <span className="truncate">{lf.relativePath}</span>
                          <span className="shrink-0">{formatBytes(lf.sizeBytes)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stats.duplicateGroups && stats.duplicateGroups.length > 0 && (
                  <div className="rounded-lg bg-amber-50/70 dark:bg-amber-950/20 p-2.5 space-y-1">
                    <div className="font-semibold text-amber-800 dark:text-amber-300">
                      {isAr
                        ? `ملفات مكررة المحتوى (SHA-256): ${stats.duplicateGroups.length}`
                        : `Duplicate Content Groups (SHA-256): ${stats.duplicateGroups.length}`}
                    </div>
                    <div className="space-y-0.5 text-[11px] text-amber-900 dark:text-amber-200 font-mono">
                      {stats.duplicateGroups.slice(0, 3).map((grp) => (
                        <div key={grp.hash} className="truncate">
                          {grp.files.join(' == ')} ({formatBytes(grp.sizeBytes)})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}
        {infoMsg && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            {infoMsg}
          </div>
        )}

        {/* Explicit Confirmation Panels */}
        {pendingDeletePath && (
          <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-red-800 dark:text-red-200 font-medium">
              {isAr
                ? `تأكيد حذف الملف نهائيًا: "${pendingDeletePath}"؟ لا يمكن التراجع عن الحذف.`
                : `Confirm permanent deletion of "${pendingDeletePath}"? This cannot be undone.`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingDeletePath(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                {isAr ? 'نعم، احذف الملف' : 'Yes, Delete File'}
              </button>
            </div>
          </div>
        )}

        {pendingTempClean && stats && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3 text-xs">
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              {isAr
                ? `سيتم حذف ${stats.tempFilesCount} ملف مؤقت بمساحة ${formatBytes(stats.tempFilesSizeBytes)}:`
                : `Confirm deleting ${stats.tempFilesCount} temporary files (${formatBytes(stats.tempFilesSizeBytes)}):`}
            </div>
            <div className="font-mono text-[11px] text-amber-800 dark:text-amber-300 max-h-24 overflow-y-auto">
              {stats.tempCandidates.map((t) => t.relativePath).join(', ')}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingTempClean(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCleanTemp()}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium"
              >
                {isAr ? 'تأكيد تنظيف الملفات المؤقتة' : 'Confirm Clean Temp Files'}
              </button>
            </div>
          </div>
        )}

        {showCreateForm && (
          <form
            onSubmit={handleCreateOrSaveFile}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={createPath}
                onChange={(e) => setCreatePath(e.target.value)}
                placeholder={isAr ? 'اسم ومسار الملف (مثال: notes/plan.md)' : 'File path (e.g. notes/plan.md)'}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                  {isAr ? 'حفظ الملف' : 'Save File'}
                </button>
              </div>
            </div>
            <textarea
              rows={4}
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              placeholder={isAr ? 'محتوى الملف النصي...' : 'Text file content...'}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
            />
          </form>
        )}

        {/* Search Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-52">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadFiles(currentSubPath, searchQuery, extFilter);
              }}
              placeholder={isAr ? 'ابحث باسم الملف أو المحتوى...' : 'Search by file name...'}
              className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
          </div>
          <select
            value={extFilter}
            onChange={(e) => {
              const val = e.target.value;
              setExtFilter(val);
              void loadFiles(currentSubPath, searchQuery, val);
            }}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
          >
            <option value="">{isAr ? 'كل الأنواع' : 'All types'}</option>
            <option value=".txt">TXT</option>
            <option value=".md">Markdown (.md)</option>
            <option value=".pdf">PDF</option>
            <option value=".docx">Word (.docx)</option>
            <option value=".xlsx">Excel (.xlsx)</option>
            <option value=".json">JSON</option>
            <option value=".csv">CSV</option>
            <option value=".png">PNG</option>
            <option value=".jpg">JPG</option>
          </select>
          <button
            type="button"
            onClick={() => void loadFiles(currentSubPath, searchQuery, extFilter)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{isAr ? 'تحديث' : 'Refresh'}</span>
          </button>
        </div>

        {/* Main 2-column Workspace Explorer & File Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Files List */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
              <span>
                {isAr ? 'ملفات مساحة العمل' : 'Workspace Files'}{' '}
                {currentSubPath && <span className="font-mono text-slate-500">/{currentSubPath}</span>}
              </span>
              {currentSubPath && (
                <button
                  type="button"
                  onClick={() => {
                    const parent = currentSubPath.split('/').slice(0, -1).join('/');
                    setCurrentSubPath(parent);
                    void loadFiles(parent, searchQuery, extFilter);
                  }}
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {isAr ? 'رجوع للأعلى' : 'Up'}
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                {isAr
                  ? 'لا توجد ملفات مطابقة بعد. يمكنك إنشاء ملف جديد أو إرفاق ملفات من المحادثة.'
                  : 'No matching files yet. Create a file above or upload via chat.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
                {items.map((item) => {
                  const isRenaming = renamingPath === item.relativePath;
                  return (
                    <div
                      key={item.relativePath}
                      className="py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="text"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleConfirmRename(item.relativePath);
                              if (e.key === 'Escape') setRenamingPath(null);
                            }}
                            className="flex-1 min-w-0 px-2 py-1 rounded border border-blue-400 bg-slate-50 dark:bg-slate-800 text-xs"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => void handleConfirmRename(item.relativePath)}
                            className="p-1 text-emerald-600"
                            aria-label={isAr ? 'تأكيد التسمية' : 'Confirm rename'}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingPath(null)}
                            className="p-1 text-slate-400"
                            aria-label={isAr ? 'إلغاء' : 'Cancel'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleOpenItem(item)}
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-start hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {item.isDirectory ? (
                              <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                            ) : ['.png', '.jpg', '.jpeg', '.webp'].includes(item.extension) ? (
                              <FileImage className="w-4 h-4 text-blue-500 shrink-0" />
                            ) : ['.json', '.ts', '.js', '.py'].includes(item.extension) ? (
                              <FileCode2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                            )}
                            <span className="truncate font-medium">{item.name}</span>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-slate-400">
                            {!item.isDirectory && (
                              <span className="font-mono">{formatBytes(item.sizeBytes)}</span>
                            )}
                            {!item.isDirectory && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingPath(item.relativePath);
                                    setRenameDraft(item.name);
                                  }}
                                  className="p-1 text-slate-400 hover:text-blue-600"
                                  aria-label={isAr ? 'إعادة تسمية' : 'Rename'}
                                  title={isAr ? 'إعادة تسمية' : 'Rename'}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDeletePath(item.relativePath)}
                                  className="p-1 text-slate-400 hover:text-red-600"
                                  aria-label={isAr ? 'حذف الملف' : 'Delete file'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Local Browser Folder Listing */}
            {browserLocalFiles.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {isAr ? `مجلد الجهاز: ${browserFolderName}` : `Device Folder: ${browserFolderName}`}
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {browserLocalFiles.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => void handleOpenLocalBrowserFile(f.file)}
                      className="w-full py-1.5 flex items-center justify-between text-xs text-start hover:text-blue-600"
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="font-mono text-[11px] text-slate-400">{formatBytes(f.file.size)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Preview & Analyze Panel */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            {previewData ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {previewData.fileName}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {previewData.mimeType} · {formatBytes(previewData.sizeBytes)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAnalyzePreviewInChat}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isAr ? 'تحليل في المحادثة' : 'Analyze in Chat'}</span>
                  </button>
                </div>

                {previewData.mimeType.startsWith('image/') && previewData.base64Data ? (
                  <img
                    src={`data:${previewData.mimeType};base64,${previewData.base64Data}`}
                    alt={previewData.fileName}
                    className="max-h-72 rounded-lg border border-slate-200 dark:border-slate-700 object-contain mx-auto"
                  />
                ) : (
                  <pre className="text-xs whitespace-pre-wrap break-words font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded-lg max-h-72 overflow-y-auto text-slate-800 dark:text-slate-200">
                    {previewData.contentText || (isAr ? '(ملف فارغ)' : '(Empty file)')}
                  </pre>
                )}
              </>
            ) : (
              <div className="h-64 flex items-center justify-center text-xs text-slate-400 text-center">
                {isAr
                  ? 'اختر أي ملف (TXT, MD, PDF, DOCX, JSON, CSV أو صورة) لقراءة محتواه أو تحليله بالذكاء الاصطناعي.'
                  : 'Select any file (TXT, MD, PDF, DOCX, JSON, CSV or Image) to preview or analyze in Chat.'}
              </div>
            )}
          </div>
        </div>

        {/* Recently Analyzed & Accessed Files */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'الملفات التي تم الوصول إليها وتحليلها مؤخرًا' : 'Recently Accessed & Analyzed Files'}
            </h2>
            {recentFiles.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  await apiClient.clearRecentFiles();
                  setRecentFiles([]);
                }}
                className="text-xs text-slate-500 hover:text-red-600"
              >
                {isAr ? 'مسح القائمة' : 'Clear List'}
              </button>
            )}
          </div>

          {recentFiles.length === 0 ? (
            <p className="text-xs text-slate-500">
              {isAr ? 'لا توجد ملفات حديثة مسجلة بعد.' : 'No recent files logged yet.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentFiles.map((f) => (
                <div key={f.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{f.file_name}</span>
                    {f.summary && (
                      <span className="text-slate-500 dark:text-slate-400"> · {f.summary}</span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    {formatBytes(f.size_bytes)} · {new Date(f.accessed_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
