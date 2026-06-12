// Generative city-pop ambient engine on raw Web Audio.
// Each landscape "station" has its own chord set and arp density, the tempo
// follows the cruise knob, and the weather mixes itself in: rain noise, wind,
// thunder, and a muffling tone filter for fog and snow. Set changes land on
// chord boundaries so the music never jumps.

const BEATS_PER_CHORD = 8; // two bars per chord

// chord sets per landscape: FIELDS, HIGHLANDS, DESERT, SKYLINE, DOWNTOWN
const CHORD_SETS = [
  [ // fields — royal road city-pop (Fmaj9 → G13 → Em7 → Am9)
    { bass: 41, notes: [53, 57, 60, 64, 67] },
    { bass: 43, notes: [55, 59, 62, 65, 69] },
    { bass: 40, notes: [52, 55, 59, 62, 67] },
    { bass: 45, notes: [57, 60, 64, 67, 71] },
  ],
  [ // highlands — open and airy (Cadd9 → G6 → Am9 → Fmaj9)
    { bass: 48, notes: [55, 60, 62, 64, 67] },
    { bass: 43, notes: [55, 59, 62, 64, 67] },
    { bass: 45, notes: [57, 60, 64, 67, 69] },
    { bass: 41, notes: [53, 57, 60, 64, 67] },
  ],
  [ // desert — dusty dorian (Dm9 → B♭maj9 → Gm11 → A phrygian)
    { bass: 38, notes: [53, 57, 60, 62, 65] },
    { bass: 46, notes: [53, 58, 62, 65, 69] },
    { bass: 43, notes: [55, 58, 62, 65, 70] },
    { bass: 45, notes: [52, 57, 61, 64, 67] },
  ],
  [ // skyline — fields harmony, brighter motion
    { bass: 41, notes: [53, 57, 60, 64, 67] },
    { bass: 43, notes: [55, 59, 62, 65, 69] },
    { bass: 40, notes: [52, 55, 59, 62, 67] },
    { bass: 45, notes: [57, 60, 64, 67, 71] },
  ],
  [ // downtown — fields transposed up, neon city-pop (Gmaj9 → A13 → F#m7 → Bm9)
    { bass: 43, notes: [55, 59, 62, 66, 69] },
    { bass: 45, notes: [57, 61, 64, 67, 71] },
    { bass: 42, notes: [54, 57, 61, 64, 69] },
    { bass: 47, notes: [59, 62, 66, 69, 73] },
  ],
  [ // somber — storms and cold rain pull the harmony minor (Am9 → Fmaj9 → Dm9 → Em7)
    { bass: 45, notes: [57, 60, 64, 67, 71] },
    { bass: 41, notes: [53, 57, 60, 64, 67] },
    { bass: 38, notes: [53, 57, 60, 62, 65] },
    { bass: 40, notes: [52, 55, 59, 62, 67] },
  ],
];
const SOMBER_SET = 5;

// chance to skip an arp note, per set (higher = sparser)
const ARP_REST = [0.28, 0.45, 0.5, 0.2, 0.12, 0.42];

