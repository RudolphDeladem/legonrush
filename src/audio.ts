// Tiny WebAudio sound effects; no audio files to download.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.8;

export function setSound(on: boolean, vol = volume) {
  enabled = on;
  volume = vol;
  if (master) master.gain.value = volume;
}

export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  if (!enabled || !ctx || !master || volume <= 0) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  coin: () => { tone(1320, 0.08, 'square', 0.05); setTimeout(() => tone(1760, 0.1, 'square', 0.04), 50); },
  jump: () => tone(300, 0.18, 'triangle', 0.1, 600),
  lane: () => tone(500, 0.05, 'sine', 0.03, 400),
  boost: () => tone(200, 0.5, 'sawtooth', 0.06, 900),
  bump: () => tone(120, 0.18, 'square', 0.08, 60),
  crash: () => { tone(160, 0.4, 'sawtooth', 0.12, 40); tone(90, 0.5, 'square', 0.08, 30); },
  count: () => tone(660, 0.12, 'sine', 0.08),
  go: () => tone(990, 0.3, 'sine', 0.1),
  finish: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.08), i * 110)),
};
