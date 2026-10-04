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

// ---------- ride music ----------
// A short highlife-style loop built from oscillators and noise, scheduled ahead
// of time so it keeps steady even when frames drop. Nothing to download.
let musicGain: GainNode | null = null;
let musicVolume = 0.5;
let musicTimer = 0;
let nextNote = 0;
let step = 0;
let noise: AudioBuffer | null = null;

const BPM = 112;
const SIXTEENTH = 60 / BPM / 4;
// bass and lead over a I-IV-V-IV progression in G (MIDI note numbers, 0 = rest)
const BASS = [43, 0, 0, 43, 0, 0, 50, 0, 48, 0, 0, 48, 0, 0, 55, 0, 50, 0, 0, 50, 0, 0, 57, 0, 48, 0, 0, 48, 0, 50, 52, 0];
const LEAD = [79, 0, 76, 0, 74, 0, 76, 79, 0, 0, 81, 0, 79, 0, 76, 0, 74, 0, 76, 0, 79, 0, 0, 74, 72, 0, 74, 0, 76, 0, 0, 0,
  79, 0, 81, 0, 83, 0, 81, 79, 0, 0, 76, 0, 74, 0, 76, 0, 78, 0, 74, 0, 81, 0, 0, 78, 76, 0, 74, 0, 72, 0, 0, 0];
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export function setMusicVolume(v: number) {
  musicVolume = v;
  if (musicGain) musicGain.gain.value = v * 0.5;
}

function voice(t: number, freq: number, dur: number, type: OscillatorType, gain: number, out: AudioNode, slideTo?: number) {
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function shaker(t: number, gain: number, out: AudioNode) {
  if (!noise) {
    noise = ctx!.createBuffer(1, ctx!.sampleRate * 0.1, ctx!.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  const hp = ctx!.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  const g = ctx!.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(hp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.06);
}

function schedule() {
  if (!ctx || !musicGain) return;
  while (nextNote < ctx.currentTime + 0.25) {
    const t = nextNote;
    const s = step % 32;
    if (s % 8 === 0 || s % 8 === 5) voice(t, 120, 0.22, 'sine', 0.9, musicGain, 45); // kick
    if (s % 8 === 4) shaker(t, 0.5, musicGain); // clap on the backbeat
    shaker(t, s % 2 ? 0.12 : 0.22, musicGain);
    if (s % 4 === 2) voice(t, 1567, 0.04, 'square', 0.04, musicGain); // bell
    if (BASS[s]) voice(t, hz(BASS[s]), SIXTEENTH * 2.5, 'triangle', 0.5, musicGain);
    const lead = LEAD[step % 64];
    if (lead) voice(t, hz(lead), SIXTEENTH * 1.6, 'triangle', 0.16, musicGain);
    nextNote += SIXTEENTH;
    step++;
  }
}

/** Starts or stops the ride music. */
export function music(on: boolean) {
  if (!on || !enabled || musicVolume <= 0 || !ctx || !master) {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = 0;
    if (musicGain) {
      const g = musicGain;
      g.gain.setTargetAtTime(0, ctx!.currentTime, 0.15);
      setTimeout(() => g.disconnect(), 800);
      musicGain = null;
    }
    return;
  }
  if (musicTimer) return;
  musicGain = ctx.createGain();
  musicGain.gain.value = musicVolume * 0.5;
  musicGain.connect(master);
  nextNote = ctx.currentTime + 0.05;
  step = 0;
  schedule();
  musicTimer = window.setInterval(schedule, 100);
}
