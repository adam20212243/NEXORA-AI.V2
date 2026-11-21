import {
  AlertTriangle,
  BarChart3,
  Check,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  Globe,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  Square,
  Terminal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ambientMusicService } from '../services/ambientMusicService.ts';
import { apiClient } from '../services/apiClient.ts';
import {
  detectClientPlatform,
  executeConfirmedDeviceCommand,
  openAppDownloadFallback,
  type DeviceLaunchResult,
} from '../services/deviceControlService.ts';
import {
  getMicStatusLabel,
  pauseSpeech,
  resumeSpeech,
  sendDesktopNotification,
  speakText,
  startSpeechRecognitionSession,
  startWakeWordListener,
  stopAllSpeech,
  type MicStatus,
  type SpeechPlaybackState,
  type SttController,
  type WakeWordController,
} from '../services/voiceService.ts';
import { PERSONALITY_STYLES } from '../shared/constants.ts';
import type {
  AppSettings,
  AttachedDocumentInput,
  ChatMessage,
  DeviceControlCommand,
  PersonalityStyleId,
} from '../shared/types.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface ChatWorkspaceProps {
  conversationId: string | null;
  settings: AppSettings;
  messages: ChatMessage[];
  sending: boolean;
  incognitoMode: boolean;
  errorMsg: string | null;
  prefillText?: string;
  pendingAttachment?: AttachedDocumentInput | null;
  onConsumePrefill?: () => void;
  onConsumePendingAttachment?: () => void;
  onDismissError: () => void;
  onSendMessage: (
    query: string,
    platform: DeviceControlCommand['targetPlatform'],
    attachments?: AttachedDocumentInput[]
  ) => Promise<void>;
  onStopGeneration: () => void;
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
  onRestoreMessage: (messageId: string) => Promise<void>;
  onRegenerateLastReply: () => Promise<void>;
  onToggleIncognito: () => void;
  onChangePersonality: (style: PersonalityStyleId) => void;
  onChangeMicMode: (mode: 'record_send' | 'live_dictation') => void;
  onToggleAutoSpeak: () => void;
  onDisableWakeWord: () => void;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed reading file bytes.'));
    reader.readAsDataURL(file);
  });
}

