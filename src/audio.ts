// Tiny WebAudio sound effects; no audio files to download.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.8;

export function setSound(on: boolean, vol = volume) {
  enabled = on;
  volume = vol;
  if (master) master.gain.value = volume;
  if (!on || vol <= 0) stopAmbience();
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

// ---------- campus ambience ----------
// Birds by day, crickets at night, distant traffic and the odd horn, rain when it
// rains, and music drifting from the Night Market as you ride near it. All made from
// oscillators and one noise buffer; it plays through the sound-effects volume.
interface Ambience {
  out: GainNode;
  traffic: GainNode;
  rain: GainNode;
  market: GainNode;
  marketLp: BiquadFilterNode;
  sources: AudioScheduledSourceNode[];
  timer: number;
  next: number;
  beat: number;
  nextBeat: number;
}
let amb: Ambience | null = null;
const ambState = { night: false, rain: false, market: 0 };
let longNoise: AudioBuffer | null = null;

function noiseLoop() {
  if (!longNoise) {
    longNoise = ctx!.createBuffer(1, ctx!.sampleRate * 2, ctx!.sampleRate);
    const d = longNoise.getChannelData(0);
    // brown-ish noise: smoother, more like distant engines and wind
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      d[i] = last * 3 + w * 0.15;
    }
  }
  const src = ctx!.createBufferSource();
  src.buffer = longNoise;
  src.loop = true;
  return src;
}

function panned(out: AudioNode, pan: number): AudioNode {
  if (!ctx!.createStereoPanner) return out;
  const p = ctx!.createStereoPanner();
  p.pan.value = pan;
  p.connect(out);
  return p;
}

/** a short bird phrase: two to five quick whistles, sliding */
function bird(t: number, out: AudioNode) {
  const dest = panned(out, Math.random() * 1.6 - 0.8);
  const base = 2200 + Math.random() * 2600;
  const n = 2 + ((Math.random() * 4) | 0);
  const kind = Math.random();
  for (let i = 0; i < n; i++) {
    const at = t + i * (0.09 + Math.random() * 0.07);
    const f = base * (kind < 0.5 ? 1 + (i % 2) * 0.18 : 1 - i * 0.06);
    voice(at, f, 0.07 + Math.random() * 0.05, 'sine', 0.05 + Math.random() * 0.04, dest, f * (kind < 0.3 ? 1.35 : 0.8));
  }
}

/** a cricket's chirp: a few fast pulses of one high note */
function cricket(t: number, out: AudioNode, f: number, pan: number) {
  const dest = panned(out, pan);
  const n = 3 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) voice(t + i * 0.045, f, 0.03, 'sine', 0.035, dest);
}

/** a distant two-tone car or trotro horn, muffled */
function horn(t: number, out: AudioNode) {
  const lp = ctx!.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.connect(panned(out, Math.random() * 1.4 - 0.7));
  const f = 360 + Math.random() * 120;
  const long = Math.random() < 0.5;
  const toot = (at: number, len: number) => {
    voice(at, f, len, 'square', 0.025, lp);
    voice(at, f * 1.26, len, 'square', 0.02, lp);
  };
  toot(t, long ? 0.5 : 0.18);
  if (!long) toot(t + 0.25, 0.18);
}

// afrobeats-style groove from the market speakers: four-on-the-floor kick, log-drum bass, bell
const MKT_BPM = 104;
const MKT_STEP = 60 / MKT_BPM / 4;
const MKT_BASS = [45, 0, 0, 45, 0, 0, 52, 0, 0, 0, 50, 0, 48, 0, 0, 0];
const MKT_KEYS = [69, 72, 76, 0, 0, 72, 0, 74, 0, 0, 71, 0, 69, 0, 0, 0];
function marketBeat(t: number, s: number, out: AudioNode) {
  if (s % 4 === 0) voice(t, 110, 0.2, 'sine', 0.9, out, 42);
  if (s % 8 === 4) shaker(t, 0.35, out);
  if (s % 2 === 1) shaker(t, 0.1, out);
  if (s % 16 === 3 || s % 16 === 11) voice(t, 1318, 0.05, 'triangle', 0.08, out);
  const b = MKT_BASS[s % 16];
  if (b) voice(t, hz(b), MKT_STEP * 1.8, 'sine', 0.6, out, hz(b) * 0.85);
  const k = MKT_KEYS[(s + Math.floor(s / 32) * 2) % 16];
  if (k) voice(t, hz(k), MKT_STEP * 1.4, 'triangle', 0.12, out);
}

