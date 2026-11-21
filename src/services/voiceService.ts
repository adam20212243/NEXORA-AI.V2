import { WAKE_WORD_PHRASES } from '../shared/constants.ts';
import { apiClient } from './apiClient.ts';

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    NexoraAndroidBridge?: {
      launchApp?: (packageName: string, intentUri: string) => boolean;
      isAppInstalled?: (packageName: string) => boolean;
      openPlayStoreOrDownload?: (packageName: string, appName: string) => boolean;
      openDefaultAssistantSettings?: () => boolean;
      speakText?: (text: string, lang: string, rate: number) => boolean;
      stopSpeaking?: () => void;
      isBackgroundServiceActive?: () => boolean;
      startBackgroundVoiceService?: () => boolean;
      stopBackgroundVoiceService?: () => boolean;
      openSystemSettingsSection?: (section: string) => boolean;
      openSafDocumentPicker?: () => boolean;
    };
  }
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
  }>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export type MicStatus =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'transcribing'
  | 'recognized'
  | 'sending'
  | 'awaiting_reply'
  | 'error';

export type MicPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface AudioInputDeviceOption {
  deviceId: string;
  label: string;
}

export interface VoiceCapabilities {
  speechRecognitionSupported: boolean;
  mediaRecorderSupported: boolean;
  speechSynthesisSupported: boolean;
  androidBridgeAvailable: boolean;
  microphoneSecureContext: boolean;
}

export function getVoiceCapabilities(): VoiceCapabilities {
  const hasWin = typeof window !== 'undefined';
  return {
    speechRecognitionSupported:
      hasWin && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    mediaRecorderSupported:
      hasWin && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    speechSynthesisSupported: hasWin && 'speechSynthesis' in window,
    androidBridgeAvailable: hasWin && Boolean(window.NexoraAndroidBridge),
    microphoneSecureContext: hasWin ? window.isSecureContext : false,
  };
}

export function getMicStatusLabel(status: MicStatus, uiLang: 'ar' | 'en'): string {
  const labels: Record<MicStatus, { ar: string; en: string }> = {
    idle: { ar: 'الميكروفون مغلق', en: 'Microphone closed' },
    requesting_permission: { ar: 'طلب الإذن...', en: 'Requesting permission...' },
    listening: { ar: 'جاري الاستماع...', en: 'Listening...' },
    transcribing: { ar: 'جاري تحويل الصوت إلى نص...', en: 'Converting speech to text...' },
    recognized: { ar: 'تم التعرف على الكلام', en: 'Speech recognized' },
    sending: { ar: 'جاري إرسال السؤال...', en: 'Sending question...' },
    awaiting_reply: { ar: 'جاري تجهيز الرد...', en: 'Preparing response...' },
    error: { ar: 'حدث خطأ في التسجيل', en: 'Recording error' },
  };
  return labels[status][uiLang];
}

