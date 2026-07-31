export type SoundEffect = "click" | "deal" | "raise" | "challenge" | "reveal" | "turn" | "win";

class SoundManager {
  private context: AudioContext | null = null;
  private muted = localStorage.getItem("poker-bull-muted") === "true";

  isMuted(): boolean {
    return this.muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    localStorage.setItem("poker-bull-muted", String(this.muted));
    if (!this.muted) this.play("click");
    return this.muted;
  }

  play(effect: SoundEffect): void {
    if (this.muted) return;
    const context = this.getContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume();

    switch (effect) {
      case "click":
        this.tone(420, 0.045, 0.025, "sine");
        break;
      case "deal":
        [0, 0.075, 0.15].forEach((delay, index) => {
          this.noise(delay, 0.045, 0.025);
          this.tone(180 + index * 25, 0.055, 0.018, "triangle", delay);
        });
        break;
      case "raise":
        this.tone(330, 0.08, 0.035, "triangle");
        this.tone(495, 0.11, 0.03, "triangle", 0.065);
        break;
      case "challenge":
        this.tone(135, 0.24, 0.07, "sawtooth");
        this.tone(95, 0.3, 0.045, "square", 0.09);
        break;
      case "reveal":
        [262, 330, 392].forEach((frequency, index) => this.tone(frequency, 0.2, 0.035, "sine", index * 0.055));
        break;
      case "turn":
        this.tone(660, 0.08, 0.025, "sine");
        this.tone(880, 0.12, 0.025, "sine", 0.07);
        break;
      case "win":
        [262, 330, 392, 523].forEach((frequency, index) => this.tone(frequency, 0.28, 0.045, "triangle", index * 0.11));
        break;
    }
  }

  private getContext(): AudioContext | null {
    if (!this.context) {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      this.context = new AudioContextClass();
    }
    return this.context;
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType, delay = 0): void {
    const context = this.context;
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(delay: number, duration: number, volume: number): void {
    const context = this.context;
    if (!context) return;
    const sampleCount = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(start);
  }
}

export const sounds = new SoundManager();
