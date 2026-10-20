import * as THREE from 'three';

export type SpatialVoiceType = 'water' | 'fire' | 'hammer' | 'lanternChime' | 'windchime';
export type FootstepSurface = 'grass' | 'rock' | 'path' | 'wood' | 'stone' | 'water' | 'ash';

interface SpatialEmitterRecord {
  id: string;
  position: THREE.Vector3;
  voice: SpatialVoiceType;
  panner: PannerNode;
  gain: GainNode;
  stopFn: () => void;
}

const _camFwd = new THREE.Vector3();
const _camUp = new THREE.Vector3();

/**
 * Pure Web Audio generative spatial sound engine for the Arkvoid 3D world.
 * Starts only after a user gesture, requires zero external audio files, and supports
 * HRTF spatial emitters, surface-aware foley, conversation ducking (-5 dB), and sound captions.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bedBusGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private spaceHumOsc: OscillatorNode | null = null;
  private spaceHumGain: GainNode | null = null;
  private airDroneOscs: OscillatorNode[] = [];
  private airDroneGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private emitters = new Map<string, SpatialEmitterRecord>();
  private muted = true;
  private ducked = false;
  private captionsEnabled = false;
  private onCaption?: (caption: string) => void;
  private lastCaptionTs = 0;
  private lastSparseEventTs = 0;
  private lastBellTs = 0;
  private stepAccumDist = 0;
  private disposed = false;

  private boundVisibilityChange: () => void;
  private boundGestureUnlock: () => void;

  constructor(options?: {
    initialMuted?: boolean;
    captionsEnabled?: boolean;
    onCaption?: (caption: string) => void;
  }) {
    this.muted = options?.initialMuted ?? true;
    this.captionsEnabled = options?.captionsEnabled ?? false;
    this.onCaption = options?.onCaption;

    this.boundVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundGestureUnlock = this.handleUserGesture.bind(this);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
      window.addEventListener('pointerdown', this.boundGestureUnlock, { passive: true });
      window.addEventListener('keydown', this.boundGestureUnlock, { passive: true });
    }
  }

  private emitCaption(text: string, minIntervalMs = 3200): void {
    if (!this.captionsEnabled || !this.onCaption) return;
    const now = performance.now();
    if (now - this.lastCaptionTs < minIntervalMs) return;
    this.lastCaptionTs = now;
    this.onCaption(text);
  }

  public setCaptionsEnabled(enabled: boolean): void {
    this.captionsEnabled = enabled;
    if (enabled && this.onCaption) {
      this.onCaption('[sound captions active]');
    }
  }

  public isCaptionsEnabled(): boolean {
    return this.captionsEnabled;
  }

  private handleUserGesture(): void {
    if (this.disposed) return;
    if (!this.muted && !this.ctx) {
      this.ensureAudioGraph();
    } else if (this.ctx && this.ctx.state === 'suspended' && !this.muted) {
      this.ctx.resume().catch(() => {});
    }
  }

  private ensureAudioGraph(): void {
    if (this.ctx || this.disposed || typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0.0001 : 0.75;
      this.masterGain.connect(ctx.destination);

      this.bedBusGain = ctx.createGain();
      this.bedBusGain.gain.value = this.ducked ? 0.562 : 1.0; // -5 dB when ducked
      this.bedBusGain.connect(this.masterGain);

      // Build reusable 4-second pink/white noise buffer
      const sampleRate = ctx.sampleRate;
      const length = sampleRate * 4;
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
      }
      this.noiseBuffer = buffer;

      // 1. Wind bed: looped band-pass filtered noise (200..900 Hz)
      const windSource = ctx.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;

      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 340;
      this.windFilter.Q.value = 1.6;

      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.08;

      windSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.bedBusGain);
      windSource.start();

      // 2. Space hum: 42 Hz sub sine tone at 4% in the Cosmos
      this.spaceHumOsc = ctx.createOscillator();
      this.spaceHumOsc.type = 'sine';
      this.spaceHumOsc.frequency.value = 42;
      this.spaceHumGain = ctx.createGain();
      this.spaceHumGain.gain.value = 0.0001;
      this.spaceHumOsc.connect(this.spaceHumGain);
      this.spaceHumGain.connect(this.bedBusGain);
      this.spaceHumOsc.start();

      // 3. Air tone: slow 3-oscillator drone in a warm open fifth (110 Hz, 165 Hz, 220 Hz)
      this.airDroneGain = ctx.createGain();
      this.airDroneGain.gain.value = 0.022;
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'lowpass';
      airFilter.frequency.value = 420;
      this.airDroneGain.connect(airFilter);
      airFilter.connect(this.bedBusGain);

      const baseFreqs = [110, 164.81, 220];
      for (const freq of baseFreqs) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(this.airDroneGain);
        osc.start();
        this.airDroneOscs.push(osc);
      }

      // Re-attach any registered spatial emitters
      for (const [id, rec] of this.emitters.entries()) {
        this.emitters.delete(id);
        this.addEmitter(id, rec.position, rec.voice);
      }
    } catch {
      // Ignore if Web Audio is blocked
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) {
      this.ensureAudioGraph();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(muted ? 0.0001 : 0.75, now, 0.18);
    }
  }

  public setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    if (this.ctx && this.bedBusGain) {
      const now = this.ctx.currentTime;
      // -5 dB ducking (10^(-5/20) = 0.5623)
      this.bedBusGain.gain.setTargetAtTime(ducked ? 0.562 : 1.0, now, 0.22);
    }
  }

  public addEmitter(
    id: string,
    position: THREE.Vector3 | readonly [number, number, number],
    voice: SpatialVoiceType
  ): void {
    const posVec =
      position instanceof THREE.Vector3
        ? position.clone()
        : new THREE.Vector3(position[0], position[1], position[2]);

    const existing = this.emitters.get(id);
    if (existing) {
      existing.stopFn();
      this.emitters.delete(id);
    }

    if (!this.ctx || !this.bedBusGain || !this.noiseBuffer) {
      // Store placeholder so it materializes when user gesture unlocks AudioContext
      this.emitters.set(id, {
        id,
        position: posVec,
        voice,
        panner: null as unknown as PannerNode,
        gain: null as unknown as GainNode,
        stopFn: () => {},
      });
      return;
    }

    const ctx = this.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 6;
    panner.maxDistance = 220;
    panner.rolloffFactor = 1.4;
    panner.positionX.value = posVec.x;
    panner.positionY.value = posVec.y;
    panner.positionZ.value = posVec.z;

    const gain = ctx.createGain();
    gain.gain.value = 0.18;
    panner.connect(gain);
    gain.connect(this.bedBusGain);

    let stopFn = () => {};

    if (voice === 'water' || voice === 'fire') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = voice === 'water' ? 'bandpass' : 'highpass';
      filter.frequency.value = voice === 'water' ? 520 : 1400;
      filter.Q.value = voice === 'water' ? 0.9 : 2.2;
      gain.gain.value = voice === 'water' ? 0.16 : 0.11;
      src.connect(filter);
      filter.connect(panner);
      src.start();
      stopFn = () => {
        try {
          src.stop();
          src.disconnect();
        } catch {}
      };
    } else {
      // Periodic chime / hammer pulse triggered on interval
      const intervalMs = voice === 'hammer' ? 2400 : voice === 'lanternChime' ? 5800 : 4600;
      const timer = window.setInterval(() => {
        if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = voice === 'hammer' ? 'triangle' : 'sine';
        osc.frequency.value =
          voice === 'hammer'
            ? 145
            : voice === 'lanternChime'
              ? 587.33
              : 659.25 + (Math.random() > 0.5 ? 131 : 0);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(voice === 'hammer' ? 0.12 : 0.05, now + 0.015);
        env.gain.exponentialRampToValueAtTime(
          0.0001,
          now + (voice === 'hammer' ? 0.24 : 1.4)
        );
        osc.connect(env);
        env.connect(panner);
        osc.start(now);
        osc.stop(now + (voice === 'hammer' ? 0.26 : 1.45));
      }, intervalMs);

      stopFn = () => window.clearInterval(timer);
    }

    this.emitters.set(id, { id, position: posVec, voice, panner, gain, stopFn });
  }

  public update(params: {
    dt: number;
    camera: THREE.Camera;
    altitudeY: number;
    altitude01: number;
    windStrength: number;
    worldMinutes: number;
    playerSpeedHoriz: number;
    surface?: FootstepSurface;
  }): void {
    const {
      dt,
      camera,
      altitudeY,
      altitude01,
      windStrength,
      worldMinutes,
      playerSpeedHoriz,
      surface = 'stone',
    } = params;

    // Trigger footsteps based on horizontal travel distance
    if (playerSpeedHoriz > 0.35 && altitudeY < 480) {
      this.stepAccumDist += playerSpeedHoriz * dt;
      if (this.stepAccumDist >= 1.95) {
        this.stepAccumDist = 0;
        this.triggerFootstep(surface);
      }
    }

    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // 1. Update 3D AudioListener pose from camera
    const listener = this.ctx.listener;
    const pos = camera.position;
    camera.getWorldDirection(_camFwd);
    _camUp.copy(camera.up).applyQuaternion(camera.quaternion).normalize();

    if (listener.positionX) {
      listener.positionX.setValueAtTime(pos.x, now);
      listener.positionY.setValueAtTime(pos.y, now);
      listener.positionZ.setValueAtTime(pos.z, now);
      listener.forwardX.setValueAtTime(_camFwd.x, now);
      listener.forwardY.setValueAtTime(_camFwd.y, now);
      listener.forwardZ.setValueAtTime(_camFwd.z, now);
      listener.upX.setValueAtTime(_camUp.x, now);
      listener.upY.setValueAtTime(_camUp.y, now);
      listener.upZ.setValueAtTime(_camUp.z, now);
    }

    // 2. Modulate wind bed & space hum by altitude and windStrength
    const overlookBoost = Math.min(1, Math.max(0, (altitudeY - 120) / 320));
    const cosmosFade = 1 - Math.min(1, altitude01 * 0.95);
    const targetWindGain = (0.045 + windStrength * 0.08 + overlookBoost * 0.06) * cosmosFade;
    const targetWindFreq = 220 + windStrength * 380 + overlookBoost * 260;

    if (this.windGain && this.windFilter) {
      this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.15);
      this.windFilter.frequency.setTargetAtTime(targetWindFreq, now, 0.2);
    }
    if (windStrength > 0.82) {
      this.emitCaption('[wind rises]', 8000);
    }

    // Space hum (42 Hz at 4% in open cosmos)
    if (this.spaceHumGain) {
      this.spaceHumGain.gain.setTargetAtTime(altitude01 * 0.04, now, 0.25);
    }
    if (altitude01 > 0.7) {
      this.emitCaption('[low space hum]', 9000);
    }

    // 3. Modulate air drone pitch slightly by time of day
    const hour = (((worldMinutes % 1440) + 1440) % 1440) / 60;
    const pitchShift = hour >= 6 && hour < 18 ? 1.0 : 0.94;
    if (this.airDroneOscs.length === 3) {
      this.airDroneOscs[0].frequency.setTargetAtTime(110 * pitchShift, now, 0.5);
      this.airDroneOscs[1].frequency.setTargetAtTime(164.81 * pitchShift, now, 0.5);
      this.airDroneOscs[2].frequency.setTargetAtTime(220 * pitchShift, now, 0.5);
    }

    // 4. Sparse time-of-day sound layers (dawn birds, dusk insects, night bells)
    const nowPerf = performance.now();
    if (altitude01 < 0.25 && nowPerf - this.lastSparseEventTs > 9500) {
      this.lastSparseEventTs = nowPerf;
      if (hour >= 5 && hour < 9) {
        this.playDawnBirdPluck();
      } else if (hour >= 17 && hour < 20.5) {
        this.playDuskInsectPulse();
      }
    }

    if ((hour >= 20.5 || hour < 5) && nowPerf - this.lastBellTs > 42000) {
      this.lastBellTs = nowPerf;
      this.playNightBellStrike();
    }
  }

  private playDawnBirdPluck(): void {
    if (!this.ctx || !this.bedBusGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.exponentialRampToValueAtTime(1560, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.22);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.025, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc.connect(env);
    env.connect(this.bedBusGain);
    osc.start(now);
    osc.stop(now + 0.3);
    this.emitCaption('[dawn birds in the valley]', 10000);
  }

  private playDuskInsectPulse(): void {
    if (!this.ctx || !this.bedBusGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3600;
    hp.Q.value = 6.0;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.018, now + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    src.connect(hp);
    hp.connect(env);
    env.connect(this.bedBusGain);
    src.start(now);
    src.stop(now + 0.4);
    this.emitCaption('[dusk insects hum]', 10000);
  }

  public playNightBellStrike(): void {
    if (!this.ctx || !this.bedBusGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Inharmonic partials approximating struck bronze bell
    const partials: ReadonlyArray<[number, number, number]> = [
      [196.0, 0.04, 4.2],
      [311.1, 0.025, 3.1],
      [476.5, 0.016, 2.2],
      [712.0, 0.008, 1.4],
    ];
    for (const [freq, amp, decay] of partials) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(amp, now + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(env);
      env.connect(this.bedBusGain);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    }
    this.emitCaption('[distant night bell]', 8000);
  }

  public triggerFootstep(surface: FootstepSurface = 'stone'): void {
    this.emitCaption(`[${surface} footsteps]`, 4500);
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value =
      surface === 'stone' || surface === 'rock'
        ? 480
        : surface === 'path'
          ? 540
          : surface === 'wood'
            ? 290
            : surface === 'water'
              ? 820
              : surface === 'ash'
                ? 410
                : 640;
    filter.Q.value = 1.8;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.04, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.11);
  }

  public triggerCloth(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.022, now + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.2);
  }

  private hallConvolver: ConvolverNode | null = null;
  private hallReverbWet: GainNode | null = null;
  private hallReverbActive = false;

  /**
   * Enables or disables the 3.2 s synthetic cathedral reverb (`ConvolverNode`)
   * inside the Hall of Records interior cell (`Prompt 5 Section 6`).
   */
  public setHallReverb(active: boolean): void {
    this.hallReverbActive = active;
    if (!this.ctx || !this.bedBusGain || !this.masterGain) return;

    if (!this.hallConvolver) {
      try {
        const rate = this.ctx.sampleRate;
        const len = Math.floor(rate * 3.2);
        const impulse = this.ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
          const data = impulse.getChannelData(ch);
          for (let i = 0; i < len; i++) {
            const t = i / len;
            const decay = Math.pow(1 - t, 2.8);
            data[i] = ((Math.sin(i * 12.9898 + ch * 78.233) * 43758.5453) % 1) * decay * 0.35;
          }
        }
        this.hallConvolver = this.ctx.createConvolver();
        this.hallConvolver.buffer = impulse;
        this.hallReverbWet = this.ctx.createGain();
        this.hallReverbWet.gain.value = 0.0001;
        this.bedBusGain.connect(this.hallConvolver);
        this.hallConvolver.connect(this.hallReverbWet);
        this.hallReverbWet.connect(this.masterGain);
      } catch {
        // Ignore if ConvolverNode creation fails
      }
    }

    if (this.hallReverbWet && this.ctx) {
      this.hallReverbWet.gain.setTargetAtTime(
        active ? 0.55 : 0.0001,
        this.ctx.currentTime,
        0.25
      );
    }
  }

  public triggerWatchBell(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const freqs = [293.66, 440.0, 587.33];
    for (let i = 0; i < freqs.length; i++) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqs[i], now);
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.06 / (i + 1), now + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
      osc.connect(env);
      env.connect(this.masterGain);
      if (this.hallReverbActive && this.hallConvolver) {
        env.connect(this.hallConvolver);
      }
      osc.start(now);
      osc.stop(now + 2.5);
    }
  }

  public triggerInteractionTick(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.045);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.035, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    osc.connect(env);
    env.connect(this.masterGain);
    if (this.hallReverbActive && this.hallConvolver) {
      env.connect(this.hallConvolver);
    }
    osc.start(now);
    osc.stop(now + 0.06);
  }

  private handleVisibilityChange(): void {
    if (!this.ctx) return;
    if (document.hidden) {
      this.ctx.suspend().catch(() => {});
    } else if (!this.muted) {
      this.ctx.resume().catch(() => {});
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
      window.removeEventListener('pointerdown', this.boundGestureUnlock);
      window.removeEventListener('keydown', this.boundGestureUnlock);
    }
    for (const rec of this.emitters.values()) {
      rec.stopFn();
    }
    this.emitters.clear();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