function ambienceTick() {
  if (!ctx || !amb) return;
  const a = amb;
  const now = ctx.currentTime;
  const night = ambState.night;
  // ease each layer toward the current state
  a.traffic.gain.setTargetAtTime((night ? 0.05 : 0.09) * (ambState.rain ? 0.6 : 1), now, 1.5);
  a.rain.gain.setTargetAtTime(ambState.rain ? 0.22 : 0, now, 1.2);
  a.market.gain.setTargetAtTime(ambState.market * 0.32, now, 0.6);
  a.marketLp.frequency.setTargetAtTime(500 + ambState.market * 2400, now, 0.6);
  while (a.next < now + 0.3) {
    const t = a.next;
    if (!night && !ambState.rain && Math.random() < 0.09) bird(t, a.out);
    if (night && Math.random() < 0.55) cricket(t, a.out, 4300 + Math.random() * 600, Math.random() * 1.6 - 0.8);
    if (Math.random() < (night ? 0.002 : 0.006)) horn(t, a.out);
    a.next += 0.1;
  }
  if (ambState.market > 0.02) {
    if (a.nextBeat < now) a.nextBeat = now + 0.05;
    while (a.nextBeat < now + 0.3) {
      marketBeat(a.nextBeat, a.beat++, a.market);
      a.nextBeat += MKT_STEP;
    }
  }
}

/** Starts the campus ambience (after unlockAudio); safe to call again. */
export function startAmbience(o: { night?: boolean; rain?: boolean; market?: number } = {}) {
  setAmbience(o);
  if (amb || !enabled || volume <= 0 || !ctx || !master) return;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.8);
  out.connect(master);
  // traffic: low rumble with slow swells, like cars passing a long way off
  const traffic = ctx.createGain();
  traffic.gain.value = 0;
  const tlp = ctx.createBiquadFilter();
  tlp.type = 'lowpass';
  tlp.frequency.value = 320;
  const tn = noiseLoop();
  tn.connect(tlp).connect(traffic).connect(out);
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 0.08;
  lfoG.gain.value = 0.035;
  lfo.connect(lfoG).connect(traffic.gain);
  // rain: the same noise, faster and band-passed into a hiss
  const rain = ctx.createGain();
  rain.gain.value = 0;
  const rbp = ctx.createBiquadFilter();
  rbp.type = 'bandpass';
  rbp.frequency.value = 3200;
  rbp.Q.value = 0.4;
  const rn = noiseLoop();
  rn.playbackRate.value = 1.7;
  rn.connect(rbp).connect(rain).connect(out);
  // market music, muffled until you are close
  const market = ctx.createGain();
  market.gain.value = 0;
  const marketLp = ctx.createBiquadFilter();
  marketLp.type = 'lowpass';
  marketLp.frequency.value = 800;
  market.connect(marketLp).connect(out);
  tn.start();
  rn.start(ctx.currentTime, 0.7);
  lfo.start();
  amb = { out, traffic, rain, market, marketLp, sources: [tn, rn, lfo], timer: 0, next: ctx.currentTime + 0.1, beat: 0, nextBeat: 0 };
  ambienceTick();
  amb.timer = window.setInterval(ambienceTick, 100);
}

/** Fades the campus ambience out. */
export function stopAmbience() {
  if (!amb || !ctx) return;
  const a = amb;
  amb = null;
  clearInterval(a.timer);
  a.out.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  setTimeout(() => {
    for (const s of a.sources) s.stop();
    a.out.disconnect();
  }, 1500);
}

/**
 * What the ambience should sound like: night swaps birds for crickets, rain adds
 * rain, market (0..1, see marketProximity in game/life.ts) brings up the music.
 */
export function setAmbience(o: { night?: boolean; rain?: boolean; market?: number }) {
  if (o.night !== undefined) ambState.night = o.night;
  if (o.rain !== undefined) ambState.rain = o.rain;
  if (o.market !== undefined) ambState.market = Math.max(0, Math.min(1, o.market));
}
