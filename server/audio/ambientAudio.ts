import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_AMBIENT_FILE_NAME = 'NEXORA_Daddy_Yankee_seamless_loop__1__da91dab1.mp3';
export const DEFAULT_AMBIENT_RELATIVE_PATH =
  'public/assets/aistudio/NEXORA_Daddy_Yankee_seamless_loop__1__da91dab1.mp3';
export const CUSTOM_AMBIENT_FILE_NAME = 'NEXORA_custom_loop.mp3';
export const AMBIENT_FILE_NAME = DEFAULT_AMBIENT_FILE_NAME;
export const MAX_AMBIENT_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export interface AmbientAudioStatus {
  available: boolean;
  fileName: string;
  sizeBytes: number | null;
  audioUrl: string | null;
  expectedPath: string;
}

export function resolveAmbientAudioPath(): string | null {
  const overridePath = process.env.NEXORA_AMBIENT_AUDIO_PATH?.trim();
  if (overridePath) {
    const resolvedOverride = path.resolve(process.cwd(), overridePath);
    try {
      if (fs.existsSync(resolvedOverride) && fs.statSync(resolvedOverride).isFile()) {
        return resolvedOverride;
      }
    } catch {
      // ignore unreadable override
    }
    return null;
  }

  const candidates = [
    path.resolve(process.cwd(), 'public', 'audio', CUSTOM_AMBIENT_FILE_NAME),
    path.resolve(process.cwd(), DEFAULT_AMBIENT_RELATIVE_PATH),
    path.resolve(process.cwd(), 'public', 'audio', DEFAULT_AMBIENT_FILE_NAME),
    path.resolve(process.cwd(), 'public', DEFAULT_AMBIENT_FILE_NAME),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore unreadable candidate
    }
  }
  return null;
}

export function getAmbientAudioStatus(): AmbientAudioStatus {
  const found = resolveAmbientAudioPath();
  if (!found) {
    return {
      available: false,
      fileName: DEFAULT_AMBIENT_FILE_NAME,
      sizeBytes: null,
      audioUrl: null,
      expectedPath: DEFAULT_AMBIENT_RELATIVE_PATH,
    };
  }
  const st = fs.statSync(found);
  const fileName = path.basename(found);
  const versionTag = Math.trunc(st.mtimeMs);
  return {
    available: true,
    fileName,
    sizeBytes: st.size,
    audioUrl: `/api/audio/ambient-track.mp3?v=${versionTag}`,
    expectedPath: DEFAULT_AMBIENT_RELATIVE_PATH,
  };
}

export function isValidMp3Buffer(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // ID3v2 tag header ("ID3")
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  // Raw MPEG frame sync (11 bits set: 0xFF followed by 0xE0..0xFF)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  return false;
}

export function saveUploadedAmbientAudio(fileName: string, base64Data: string): AmbientAudioStatus {
  const cleanName = path.basename(fileName.trim());
  if (!cleanName || !/\.mp3$/i.test(cleanName)) {
    throw new Error('Only valid .mp3 audio files may be used as ambient background music.');
  }

  const stripped = base64Data.includes(',') ? base64Data.split(',').pop() ?? '' : base64Data;
  const buf = Buffer.from(stripped, 'base64');
  if (buf.length === 0 || buf.length > MAX_AMBIENT_UPLOAD_BYTES) {
    throw new Error('MP3 file must be non-empty and under 15 MB.');
  }
  if (!isValidMp3Buffer(buf)) {
    throw new Error('Invalid MP3 audio header. Please provide a valid MP3 file.');
  }

  const overridePath = process.env.NEXORA_AMBIENT_AUDIO_PATH?.trim();
  const targetPath = overridePath
    ? path.resolve(process.cwd(), overridePath)
    : path.resolve(process.cwd(), 'public', 'audio', CUSTOM_AMBIENT_FILE_NAME);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buf);
  return getAmbientAudioStatus();
}
