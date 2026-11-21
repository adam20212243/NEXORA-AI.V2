import { Loader2, Mic, MicOff, Radio, Square, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { detectClientPlatform } from '../services/deviceControlService.ts';
import {
  getMicStatusLabel,
  getVoiceAssistantStatus,
  speakText,
  startBackgroundVoiceService,
  startSpeechRecognitionSession,
  stopAllSpeech,
  stopBackgroundVoiceService,
  type MicStatus,
  type SttController,
} from '../services/voiceService.ts';
import type { AppSettings, DeviceControlCommand } from '../shared/types.ts';

interface FloatingVoiceAssistantProps {
  settings: AppSettings;
  onQuickSend: (
    query: string,
    platform: DeviceControlCommand['targetPlatform']
  ) => Promise<string | null>;
  onToggleSetting: (updates: Partial<AppSettings>) => Promise<void>;
}

export function FloatingVoiceAssistant({
  settings,
  onQuickSend,
  onToggleSetting,
}: FloatingVoiceAssistantProps) {
  const isAr = settings.language === 'ar';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcriptPreview, setTranscriptPreview] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const sttRef = useRef<SttController | null>(null);

  useEffect(() => {
    return () => {
      sttRef.current?.abort();
    };
  }, []);

  if (!settings.enableFloatingVoiceButton) {
    return null;
  }

  const assistantState = getVoiceAssistantStatus(settings.enableWakeWord);

  const handleToggleVoiceCapture = async () => {
    setStatusError(null);
    if (micStatus === 'listening' || micStatus === 'requesting_permission') {
      sttRef.current?.stop();
      return;
    }

    stopAllSpeech();
    setSpeaking(false);
    setTranscriptPreview('');

    sttRef.current = await startSpeechRecognitionSession({
      lang: settings.voiceSttLang,
      uiLang: settings.language,
      deviceId: settings.voiceInputDeviceId || undefined,
      onStatus: (st, err) => {
        setMicStatus(st);
        if (err) setStatusError(err);
      },
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onInterim: (interim) => setTranscriptPreview(interim),
      onFinal: async (finalText) => {
        const clean = finalText.trim();
        if (!clean) return;
        setTranscriptPreview(clean);
        setMicStatus('sending');
        try {
          const reply = await onQuickSend(clean, detectClientPlatform());
          setMicStatus('idle');
          if (reply) {
            setLastReply(reply);
            if (settings.voiceTtsEnabled && settings.autoSpeakResponses) {
              setSpeaking(true);
              await speakText({
                text: reply,
                lang: settings.language,
                rate: settings.voiceTtsRate,
                volume: settings.voiceTtsVolume,
                preferredVoiceName: settings.voiceTtsVoiceName,
                useServerFallback: settings.useServerTtsFallback,
                onEnd: () => setSpeaking(false),
                onError: () => setSpeaking(false),
              });
            }
          }
        } catch (err) {
          setMicStatus('error');
          setStatusError(err instanceof Error ? err.message : 'Voice command failed.');
        }
      },
    });
  };

  const handleToggleNativeBackground = () => {
    setStatusError(null);
    if (assistantState.mode !== 'android_foreground_service') {
      void onToggleSetting({
        enableBackgroundVoiceAssistant: !settings.enableBackgroundVoiceAssistant,
        enableWakeWord: !settings.enableBackgroundVoiceAssistant,
      });
      return;
    }

    const res = assistantState.active
      ? stopBackgroundVoiceService()
      : startBackgroundVoiceService();
    if (!res.ok && res.error) {
      setStatusError(res.error);
    } else {
      void onToggleSetting({ enableBackgroundVoiceAssistant: !assistantState.active });
    }
  };

  return (
    <div className="fixed bottom-5 end-5 z-40 flex flex-col items-end gap-2">
      {drawerOpen && (
        <div className="w-80 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Radio
                className={`w-4 h-4 ${
                  micStatus === 'listening' || assistantState.active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-400'
                }`}
              />
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                NEXORA Voice Assistant
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label={isAr ? 'إغلاق المساعد الصوتي' : 'Close voice drawer'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
            {isAr ? assistantState.reasonAr : assistantState.reasonEn}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggleVoiceCapture()}
              disabled={micStatus === 'sending' || micStatus === 'awaiting_reply'}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                micStatus === 'listening'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {micStatus === 'listening' ? (
                <>
                  <MicOff className="w-3.5 h-3.5" />
                  <span>{isAr ? 'إيقاف وإرسال' : 'Stop & Send'}</span>
                </>
              ) : micStatus === 'sending' || micStatus === 'awaiting_reply' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isAr ? 'جاري التنفيذ...' : 'Processing...'}</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تحدث الآن' : 'Speak Now'}</span>
                </>
              )}
            </button>

            {speaking && (
              <button
                type="button"
                onClick={() => {
                  stopAllSpeech();
                  setSpeaking(false);
                }}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1"
              >
                <Square className="w-3.5 h-3.5 text-red-600" />
                <span>{isAr ? 'إيقاف' : 'Stop'}</span>
              </button>
            )}
          </div>

          {micStatus === 'listening' && (
            <div className="space-y-1">
              <div className="text-[11px] text-blue-600 dark:text-blue-400">
                {getMicStatusLabel(micStatus, settings.language)}
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-75"
                  style={{ width: `${Math.max(8, Math.round(audioLevel * 100))}%` }}
                />
              </div>
            </div>
          )}

          {transcriptPreview && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2 text-[11px] text-slate-700 dark:text-slate-200">
              <span className="font-semibold">{isAr ? 'النص:' : 'Heard:'} </span>
              {transcriptPreview}
            </div>
          )}

          {lastReply && (
            <div className="rounded-lg bg-blue-50/70 dark:bg-blue-950/30 p-2 text-[11px] text-slate-800 dark:text-slate-200 max-h-28 overflow-y-auto">
              <div className="flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300 mb-0.5">
                <Volume2 className="w-3 h-3" />
                <span>{isAr ? 'آخر رد:' : 'Latest reply:'}</span>
              </div>
              <p className="whitespace-pre-wrap">{lastReply}</p>
            </div>
          )}

          {statusError && (
            <div className="text-[11px] text-amber-700 dark:text-amber-300">{statusError}</div>
          )}

          <button
            type="button"
            onClick={handleToggleNativeBackground}
            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {assistantState.mode === 'android_foreground_service'
              ? assistantState.active
                ? isAr
                  ? 'إيقاف خدمة الخلفية الصوتية'
                  : 'Stop Android Background Service'
                : isAr
                ? 'تشغيل خدمة الخلفية الصوتية'
                : 'Start Android Background Service'
              : settings.enableWakeWord
              ? isAr
                ? 'تعطيل وضع التنبيه الصوتي'
                : 'Disable Wake Word Mode'
              : isAr
              ? 'تفعيل وضع التنبيه الصوتي أثناء فتح التبويب'
              : 'Enable Tab Wake Word Mode'}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setDrawerOpen((prev) => !prev)}
        className={`h-12 w-12 rounded-full shadow-lg flex items-center justify-center transition-colors ${
          micStatus === 'listening'
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
        aria-label={isAr ? 'المساعد الصوتي العائم' : 'Floating Voice Assistant'}
        title="NEXORA Voice Assistant"
      >
        {micStatus === 'listening' ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>
    </div>
  );
}
