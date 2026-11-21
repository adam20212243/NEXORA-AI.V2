import { KeyRound, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdminAuthStatus, AppLanguage, KnowledgeBaseStats } from '../shared/types.ts';
import { apiClient, type SystemStatusResponse } from '../services/apiClient.ts';
import { KnowledgeConsole } from './KnowledgeConsole.tsx';
import { SystemProvidersView } from './SystemProvidersView.tsx';

interface AdminConsoleViewProps {
  lang: AppLanguage;
  onAuthChange: (authenticated: boolean) => void;
}

export function AdminConsoleView({ lang, onAuthChange }: AdminConsoleViewProps) {
  const isAr = lang === 'ar';
  const [authStatus, setAuthStatus] = useState<AdminAuthStatus | null>(null);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'knowledge' | 'system'>('knowledge');
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeBaseStats | null>(null);

  const loadAdminState = async () => {
    try {
      const status = await apiClient.getAdminStatus();
      setAuthStatus(status);
      onAuthChange(status.authenticated);
      if (status.authenticated) {
        const sys = await apiClient.getSystemStatus();
        setSystemStatus(sys);
        setKnowledgeStats(sys.knowledgeStats);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed checking admin status.');
    }
  };

  useEffect(() => {
    void loadAdminState();
  }, []);

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (passcode.length < 6) {
      setErrorMsg(
        isAr ? 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.' : 'Password must be at least 6 characters.'
      );
      return;
    }
    if (passcode !== confirmPasscode) {
      setErrorMsg(isAr ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiClient.claimAdmin(passcode);
      setPasscode('');
      setConfirmPasscode('');
      await loadAdminState();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed setting admin password.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      await apiClient.loginAdmin(passcode);
      setPasscode('');
      await loadAdminState();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid administrator password.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    apiClient.logoutAdmin();
    onAuthChange(false);
    setSystemStatus(null);
    setKnowledgeStats(null);
    void loadAdminState();
  };

  if (!authStatus) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-xs text-slate-500">
        {isAr ? 'جاري التحقق من حالة الإدارة...' : 'Checking administrator session...'}
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <div className="h-full overflow-y-auto flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
              {authStatus.needsClaim ? <KeyRound className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {authStatus.needsClaim
                  ? isAr
                    ? 'إعداد كلمة مرور الإدارة (أول تشغيل)'
                    : 'Set Administrator Password (First Run)'
                  : isAr
                  ? 'لوحة الإدارة الداخلية المحمية'
                  : 'Protected Internal Admin Console'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {authStatus.needsClaim
                  ? isAr
                    ? 'قم بتعيين كلمة مرور لحماية قاعدة المعرفة والأقسام الخمسة وسجلات النظام.'
                    : 'Create an admin password to protect the internal Knowledge Base and diagnostics.'
                  : isAr
                  ? 'مخصصة للمسؤول فقط للوصول إلى قاعدة المعرفة وإحصائيات النظام.'
                  : 'Restricted to authorized administrators for Knowledge Base and diagnostics.'}
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3.5 py-2 text-xs text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {authStatus.needsClaim ? (
            <form onSubmit={handleClaim} className="space-y-3">
              <input
                type="password"
                required
                minLength={6}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder={isAr ? 'كلمة المرور الجديدة (6 أحرف+)' : 'New admin password (6+ chars)'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
              />
              <input
                type="password"
                required
                minLength={6}
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                placeholder={isAr ? 'تأكيد كلمة المرور' : 'Confirm password'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
              >
                {busy
                  ? isAr
                    ? 'جاري الحفظ...'
                    : 'Saving...'
                  : isAr
                  ? 'حفظ كلمة المرور والدخول'
                  : 'Save Password & Enter'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-3">
              <input
                type="password"
                required
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder={isAr ? 'أدخل كلمة مرور الإدارة' : 'Enter administrator password'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
              >
                {busy
                  ? isAr
                    ? 'جاري التحقق...'
                    : 'Verifying...'
                  : isAr
                  ? 'دخول الإدارة'
                  : 'Unlock Admin Console'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Admin Bar */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {isAr ? 'وضع المسؤول النشط' : 'Administrator Session Active'}
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 ms-3">
            <button
              type="button"
              onClick={() => setActiveTab('knowledge')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'knowledge'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {isAr ? 'قاعدة المعرفة (20,000)' : 'Knowledge Base (20,000)'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('system')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'system'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {isAr ? 'المزودون والبحث وسجلات النظام' : 'Providers, Search & Diagnostics'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>{isAr ? 'قفل الإدارة' : 'Lock Admin'}</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'knowledge' ? (
          <KnowledgeConsole
            lang={lang}
            stats={knowledgeStats}
            onStatsUpdated={(s) => setKnowledgeStats(s)}
          />
        ) : (
          <SystemProvidersView
            lang={lang}
            providers={systemStatus?.providers ?? []}
            imageGenerationEnabled={systemStatus?.imageGenerationEnabled ?? false}
          />
        )}
      </div>
    </div>
  );
}
