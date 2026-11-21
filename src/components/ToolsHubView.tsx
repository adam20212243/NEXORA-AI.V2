import {
  Check,
  CheckSquare,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AppSettings,
  ToolCapabilityDescriptor,
  UserPreferenceItem,
  UserTaskItem,
} from '../shared/types.ts';
import { apiClient } from '../services/apiClient.ts';

interface ToolsHubViewProps {
  settings: AppSettings;
  tools: ToolCapabilityDescriptor[];
  onUsePromptInChat: (prompt: string) => void;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
}

export function ToolsHubView({
  settings,
  tools,
  onUsePromptInChat,
  onUpdateSettings,
}: ToolsHubViewProps) {
  const isAr = settings.language === 'ar';
  const [tasks, setTasks] = useState<UserTaskItem[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [preferences, setPreferences] = useState<UserPreferenceItem[]>([]);
  const [prefKey, setPrefKey] = useState('');
  const [prefValue, setPrefValue] = useState('');
  const [prefCategory, setPrefCategory] = useState<'preference' | 'project' | 'saved_fact'>('preference');
  const [editingPrefId, setEditingPrefId] = useState<string | null>(null);
  const [editingPrefValue, setEditingPrefValue] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadWorkspaceData = async () => {
    try {
      const [tRes, pRes] = await Promise.all([
        apiClient.listTasks(),
        apiClient.listPreferences(),
      ]);
      setTasks(tRes.tasks);
      setPreferences(pRes.preferences);
    } catch {
      // Ignore transient load error
    }
  };

  useEffect(() => {
    void loadWorkspaceData();
  }, []);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setErrorMsg(null);
    try {
      const created = await apiClient.createTask(newTaskTitle.trim());
      setTasks((prev) => [created, ...prev]);
      setNewTaskTitle('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed adding task.');
    }
  };

  const handleToggleTask = async (task: UserTaskItem) => {
    const nextStatus = task.status === 'done' ? 'todo' : 'done';
    await apiClient.updateTaskStatus(task.id, nextStatus);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
  };

  const handleDeleteTask = async (id: string) => {
    await apiClient.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleAddPreference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefKey.trim() || !prefValue.trim()) return;
    setErrorMsg(null);
    try {
      const saved = await apiClient.savePreference(prefKey.trim(), prefValue.trim(), prefCategory);
      setPreferences((prev) => [saved, ...prev.filter((p) => p.key !== saved.key)]);
      setPrefKey('');
      setPrefValue('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed saving preference.');
    }
  };

  const handleSaveEditPreference = async (id: string) => {
    if (!editingPrefValue.trim()) return;
    setErrorMsg(null);
    try {
      const updated = await apiClient.updatePreference(id, { value: editingPrefValue.trim() });
      setPreferences((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setEditingPrefId(null);
      setEditingPrefValue('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed updating preference.');
    }
  };

  const handleDeletePreference = async (id: string) => {
    await apiClient.deletePreference(id);
    setPreferences((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {isAr ? 'أدوات وقدرات NEXORA AI' : 'NEXORA AI Tools & Capabilities'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {isAr
              ? 'جميع الأدوات تعمل عبر العقل الرئيسي NEXORA MASTER لتقديم المساعدة في البحث، البرمجة، الرياضيات، المستندات، المهام، والصوت.'
              : 'All tools operate through NEXORA MASTER—supporting research, code, math, file analysis, tasks, and voice.'}
          </p>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Registered Extensible Tools Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map((tool) => {
            const statusText =
              tool.connectionStatus === 'ready'
                ? isAr
                  ? 'جاهز'
                  : 'Ready'
                : tool.connectionStatus === 'requires_api_key'
                ? isAr
                  ? 'يتطلب مفتاح API'
                  : 'Requires API Key'
                : tool.connectionStatus === 'requires_permission'
                ? isAr
                  ? 'يتطلب إذنًا'
                  : 'Requires Permission'
                : isAr
                ? 'جسر محلي/اختياري'
                : 'Optional Bridge';

            return (
              <div
                key={tool.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isAr ? tool.nameAr : tool.nameEn}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {isAr ? tool.descriptionAr : tool.descriptionEn}
                  </p>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                    <span>{statusText}</span>
                    {(tool.requiredPermissionsAr || tool.requiredPermissionsEn) && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span>
                          {isAr ? tool.requiredPermissionsAr : tool.requiredPermissionsEn}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUsePromptInChat(isAr ? tool.samplePromptAr : tool.samplePromptEn)
                  }
                  className="self-start text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تجربة الأداة في المحادثة' : 'Try in Chat'}</span>
                </button>
              </div>
            );
          })}
        </section>

        {/* Task & Plan Organizer + Consented Memory Split */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tasks Organizer */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isAr ? 'تنظيم المهام والخطط' : 'Task & Plan Organizer'}
              </h2>
            </div>

            <form onSubmit={handleAddTask} className="flex items-center gap-2">
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder={isAr ? 'أضف مهمة جديدة...' : 'Add a new task...'}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isAr ? 'إضافة' : 'Add'}</span>
              </button>
            </form>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {tasks.length === 0 ? (
                <p className="py-3 text-xs text-slate-500">
                  {isAr ? 'لا توجد مهام مسجلة بعد.' : 'No tasks added yet.'}
                </p>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={task.status === 'done'}
                        onChange={() => void handleToggleTask(task)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span
                        className={`truncate ${
                          task.status === 'done'
                            ? 'line-through text-slate-400'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {task.title}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTask(task.id)}
                      className="text-slate-400 hover:text-red-600 p-1"
                      aria-label="Delete task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Consented Preference Memory */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isAr ? 'تذكر تفضيلات المستخدم (بإذن واضح)' : 'User Preferences Memory (Consented)'}
              </h2>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.memoryConsentGranted}
                  onChange={(e) =>
                    void onUpdateSettings({ memoryConsentGranted: e.target.checked })
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>{isAr ? 'موافقة الحفظ' : 'Consent Enabled'}</span>
              </label>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isAr
                ? 'لا يحفظ المساعد أي تفضيل شخصي إلا بعد تفعيل موافقتك الصريحة أعلاه.'
                : 'NEXORA never stores personal preferences unless explicit consent is enabled above.'}
            </p>

            {settings.memoryConsentGranted && (
              <form onSubmit={handleAddPreference} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select
                  value={prefCategory}
                  onChange={(e) =>
                    setPrefCategory(e.target.value as 'preference' | 'project' | 'saved_fact')
                  }
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs"
                >
                  <option value="preference">{isAr ? 'تفضيل' : 'Preference'}</option>
                  <option value="project">{isAr ? 'مشروع' : 'Project'}</option>
                  <option value="saved_fact">{isAr ? 'معلومة محفوظة' : 'Saved Fact'}</option>
                </select>
                <input
                  type="text"
                  value={prefKey}
                  onChange={(e) => setPrefKey(e.target.value)}
                  placeholder={isAr ? 'العنوان (مثل: لغة البرمجة)' : 'Key (e.g. Stack)'}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  value={prefValue}
                  onChange={(e) => setPrefValue(e.target.value)}
                  placeholder={isAr ? 'القيمة (مثل: TypeScript)' : 'Value (e.g. TypeScript)'}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                  {isAr ? 'حفظ' : 'Save'}
                </button>
              </form>
            )}

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {preferences.length === 0 ? (
                <p className="py-2 text-xs text-slate-500">
                  {isAr ? 'لا توجد تفضيلات محفوظة.' : 'No saved preferences.'}
                </p>
              ) : (
                preferences.map((p) => {
                  const isEditing = editingPrefId === p.id;
                  return (
                    <div key={p.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0">
                            {p.key}:
                          </span>
                          <input
                            type="text"
                            value={editingPrefValue}
                            onChange={(e) => setEditingPrefValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveEditPreference(p.id);
                              if (e.key === 'Escape') setEditingPrefId(null);
                            }}
                            className="flex-1 min-w-0 px-2 py-1 rounded border border-blue-400 bg-slate-50 dark:bg-slate-800 text-xs"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveEditPreference(p.id)}
                            className="p-1 text-emerald-600"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPrefId(null)}
                            className="p-1 text-slate-400"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="truncate">
                            <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 me-1.5">
                              [{p.category ?? 'preference'}]
                            </span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {p.key}:
                            </span>{' '}
                            <span className="text-slate-600 dark:text-slate-400">{p.value}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPrefId(p.id);
                                setEditingPrefValue(p.value);
                              }}
                              className="text-slate-400 hover:text-blue-600 p-1"
                              aria-label="Edit preference"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeletePreference(p.id)}
                              className="text-slate-400 hover:text-red-600 p-1"
                              aria-label="Delete preference"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
