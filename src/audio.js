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
    this.master.connect(this.tone).connect(comp).connect(limiter).connect(ctx.destination);

    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.4, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.5;
    this.reverb.connect(this.reverbGain).connect(this.master);

    // pad bus
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1050;
    this.padFilter.Q.value = 0.6;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.34;
    this.padFilter.connect(this.padBus);
    this.padBus.connect(this.master);
    const padSend = ctx.createGain();
    padSend.gain.value = 0.7;
    this.padBus.connect(padSend).connect(this.reverb);

    // pluck bus with dotted-eighth feedback echo
    this.pluckBus = ctx.createGain();
    this.pluckBus.gain.value = 0.5;
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = this.spb * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    this.echoFb = fb;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2600;
    this.delay.connect(echoTone).connect(fb).connect(this.delay);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.4;
    this.delay.connect(echoOut).connect(this.master);
    this.pluckBus.connect(this.delay);
    this.pluckBus.connect(this.master);
    const pluckSend = ctx.createGain();
    pluckSend.gain.value = 0.5;
    this.pluckBus.connect(pluckSend).connect(this.reverb);

    // bass bus
    this.bassBus = ctx.createGain();
    this.bassBus.gain.value = 0.4;
    this.bassBus.connect(this.master);

    // lead bus: e-piano / bells / flute / MIDI melodies, with a wash of reverb
    this.leadBus = ctx.createGain();
    this.leadBus.gain.value = 0.5;
    this.leadBus.connect(this.master);
    const leadSend = ctx.createGain();
    leadSend.gain.value = 0.6;
    this.leadBus.connect(leadSend).connect(this.reverb);

    // percussion bus, barely there
    this.percBus = ctx.createGain();
    this.percBus.gain.value = 0.6;
    this.percBus.connect(this.master);

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
    this.delay.delayTime.setTargetAtTime(this.spb * 0.75, this.ctx.currentTime, 0.8);
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

  // lead voice dispatch — every track sings with its own instrument
  _lead(kind, freq, t, vel, dur) {
    if (kind === 'epiano') this._epiano(freq, t, vel, dur);
    else if (kind === 'soft') this._epiano(freq, t, vel, dur, true);
    else if (kind === 'bell') this._bell(freq, t, vel);
    else if (kind === 'flute') this._flute(freq, t, vel, Math.max(dur, this.spb * 1.6));
    else this._pluck(freq, t, vel);
  }

  // FM e-piano: sine carrier, 2:1 modulator whose index decays — soft tine.
  // In soft mode the tine almost disappears: slow attack, barely any FM —
  // the voice MIDI covers float in on.
  _epiano(freq, t, vel, dur = 0.9, soft = false) {
    const ctx = this.ctx;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * (soft ? 0.9 : 1.6), t);
    modGain.gain.setTargetAtTime(freq * 0.05, t + 0.01, soft ? 0.26 : 0.18);
    mod.connect(modGain).connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    // a clear (but not clicky) onset — articulation carries the tune
    g.gain.linearRampToValueAtTime(vel, t + (soft ? 0.022 : 0.008));
    g.gain.setTargetAtTime(vel * (soft ? 0.55 : 0.35), t + 0.08, soft ? 0.5 : 0.3);
    g.gain.setTargetAtTime(0, t + dur, soft ? 0.35 : 0.18);
    carrier.connect(g).connect(this.leadBus);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + dur + 2);
    mod.stop(t + dur + 2);
  }

  // small glass bell: fundamental plus inharmonic partials, long shimmer
  _bell(freq, t, vel) {
    const ctx = this.ctx;
    for (const [ratio, amp, dec] of [[1, 1, 1.4], [2.76, 0.4, 0.6], [5.4, 0.18, 0.3]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel * amp * 0.7, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.02, dec);
      osc.connect(g).connect(this.leadBus);
      osc.start(t);
      osc.stop(t + dec * 6);
    }
  }

  // breathy flute: filtered triangle with slow attack and gentle vibrato
  _flute(freq, t, vel, dur) {
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
    osc.connect(lp).connect(g).connect(this.leadBus);
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
    for (const m of notes) {
      for (const det of [-5, 4]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiHz(m);
        osc.detune.value = det;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.045, t + 1.4);
        g.gain.setValueAtTime(0.045, t + dur - 0.4);
        g.gain.linearRampToValueAtTime(0, t + dur + 2.2);
        osc.connect(g).connect(this.padFilter);
        osc.start(t);
        osc.stop(t + dur + 2.4);
      }
    }
  }

  _bass(m, t, dur) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiHz(m - 12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.06);
    g.gain.setTargetAtTime(0.12, t + 0.3, 0.5);
    g.gain.setTargetAtTime(0, t + dur, 0.2);
    osc.connect(g).connect(this.bassBus);
    osc.start(t);
    osc.stop(t + dur + 1);
  }

  _pluck(freq, t, vel) {
    const osc = this.ctx.createOscillator();
    osc.type = this.track.pluckType;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.03, 0.16);
    osc.connect(g).connect(this.pluckBus);
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
    g.gain.linearRampToValueAtTime(0.035, t + 0.02);
    g.gain.setTargetAtTime(0, t + 0.1, 0.9);
    const send = this.ctx.createGain();
    send.gain.value = 1.6;
    osc.connect(g);
    g.connect(this.master);
    g.connect(send).connect(this.reverb);
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

  _impulse(seconds, decay) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }
}
