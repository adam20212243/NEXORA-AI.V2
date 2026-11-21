import { Menu, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AdminConsoleView } from './components/AdminConsoleView.tsx';
import { ChatWorkspace } from './components/ChatWorkspace.tsx';
import { DownloadView } from './components/DownloadView.tsx';
import { FileManagerView } from './components/FileManagerView.tsx';
import { FloatingVoiceAssistant } from './components/FloatingVoiceAssistant.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Sidebar, type ActiveView } from './components/Sidebar.tsx';
import { ToolsHubView } from './components/ToolsHubView.tsx';
import { WebResearchView } from './components/WebResearchView.tsx';
import {
  apiClient,
  buildApiUrl,
  type AmbientAudioStatusResponse,
  type PublicCapabilitiesResponse,
} from './services/apiClient.ts';
import { ambientMusicService } from './services/ambientMusicService.ts';
import { detectClientPlatform } from './services/deviceControlService.ts';
import { stopAllSpeech } from './services/voiceService.ts';
import { DEFAULT_SETTINGS } from './shared/constants.ts';
import type {
  AppSettings,
  AttachedDocumentInput,
  ChatMessage,
  Conversation,
  DeviceControlCommand,
  PersonalityStyleId,
} from './shared/types.ts';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [capabilities, setCapabilities] = useState<PublicCapabilitiesResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>(undefined);
  const [pendingAttachment, setPendingAttachment] = useState<AttachedDocumentInput | null>(null);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [ambientStatus, setAmbientStatus] = useState<AmbientAudioStatusResponse | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isAr = settings.language === 'ar';

  useEffect(() => {
    const html = document.documentElement;
    html.lang = settings.language;
    html.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    if (settings.theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [settings.language, settings.theme]);

  useEffect(() => {
    ambientMusicService.configure({
      available: Boolean(ambientStatus?.available),
      audioUrl: ambientStatus?.audioUrl ? buildApiUrl(ambientStatus.audioUrl) : null,
      enabled: settings.ambientMusicEnabled,
      muted: settings.ambientMusicMuted,
      volume: settings.ambientMusicVolume,
    });
  }, [
    ambientStatus,
    settings.ambientMusicEnabled,
    settings.ambientMusicMuted,
    settings.ambientMusicVolume,
  ]);

  const loadInitialData = async () => {
    try {
      const [capsData, convData, adminState, audioState] = await Promise.all([
        apiClient.getPublicCapabilities(),
        apiClient.listConversations(),
        apiClient.getAdminStatus().catch(() => ({
          needsClaim: false,
          envPasscodeActive: false,
          authenticated: false,
        })),
        apiClient.getAmbientAudioStatus().catch(() => null),
      ]);
      setCapabilities(capsData);
      setSettings(capsData.settings);
      setConversations(convData.conversations);
      setAdminAuthenticated(adminState.authenticated);
      if (audioState) setAmbientStatus(audioState);
      if (convData.conversations.length > 0 && !activeConversationId) {
        const firstId = convData.conversations[0].id;
        setActiveConversationId(firstId);
        const msgRes = await apiClient.getMessages(firstId);
        setMessages(msgRes.messages);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed initializing NEXORA AI.');
    }
  };

  useEffect(() => {
    void loadInitialData();
  }, []);

  const handleSelectView = (view: ActiveView) => {
    if (activeView === 'chat' && view !== 'chat' && !settings.allowBackgroundTts) {
      stopAllSpeech();
    }
    setActiveView(view);
  };

  const handleSelectConversation = async (id: string) => {
    if (id !== activeConversationId) {
      stopAllSpeech();
    }
    setIncognitoMode(false);
    setActiveConversationId(id);
    setChatError(null);
    try {
      const res = await apiClient.getMessages(id);
      setMessages(res.messages);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed loading conversation.');
    }
  };

  const handleNewConversation = () => {
    stopAllSpeech();
    setIncognitoMode(false);
    setActiveConversationId(null);
    setMessages([]);
    setChatError(null);
  };

  const handleToggleIncognito = () => {
    stopAllSpeech();
    setIncognitoMode((prev) => {
      const next = !prev;
      setActiveConversationId(null);
      setMessages([]);
      setChatError(null);
      return next;
    });
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await apiClient.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        stopAllSpeech();
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed deleting conversation.');
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    const updated = await apiClient.renameOrPinConversation(id, { title });
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
  };

  const handleTogglePinConversation = async (id: string, nextPinned: boolean) => {
    await apiClient.renameOrPinConversation(id, { pinned: nextPinned });
    const convList = await apiClient.listConversations();
    setConversations(convList.conversations);
  };

  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSending(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === 'streaming_temp'
          ? {
              ...m,
              id: `msg_aborted_${Date.now()}`,
              content: m.content || (isAr ? 'تم إيقاف التوليد.' : 'Generation stopped.'),
            }
          : m
      )
    );
  };

  const handleSendMessage = async (
    query: string,
    platform: DeviceControlCommand['targetPlatform'],
    attachments?: AttachedDocumentInput[]
  ): Promise<string | null> => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSending(true);
    setChatError(null);

    const localHistory = incognitoMode
      ? messages.slice(-8).map((m) => ({ role: m.role, content: m.content }))
      : undefined;

    let finalAnswer = '';
    try {
      await apiClient.streamChatMessage(
        {
          query,
          conversationId: incognitoMode ? undefined : activeConversationId ?? undefined,
          attachments,
          platform,
          incognito: incognitoMode,
          history: localHistory,
        },
        {
          signal: controller.signal,
          onMeta: (data) => {
            if (!incognitoMode) {
              setActiveConversationId(data.conversationId);
            }
            const tempAssistant: ChatMessage = {
              id: 'streaming_temp',
              conversation_id: data.conversationId,
              role: 'assistant',
              content: '',
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, data.userMessage, tempAssistant]);
          },
          onToken: (chunk) => {
            finalAnswer += chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === 'streaming_temp' ? { ...m, content: finalAnswer } : m
              )
            );
          },
          onDone: (data) => {
            finalAnswer = data.assistantMessage.content;
            if (!incognitoMode) {
              setActiveConversationId(data.conversationId);
            }
            setMessages((prev) =>
              prev.map((m) => (m.id === 'streaming_temp' ? data.assistantMessage : m))
            );
          },
        }
      );

      if (!incognitoMode) {
        const convList = await apiClient.listConversations();
        setConversations(convList.conversations);
      }
      return finalAnswer;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return finalAnswer || null;
      }
      setMessages((prev) => prev.filter((m) => m.id !== 'streaming_temp'));
      setChatError(err instanceof Error ? err.message : 'Failed communicating with NEXORA MASTER.');
      return null;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setSending(false);
    }
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    setSending(true);
    setChatError(null);
    try {
      const res = await apiClient.editMessageAndRegenerate(
        messageId,
        newContent,
        detectClientPlatform()
      );
      setMessages(res.messages);
      const convList = await apiClient.listConversations();
      setConversations(convList.conversations);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed editing message.');
    } finally {
      setSending(false);
    }
  };

  const handleRestoreMessage = async (messageId: string) => {
    try {
      const res = await apiClient.restoreMessage(messageId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed restoring message.');
    }
  };

  const handleRegenerateLastReply = async () => {
    if (!activeConversationId) return;
    setSending(true);
    setChatError(null);
    try {
      const res = await apiClient.regenerateLastReply(
        activeConversationId,
        detectClientPlatform()
      );
      setMessages(res.messages);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed regenerating reply.');
    } finally {
      setSending(false);
    }
  };

  const handleUpdateSettings = async (updates: Partial<AppSettings>) => {
    const saved = await apiClient.updateSettings(updates);
    setSettings(saved);
    const refreshed = await apiClient.getPublicCapabilities();
    setCapabilities(refreshed);
  };

  const handleResetSettings = async () => {
    const reset = await apiClient.resetSettings();
    setSettings(reset);
    const refreshed = await apiClient.getPublicCapabilities();
    setCapabilities(refreshed);
  };

  const viewTitles: Record<ActiveView, { ar: string; en: string }> = {
    chat: { ar: 'NEXORA MASTER / المحادثة', en: 'NEXORA MASTER / Chat' },
    files: { ar: 'مدير الملفات والملفات الحديثة', en: 'File Manager & Recent Files' },
    web: { ar: 'البحث المباشر وتصفح المواقع', en: 'Live Web Search & Browse' },
    tools: { ar: 'الأدوات والمهام', en: 'Tools & Tasks' },
    settings: { ar: 'الإعدادات وسجل النشاط', en: 'Settings & Activity Log' },
    download: { ar: 'تنزيل وتشغيل NEXORA AI', en: 'Download & Run NEXORA AI' },
    admin: { ar: 'الإدارة الداخلية المحمية', en: 'Protected System Admin' },
  };

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        lang={settings.language}
        activeView={activeView}
        onSelectView={handleSelectView}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => void handleSelectConversation(id)}
        onNewConversation={handleNewConversation}
        onDeleteConversation={(id) => void handleDeleteConversation(id)}
        onRenameConversation={handleRenameConversation}
        onTogglePinConversation={handleTogglePinConversation}
        adminAuthenticated={adminAuthenticated}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <header className="h-14 shrink-0 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={isAr ? 'فتح القائمة' : 'Open menu'}
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
              {isAr ? viewTitles[activeView].ar : viewTitles[activeView].en}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                void handleUpdateSettings({
                  language: settings.language === 'ar' ? 'en' : 'ar',
                  voiceSttLang: settings.language === 'ar' ? 'en-US' : 'ar-SA',
                })
              }
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {settings.language === 'ar' ? 'English' : 'العربية'}
            </button>
            <button
              type="button"
              onClick={() =>
                void handleUpdateSettings({
                  theme: settings.theme === 'dark' ? 'light' : 'dark',
                })
              }
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label={isAr ? 'تبديل المظهر' : 'Toggle theme'}
            >
              {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">
          {activeView === 'chat' && (
            <ChatWorkspace
              conversationId={activeConversationId}
              settings={settings}
              messages={messages}
              sending={sending}
              incognitoMode={incognitoMode}
              errorMsg={chatError}
              prefillText={prefillPrompt}
              pendingAttachment={pendingAttachment}
              onConsumePrefill={() => setPrefillPrompt(undefined)}
              onConsumePendingAttachment={() => setPendingAttachment(null)}
              onDismissError={() => setChatError(null)}
              onSendMessage={async (q, p, a) => {
                await handleSendMessage(q, p, a);
              }}
              onStopGeneration={handleStopGeneration}
              onEditMessage={handleEditMessage}
              onRestoreMessage={handleRestoreMessage}
              onRegenerateLastReply={handleRegenerateLastReply}
              onToggleIncognito={handleToggleIncognito}
              onChangePersonality={(style: PersonalityStyleId) =>
                void handleUpdateSettings({ personalityStyle: style })
              }
              onChangeMicMode={(mode) => void handleUpdateSettings({ voiceMicMode: mode })}
              onToggleAutoSpeak={() =>
                void handleUpdateSettings({ autoSpeakResponses: !settings.autoSpeakResponses })
              }
              onDisableWakeWord={() =>
                void handleUpdateSettings({ enableWakeWord: false })
              }
            />
          )}

          {activeView === 'files' && (
            <FileManagerView
              settings={settings}
              onAttachToChatAndOpen={(attachment, suggestedPrompt) => {
                setPendingAttachment(attachment);
                setPrefillPrompt(suggestedPrompt);
                setActiveView('chat');
              }}
            />
          )}

          {activeView === 'web' && (
            <WebResearchView
              settings={settings}
              onUseSummaryInChat={(prompt) => {
                setPrefillPrompt(prompt);
                setActiveView('chat');
              }}
            />
          )}

          {activeView === 'tools' && (
            <ToolsHubView
              settings={settings}
              tools={capabilities?.tools ?? []}
              onUsePromptInChat={(prompt) => {
                setPrefillPrompt(prompt);
                setActiveView('chat');
              }}
              onUpdateSettings={handleUpdateSettings}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              settings={settings}
              providers={capabilities?.providers ?? []}
              ambientStatus={ambientStatus}
              onAmbientStatusChange={setAmbientStatus}
              onSaveSettings={handleUpdateSettings}
              onResetSettings={handleResetSettings}
              onOpenAdminPanel={() => setActiveView('admin')}
            />
          )}

          {activeView === 'download' && <DownloadView lang={settings.language} />}

          {activeView === 'admin' && (
            <AdminConsoleView
              lang={settings.language}
              onAuthChange={(authed) => setAdminAuthenticated(authed)}
            />
          )}
        </main>
      </div>

      {/* Opt-in Floating Voice Assistant */}
      <FloatingVoiceAssistant
        settings={settings}
        onQuickSend={async (q, p) => handleSendMessage(q, p)}
        onToggleSetting={handleUpdateSettings}
      />
    </div>
  );
}
