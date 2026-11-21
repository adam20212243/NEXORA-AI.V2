export type AmbientPlaybackStatus =
  | 'unavailable'
  | 'stopped'
  | 'paused'
  | 'muted'
  | 'awaiting_interaction'
  | 'playing';

export interface AmbientMusicSnapshot {
  available: boolean;
  audioUrl: string | null;
  enabled: boolean;
  muted: boolean;
  volume: number;
  ducked: boolean;
  status: AmbientPlaybackStatus;
  errorMessage: string | null;
}

const CROSSFADE_SEC = 1.6;
const FADE_IN_MS = 850;
const FADE_OUT_MS = 380;
const POLL_MS = 160;
const SINGLETON_KEY = '__nexoraAmbientMusicEngine';

class AmbientMusicController {
  private deckA: HTMLAudioElement | null = null;
  private deckB: HTMLAudioElement | null = null;
  private activeDeckIndex: 0 | 1 = 0;

  private available = false;
  private audioUrl: string | null = null;
  private enabled = true;
  private muted = false;
  private volume = 0.16;
  private ducked = false;
  private pausedForVisibility = false;
  private status: AmbientPlaybackStatus = 'unavailable';
  private errorMessage: string | null = null;

  private crossfading = false;
  private loopTimer: number | null = null;
  private fadeFrameA: number | null = null;
  private fadeFrameB: number | null = null;
  private gestureBound = false;
  private visibilityBound = false;
  private startingPromise: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    this.bindVisibilityListener();
  }

  public getSnapshot(): AmbientMusicSnapshot {
    return {
      available: this.available,
      audioUrl: this.audioUrl,
      enabled: this.enabled,
      muted: this.muted,
      volume: this.volume,
      ducked: this.ducked,
      status: this.status,
      errorMessage: this.errorMessage,
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // ignore subscriber error
      }
    }
  }

  private getEffectiveVolume(): number {
    if (!this.enabled || this.muted) return 0;
    const clamped = Math.max(0, Math.min(1, this.volume));
    return this.ducked ? clamped * 0.2 : clamped;
  }

  private ensureDecks(): [HTMLAudioElement, HTMLAudioElement] | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined' || !this.audioUrl) {
      return null;
    }

    const createDeck = (existing: HTMLAudioElement | null): HTMLAudioElement => {
      if (existing) {
        const resolvedUrl = new URL(this.audioUrl!, window.location.href).href;
        if (existing.src !== resolvedUrl) {
          existing.src = this.audioUrl!;
        }
        return existing;
      }
      const el = new Audio(this.audioUrl!);
      el.preload = 'auto';
      el.loop = false;
      el.volume = 0;
      el.addEventListener('error', () => {
        if (this.getActiveDeck() === el && this.enabled) {
          this.errorMessage = 'Could not load ambient background audio stream.';
          this.status = 'unavailable';
          this.emit();
        }
      });
      return el;
    };

    this.deckA = createDeck(this.deckA);
    this.deckB = createDeck(this.deckB);
    return [this.deckA, this.deckB];
  }

  private getActiveDeck(): HTMLAudioElement | null {
    return this.activeDeckIndex === 0 ? this.deckA : this.deckB;
  }

  private getStandbyDeck(): HTMLAudioElement | null {
    return this.activeDeckIndex === 0 ? this.deckB : this.deckA;
  }

  private cancelFade(deckIndex: 0 | 1): void {
    const id = deckIndex === 0 ? this.fadeFrameA : this.fadeFrameB;
    if (id !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(id);
    }
    if (deckIndex === 0) this.fadeFrameA = null;
    else this.fadeFrameB = null;
  }

  private rampVolume(
    deckIndex: 0 | 1,
    deck: HTMLAudioElement,
    targetVol: number,
    durationMs: number,
    onComplete?: () => void
  ): void {
    this.cancelFade(deckIndex);
    const safeTarget = Math.max(0, Math.min(1, targetVol));
    deck.muted = this.muted || safeTarget <= 0.001;

    if (typeof window === 'undefined' || durationMs <= 0) {
      deck.volume = safeTarget;
      onComplete?.();
      return;
    }

    const startVol = deck.volume;
    const startTime = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      // Smooth sine ease-in-out curve to avoid abrupt volume jumps
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress);
      deck.volume = Math.max(0, Math.min(1, startVol + (safeTarget - startVol) * eased));
      deck.muted = this.muted || deck.volume <= 0.0005;

      if (progress < 1) {
        const nextId = window.requestAnimationFrame(step);
        if (deckIndex === 0) this.fadeFrameA = nextId;
        else this.fadeFrameB = nextId;
      } else {
        if (deckIndex === 0) this.fadeFrameA = null;
        else this.fadeFrameB = null;
        onComplete?.();
      }
    };

    const id = window.requestAnimationFrame(step);
    if (deckIndex === 0) this.fadeFrameA = id;
    else this.fadeFrameB = id;
  }

  private stopLoopScheduler(): void {
    if (this.loopTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private startLoopScheduler(): void {
    this.stopLoopScheduler();
    if (typeof window === 'undefined') return;

    this.loopTimer = window.setInterval(() => {
      const active = this.getActiveDeck();
      const standby = this.getStandbyDeck();
      if (!active || !standby || !this.enabled || this.muted || active.paused) {
        return;
      }

      const duration = active.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const fadeWindow = Math.min(CROSSFADE_SEC, Math.max(0.25, duration * 0.25));
      const remaining = duration - active.currentTime;

      if (remaining <= fadeWindow && !this.crossfading) {
        void this.performCrossfadeLoop(Math.round(fadeWindow * 1000));
      }
    }, POLL_MS);
  }

  private async performCrossfadeLoop(fadeMs: number): Promise<void> {
    if (this.crossfading || !this.enabled || this.muted) return;
    const active = this.getActiveDeck();
    const standby = this.getStandbyDeck();
    if (!active || !standby) return;

    const outgoingIdx = this.activeDeckIndex;
    const incomingIdx: 0 | 1 = outgoingIdx === 0 ? 1 : 0;

    this.crossfading = true;
    try {
      standby.pause();
      standby.currentTime = 0;
      standby.volume = 0;
      standby.muted = this.muted;
      await standby.play();

      const targetVol = this.getEffectiveVolume();
      this.activeDeckIndex = incomingIdx;

      this.rampVolume(incomingIdx, standby, targetVol, fadeMs);
      this.rampVolume(outgoingIdx, active, 0, fadeMs, () => {
        active.pause();
        active.currentTime = 0;
        this.crossfading = false;
      });
    } catch {
      this.crossfading = false;
    }
  }

  private bindInteractionUnlock(): void {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;

    const unlock = () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      this.gestureBound = false;
      if (this.available && this.enabled && !this.muted && this.status === 'awaiting_interaction') {
        void this.playNow();
      }
    };

    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
  }

  private bindVisibilityListener(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this.status === 'playing') {
          this.pausedForVisibility = true;
          this.fadeOutAndPause();
        }
      } else if (document.visibilityState === 'visible') {
        if (this.pausedForVisibility && this.enabled && !this.muted && this.available) {
          this.pausedForVisibility = false;
          void this.playNow();
        }
      }
    });
  }

  private pauseAllDecksImmediately(): void {
    this.stopLoopScheduler();
    this.crossfading = false;
    this.cancelFade(0);
    this.cancelFade(1);
    for (const d of [this.deckA, this.deckB]) {
      if (d && !d.paused) {
        d.pause();
      }
      if (d) d.volume = 0;
    }
  }

  private fadeOutAndPause(nextStatus?: AmbientPlaybackStatus): void {
    this.stopLoopScheduler();
    this.crossfading = false;
    const activeIdx = this.activeDeckIndex;
    const active = this.getActiveDeck();
    const standby = this.getStandbyDeck();

    if (standby && !standby.paused) {
      standby.pause();
      standby.volume = 0;
    }

    if (active && !active.paused) {
      this.rampVolume(activeIdx, active, 0, FADE_OUT_MS, () => {
        active.pause();
        if (nextStatus) {
          this.status = nextStatus;
          this.emit();
        }
      });
    } else if (nextStatus) {
      this.status = nextStatus;
      this.emit();
    }
  }

  private async playNow(): Promise<void> {
    if (!this.available || !this.audioUrl) {
      this.status = 'unavailable';
      this.emit();
      return;
    }
    if (!this.enabled) {
      this.fadeOutAndPause('stopped');
      return;
    }
    if (this.muted) {
      this.fadeOutAndPause('muted');
      return;
    }
    if (this.startingPromise) {
      return this.startingPromise;
    }

    const decks = this.ensureDecks();
    if (!decks) return;

    const activeIdx = this.activeDeckIndex;
    const active = decks[activeIdx];
    const standby = decks[activeIdx === 0 ? 1 : 0];

    // Strict singleton guarantee: ensure standby deck is never also playing simultaneously
    if (!this.crossfading && !standby.paused) {
      standby.pause();
      standby.currentTime = 0;
      standby.volume = 0;
    }

    if (!active.paused) {
      // Already playing -> smoothly update volume only
      this.rampVolume(activeIdx, active, this.getEffectiveVolume(), 250);
      this.status = 'playing';
      this.startLoopScheduler();
      this.emit();
      return;
    }

    this.startingPromise = (async () => {
      try {
        active.volume = 0;
        active.muted = false;
        await active.play();
        this.errorMessage = null;
        this.status = 'playing';
        this.startLoopScheduler();
        this.rampVolume(activeIdx, active, this.getEffectiveVolume(), FADE_IN_MS);
        this.emit();
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError') {
          this.status = 'awaiting_interaction';
          this.bindInteractionUnlock();
          this.emit();
        } else {
          this.errorMessage = err instanceof Error ? err.message : 'Unable to start ambient music.';
          this.status = 'paused';
          this.emit();
        }
      } finally {
        this.startingPromise = null;
      }
    })();

    return this.startingPromise;
  }

  public configure(next: {
    available?: boolean;
    audioUrl?: string | null;
    enabled?: boolean;
    muted?: boolean;
    volume?: number;
  }): void {
    const urlChanged = next.audioUrl !== undefined && next.audioUrl !== this.audioUrl;
    if (next.available !== undefined) this.available = next.available;
    if (next.audioUrl !== undefined) this.audioUrl = next.audioUrl;
    if (next.enabled !== undefined) this.enabled = next.enabled;
    if (next.muted !== undefined) this.muted = next.muted;
    if (typeof next.volume === 'number' && Number.isFinite(next.volume)) {
      this.volume = Math.max(0, Math.min(1, next.volume));
    }

    if (urlChanged) {
      this.pauseAllDecksImmediately();
      if (this.deckA && this.audioUrl) this.deckA.src = this.audioUrl;
      if (this.deckB && this.audioUrl) this.deckB.src = this.audioUrl;
    }

    if (!this.available || !this.audioUrl) {
      this.pauseAllDecksImmediately();
      this.status = 'unavailable';
      this.emit();
      return;
    }

    if (!this.enabled) {
      this.fadeOutAndPause('stopped');
      return;
    }

    if (this.muted) {
      this.fadeOutAndPause('muted');
      return;
    }

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.pausedForVisibility = true;
      return;
    }

    void this.playNow();
  }

  public setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    const active = this.getActiveDeck();
    if (active && !active.paused && this.enabled && !this.muted) {
      this.rampVolume(this.activeDeckIndex, active, this.getEffectiveVolume(), 260);
    }
    this.emit();
  }

  public async togglePlayStop(): Promise<boolean> {
    const nextEnabled = !this.enabled;
    this.configure({ enabled: nextEnabled, muted: nextEnabled ? false : this.muted });
    return nextEnabled;
  }

  public async toggleMute(): Promise<boolean> {
    const nextMuted = !this.muted;
    this.configure({ muted: nextMuted });
    return nextMuted;
  }
}

function getSingleton(): AmbientMusicController {
  const g = globalThis as Record<string, unknown>;
  if (!g[SINGLETON_KEY]) {
    g[SINGLETON_KEY] = new AmbientMusicController();
  }
  return g[SINGLETON_KEY] as AmbientMusicController;
}

export const ambientMusicService = getSingleton();
