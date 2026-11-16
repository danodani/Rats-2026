export type SfxKey =
  | 'birth'
  | 'bomb'
  | 'choke'
  | 'clunk'
  | 'gas'
  | 'newsex'
  | 'nuclear'
  | 'poison'
  | 'putdown'
  | 'sex'
  | 'victory'
  | 'welldone'
  | 'wewin';

const SFX_PATHS: Record<SfxKey, string> = {
  birth: '/assets/aistudio/BIRTH_e4b1a52f.WAV',
  bomb: '/assets/aistudio/BOMB_6ed3543c.WAV',
  choke: '/assets/aistudio/CHOKE_25da853a.WAV',
  clunk: '/assets/aistudio/CLUNK_9b313b1e.WAV',
  gas: '/assets/aistudio/GAS_a45598a2.WAV',
  newsex: '/assets/aistudio/NEWSEX_5ec5b66d.WAV',
  nuclear: '/assets/aistudio/NUCLEAR_20ca0b3d.WAV',
  poison: '/assets/aistudio/POISON_9e4755bb.WAV',
  putdown: '/assets/aistudio/PUTDOWN_af349d9d.WAV',
  sex: '/assets/aistudio/SEX_c6a995dc.WAV',
  victory: '/assets/aistudio/VICTORY_65b40d5d.WAV',
  welldone: '/assets/aistudio/WELLDONE_941c6539.WAV',
  wewin: '/assets/aistudio/WEWIN_e3a950bf.WAV',
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SfxKey, AudioBuffer>();
  private loadingPromise: Promise<void> | null = null;
  private lastPlayed = new Map<string, number>();
  private muted = false;
  private ambientEnabled = true;

  // Dynamic ambient pad nodes
  private ambientGain: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private ambientOsc1: OscillatorNode | null = null;
  private ambientOsc2: OscillatorNode | null = null;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.startAmbientPad();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.loadingPromise) {
      this.loadingPromise = this.preloadAll();
    }
  }

  private async preloadAll(): Promise<void> {
    if (!this.ctx) return;
    const entries = Object.entries(SFX_PATHS) as Array<[SfxKey, string]>;
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const arr = await res.arrayBuffer();
          if (!this.ctx) return;
          const decoded = await this.ctx.decodeAudioData(arr);
          this.buffers.set(key, decoded);
        } catch {
          // Ignore individual decode failure gracefully
        }
      }),
    );
  }

  private startAmbientPad(): void {
    if (!this.ctx || this.ambientOsc1) return;
    try {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 1.2;

      const gain = this.ctx.createGain();
      gain.gain.value = this.muted || !this.ambientEnabled ? 0 : 0.032;

      const osc1 = this.ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.value = 65.41; // C2

      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 98.0; // G2

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start();
      osc2.start();

      this.ambientFilter = filter;
      this.ambientGain = gain;
      this.ambientOsc1 = osc1;
      this.ambientOsc2 = osc2;
    } catch {
      // Ignore audio context init errors
    }
  }

  public setDangerIntensity(ratio: number): void {
    if (!this.ctx || !this.ambientFilter || !this.ambientGain) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const targetFreq = 180 + clamped * 440;
    this.ambientFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.35);
    const targetVol = this.muted || !this.ambientEnabled ? 0 : 0.025 + clamped * 0.02;
    this.ambientGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.35);
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.ctx && this.ambientGain) {
      this.ambientGain.gain.setTargetAtTime(
        mute || !this.ambientEnabled ? 0 : 0.03,
        this.ctx.currentTime,
        0.1,
      );
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public play(key: SfxKey, minIntervalMs = 120, volume = 0.72): void {
    if (this.muted) return;
    this.unlock();
    const now = performance.now();
    const prev = this.lastPlayed.get(key) ?? 0;
    if (now - prev < minIntervalMs) return;
    this.lastPlayed.set(key, now);

    if (this.ctx && this.buffers.has(key)) {
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers.get(key)!;
        const gain = this.ctx.createGain();
        gain.gain.value = volume;
        src.connect(gain);
        gain.connect(this.ctx.destination);
        src.start();
        return;
      } catch {
        // fallback below
      }
    }

    // Fallback HTMLAudio if buffer isn't decoded yet
    try {
      const audio = new Audio(SFX_PATHS[key]);
      audio.volume = volume;
      void audio.play().catch(() => {});
    } catch {
      // no-op
    }
  }

  public playUiClick(pitch = 680): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, now);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.65, now + 0.045);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.055);
    } catch {
      // no-op
    }
  }
}

export const soundEngine = new SoundEngine();