// Tracks: same generative engine, different character. All meditative, but
// each has its own tempo feel, lead voice, density and space. In auto mode
// the track follows the mood of the drive and crossfades at chord boundaries.
// Each track is its own little band: a lead voice (plucked synth, FM e-piano,
// bells or breathy flute), optional e-piano comping and a whisper of
// percussion, on top of the shared pad/bass/echo architecture.
export const TRACKS = [
  { name: 'GOLDEN HOUR', tempoMul: 1, lead: 'pluck', pluckType: 'triangle', pluckOct: 12, comp: false, perc: 1, padGain: 0.34, pluckGain: 0.5, bassGain: 0.4, filter: 1050, rest: 0, sparkle: 0, rev: 0.5, echo: 0.34 },
  { name: 'NIGHT DRIVE', tempoMul: 0.85, lead: 'epiano', pluckType: 'sine', pluckOct: 0, comp: true, perc: 2, padGain: 0.28, pluckGain: 0.44, bassGain: 0.56, filter: 720, rest: 0.18, sparkle: -0.15, rev: 0.6, echo: 0.42 },
  { name: 'MORNING BELLS', tempoMul: 1.1, lead: 'bell', pluckType: 'sine', pluckOct: 12, comp: false, perc: 0, padGain: 0.24, pluckGain: 0.3, bassGain: 0.34, filter: 1500, rest: -0.1, sparkle: 0.35, rev: 0.55, echo: 0.3 },
  { name: 'RAINY GLASS', tempoMul: 0.9, lead: 'epiano', pluckType: 'sine', pluckOct: 12, comp: false, perc: 0, padGain: 0.3, pluckGain: 0.56, bassGain: 0.36, filter: 880, rest: 0.1, sparkle: 0.15, rev: 0.75, echo: 0.5 },
  { name: 'OPEN PLAINS', tempoMul: 0.78, lead: 'flute', pluckType: 'triangle', pluckOct: 0, comp: false, perc: 0, padGain: 0.42, pluckGain: 0.26, bassGain: 0.42, filter: 950, rest: 0.3, sparkle: 0.1, rev: 0.8, echo: 0.28 },
];