export function ChatWorkspace({
  conversationId,
  settings,
  messages,
  sending,
  incognitoMode,
  errorMsg,
  prefillText,
  pendingAttachment,
  onConsumePrefill,
  onConsumePendingAttachment,
  onDismissError,
  onSendMessage,
  onStopGeneration,
  onEditMessage,
  onRestoreMessage,
  onRegenerateLastReply,
  onToggleIncognito,
  onChangePersonality,
  onChangeMicMode,
  onToggleAutoSpeak,
  onDisableWakeWord,
}: ChatWorkspaceProps) {
  const isAr = settings.language === 'ar';
  const [inputText, setInputText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [speechState, setSpeechState] = useState<SpeechPlaybackState>('idle');
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [deviceResults, setDeviceResults] = useState<Record<string, DeviceLaunchResult>>({});
  const [fileActionResults, setFileActionResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [visibilityNotice, setVisibilityNotice] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachedDocumentInput[]>([]);
  const [wakeWordError, setWakeWordError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');

  const sttRef = useRef<SttController | null>(null);
  const wakeRef = useRef<WakeWordController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const baseInputBeforeMicRef = useRef('');
  const spokenMessageIdsRef = useRef<Set<string>>(new Set());
  const autoLaunchedIdsRef = useRef<Set<string>>(new Set());
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const prevConvIdRef = useRef<string | null>(conversationId);
  const sawSendingTrueRef = useRef<boolean>(false);

  // Prefill from Tools Hub, File Manager, or Web Research
  useEffect(() => {
    if (prefillText) {
      setInputText(prefillText);
      onConsumePrefill?.();
    }
  }, [prefillText, onConsumePrefill]);

  useEffect(() => {
    if (pendingAttachment) {
      setAttachments((prev) => [...prev, pendingAttachment].slice(0, 3));
      onConsumePendingAttachment?.();
    }
  }, [pendingAttachment, onConsumePendingAttachment]);

  // Scroll to newest message / streaming updates
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  // Mandatory TTS Stop + reset live-turn flag when switching conversation
  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      prevConvIdRef.current = conversationId;
      sawSendingTrueRef.current = false;
      stopAllSpeech();
      setSpeakingMessageId(null);
      setSpeechState('idle');
      for (const m of messages) {
        spokenMessageIdsRef.current.add(m.id);
        autoLaunchedIdsRef.current.add(m.id);
        notifiedIdsRef.current.add(m.id);
      }
    }
  }, [conversationId, messages]);

  useEffect(() => {
    const activeAudio = micStatus === 'listening' || speakingMessageId !== null;
    ambientMusicService.setDucked(activeAudio);
    return () => {
      ambientMusicService.setDucked(false);
    };
  }, [micStatus, speakingMessageId]);

  useEffect(() => {
    return () => {
      sttRef.current?.abort();
      wakeRef.current?.stop();
      if (!settings.allowBackgroundTts) {
        stopAllSpeech();
      }
    };
  }, [settings.allowBackgroundTts]);

  // Background / Foreground visibility handler
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (micStatus === 'listening') {
          sttRef.current?.stop();
          setVisibilityNotice(
            isAr
              ? 'تم إيقاف الميكروفون عند الانتقال إلى الخلفية بسبب قيود المتصفح.'
              : 'Microphone paused in background due to browser OS constraints.'
          );
        }
        if (!settings.allowBackgroundTts && speakingMessageId) {
          stopAllSpeech();
          setSpeakingMessageId(null);
          setSpeechState('idle');
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [micStatus, speakingMessageId, settings.allowBackgroundTts, isAr]);

  // Wake Word Listener (Opt-in ONLY)
  useEffect(() => {
    wakeRef.current?.stop();
    wakeRef.current = null;
    setWakeWordError(null);

    if (!settings.enableWakeWord || micStatus === 'listening' || sending) {
      return;
    }

    wakeRef.current = startWakeWordListener({
      lang: settings.voiceSttLang,
      onWakeWord: (trailingCommand) => {
        if (trailingCommand && trailingCommand.length >= 2) {
          void submitRecognizedQuery(trailingCommand);
        } else {
          void handleStartRecording();
        }
      },
      onError: (err) => {
        setWakeWordError(
          isAr
            ? `تعذر تشغيل التنبيه الصوتي المستمر في هذا المتصفح (${err}).`
            : `Wake word unavailable in this browser (${err}).`
        );
      },
    });

    return () => {
      wakeRef.current?.stop();
      wakeRef.current = null;
    };
  }, [settings.enableWakeWord, settings.voiceSttLang, micStatus, sending]);

  // Strictly handle post-reply actions ONLY after an active sending->idle transition (never on history load)
  useEffect(() => {
    if (sending) {
      sawSendingTrueRef.current = true;
      return;
    }
    if (messages.length === 0) return;

    if (!sawSendingTrueRef.current) {
      for (const m of messages) {
        spokenMessageIdsRef.current.add(m.id);
        autoLaunchedIdsRef.current.add(m.id);
        notifiedIdsRef.current.add(m.id);
      }
      return;
    }

    const last = messages[messages.length - 1];
    if (
      last.role !== 'assistant' ||
      last.id === 'streaming_temp' ||
      last.id.startsWith('msg_aborted_')
    ) {
      return;
    }

    sawSendingTrueRef.current = false;

    if (
      settings.enableNotifications &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden' &&
      !notifiedIdsRef.current.has(last.id)
    ) {
      notifiedIdsRef.current.add(last.id);
      void sendDesktopNotification('NEXORA AI', last.content.slice(0, 120), true);
    }

    if (
      settings.voiceTtsEnabled &&
      settings.autoSpeakResponses &&
      !spokenMessageIdsRef.current.has(last.id)
    ) {
      spokenMessageIdsRef.current.add(last.id);
      void handleSpeakMessage(last);
    }

    const cmd = last.metadata?.deviceCommand;
    if (
      cmd &&
      cmd.detected &&
      cmd.action !== 'close_app' &&
      cmd.action !== 'file_action' &&
      cmd.autoLaunchRecommended &&
      !autoLaunchedIdsRef.current.has(last.id)
    ) {
      autoLaunchedIdsRef.current.add(last.id);
      void executeConfirmedDeviceCommand(cmd, true).then((res) => {
        setDeviceResults((prev) => ({ ...prev, [last.id]: res }));
      });
    }
  }, [messages, sending, settings.autoSpeakResponses, settings.voiceTtsEnabled, settings.enableNotifications]);

  const submitRecognizedQuery = async (recognizedText: string) => {
    const clean = recognizedText.trim();
    if (!clean) return;
    setMicStatus('sending');
    setInputText('');
    setInterimText('');
    try {
      setMicStatus('awaiting_reply');
      const attachedCopy = attachments.length > 0 ? [...attachments] : undefined;
      setAttachments([]);
      await onSendMessage(clean, detectClientPlatform(), attachedCopy);
      setMicStatus('idle');
    } catch {
      setMicStatus('error');
    }
  };

  const handleStartRecording = async () => {
    setMicError(null);
    setVisibilityNotice(null);
    wakeRef.current?.stop();
    stopAllSpeech();
    setSpeakingMessageId(null);
    setSpeechState('idle');
    baseInputBeforeMicRef.current = inputText.trim();

    sttRef.current = await startSpeechRecognitionSession({
      lang: settings.voiceSttLang,
      uiLang: settings.language,
      deviceId: settings.voiceInputDeviceId || undefined,
      onStatus: (status, err) => {
        setMicStatus(status);
        if (err) setMicError(err);
      },
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onInterim: (interim) => {
        setInterimText(interim);
        if (settings.voiceMicMode === 'live_dictation') {
          const base = baseInputBeforeMicRef.current;
          setInputText(base ? `${base} ${interim}`.trim() : interim);
        }
      },
      onFinal: (finalTranscript) => {
        setInterimText('');
        const clean = finalTranscript.trim();
        if (!clean) {
          setMicError(
            isAr ? 'لم يتم التقاط كلام واضح لإرساله.' : 'No clear speech captured to send.'
          );
          setMicStatus('error');
          return;
        }
        if (settings.voiceMicMode === 'record_send' && settings.autoSendVoiceTranscript) {
          void submitRecognizedQuery(clean);
        } else {
          const base = baseInputBeforeMicRef.current;
          setInputText(base ? `${base} ${clean}`.trim() : clean);
          setMicStatus('recognized');
        }
      },
    });
  };

  const handleToggleMic = async () => {
    if (micStatus === 'listening' || micStatus === 'requesting_permission') {
      sttRef.current?.stop();
      return;
    }
    await handleStartRecording();
  };

  const handleImmediateStopAllVoice = () => {
    if (micStatus === 'listening' || micStatus === 'requesting_permission') {
      sttRef.current?.abort();
      setMicStatus('idle');
      setInterimText('');
    }
    stopAllSpeech();
    setSpeakingMessageId(null);
    setSpeechState('idle');
  };

  const handleSpeakMessage = async (msg: ChatMessage, forceReplay = false) => {
    if (!settings.voiceTtsEnabled) {
      setTtsError(
        isAr ? 'الرد الصوتي معطل من الإعدادات حاليًا.' : 'Voice playback is disabled in Settings.'
      );
      return;
    }
    setTtsError(null);

    if (!forceReplay && speakingMessageId === msg.id) {
      if (speechState === 'playing') {
        if (pauseSpeech()) setSpeechState('paused');
        return;
      }
      if (speechState === 'paused') {
        if (resumeSpeech()) setSpeechState('playing');
        return;
      }
    }

    const msgLang = msg.metadata?.language ?? settings.language;
    setSpeakingMessageId(msg.id);
    setSpeechState('playing');
    await speakText({
      text: msg.content,
      lang: msgLang,
      rate: settings.voiceTtsRate,
      volume: settings.voiceTtsVolume,
      preferredVoiceName: settings.voiceTtsVoiceName,
      useServerFallback: settings.useServerTtsFallback,
      onStart: () => {
        setSpeakingMessageId(msg.id);
        setSpeechState('playing');
      },
      onEnd: () => {
        setSpeakingMessageId((curr) => (curr === msg.id ? null : curr));
        setSpeechState('idle');
      },
      onError: (err) => {
        setTtsError(err);
        setSpeakingMessageId(null);
        setSpeechState('idle');
      },
    });
  };

  const handleCopyText = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
  };

  const handleShareMessage = async (msg: ChatMessage) => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'NEXORA AI',
          text: msg.content,
        });
        return;
      } catch {
        // User cancelled or share unsupported; fall back to copy
      }
    }
    handleCopyText(`share_${msg.id}`, msg.content);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setMicError(null);
    const added: AttachedDocumentInput[] = [];

    for (const file of Array.from(files).slice(0, 3)) {
      const lower = file.name.toLowerCase();
      const isBinary =
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        lower.endsWith('.pdf') ||
        lower.endsWith('.docx') ||
        lower.endsWith('.xlsx');

      if (isBinary) {
        if (file.size > 4_000_000) {
          setMicError(
            isAr
              ? `الملف "${file.name}" يتجاوز الحد (4MB).`
              : `File "${file.name}" exceeds 4MB limit.`
          );
          continue;
        }
        const base64Data = await readFileAsBase64(file);
        added.push({
          fileName: file.name,
          mimeType:
            file.type ||
            (lower.endsWith('.xlsx')
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : lower.endsWith('.docx')
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : lower.endsWith('.pdf')
              ? 'application/pdf'
              : 'image/png'),
          base64Data,
          sizeBytes: file.size,
        });
      } else {
        if (file.size > 400_000) {
          setMicError(
            isAr
              ? `الملف "${file.name}" يتجاوز الحد النصي (400KB).`
              : `File "${file.name}" exceeds 400KB text limit.`
          );
          continue;
        }
        const text = await file.text();
        added.push({
          fileName: file.name,
          mimeType: file.type || 'text/plain',
          contentText: text,
          sizeBytes: file.size,
        });
      }
    }

    setAttachments((prev) => [...prev, ...added].slice(0, 3));
    e.target.value = '';
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const combined =
      settings.voiceMicMode === 'live_dictation'
        ? inputText.trim()
        : `${inputText} ${interimText}`.trim();

    const hasImageAttachment = attachments.some((a) => a.mimeType.startsWith('image/'));
    const effectiveQuery =
      combined ||
      (attachments.length > 0
        ? hasImageAttachment
          ? isAr
            ? 'صف هذه الصورة واستخرج أي نص واضح فيها.'
            : 'Describe this image and extract any visible text.'
          : isAr
          ? 'حلل ولخص هذا الملف.'
          : 'Analyze and summarize this file.'
        : '');

    if (!effectiveQuery || sending) return;

    if (micStatus === 'listening') {
      sttRef.current?.abort();
    }

    setInputText('');
    setInterimText('');
    setMicStatus('idle');
    const attachedCopy = attachments.length > 0 ? [...attachments] : undefined;
    setAttachments([]);
    await onSendMessage(effectiveQuery, detectClientPlatform(), attachedCopy);
  };

  const handleDeviceLaunch = async (messageId: string, cmd: DeviceControlCommand) => {
    const res = await executeConfirmedDeviceCommand(cmd, true);
    setDeviceResults((prev) => ({ ...prev, [messageId]: res }));
  };

  const handleConfirmedFileAction = async (messageId: string, cmd: DeviceControlCommand) => {
    if (!cmd.pendingFileAction) return;
    try {
      if (cmd.pendingFileAction.operation === 'delete' && cmd.pendingFileAction.targetPath) {
        const res = await apiClient.deleteWorkspaceFile(cmd.pendingFileAction.targetPath, true);
        setFileActionResults((prev) => ({ ...prev, [messageId]: { ok: res.deleted, msg: res.message } }));
      } else if (cmd.pendingFileAction.operation === 'clean_temp') {
        const res = await apiClient.cleanWorkspaceTempFiles(undefined, true);
        setFileActionResults((prev) => ({ ...prev, [messageId]: { ok: true, msg: res.message } }));
      }
    } catch (err) {
      setFileActionResults((prev) => ({
        ...prev,
        [messageId]: { ok: false, msg: err instanceof Error ? err.message : 'Action failed.' },
      }));
    }
  };

  const starterPrompts = isAr
    ? [
        'من اكتشف الجاذبية؟',
        'اشرح لي قوانين نيوتن للحركة بطريقة مبسطة مع مثال يومي.',
        'احسب (48 * 15) + 360 / 12 واشرح خطوات الحل.',
        'افتح يوتيوب',
      ]
    : [
        'Who discovered gravity?',
        'Explain Newton laws of motion clearly with an everyday example.',
        'Solve (48 * 15) + 360 / 12 step by step.',
        'Open YouTube',
      ];

  const effectiveMicState: MicStatus = sending ? 'awaiting_reply' : micStatus;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="flex flex-col h-full">
      {/* Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">NEXORA MASTER</span>
          <span aria-hidden="true">·</span>
          <span>
            {incognitoMode
              ? isAr
                ? 'وضع المحادثة المؤقتة (لا يُحفظ في السجل)'
                : 'Temporary Incognito Chat (Not Saved)'
              : isAr
              ? 'مساعد موحد متعدد الأدوات'
              : 'Unified Multi-Tool Assistant'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(speakingMessageId !== null || micStatus === 'listening') && (
            <button
              type="button"
              onClick={handleImmediateStopAllVoice}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" />
              <span>{isAr ? 'إيقاف الصوت فورًا' : 'Stop Voice Now'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleIncognito}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              incognitoMode
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span>{isAr ? 'محادثة مؤقتة' : 'Incognito'}</span>
          </button>

          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="whitespace-nowrap hidden sm:inline">
              {isAr ? 'الأسلوب:' : 'Style:'}
            </span>
            <select
              value={settings.personalityStyle}
              onChange={(e) => onChangePersonality(e.target.value as PersonalityStyleId)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PERSONALITY_STYLES.map((style) => (
                <option key={style.id} value={style.id}>
                  {isAr ? style.nameAr : style.nameEn}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onToggleAutoSpeak}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              settings.autoSpeakResponses && settings.voiceTtsEnabled
                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {settings.autoSpeakResponses && settings.voiceTtsEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{isAr ? 'نطق تلقائي' : 'Auto Voice'}</span>
          </button>
        </div>
      </div>

      {/* Explicit Opt-in Wake Word Transparency Banner */}
      {settings.enableWakeWord && (
        <div className="px-6 py-2 border-b border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-800 dark:text-blue-300">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isAr
                ? 'التنبيه الصوتي مفعّل (قل: "هاي مساعد" أو "يا NEXORA"). يتوقف تلقائيًا عند إغلاق المتصفح.'
                : 'Wake Word active (say "Hey Assistant" or "يا NEXORA"). Browser stops listening when closed.'}
            </span>
          </div>
          <button
            type="button"
            onClick={onDisableWakeWord}
            className="underline font-medium shrink-0"
          >
            {isAr ? 'تعطيل التنبيه الصوتي' : 'Disable Wake Word'}
          </button>
        </div>
      )}

      {/* Alerts */}
      {(errorMsg || micError || ttsError || visibilityNotice || wakeWordError) && (
        <div className="px-6 pt-3 space-y-2">
          {errorMsg && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              <span>{errorMsg}</span>
              <button type="button" onClick={onDismissError} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {micError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span>{micError}</span>
              <button type="button" onClick={() => setMicError(null)} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {ttsError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span>{ttsError}</span>
              <button type="button" onClick={() => setTtsError(null)} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {wakeWordError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span>{wakeWordError}</span>
              <button type="button" onClick={() => setWakeWordError(null)} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {visibilityNotice && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300">
              <span>{visibilityNotice}</span>
              <button
                type="button"
                onClick={() => setVisibilityNotice(null)}
                className="underline shrink-0"
              >
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Messages Stream (Clean user experience — NO internal KB/sections/DB exposed) */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="py-12 space-y-8">
              <div className="space-y-3">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 text-balance">
                  {incognitoMode
                    ? isAr
                      ? 'محادثة مؤقتة خاصة (NEXORA AI)'
                      : 'Private Temporary Chat (NEXORA AI)'
                    : isAr
                    ? 'مرحبًا بك في NEXORA AI'
                    : 'Welcome to NEXORA AI'}
                </h1>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                  {incognitoMode
                    ? isAr
                      ? 'رسائل هذه الجلسة لا تُحفظ في قاعدة البيانات ولا تظهر في السجل.'
                      : 'Messages in this temporary chat are not saved to history or database.'
                    : isAr
                    ? 'اسأل أي سؤال، ارفع صورًا أو ملفات Excel/CSV/PDF للتحليل، تحدث مباشرة بالصوت، أو نفّذ أوامر التطبيقات بأمان.'
                    : 'Ask any question, upload images or Excel/CSV/PDF files, speak naturally, or run confirmed device & file tasks.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void onSendMessage(prompt, detectClientPlatform())}
                    className="text-start p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-600 transition-colors text-sm text-slate-800 dark:text-slate-200"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const meta = msg.metadata;
              const isSpeaking = speakingMessageId === msg.id;
              const launchOutcome = deviceResults[msg.id];
              const fileActionOutcome = fileActionResults[msg.id];
              const isEditingThis = editingMsgId === msg.id;
              const isStreamingThis = msg.id === 'streaming_temp';

              return (
                <article
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`w-full max-w-3xl rounded-xl px-5 py-4 ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {/* Header Metadata Line & Optional Audio Controls */}
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 pb-2 mb-3 border-b text-xs ${
                        isUser
                          ? 'border-blue-500/40 text-blue-100'
                          : 'border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {isUser ? (isAr ? 'أنت' : 'You') : 'NEXORA'}
                        </span>
                        {msg.is_edited && (
                          <span className="text-[11px] opacity-80">
                            ({isAr ? 'معدّلة' : 'Edited'})
                          </span>
                        )}
                        {!isUser && meta?.toolsExecuted && meta.toolsExecuted.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {meta.toolsExecuted
                                .map((t) => (isAr ? t.toolNameAr : t.toolNameEn))
                                .join(' / ')}
                            </span>
                          </>
                        )}
                        {!isUser && isSpeaking && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-blue-600 dark:text-blue-400 font-medium">
                              {speechState === 'paused'
                                ? isAr
                                  ? 'متوقف مؤقتًا'
                                  : 'Paused'
                                : isAr
                                ? 'جاري القراءة الصوتية...'
                                : 'Speaking...'}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Strictly Optional Read Aloud Controls on Assistant Replies */}
                      {!isUser && !isStreamingThis && (
                        <div className="flex flex-wrap items-center gap-2">
                          {isSpeaking ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleSpeakMessage(msg)}
                                className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {speechState === 'paused' ? (
                                  <>
                                    <Play className="w-3.5 h-3.5" />
                                    <span>{isAr ? 'متابعة' : 'Resume'}</span>
                                  </>
                                ) : (
                                  <>
                                    <Pause className="w-3.5 h-3.5" />
                                    <span>{isAr ? 'إيقاف مؤقت' : 'Pause'}</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleSpeakMessage(msg, true)}
                                className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600"
                                title={isAr ? 'إعادة التشغيل' : 'Replay'}
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  stopAllSpeech();
                                  setSpeakingMessageId(null);
                                  setSpeechState('idle');
                                }}
                                className="flex items-center gap-1 text-xs text-red-600 hover:underline"
                              >
                                <Square className="w-3 h-3" />
                                <span>{isAr ? 'إيقاف' : 'Stop'}</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSpeakMessage(msg)}
                              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>{isAr ? 'تشغيل الصوت' : 'Read Aloud'}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Transparent API Quota / Vision / Service Notice */}
                    {!isUser && meta?.apiErrorCode && (
                      <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          {meta.apiErrorCode === 'QUOTA_EXCEEDED'
                            ? isAr
                              ? 'تنبيه الخدمة: تم بلوغ حد طلبات API المؤقت (HTTP 429).'
                              : 'Service notice: Temporary API quota reached (HTTP 429).'
                            : meta.apiErrorCode === 'NOT_CONFIGURED'
                            ? isAr
                              ? 'تنبيه الاتصال: مفتاح GEMINI_API_KEY غير مفعّل حاليًا في البيئة.'
                              : 'Connection notice: GEMINI_API_KEY is not configured in environment.'
                            : meta.apiErrorCode === 'VISION_UNSUPPORTED'
                            ? isAr
                              ? 'تنبيه الرؤية: النموذج الحالي لا يدعم تحليل الصور.'
                              : 'Vision notice: Current model does not support image analysis.'
                            : isAr
                            ? 'تنبيه اتصال مؤقت مع مزود الذكاء الاصطناعي.'
                            : 'Temporary AI provider connection notice.'}
                        </span>
                      </div>
                    )}

                    {/* Message Body or Inline Editor */}
                    {isEditingThis ? (
                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          value={editingDraft}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          className="w-full rounded-lg border border-blue-300 bg-white text-slate-900 px-3 py-2 text-sm"
                        />
                        <div className="flex items-center justify-end gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => setEditingMsgId(null)}
                            className="px-3 py-1.5 rounded bg-blue-700 text-white"
                          >
                            {isAr ? 'إلغاء' : 'Cancel'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const clean = editingDraft.trim();
                              if (!clean) return;
                              setEditingMsgId(null);
                              await onEditMessage(msg.id, clean);
                            }}
                            className="px-3 py-1.5 rounded bg-white text-blue-700 font-semibold"
                          >
                            {isAr ? 'حفظ وإعادة التوليد' : 'Save & Regenerate'}
                          </button>
                        </div>
                      </div>
                    ) : isUser ? (
                      <div className="text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                    ) : (
                      <MarkdownRenderer
                        content={msg.content || (isStreamingThis ? '...' : '')}
                        lang={meta?.language ?? settings.language}
                      />
                    )}

                    {/* Structured Tabular Data Analysis Card + SVG Bar Chart */}
                    {!isUser && meta?.dataAnalysis && (
                      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-800 dark:text-slate-200">
                          <span className="flex items-center gap-1.5">
                            <BarChart3 className="w-4 h-4 text-blue-600" />
                            <span>
                              {isAr ? 'ملخص تحليل البيانات:' : 'Tabular Data Analysis:'}{' '}
                              {meta.dataAnalysis.fileName}
                            </span>
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {meta.dataAnalysis.rowCount} {isAr ? 'صف' : 'rows'} ×{' '}
                            {meta.dataAnalysis.columnCount} {isAr ? 'عمود' : 'cols'}
                          </span>
                        </div>

                        {meta.dataAnalysis.numericStats.length > 0 && (
                          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-[11px] text-start border-collapse">
                              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                <tr>
                                  <th className="px-2.5 py-1.5">{isAr ? 'العمود' : 'Column'}</th>
                                  <th className="px-2.5 py-1.5">{isAr ? 'المتوسط' : 'Mean'}</th>
                                  <th className="px-2.5 py-1.5">{isAr ? 'الأدنى' : 'Min'}</th>
                                  <th className="px-2.5 py-1.5">{isAr ? 'الأقصى' : 'Max'}</th>
                                  <th className="px-2.5 py-1.5">{isAr ? 'المجموع' : 'Sum'}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                                {meta.dataAnalysis.numericStats.map((st) => (
                                  <tr key={st.column}>
                                    <td className="px-2.5 py-1.5 font-sans font-medium">{st.column}</td>
                                    <td className="px-2.5 py-1.5">{st.mean}</td>
                                    <td className="px-2.5 py-1.5">{st.min}</td>
                                    <td className="px-2.5 py-1.5">{st.max}</td>
                                    <td className="px-2.5 py-1.5">{st.sum}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {meta.dataAnalysis.chartSeries && meta.dataAnalysis.chartSeries.length > 0 && (() => {
                          const series = meta.dataAnalysis.chartSeries!;
                          const maxVal = Math.max(...series.map((s) => Math.abs(s.value)), 1);
                          return (
                            <div dir="ltr" className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 space-y-1.5">
                              {series.slice(0, 8).map((pt, idx) => (
                                <div key={`${pt.label}-${idx}`} className="flex items-center gap-2 text-[11px]">
                                  <span className="w-24 truncate text-slate-600 dark:text-slate-300">
                                    {pt.label}
                                  </span>
                                  <div className="flex-1 h-2.5 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                    <div
                                      className="h-full bg-blue-600 rounded"
                                      style={{ width: `${Math.max(4, Math.round((Math.abs(pt.value) / maxVal) * 100))}%` }}
                                    />
                                  </div>
                                  <span className="w-16 text-right font-mono text-slate-500">
                                    {pt.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Real Web Reference Images Grid (Wikimedia/Wikipedia Only, Zero AI Generation) */}
                    {!isUser && meta?.referenceImages && meta.referenceImages.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                          <ImageIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>{isAr ? 'صور مرجعية من الويب' : 'Web Reference Images'}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {meta.referenceImages.map((img) => (
                            <div
                              key={img.imageUrl}
                              className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800"
                            >
                              <a
                                href={img.pageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block aspect-video bg-slate-100 dark:bg-slate-900 overflow-hidden"
                              >
                                <img
                                  src={img.thumbUrl}
                                  alt={img.title}
                                  loading="lazy"
                                  className="w-full h-full object-cover"
                                />
                              </a>
                              <div className="p-2 flex items-center justify-between gap-2 text-[11px]">
                                <a
                                  href={img.pageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="truncate font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  {img.title}
                                </a>
                                <a
                                  href={img.imageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={isAr ? 'فتح / تنزيل الصورة' : 'Open / Download Image'}
                                  className="shrink-0 text-slate-500 hover:text-blue-600"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Device Control / Destructive Confirmation Card */}
                    {!isUser && meta?.deviceCommand && meta.deviceCommand.detected && (
                      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <span>
                            {meta.deviceCommand.action === 'close_app'
                              ? isAr
                                ? 'إغلاق التطبيق (يتطلب موافقة)'
                                : 'Close Application (Confirmation Required)'
                              : meta.deviceCommand.action === 'file_action'
                              ? isAr
                                ? 'إجراء على الملفات (يتطلب موافقة)'
                                : 'File Operation (Confirmation Required)'
                              : isAr
                              ? 'التحكم بالتطبيق'
                              : 'App Launch'}{' '}
                            · <span className="font-mono">{meta.deviceCommand.targetPlatform}</span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {meta.deviceCommand.action === 'file_action' &&
                          meta.deviceCommand.pendingFileAction ? (
                            <button
                              type="button"
                              onClick={() => void handleConfirmedFileAction(msg.id, meta.deviceCommand!)}
                              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                            >
                              {meta.deviceCommand.pendingFileAction.operation === 'delete'
                                ? isAr
                                  ? `تأكيد حذف "${meta.deviceCommand.pendingFileAction.targetPath}"`
                                  : `Confirm Delete "${meta.deviceCommand.pendingFileAction.targetPath}"`
                                : isAr
                                ? 'تأكيد تنظيف الملفات المؤقتة'
                                : 'Confirm Clean Temp Files'}
                            </button>
                          ) : meta.deviceCommand.action === 'close_app' ? (
                            <button
                              type="button"
                              onClick={() => void handleDeviceLaunch(msg.id, meta.deviceCommand!)}
                              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                            >
                              {isAr
                                ? `تأكيد إغلاق ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`
                                : `Confirm Close ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`}
                            </button>
                          ) : (
                            meta.deviceCommand.supportedOnCurrentPlatform && (
                              <button
                                type="button"
                                onClick={() => void handleDeviceLaunch(msg.id, meta.deviceCommand!)}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                              >
                                {meta.deviceCommand.requiresConfirmation
                                  ? isAr
                                    ? `تأكيد فتح ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`
                                    : `Confirm Launch ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`
                                  : isAr
                                  ? `فتح ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName} الآن`
                                  : `Open ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`}
                              </button>
                            )
                          )}

                          {launchOutcome?.canFallbackDownload && (
                            <button
                              type="button"
                              onClick={() => {
                                const fallbackRes = openAppDownloadFallback(meta.deviceCommand!);
                                setDeviceResults((prev) => ({ ...prev, [msg.id]: fallbackRes }));
                              }}
                              className="px-3.5 py-2 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            >
                              {isAr ? 'فتح صفحة التطبيق / المتجر' : 'Open App Store / Web Link'}
                            </button>
                          )}
                        </div>

                        {launchOutcome && (
                          <p
                            className={`text-xs ${
                              launchOutcome.executed
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isAr ? launchOutcome.messageAr : launchOutcome.messageEn}
                          </p>
                        )}
                        {fileActionOutcome && (
                          <p
                            className={`text-xs ${
                              fileActionOutcome.ok
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {fileActionOutcome.msg}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Medical Disclaimer Notice ONLY for actual medical responses */}
                    {!isUser && meta?.medicalDisclaimerIncluded && (
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          {isAr
                            ? 'تنبيه: المعلومات الطبية للتثقيف العلمي فقط ولا تُغني عن استشارة الطبيب المختص في الحالات الشخصية.'
                            : 'Notice: Medical information is strictly educational and does not substitute for consulting a licensed physician.'}
                        </span>
                      </div>
                    )}

                    {/* External Web Sources with Copy Link */}
                    {!isUser && meta?.webSources && meta.webSources.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                          <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>{isAr ? 'المصادر الخارجية' : 'External Sources'}</span>
                        </div>
                        <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                          {meta.webSources.map((w) => (
                            <li key={w.url} className="flex flex-wrap items-center gap-1.5">
                              <a
                                href={w.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                              >
                                <span>{w.title}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <button
                                type="button"
                                onClick={() => handleCopyText(`src_${w.url}`, w.url)}
                                className="text-slate-400 hover:text-blue-600 p-0.5"
                                title={isAr ? 'نسخ الرابط' : 'Copy link'}
                              >
                                {copiedId === `src_${w.url}` ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                              <span aria-hidden="true">·</span>
                              <span>{w.sourceName}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Per-Message Quick Actions Footer */}
                    {!isStreamingThis && !isEditingThis && (
                      <div
                        className={`mt-3 pt-2.5 border-t flex flex-wrap items-center gap-3 text-[11px] ${
                          isUser
                            ? 'border-blue-500/30 text-blue-100'
                            : 'border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleCopyText(msg.id, msg.content)}
                          className="inline-flex items-center gap-1 hover:opacity-80"
                        >
                          {copiedId === msg.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>
                            {copiedId === msg.id
                              ? isAr
                                ? 'تم النسخ'
                                : 'Copied'
                              : isAr
                              ? 'نسخ'
                              : 'Copy'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleShareMessage(msg)}
                          className="inline-flex items-center gap-1 hover:opacity-80"
                        >
                          <Share2 className="w-3 h-3" />
                          <span>
                            {copiedId === `share_${msg.id}`
                              ? isAr
                                ? 'نُسخ للمشاركة'
                                : 'Copied'
                              : isAr
                              ? 'مشاركة'
                              : 'Share'}
                          </span>
                        </button>

                        {isUser && !incognitoMode && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMsgId(msg.id);
                                setEditingDraft(msg.content);
                              }}
                              className="inline-flex items-center gap-1 hover:opacity-80"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>{isAr ? 'تعديل' : 'Edit'}</span>
                            </button>
                            {msg.is_edited && (
                              <button
                                type="button"
                                onClick={() => void onRestoreMessage(msg.id)}
                                className="inline-flex items-center gap-1 hover:opacity-80"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>{isAr ? 'استعادة الأصل' : 'Restore Original'}</span>
                              </button>
                            )}
                          </>
                        )}

                        {!isUser && !incognitoMode && msg.id === lastAssistantId && (
                          <button
                            type="button"
                            disabled={sending}
                            onClick={() => void onRegenerateLastReply()}
                            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>{isAr ? 'إعادة التوليد' : 'Regenerate'}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}

          {sending && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 px-4 py-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>{getMicStatusLabel('awaiting_reply', settings.language)}</span>
              </div>
              <button
                type="button"
                onClick={onStopGeneration}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                <Square className="w-3 h-3" />
                <span>{isAr ? 'إيقاف التوليد' : 'Stop Generation'}</span>
              </button>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer with Multimodal Upload & Dual Microphone Mode */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-6 py-4"
      >
        <div className="max-w-4xl mx-auto space-y-2.5">
          {/* Attached Files & Image Thumbnails Strip */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.fileName}-${idx}`}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  {att.mimeType.startsWith('image/') && att.base64Data && (
                    <img
                      src={`data:${att.mimeType};base64,${att.base64Data}`}
                      alt={att.fileName}
                      className="w-7 h-7 rounded object-cover"
                    />
                  )}
                  <span className="max-w-44 truncate">{att.fileName}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Explicit Microphone State + Dual Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>{isAr ? 'وضع الميكروفون:' : 'Mic Mode:'}</span>
              <button
                type="button"
                onClick={() =>
                  onChangeMicMode(
                    settings.voiceMicMode === 'record_send' ? 'live_dictation' : 'record_send'
                  )
                }
                className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium"
              >
                {settings.voiceMicMode === 'live_dictation'
                  ? isAr
                    ? 'إملاء مباشر أثناء التحدث'
                    : 'Live Dictation'
                  : isAr
                  ? 'تسجيل ومراجعة قبل الإرسال'
                  : 'Record & Review'}
              </button>
            </div>

            {(effectiveMicState !== 'idle' || interimText) && (
              <div className="flex items-center gap-3">
                <span
                  className={`font-medium ${
                    effectiveMicState === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : effectiveMicState === 'listening'
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {getMicStatusLabel(effectiveMicState, settings.language)}
                </span>

                {effectiveMicState === 'listening' && (
                  <div
                    className="w-20 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
                    title={isAr ? 'مستوى الصوت الفعلي' : 'Real audio input level'}
                  >
                    <div
                      className="h-full bg-blue-600 transition-all duration-75"
                      style={{ width: `${Math.max(6, Math.round(audioLevel * 100))}%` }}
                    />
                  </div>
                )}

                {interimText && settings.voiceMicMode !== 'live_dictation' && (
                  <span className="italic text-blue-600 dark:text-blue-400 truncate max-w-xs">
                    {interimText}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-end gap-2">
            <label
              className="shrink-0 h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center cursor-pointer"
              title={
                isAr
                  ? 'إرفاق صورة أو ملف (JPG, PNG, WEBP, PDF, DOCX, XLSX, CSV, JSON, Code)'
                  : 'Attach image or file (JPG, PNG, WEBP, PDF, DOCX, XLSX, CSV, JSON, Code)'
              }
            >
              <Paperclip className="w-4 h-4" />
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.txt,.md,.csv,.json,.ts,.tsx,.js,.py,.html,.xml,.log"
                multiple
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>

            <button
              type="button"
              data-nexora-mic-btn="true"
              onClick={() => void handleToggleMic()}
              className={`shrink-0 h-11 px-3.5 rounded-xl border flex items-center gap-2 text-xs font-medium transition-colors whitespace-nowrap ${
                micStatus === 'listening'
                  ? 'bg-red-600 hover:bg-red-700 border-red-600 text-white'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              aria-label={isAr ? 'التحدث بالميكروفون' : 'Voice Input'}
            >
              {micStatus === 'listening' ? (
                <>
                  <MicOff className="w-4 h-4" />
                  <span>{isAr ? 'إيقاف التسجيل' : 'Stop Mic'}</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {settings.voiceSttLang === 'ar-SA' ? 'تحدث (عربي)' : 'Speak (EN)'}
                  </span>
                </>
              )}
            </button>

            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={
                isAr
                  ? 'اكتب سؤالك، أو أرفق صورة/ملفًا، أو اضغط الميكروفون...'
                  : 'Type your question, attach an image/file, or press the mic...'
              }
              className="flex-1 min-h-11 max-h-36 resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              type="submit"
              disabled={
                sending || (!inputText.trim() && !interimText.trim() && attachments.length === 0)
              }
              className="shrink-0 h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{isAr ? 'إرسال' : 'Send'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