export async function getMicrophonePermissionState(): Promise<MicPermissionStatus> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unsupported';
  }
  if (!navigator.permissions?.query) {
    return 'prompt';
  }
  try {
    const res = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (res.state === 'granted' || res.state === 'denied' || res.state === 'prompt') {
      return res.state;
    }
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

export async function getAudioInputDevices(): Promise<AudioInputDeviceOption[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${idx + 1}`,
      }));
  } catch {
    return [];
  }
}

export function mapMicErrorMessage(code: string, uiLang: 'ar' | 'en'): string {
  const arMap: Record<string, string> = {
    'not-allowed':
      'تم رفض إذن الميكروفون. فعّل إذن الميكروفون من إعدادات المتصفح ثم أعد المحاولة.',
    'permission-denied':
      'تم رفض إذن الميكروفون. اسمح بالوصول من أيقونة القفل بجانب عنوان الموقع.',
    'no-speech':
      'لم يتم التقاط صوت واضح من الميكروفون. تأكد من اختيار جهاز الإدخال الصحيح وتحدث بوضوح.',
    'audio-capture':
      'تعذر التقاط الصوت من الميكروفون أو أن الميكروفون غير متصل/مشغول.',
    network:
      'فشل الاتصال بخدمة التعرف السحابي للمتصفح؛ جارٍ التحقق من البديل أو أعد المحاولة.',
    aborted: 'تم إيقاف التسجيل الصوتي قبل إتمام التعرف.',
    'not-supported':
      'المتصفح الحالي لا يدعم التقاط الصوت أو يحتاج اتصال HTTPS آمن.',
  };
  const enMap: Record<string, string> = {
    'not-allowed':
      'Microphone permission denied. Enable microphone access in browser settings and retry.',
    'permission-denied':
      'Microphone permission denied. Allow access via the browser address bar.',
    'no-speech':
      'No clear speech captured. Verify the active input device and speak closer to the mic.',
    'audio-capture':
      'Unable to capture audio—microphone may be disconnected, muted, or in use.',
    network:
      'Browser speech service network failure.',
    aborted: 'Voice capture stopped before completion.',
    'not-supported':
      'Audio capture is unsupported in this browser or requires a secure HTTPS context.',
  };
  return (
    (uiLang === 'ar' ? arMap[code] : enMap[code]) ??
    (uiLang === 'ar' ? `خطأ في التسجيل: ${code}` : `Recording error: ${code}`)
  );
}

export function playReadyChime(): void {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
    setTimeout(() => void ctx.close(), 300);
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

export interface SttController {
  stop: () => void;
  abort: () => void;
}

/**
 * Dual-path real audio capture + speech recognition:
 * 1) Opens real MediaStream on chosen audioInputDeviceId and measures live RMS audio energy
 *    so the UI NEVER fakes a glowing mic button without real input hardware access.
 * 2) Runs Web Speech Recognition AND parallel MediaRecorder audio buffering.
 * 3) On stop/end, commits unfinalized interim transcript or falls back to /api/voice/transcribe
 *    when Web Speech fails with network/service errors while real audio was captured.
 */
export async function startSpeechRecognitionSession(options: {
  lang: 'ar-SA' | 'en-US';
  uiLang: 'ar' | 'en';
  deviceId?: string;
  onStatus: (status: MicStatus, errorText?: string) => void;
  onAudioLevel?: (level: number) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
}): Promise<SttController> {
  options.onStatus('requesting_permission');

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    options.onStatus('error', mapMicErrorMessage('not-supported', options.uiLang));
    return { stop: () => {}, abort: () => {} };
  }

  let stream: MediaStream;
  try {
    const constraints: MediaStreamConstraints = {
      audio: options.deviceId
        ? { deviceId: { exact: options.deviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true },
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : 'not-allowed';
    const code =
      name === 'NotFoundError' || name === 'OverconstrainedError' ? 'audio-capture' : 'not-allowed';
    options.onStatus('error', mapMicErrorMessage(code, options.uiLang));
    return { stop: () => {}, abort: () => {} };
  }

  // Real-time audio level meter via AudioContext + AnalyserNode
  let audioCtx: AudioContext | null = null;
  let rafId = 0;
  let peakAudioLevel = 0;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioCtx) {
    try {
      audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.min(1, Math.sqrt(sumSq / data.length) * 3.5);
        if (rms > peakAudioLevel) peakAudioLevel = rms;
        options.onAudioLevel?.(rms);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch {
      // Ignore analyser errors
    }
  }

  // Parallel MediaRecorder capture so we ALWAYS have real audio bytes if server transcription fallback is needed
  let recorder: MediaRecorder | null = null;
  const audioChunks: Blob[] = [];
  const mimeType =
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4';
  if (typeof MediaRecorder !== 'undefined') {
    try {
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      recorder.start(250);
    } catch {
      recorder = null;
    }
  }

  let closed = false;
  let aborted = false;
  let finalBuffer = '';
  let latestInterim = '';
  let recognition: SpeechRecognitionInstance | null = null;
  let speechErrorCode: string | null = null;

  const cleanupHardware = () => {
    if (rafId) cancelAnimationFrame(rafId);
    options.onAudioLevel?.(0);
    if (audioCtx) {
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  const finalizeAudioSession = async () => {
    if (closed) return;
    closed = true;

    const capturedSpeech = `${finalBuffer} ${latestInterim}`.trim();
    if (aborted) {
      cleanupHardware();
      options.onStatus('idle');
      return;
    }

    if (capturedSpeech.length > 0) {
      cleanupHardware();
      options.onStatus('recognized');
      options.onFinal(capturedSpeech);
      return;
    }

    // If Web Speech failed or produced empty text, try server Gemini transcription if real audio was captured
    if (recorder && audioChunks.length > 0 && peakAudioLevel > 0.015) {
      options.onStatus('transcribing');
      try {
        const blob = new Blob(audioChunks, { type: mimeType });
        const base64 = await blobToBase64(blob);
        const res = await apiClient.transcribeAudioFallback(base64, mimeType, options.lang);
        cleanupHardware();
        if (res.transcript && res.transcript.trim().length > 0) {
          options.onStatus('recognized');
          options.onFinal(res.transcript.trim());
          return;
        }
      } catch (fallbackErr) {
        cleanupHardware();
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : '';
        options.onStatus(
          'error',
          speechErrorCode
            ? `${mapMicErrorMessage(speechErrorCode, options.uiLang)} (${fallbackMsg})`
            : fallbackMsg || mapMicErrorMessage('no-speech', options.uiLang)
        );
        return;
      }
    }

    cleanupHardware();
    options.onStatus('error', mapMicErrorMessage(speechErrorCode ?? 'no-speech', options.uiLang));
  };

  const stopRecorderThenFinalize = () => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        void finalizeAudioSession();
      };
      recorder.stop();
    } else {
      void finalizeAudioSession();
    }
  };

  const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (RecognitionCtor) {
    recognition = new RecognitionCtor();
    recognition.lang = options.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      options.onStatus('listening');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript ?? '';
        if (event.results[i].isFinal) {
          finalBuffer = `${finalBuffer} ${transcript}`.trim();
        } else {
          interim += transcript;
        }
      }
      latestInterim = interim.trim();
      const combined = `${finalBuffer} ${latestInterim}`.trim();
      if (combined) {
        options.onInterim(combined);
      }
    };

    recognition.onerror = (event) => {
      speechErrorCode = event.error;
    };

    recognition.onend = () => {
      stopRecorderThenFinalize();
    };

    try {
      options.onStatus('listening');
      recognition.start();
    } catch {
      speechErrorCode = 'not-supported';
      options.onStatus('listening');
    }
  } else if (recorder) {
    // Pure MediaRecorder path (e.g. Firefox or embedded WebView without SpeechRecognition)
    options.onStatus('listening');
  } else {
    cleanupHardware();
    options.onStatus('error', mapMicErrorMessage('not-supported', options.uiLang));
    return { stop: () => {}, abort: () => {} };
  }

  return {
    stop: () => {
      if (recognition) {
        try {
          recognition.stop();
          return;
        } catch {
          // Fall through to recorder stop
        }
      }
      stopRecorderThenFinalize();
    },
    abort: () => {
      aborted = true;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
      }
      stopRecorderThenFinalize();
    },
  };
}

export function matchWakeWord(transcript: string): {
  matched: boolean;
  phrase?: string;
  trailingText: string;
} {
  const lower = transcript.toLowerCase().trim();
  for (const phrase of WAKE_WORD_PHRASES) {
    const idx = lower.indexOf(phrase.toLowerCase());
    if (idx >= 0) {
      const trailing = transcript
        .slice(idx + phrase.length)
        .replace(/^[\s,،:]+/, '')
        .trim();
      return { matched: true, phrase, trailingText: trailing };
    }
  }
  return { matched: false, trailingText: '' };
}

export interface WakeWordController {
  stop: () => void;
}

export function startWakeWordListener(options: {
  lang: 'ar-SA' | 'en-US';
  onWakeWord: (trailingCommand: string) => void;
  onError: (msg: string) => void;
}): WakeWordController | null {
  const RecognitionCtor =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : undefined;
  if (!RecognitionCtor) {
    options.onError('Wake word detection requires Web Speech API or native Android service.');
    return null;
  }

  let stopped = false;
  const recognition = new RecognitionCtor();
  recognition.lang = options.lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0]?.transcript ?? '';
      const check = matchWakeWord(text);
      if (check.matched) {
        stopped = true;
        try {
          recognition.stop();
        } catch {
          // ignore
        }
        playReadyChime();
        options.onWakeWord(check.trailingText);
        return;
      }
    }
  };

  recognition.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      stopped = true;
      options.onError(ev.error);
    }
  };

  recognition.onend = () => {
    if (!stopped) {
      setTimeout(() => {
        if (!stopped) {
          try {
            recognition.start();
          } catch {
            // Ignore restart failure if tab lost focus
          }
        }
      }, 350);
    }
  };

  try {
    recognition.start();
  } catch (err) {
    options.onError(err instanceof Error ? err.message : 'Wake word start error');
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    },
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to encode audio blob.'));
    reader.readAsDataURL(blob);
  });
}

// =========================================================================
// Natural TTS Engine with Full Chunking & All 7 Mandatory Stop Rules
// =========================================================================
export type SpeechPlaybackState = 'idle' | 'playing' | 'paused';

let activeAudioElement: HTMLAudioElement | null = null;
let playbackGeneration = 0;
let currentPlaybackState: SpeechPlaybackState = 'idle';

export function getSpeechPlaybackState(): SpeechPlaybackState {
  return currentPlaybackState;
}

export function getAvailableTtsVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  return window.speechSynthesis.getVoices();
}

export function pauseSpeech(): boolean {
  if (currentPlaybackState !== 'playing') return false;
  if (activeAudioElement && !activeAudioElement.paused) {
    activeAudioElement.pause();
    currentPlaybackState = 'paused';
    return true;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
    currentPlaybackState = 'paused';
    return true;
  }
  return false;
}

export function resumeSpeech(): boolean {
  if (currentPlaybackState !== 'paused') return false;
  if (activeAudioElement && activeAudioElement.paused) {
    void activeAudioElement.play().catch(() => {});
    currentPlaybackState = 'playing';
    return true;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    currentPlaybackState = 'playing';
    return true;
  }
  return false;
}

export function stopAllSpeech(): void {
  playbackGeneration++;
  currentPlaybackState = 'idle';
  if (typeof window !== 'undefined') {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (window.NexoraAndroidBridge?.stopSpeaking) {
      window.NexoraAndroidBridge.stopSpeaking();
    }
  }
  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement.currentTime = 0;
    activeAudioElement = null;
  }
}

export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*#_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSpeechIntoChunks(text: string, maxChunkLen = 200): string[] {
  const sentences = text.split(/(?<=[.!?؟،\n])\s+/);
  const chunks: string[] = [];
  let buffer = '';

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if ((buffer + ' ' + trimmed).trim().length <= maxChunkLen) {
      buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
    } else {
      if (buffer) chunks.push(buffer);
      if (trimmed.length <= maxChunkLen) {
        buffer = trimmed;
      } else {
        for (let i = 0; i < trimmed.length; i += maxChunkLen) {
          chunks.push(trimmed.slice(i, i + maxChunkLen));
        }
        buffer = '';
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export async function speakText(options: {
  text: string;
  lang: 'ar' | 'en';
  rate: number;
  volume?: number;
  preferredVoiceName?: string;
  useServerFallback: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}): Promise<void> {
  // Rule 5: Stop previous reading immediately before starting a new one
  stopAllSpeech();
  const myGeneration = ++playbackGeneration;

  const cleanText = cleanTextForSpeech(options.text);
  if (!cleanText) {
    options.onEnd?.();
    return;
  }

  const clampedVolume = Math.min(Math.max(options.volume ?? 1.0, 0.1), 1.0);
  const targetLocale = options.lang === 'ar' ? 'ar-SA' : 'en-US';

  // 1. Native Android Bridge when packaged natively
  if (window.NexoraAndroidBridge?.speakText) {
    const ok = window.NexoraAndroidBridge.speakText(cleanText, targetLocale, options.rate);
    if (ok) {
      currentPlaybackState = 'playing';
      options.onStart?.();
      return;
    }
  }

  // 2. Browser SpeechSynthesis with full sentence chunking (reads entire response cleanly)
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const voices = window.speechSynthesis.getVoices();
    const matchedVoice =
      (options.preferredVoiceName &&
        voices.find((v) => v.name === options.preferredVoiceName)) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(options.lang)) ||
      null;

    if (matchedVoice || options.lang === 'en' || !options.useServerFallback) {
      const chunks = splitSpeechIntoChunks(cleanText, 210);
      currentPlaybackState = 'playing';
      options.onStart?.();

      for (const chunk of chunks) {
        if (myGeneration !== playbackGeneration) {
          return;
        }

        const chunkOutcome = await new Promise<'ok' | 'stopped' | 'error'>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(chunk);
          utterance.lang = targetLocale;
          utterance.rate = Math.min(Math.max(options.rate, 0.5), 2.0);
          utterance.volume = clampedVolume;
          if (matchedVoice) {
            utterance.voice = matchedVoice;
          }
          utterance.onend = () => resolve('ok');
          utterance.onerror = (ev) => {
            if (ev.error === 'interrupted' || ev.error === 'canceled') {
              resolve('stopped');
            } else {
              resolve('error');
            }
          };
          window.speechSynthesis.speak(utterance);
        });

        if (chunkOutcome === 'stopped' || myGeneration !== playbackGeneration) {
          return;
        }
        if (chunkOutcome === 'error') {
          if (options.useServerFallback) {
            await playServerTtsFallback(cleanText, myGeneration, {
              ...options,
              volume: clampedVolume,
            });
          } else {
            currentPlaybackState = 'idle';
            options.onError?.(
              options.lang === 'ar'
                ? 'تعذر تشغيل الصوت عبر المتصفح.'
                : 'Browser speech synthesis failed.'
            );
            options.onEnd?.();
          }
          return;
        }
      }

      if (myGeneration === playbackGeneration) {
        currentPlaybackState = 'idle';
        options.onEnd?.();
      }
      return;
    }
  }

  // 3. Server Gemini TTS WAV Fallback
  if (options.useServerFallback) {
    await playServerTtsFallback(cleanText, myGeneration, {
      ...options,
      volume: clampedVolume,
    });
  } else {
    currentPlaybackState = 'idle';
    options.onError?.(
      options.lang === 'ar'
        ? 'لا يتوفر صوت عربي مثبت في هذا المتصفح.'
        : 'No speech synthesis voice available in this browser.'
    );
    options.onEnd?.();
  }
}

async function playServerTtsFallback(
  cleanText: string,
  myGeneration: number,
  options: {
    volume?: number;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (msg: string) => void;
  }
): Promise<void> {
  try {
    currentPlaybackState = 'playing';
    options.onStart?.();
    const res = await apiClient.synthesizeServerTts(cleanText.slice(0, 1400));
    if (myGeneration !== playbackGeneration) return;
    const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
    audio.volume = Math.min(Math.max(options.volume ?? 1.0, 0.1), 1.0);
    activeAudioElement = audio;
    await new Promise<void>((resolve) => {
      audio.onended = () => {
        activeAudioElement = null;
        if (myGeneration === playbackGeneration) {
          currentPlaybackState = 'idle';
          options.onEnd?.();
        }
        resolve();
      };
      audio.onerror = () => {
        activeAudioElement = null;
        if (myGeneration === playbackGeneration) {
          currentPlaybackState = 'idle';
          options.onError?.('Failed to play server synthesized audio.');
          options.onEnd?.();
        }
        resolve();
      };
      void audio.play().catch((err) => {
        activeAudioElement = null;
        if (myGeneration === playbackGeneration) {
          currentPlaybackState = 'idle';
          options.onError?.(err instanceof Error ? err.message : 'Audio autoplay blocked.');
          options.onEnd?.();
        }
        resolve();
      });
    });
  } catch (err) {
    if (myGeneration === playbackGeneration) {
      currentPlaybackState = 'idle';
      options.onError?.(err instanceof Error ? err.message : 'TTS playback error.');
      options.onEnd?.();
    }
  }
}

export async function testMicrophoneCapture(deviceId?: string): Promise<{
  ok: boolean;
  peakLevel: number;
  error?: string;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, peakLevel: 0, error: 'MediaDevices API unavailable.' };
  }
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let peak = 0;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 80));
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let j = 0; j < buf.length; j++) {
          const n = (buf[j] - 128) / 128;
          sum += n * n;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > peak) peak = rms;
      }
    }
    return { ok: true, peakLevel: Math.min(1, peak * 3) };
  } catch (err) {
    return {
      ok: false,
      peakLevel: 0,
      error: err instanceof Error ? err.message : 'Microphone test failed.',
    };
  } finally {
    if (audioCtx) void audioCtx.close().catch(() => {});
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
    }
  }
}

export interface BackgroundVoiceAssistantStatus {
  mode: 'android_foreground_service' | 'browser_tab_only';
  active: boolean;
  canRunInDeviceBackground: boolean;
  reasonAr: string;
  reasonEn: string;
}

export function getVoiceAssistantStatus(wakeWordEnabled: boolean): BackgroundVoiceAssistantStatus {
  const hasNative = typeof window !== 'undefined' && Boolean(window.NexoraAndroidBridge);
  if (hasNative && window.NexoraAndroidBridge?.isBackgroundServiceActive) {
    const active = Boolean(window.NexoraAndroidBridge.isBackgroundServiceActive());
    return {
      mode: 'android_foreground_service',
      active,
      canRunInDeviceBackground: true,
      reasonAr: active
        ? 'خدمة الخلفية الصوتية على Android تعمل مع إشعار نشط.'
        : 'خدمة الخلفية الصوتية متوقفة حاليًا.',
      reasonEn: active
        ? 'Android Foreground Voice Service is running with an active notification.'
        : 'Android Foreground Voice Service is currently stopped.',
    };
  }
  return {
    mode: 'browser_tab_only',
    active: wakeWordEnabled && (typeof document === 'undefined' || document.visibilityState === 'visible'),
    canRunInDeviceBackground: false,
    reasonAr:
      'في المتصفح العادي يعمل الاستماع فقط طالما التبويب مفتوحًا؛ للتشغيل الحقيقي في خلفية الهاتف يتطلب تجميع Android APK باستخدام NexoraVoiceForegroundService.',
    reasonEn:
      'In a web browser, listening runs only while this tab is open; true device-background listening requires the Android APK ForegroundService.',
  };
}

export function startBackgroundVoiceService(): { ok: boolean; error?: string } {
  if (typeof window === 'undefined' || !window.NexoraAndroidBridge?.startBackgroundVoiceService) {
    return {
      ok: false,
      error: 'جسر Android الأصلي غير متوفر في هذه الجلسة.',
    };
  }
  const ok = Boolean(window.NexoraAndroidBridge.startBackgroundVoiceService());
  return ok ? { ok: true } : { ok: false, error: 'تعذر بدء خدمة الصوت الخلفية.' };
}

export function stopBackgroundVoiceService(): { ok: boolean; error?: string } {
  if (typeof window === 'undefined' || !window.NexoraAndroidBridge?.stopBackgroundVoiceService) {
    return { ok: false, error: 'جسر Android الأصلي غير متوفر في هذه الجلسة.' };
  }
  const ok = Boolean(window.NexoraAndroidBridge.stopBackgroundVoiceService());
  return ok ? { ok: true } : { ok: false, error: 'تعذر إيقاف خدمة الصوت الخلفية.' };
}

export async function sendDesktopNotification(
  title: string,
  body: string,
  enabled: boolean
): Promise<boolean> {
  if (!enabled || typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