// preset used while a MIDI song is on the air: the generative bed keeps
// breathing as usual (the melody is transposed into its diatonic world), and
// the song floats over it as a quiet half-tempo line — a light ambient cover
const MIDI_PRESET = {
  name: 'MIDI', tempoMul: 1, lead: 'soft', pluckType: 'sine', pluckOct: 0, comp: false, perc: 0,
  padGain: 0.29, pluckGain: 0.5, bassGain: 0.4, filter: 980, rest: 0.7, sparkle: 0.05, rev: 0.62, echo: 0.38,
};

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class MusicEngine {
  constructor() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.tempo = 78;
    this.spb = 60 / this.tempo;
    this.volume = 0.9;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // global tone filter — fog and snow muffle the whole mix
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 16000;
    this.tone.Q.value = 0.4;
    // gentle tape-style saturation glues the mix together
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = i / 255.5 - 1;
      curve[i] = Math.tanh(1.5 * x) / Math.tanh(1.5);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    // brick-wall safety limiter — keeps thunder and chord stacks from clipping
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master.connect(this.tone).connect(shaper).connect(comp).connect(limiter).connect(ctx.destination);

    // reverb: long, pre-delayed, with a tail that darkens as it fades
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(4.2, 2.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.5;
    this.reverb.connect(this.reverbGain).connect(this.master);

    // pad bus, ducked a touch on each beat so the whole bed breathes
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1050;
    this.padFilter.Q.value = 0.6;
    // slow filter drift keeps long pads alive
    this.padLfo = ctx.createOscillator();
    this.padLfo.frequency.value = 0.06;
    const padLfoGain = ctx.createGain();
    padLfoGain.gain.value = 110;
    this.padLfo.connect(padLfoGain).connect(this.padFilter.frequency);
    this.padLfo.start();
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.34;
    this.duck = ctx.createGain();
    this.padFilter.connect(this.padBus);
    this.padBus.connect(this.duck).connect(this.master);
    const padSend = ctx.createGain();
    padSend.gain.value = 0.7;
    this.padBus.connect(padSend).connect(this.reverb);

    // pluck bus with a dotted-eighth PING-PONG echo — left, right, left…
    this.pluckBus = ctx.createGain();
    this.pluckBus.gain.value = 0.5;
    this.pluckBus.connect(this.master);
    const pluckSend = ctx.createGain();
    pluckSend.gain.value = 0.5;
    this.pluckBus.connect(pluckSend).connect(this.reverb);
    this.delayA = ctx.createDelay(2);
    this.delayB = ctx.createDelay(2);
    this.delayA.delayTime.value = this.spb * 0.75;
    this.delayB.delayTime.value = this.spb * 0.75;
    const lpA = ctx.createBiquadFilter();
    lpA.type = 'lowpass';
    lpA.frequency.value = 2400;
    const lpB = ctx.createBiquadFilter();
    lpB.type = 'lowpass';
    lpB.frequency.value = 1900;
    const panA = ctx.createStereoPanner();
    panA.pan.value = -0.55;
    const panB = ctx.createStereoPanner();
    panB.pan.value = 0.55;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.45;
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.45;
    this.echoFb2 = ctx.createGain();
    this.echoFb2.gain.value = 0.4;
    this.delayA.connect(lpA);
    lpA.connect(panA).connect(echoOut);
    lpA.connect(this.echoFb).connect(this.delayB);
    this.delayB.connect(lpB);
    lpB.connect(panB).connect(echoOut);
    lpB.connect(this.echoFb2).connect(this.delayA);
    echoOut.connect(this.master);
    const echoIn = ctx.createGain();
    echoIn.gain.value = 0.55;
    this.pluckBus.connect(echoIn).connect(this.delayA);

    // bass bus
    this.bassBus = ctx.createGain();
    this.bassBus.gain.value = 0.4;
    this.bassBus.connect(this.master);

    // lead bus: e-piano / bells / flute / MIDI melodies — dry voice plus a
    // two-voice modulated chorus spread wide, and a wash of reverb
    this.leadBus = ctx.createGain();
    this.leadBus.gain.value = 0.5;
    const leadDry = ctx.createGain();
    leadDry.gain.value = 0.78;
    this.leadBus.connect(leadDry).connect(this.master);
    for (const [base, rate, depth, pan] of [[0.013, 0.31, 0.0024, -0.6], [0.021, 0.23, 0.0031, 0.6]]) {
      const dl = ctx.createDelay(0.1);
      dl.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg).connect(dl.delayTime);
      lfo.start();
      const pn = ctx.createStereoPanner();
      pn.pan.value = pan;
      const cg = ctx.createGain();
      cg.gain.value = 0.4;
      this.leadBus.connect(dl).connect(pn).connect(cg).connect(this.master);
    }
    const leadSend = ctx.createGain();
    leadSend.gain.value = 0.6;
    this.leadBus.connect(leadSend).connect(this.reverb);
    const leadEcho = ctx.createGain();
    leadEcho.gain.value = 0.22;
    this.leadBus.connect(leadEcho).connect(this.delayA);

    // percussion bus, barely there
    this.percBus = ctx.createGain();
    this.percBus.gain.value = 0.6;
    this.percBus.connect(this.master);

    // round-robin stereo placement for melody notes
    this._panSeq = [-0.32, 0.18, 0.38, -0.14, 0.05, -0.42, 0.28];
    this._panIdx = 0;

    this._atmosphere();

    this.setIdx = 0;
    this.pendingSet = null;
    this.arpRest = ARP_REST[0];
    this.nightAmt = 0;
    this.moodRest = 0;
    this.sparkleMood = 0;
    this.cruiseBpm = 78;
    this.trackIdx = 0;
    this.track = TRACKS[0];
    this.pendingTrack = null;
    this.autoTrack = true;
    this.midiTracks = [];
    this.midiLoop = null;

    this.beatTimes = [];
    this.nextBeat = 0;
    this.beatCount = 0;
    this.muted = false;
    this.timer = null;
  }

  start() {
    this.ctx.resume();
    this._unlockIOS();
    this.nextBeat = this.ctx.currentTime + 0.2;
    this.timer = setInterval(() => this._schedule(), 40);
    // iOS suspends the context on lock/interruption — revive it on any touch
    const revive = () => {
      if (this.ctx.state !== 'running') this.ctx.resume();
    };
    window.addEventListener('pointerdown', revive, { passive: true });
    window.addEventListener('touchend', revive, { passive: true });
    // background tabs throttle the scheduler — duck the music instead of stuttering
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx.state !== 'running') this.ctx.resume();
      if (this.muted) return;
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(document.hidden ? 0 : this.volume, t, 0.2);
      if (!document.hidden) this.nextBeat = Math.max(this.nextBeat, this.ctx.currentTime + 0.2);
    });
  }

  // iOS routes Web Audio through the ringer channel, so the silent switch
  // kills it. Looping a (silent) media element in the same user gesture flips
  // the audio session to "playback", which ignores the switch.
  _unlockIOS() {
    try {
      const rate = 8000;
      const samples = rate / 10;
      const buf = new ArrayBuffer(44 + samples * 2);
      const v = new DataView(buf);
      const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, samples * 2, true);
      const el = document.createElement('audio');
      el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      el.loop = true;
      el.setAttribute('playsinline', '');
      el.play().catch(() => {});
      this._silentLoop = el; // keep alive
    } catch { /* best effort */ }
  }

  toggleMute() {
    this.muted = !this.muted;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.15);
    return this.muted;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this.muted) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.volume, t, 0.1);
    }
  }

  // Songs parsed from .mid files become extra stations on the track dial.
  addMidiTrack(name, loop) {
    if (loop) this.midiTracks.push({ name, loop });
  }

  get totalTracks() {
    return TRACKS.length + this.midiTracks.length;
  }

  // Manual track choice from the radio ('auto' hands it back to the drive).
  setTrack(idx) {
    if (idx === 'auto') { this.autoTrack = true; return; }
    this.autoTrack = false;
    const total = this.totalTracks;
    const n = ((idx % total) + total) % total;
    if (n !== this.trackIdx) this.pendingTrack = n;
  }

  get displayTrack() {
    const idx = this.pendingTrack !== null ? this.pendingTrack : this.trackIdx;
    return idx < TRACKS.length ? TRACKS[idx].name : this.midiTracks[idx - TRACKS.length].name;
  }

  _setTempo(bpm) {
    if (Math.abs(bpm - this.tempo) < 0.5) return;
    this.tempo = bpm;
    this.spb = 60 / bpm;
    const t = this.ctx.currentTime;
    this.delayA.delayTime.setTargetAtTime(this.spb * 0.75, t, 0.8);
    this.delayB.delayTime.setTargetAtTime(this.spb * 0.75, t, 0.8);
  }

  _applyTrack(idx) {
    this.trackIdx = idx;
    if (idx < TRACKS.length) {
      this.track = TRACKS[idx];
      this.midiLoop = null;
    } else {
      this.track = MIDI_PRESET;
      this.midiLoop = this.midiTracks[idx - TRACKS.length].loop;
      // settle the bed into the song's diatonic home so they never argue
      this.setIdx = this.midiLoop.minor ? SOMBER_SET : 0;
      this.pendingSet = null;
      this.arpRest = ARP_REST[this.setIdx];
    }
    const t = this.ctx.currentTime;
    this.padBus.gain.setTargetAtTime(this.track.padGain, t, 2.5);
    this.pluckBus.gain.setTargetAtTime(this.track.pluckGain, t, 2.5);
    this._setTempo(this.cruiseBpm * this.track.tempoMul);
  }

  // The world reports where we are and how it feels; the music leans in.
  // Mood, not just tempo: storms pull the harmony minor and the filters down,
  // snow opens the reverb and adds sparkles, clear days brighten everything —
  // and in auto mode the whole track changes with the drive.
  setScene({ set, tempo, night, muffle, rain, snow = 0, storm = 0, wind, bright = 0, timeIdx = 2 }) {
    const t = this.ctx.currentTime;
    const somber = Math.min(1, storm + rain * 0.45);
    // while a MIDI cover is on the air, the bed stays in the song's home set
    const midiMode = this.midiLoop !== null ||
      (this.pendingTrack !== null && this.pendingTrack >= TRACKS.length);
    if (!midiMode) {
      const effSet = somber > 0.55 ? SOMBER_SET : set;
      if (effSet !== this.setIdx && effSet !== this.pendingSet) this.pendingSet = effSet;
    }
    if (tempo) this.cruiseBpm = tempo;
    this._setTempo(this.cruiseBpm * this.track.tempoMul);

    if (this.autoTrack) {
      let pick;
      if (rain + storm > 0.55) pick = 3;        // rainy glass
      else if (night > 0.55) pick = 1;          // night drive
      else if (timeIdx === 0) pick = 2;         // morning bells at dawn
      else if (set === 1 || set === 2) pick = 4; // open plains in the wilds
      else pick = 0;                            // golden hour
      if (pick !== this.trackIdx && pick !== this.pendingTrack) this.pendingTrack = pick;
    }

    this.nightAmt = night;
    this.moodRest = rain * 0.1 + snow * 0.16 + storm * 0.05 - bright * 0.08;
    this.sparkleMood = snow * 0.3 - storm * 0.35 + this.track.sparkle;
    this.padFilter.frequency.setTargetAtTime(
      this.track.filter - night * 380 - somber * 240 + bright * 230, t, 1.5);
    this.tone.frequency.setTargetAtTime(13500 - Math.min(1, muffle) * 11000, t, 1.5);
    this.reverbGain.gain.setTargetAtTime(this.track.rev + snow * 0.35 + rain * 0.15, t, 2);
    this.echoFb.gain.setTargetAtTime(this.track.echo + rain * 0.14, t, 2);
    this.echoFb2.gain.setTargetAtTime((this.track.echo + rain * 0.14) * 0.85, t, 2);
    this.bassBus.gain.setTargetAtTime(this.track.bassGain + storm * 0.12, t, 2);
    this.rainGain.gain.setTargetAtTime(Math.min(1, rain) * 0.05, t, 1.2);
    this.windGain.gain.setTargetAtTime(0.018 + wind * 0.05, t, 1.5);
  }

  // distant thunder, delayed like the real thing
  thunder(delayS) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delayS;
    const src = ctx.createBufferSource();
    src.buffer = this._noise(2.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.25, t + 0.08);
    g.gain.setTargetAtTime(0, t + 0.35, 0.8);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 3.2);
  }

  // brief radio static when tuning to another station
  tuneFx() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._staticNoise(0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2800, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.4);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.setTargetAtTime(0, t + 0.25, 0.1);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.55);
  }

  // soft radio pushbutton: a muffled felt tick and a low rounded thump,
  // quiet enough to sit inside the music
  uiClick() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tick = ctx.createBufferSource();
    tick.buffer = this._staticNoise(0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 1.1;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.05, t);
    sg.gain.setTargetAtTime(0, t + 0.005, 0.014);
    tick.connect(bp).connect(sg).connect(this.master);
    tick.start(t);
    tick.stop(t + 0.07);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150, t);
    thump.frequency.exponentialRampToValueAtTime(95, t + 0.05);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
    tg.gain.setTargetAtTime(0, t + 0.03, 0.03);
    thump.connect(tg).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.14);
  }

  // 0..1 envelope that spikes on each beat — drives the wind/bloom pulse.
  getPulse() {
    const now = this.ctx.currentTime;
    let last = -10;
    while (this.beatTimes.length && this.beatTimes[0] < now - 4) this.beatTimes.shift();
    for (const t of this.beatTimes) {
      if (t <= now) last = t;
      else break;
    }
    return Math.exp(-2.6 * Math.max(0, now - last));
  }

  // ---- internals ----------------------------------------------------------

  _schedule() {
    const horizon = this.ctx.currentTime + 0.15;
    while (this.nextBeat < horizon) {
      this._beat(this.beatCount, this.nextBeat);
      this.beatTimes.push(this.nextBeat);
      this.nextBeat += this.spb;
      this.beatCount++;
    }
  }

  _beat(beat, t) {
    const beatInChord = beat % BEATS_PER_CHORD;
    if (beatInChord === 0) {
      if (this.pendingTrack !== null) {
        this._applyTrack(this.pendingTrack);
        this.pendingTrack = null;
      }
      if (this.pendingSet !== null) {
        this.setIdx = this.pendingSet;
        this.pendingSet = null;
        this.arpRest = ARP_REST[this.setIdx];
      }
    }
    const chordIdx = Math.floor(beat / BEATS_PER_CHORD) % 4;
    const chord = CHORD_SETS[this.setIdx][chordIdx];

    if (beatInChord === 0) {
      this._pad(chord.notes, t, BEATS_PER_CHORD * this.spb);
      const sparkleP = 0.55 + this.nightAmt * 0.25 + (this.sparkleMood || 0);
      if (Math.random() < sparkleP) this._sparkle(chord.notes, t + this.spb * (1 + Math.floor(Math.random() * 4)));
    }
    if (beatInChord % 4 === 0) this._bass(chord.bass, t, this.spb * 3.6);

    // a breath of sidechain: the pads dip a touch on every beat and swell
    // back — the bed pulses with the same heartbeat that sways the flowers
    this.duck.gain.setValueAtTime(0.86, t);
    this.duck.gain.setTargetAtTime(1, t + 0.03, 0.11);

    // a whisper of percussion where the track calls for it
    if (this.track.perc >= 1) {
      for (let half = 0; half < 2; half++) {
        if (Math.random() < 0.8) this._shaker(t + half * this.spb * 0.5, half ? 0.008 : 0.012);
      }
    }
    if (this.track.perc >= 2 && beatInChord % 4 === 0) this._kick(t, 0.07);

    // e-piano comping stabs late in the chord
    if (this.track.comp && (beatInChord === 3 || beatInChord === 6) && Math.random() < 0.5) {
      const stab = chord.notes.slice(1, 4);
      stab.forEach((m, i) => this._epiano(midiHz(m), t + i * 0.015, 0.02, this.spb * 1.4));
    }

    if (this.midiLoop) {
      // the song, woven in: this beat's melody notes, quiet and unhurried,
      // floating inside the bed rather than on top of it
      const L = this.midiLoop;
      const lb = beat % L.lengthBeats;
      const bucket = L.buckets.get(lb);
      if (bucket) {
        for (const n of bucket) {
          const when = t + (n.beat - lb) * this.spb;
          this._lead(this.track.lead, midiHz(n.midi), when, 0.04 + n.vel * 0.05, Math.min(4, Math.max(0.3, n.durBeats * this.spb)));
        }
      }
    }

    // arpeggio: two eighth notes per beat with light swing and air
    const tones = chord.notes;
    const rest = Math.min(0.85, Math.max(0.05, this.arpRest + this.track.rest + (this.moodRest || 0)));
    for (let half = 0; half < 2; half++) {
      if (Math.random() < rest) continue;
      const idx = (beat * 2 + half * 3 + chordIdx) % tones.length;
      const oct = (beat + half) % 4 === 3 ? 12 : 0;
      const when = t + half * this.spb * 0.5 + (half ? this.spb * 0.04 : 0);
      const vel = (0.04 + Math.random() * 0.04) * (1 - this.nightAmt * 0.3);
      this._lead(this.track.lead, midiHz(tones[idx] + this.track.pluckOct + oct), when, vel, this.spb * 1.2);
    }
  }

  // lead voice dispatch — every track sings with its own instrument.
  // Notes are humanized (micro-timing and velocity) and walk around the
  // stereo field instead of stacking dead center: that's what makes the
  // difference between "a MIDI file" and a performance.
  _lead(kind, freq, t, vel, dur) {
    t += (Math.random() - 0.5) * 0.013;
    vel *= 0.86 + Math.random() * 0.28;
    this._panIdx = (this._panIdx + 1) % this._panSeq.length;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = this._panSeq[this._panIdx];
    if (kind === 'epiano') { pan.connect(this.leadBus); this._epiano(freq, t, vel, dur, false, pan); }
    else if (kind === 'soft') { pan.connect(this.leadBus); this._epiano(freq, t, vel, dur, true, pan); }
    else if (kind === 'bell') { pan.connect(this.leadBus); this._bell(freq, t, vel, pan); }
    else if (kind === 'flute') { pan.connect(this.leadBus); this._flute(freq, t, vel, Math.max(dur, this.spb * 1.6), pan); }
    else { pan.connect(this.pluckBus); this._pluck(freq, t, vel, pan); }
  }

  // FM e-piano: sine carrier, 2:1 modulator whose index decays — soft tine.
  // Velocity drives brightness (harder notes ring brighter, like a real
  // tine), long notes get a delayed vibrato, soft mode rounds it all off.
  _epiano(freq, t, vel, dur = 0.9, soft = false, out = this.leadBus) {
    const ctx = this.ctx;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;
    carrier.detune.value = (Math.random() - 0.5) * 5;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2;
    const brightness = soft ? 0.55 + vel * 5 : 1.1 + vel * 7;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * brightness, t);
    modGain.gain.setTargetAtTime(freq * 0.05, t + 0.01, soft ? 0.26 : 0.18);
    mod.connect(modGain).connect(carrier.frequency);
    if (dur > 0.7) {
      // delayed vibrato — the note starts straight, then starts to sing
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.8;
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(6, t + 0.55);
      lfo.connect(vg).connect(carrier.detune);
      lfo.start(t);
      lfo.stop(t + dur + 2);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    // a clear (but not clicky) onset — articulation carries the tune
    g.gain.linearRampToValueAtTime(vel, t + (soft ? 0.022 : 0.008));
    g.gain.setTargetAtTime(vel * (soft ? 0.55 : 0.35), t + 0.08, soft ? 0.5 : 0.3);
    g.gain.setTargetAtTime(0, t + dur, soft ? 0.35 : 0.18);
    carrier.connect(g).connect(out);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + dur + 2);
    mod.stop(t + dur + 2);
  }

  // small glass bell: fundamental plus inharmonic partials, long shimmer
  _bell(freq, t, vel, out = this.leadBus) {
    const ctx = this.ctx;
    for (const [ratio, amp, dec] of [[1, 1, 1.4], [2.76, 0.4, 0.6], [5.4, 0.18, 0.3]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel * amp * 0.7, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.02, dec);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + dec * 6);
    }
  }

  // breathy flute: filtered triangle with slow attack and gentle vibrato
  _flute(freq, t, vel, dur, out = this.leadBus) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibGain = ctx.createGain();
    vibGain.gain.value = freq * 0.006;
    vib.connect(vibGain).connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.9, t + 0.09);
    g.gain.setValueAtTime(vel * 0.9, t + Math.max(0.1, dur - 0.1));
    g.gain.setTargetAtTime(0, t + dur, 0.12);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 1);
    vib.stop(t + dur + 1);
  }

  // soft felt kick
  _kick(t, vel) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t + 0.02, 0.07);
    osc.connect(g).connect(this.percBus);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  // tiny shaker tick
  _shaker(t, vel) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._staticNoise(0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t + 0.008, 0.022);
    src.connect(hp).connect(g).connect(this.percBus);
    src.start(t);
    src.stop(t + 0.09);
  }

  _pad(notes, t, dur) {
    // detuned saw pair spread hard left/right — a wide, breathing ensemble
    for (const m of notes) {
      for (const [det, pan] of [[-6, -0.5], [5, 0.5]]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiHz(m);
        osc.detune.value = det + (Math.random() - 0.5) * 3;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.042, t + 1.4);
        g.gain.setValueAtTime(0.042, t + dur - 0.4);
        g.gain.linearRampToValueAtTime(0, t + dur + 2.2);
        const pn = this.ctx.createStereoPanner();
        pn.pan.value = pan;
        osc.connect(g).connect(pn).connect(this.padFilter);
        osc.start(t);
        osc.stop(t + dur + 2.4);
      }
    }
    // soft triangle sub an octave under the root anchors the chord
    const sub = this.ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = midiHz(notes[0] - 12);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.05, t + 1.8);
    sg.gain.setValueAtTime(0.05, t + dur - 0.4);
    sg.gain.linearRampToValueAtTime(0, t + dur + 2);
    sub.connect(sg).connect(this.padFilter);
    sub.start(t);
    sub.stop(t + dur + 2.2);
  }

  _bass(m, t, dur) {
    // sine fundamental plus a quiet rounded-off triangle octave for warmth
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    lp.connect(this.bassBus);
    for (const [type, mm, amp] of [['sine', m - 12, 0.22], ['triangle', m, 0.06]]) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiHz(mm);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.06);
      g.gain.setTargetAtTime(amp * 0.55, t + 0.3, 0.5);
      g.gain.setTargetAtTime(0, t + dur, 0.2);
      osc.connect(g).connect(lp);
      osc.start(t);
      osc.stop(t + dur + 1);
    }
  }

  _pluck(freq, t, vel, out = this.pluckBus) {
    const osc = this.ctx.createOscillator();
    osc.type = this.track.pluckType;
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.03, 0.16);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.4);
  }

  _sparkle(notes, t) {
    const m = notes[Math.floor(Math.random() * notes.length)] + 24;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiHz(m);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.032, t + 0.02);
    g.gain.setTargetAtTime(0, t + 0.1, 0.9);
    // sparkles drift far out in the stereo field
    const pn = this.ctx.createStereoPanner();
    pn.pan.value = (Math.random() - 0.5) * 1.5;
    const send = this.ctx.createGain();
    send.gain.value = 1.6;
    osc.connect(g).connect(pn);
    pn.connect(this.master);
    pn.connect(send).connect(this.reverb);
    osc.start(t);
    osc.stop(t + 4);
  }

  _atmosphere() {
    const ctx = this.ctx;
    // wind: looped noise through a slowly breathing bandpass
    const wind = ctx.createBufferSource();
    wind.buffer = this._noise(3);
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.018;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    wind.connect(bp).connect(this.windGain).connect(this.master);
    wind.start();
    lfo.start();

    // rain: brighter noise band, silent until the weather brings it in
    const rain = ctx.createBufferSource();
    rain.buffer = this._staticNoise(4);
    rain.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1700;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 7000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(hp).connect(rainLp).connect(this.rainGain).connect(this.master);
    rain.start();

    // vinyl crackle — kept quiet so it reads as warmth, not clipping
    const crackle = ctx.createBufferSource();
    crackle.buffer = this._crackle(2.7);
    crackle.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    const cg = ctx.createGain();
    cg.gain.value = 0.02;
    crackle.connect(lp).connect(cg).connect(this.master);
    crackle.start();
  }

  _noise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b = 0;
      for (let i = 0; i < len; i++) {
        // cheap pink-ish noise
        b = b * 0.97 + (Math.random() * 2 - 1) * 0.03;
        d[i] = b * 6;
      }
    }
    return buf;
  }

  _staticNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  _crackle(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < 90; i++) {
      const at = Math.floor(Math.random() * len);
      const amp = (Math.random() * 2 - 1) * (0.2 + Math.random() * 0.5);
      const w = 2 + Math.floor(Math.random() * 14);
      for (let j = 0; j < w && at + j < len; j++) {
        d[at + j] += amp * Math.exp(-j * 0.6);
      }
    }
    return buf;
  }

  // reverb impulse with a short pre-delay and a tail that darkens over time
  // (a one-pole lowpass whose smoothing tightens toward the end) — the
  // difference between a noise burst and a room
  _impulse(seconds, decay) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const pre = Math.floor(sr * 0.02);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const k = (i - pre) / (len - pre);
        const a = 0.15 + 0.8 * k; // more smoothing (darker) as the tail fades
        const x = (Math.random() * 2 - 1) * Math.pow(1 - k, decay);
        lp = lp * a + x * (1 - a);
        d[i] = lp * 2.4;
      }
    }
    return buf;
  }
}
