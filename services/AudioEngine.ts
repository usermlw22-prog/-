export class AudioEngine {
  private static ctx: AudioContext | null = null;
  private static masterGain: GainNode | null = null;
  
  static init() {
    if (this.ctx) return;
    try {
      const CtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (CtxClass) {
        this.ctx = new CtxClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Master volume
        this.masterGain.connect(this.ctx.destination);
      }
    } catch (e) {
      console.warn("Web Audio API not supported", e);
    }
  }

  static resume() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private static playTone(freq: number, type: OscillatorType, startTime: number, duration: number, vol: number = 1) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  static playBumperHit(combo: number) {
    this.resume();
    if (!this.ctx) return;

    // C Major Pentatonic: C, D, E, G, A
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
    // Calculate pitch based on combo (looping through scale, increasing octaves)
    const noteIndex = (combo - 1) % scale.length;
    const octaveMultiplier = 1 + Math.floor((combo - 1) / scale.length) * 0.5;
    
    const freq = scale[noteIndex] * octaveMultiplier;
    const now = this.ctx.currentTime;

    // Layered sound for richness
    this.playTone(freq, 'sine', now, 0.5, 0.8);
    this.playTone(freq * 0.5, 'triangle', now, 0.5, 0.3);
  }

  static playWallHit(force: number) {
    this.resume();
    if (!this.ctx || force < 1) return;

    const now = this.ctx.currentTime;
    const intensity = Math.min(force / 20, 1.0);
    
    // Short noise-like thud
    this.playTone(80 + (force * 5), 'triangle', now, 0.1, intensity * 0.5);
    this.playTone(40, 'sine', now, 0.15, intensity * 0.5);
  }

  static playCollect() {
    this.resume();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // High pitched "coin" sound
    this.playTone(1046.50, 'sine', now, 0.2, 0.6); // C6
    this.playTone(2093.00, 'sine', now + 0.05, 0.3, 0.3); // C7
  }

  static playLaunch() {
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Frequency sweep up
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.2);

    // Volume envelope
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);

    // Filter to soften the sawtooth
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, now);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  static playWin() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Major Arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major
    notes.forEach((freq, i) => {
        this.playTone(freq, 'sine', now + i * 0.1, 0.5, 0.5);
    });
    // Final Chord
    setTimeout(() => {
        notes.forEach(freq => this.playTone(freq, 'triangle', this.ctx!.currentTime, 1.0, 0.2));
    }, 400);
  }

  static playLose() {
    this.resume();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Descending Tritone / Sad sound
    this.playTone(300, 'sawtooth', now, 0.4, 0.3);
    this.playTone(212, 'sawtooth', now + 0.4, 0.4, 0.3);
    this.playTone(150, 'sawtooth', now + 0.8, 0.6, 0.5);
  }

  static playAiSpawn() {
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Glitchy Sawtooth drop
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  static playBeamCharge() {
    this.resume();
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Rising sine wave warning
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.4); // Matches 400ms warmup

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.3);
    gain.gain.linearRampToValueAtTime(0, now + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  static playBeamFire() {
    this.resume();
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    
    // Main Zap
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    // Filter for "laser" effect
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.3);
    
    // Sub bass impact
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(150, now);
    subOsc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    
    subGain.gain.setValueAtTime(0.4, now);
    subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.3);
  }
}