// Minimal Standard MIDI File reader + melody extraction. A .mid file goes in,
// a playable lead loop comes out: notes in beat-space (so it locks to the
// engine's tempo), transposed into the game's home key, bucketed per beat for
// cheap scheduling. No external deps.

export function parseMidi(buf) {
  // some files are RIFF-wrapped (RMID) or have junk before the header —
  // find the actual 'MThd' marker and start there
  const bytes = new Uint8Array(buf);
  let start = -1;
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x4d && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) {
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error('not a midi file');
  if (start > 0) buf = buf.slice(start);

  const d = new DataView(buf);
  let p = 0;
  const str = (n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p++));
    return s;
  };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const u8 = () => d.getUint8(p++);
  const vlq = () => {
    let v = 0;
    for (;;) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  };

  if (str(4) !== 'MThd') throw new Error('not a midi file');
  const hlen = u32();
  u16(); // format
  const ntrk = u16();
  const div = u16();
  p += hlen - 6;

  const tracks = [];
  for (let ti = 0; ti < ntrk && p + 8 <= buf.byteLength; ti++) {
    if (str(4) !== 'MTrk') break;
    const len = u32();
    const end = p + len;
    let tick = 0;
    let running = 0;
    const open = new Map();
    const notes = [];
    while (p < end) {
      tick += vlq();
      let st = u8();
      // only channel messages (0x80–0xEF) participate in running status;
      // meta/sysex must not clobber it or the stream desyncs
      if (st < 0x80) { p--; st = running; }
      else if (st < 0xf0) running = st;
      const type = st & 0xf0;
      if (type === 0x90 || type === 0x80) {
        const note = u8();
        const vel = u8();
        const ch = st & 0x0f;
        const key = ch * 200 + note;
        if (type === 0x90 && vel > 0) {
          open.set(key, { tick, vel });
        } else {
          const o = open.get(key);
          if (o) {
            notes.push({ midi: note, vel: o.vel / 127, start: o.tick, dur: Math.max(1, tick - o.tick), ch });
            open.delete(key);
          }
        }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) p += 2;
      else if (type === 0xc0 || type === 0xd0) p += 1;
      else if (st === 0xff) {
        u8();
        // NB: `p += vlq()` would snapshot p BEFORE vlq advances it — keep separate
        const l = vlq();
        p += l;
      } else if (st === 0xf0 || st === 0xf7) {
        const l = vlq();
        p += l;
      } else break;
    }
    p = end;
    tracks.push(notes);
  }
  return { div, tracks };
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Krumhansl-style key guess from a duration-weighted pitch-class histogram.
function estimateKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.midi % 12] += n.dur;
  let best = { score: -Infinity, tonic: 0, minor: false };
  for (const [tpl, minor] of [[MAJOR, false], [MINOR, true]]) {
    for (let tonic = 0; tonic < 12; tonic++) {
      let score = 0;
      for (let i = 0; i < 12; i++) score += tpl[i] * hist[(tonic + i) % 12];
      if (score > best.score) best = { score, tonic, minor };
    }
  }
  return best;
}

// Pick the most melodic track: plenty of notes in a singing register,
// preferring mostly-monophonic lines over chordal accompaniment.
function pickLead(parsed) {
  let best = null;
  for (const notes of parsed.tracks) {
    const melodic = notes.filter((n) => n.ch !== 9 && n.midi >= 48 && n.midi <= 96);
    if (melodic.length < 24) continue;
    const avg = melodic.reduce((a, n) => a + n.midi, 0) / melodic.length;
    const starts = new Set(melodic.map((n) => n.start));
    const mono = starts.size / melodic.length; // 1 = pure melody, low = chords
    const score = melodic.length * (0.4 + mono) * (avg > 55 ? 1 : 0.5);
    if (!best || score > best.score) best = { notes: melodic, score };
  }
  return best ? best.notes : null;
}

// Build a beat-space loop ready for the music engine, reshaped into a light
// ambient cover: the melody is transposed into the bed's own diatonic world
// (the chord sets all live in C major / A minor) and lightly thinned — but it
// keeps its original phrasing and pace, so the tune stays recognizable.
export function makeLoop(parsed, maxBeats = 96) {
  const lead = pickLead(parsed);
  if (!lead) return null;
  const key = estimateKey(lead);
  const transpose = (((key.minor ? 9 : 0) - key.tonic + 6 + 24) % 12) - 6; // shortest way

  const div = parsed.div || 480;
  const t0 = Math.min(...lead.map((n) => n.start));
  const all = lead
    .map((n) => ({
      beat: (n.start - t0) / div,
      durBeats: Math.min(6, n.dur / div),
      midi: n.midi + transpose,
      vel: n.vel,
    }))
    .filter((n) => n.beat < maxBeats)
    .sort((a, b) => a.beat - b.beat);
  // drop only the dust — grace notes and near-silent ticks; hooks survive
  let notes = all.filter((n) => n.durBeats >= 0.15 && n.vel > 0.12);
  if (notes.length < 16) notes = all;
  if (notes.length < 16) return null;

  // settle the melody into a singing register
  const avg = notes.reduce((a, n) => a + n.midi, 0) / notes.length;
  const octShift = Math.round((70 - avg) / 12) * 12;
  if (octShift) notes = notes.map((n) => ({ ...n, midi: n.midi + octShift }));

  // bucket per integer beat with modest polyphony — airy but articulate
  const buckets = new Map();
  for (const n of notes) {
    const b = Math.floor(n.beat);
    if (!buckets.has(b)) buckets.set(b, []);
    const arr = buckets.get(b);
    arr.push(n);
    if (arr.length > 3) {
      arr.sort((x, y) => y.vel - x.vel);
      arr.length = 3;
    }
  }
  const last = notes[notes.length - 1];
  const lengthBeats = Math.max(16, Math.ceil((last.beat + last.durBeats) / 8) * 8);
  return { lengthBeats, buckets, minor: key.minor };
}

// "KarmaPolice(3).mid" → "KARMA POLICE"
export function midiTrackName(filename) {
  return filename
    .replace(/\.midi?$/i, '')
    .replace(/\(\d+\)/g, '')
    .replace(/\./g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .toUpperCase();
}
