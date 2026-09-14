// Reading and writing MIDI.
//
// Reading rides on @tonejs/midi, which happily parses format 0 and format 1
// and hands back absolute times in seconds with the tempo map already applied.
// Writing is done by hand below, because @tonejs/midi's writer hardcodes
// format 1 in the header and we specifically want format 0 out.

//////////////////////////////////////////////////////////////////////
// WRITING - minimal type 0 encoder
//////////////////////////////////////////////////////////////////////

const PPQ = 480;

// MIDI stores most numbers as variable-length quantities: 7 bits per byte,
// high bit set on every byte but the last.
function writeVarInt(value) {
  const bytes = [value & 0x7f];
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

function writeUint32(value) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function writeUint16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function chunk(id, bytes) {
  const out = [];
  for (const ch of id) out.push(ch.charCodeAt(0));
  return out.concat(writeUint32(bytes.length), bytes);
}

/**
 * Encode a score to a format 0 (single track) MIDI file.
 *
 * @param {Object} song {name, bpm, notes:[{midi, channel, time, duration, velocity}]}
 *        time and duration are in seconds.
 * @returns {Uint8Array} the bytes of a .mid file
 */
function encodeType0(song) {
  const bpm = song.bpm || 120;
  const secondsPerTick = 60 / bpm / PPQ;
  const toTicks = (seconds) => Math.max(0, Math.round(seconds / secondsPerTick));

  // Every note becomes a note-on and a note-off, then the whole lot is sorted
  // into one stream - which is exactly what "format 0" means.
  const events = [];
  for (const n of song.notes) {
    const onTick = toTicks(n.time);
    const offTick = toTicks(n.time + Math.max(n.duration, 0.01));
    const velocity = Math.max(1, Math.min(127, Math.round((n.velocity ?? 0.8) * 127)));
    const channel = (n.channel ?? 0) & 0x0f;
    events.push({ tick: onTick,  order: 1, bytes: [0x90 | channel, n.midi & 0x7f, velocity] });
    events.push({ tick: offTick, order: 0, bytes: [0x80 | channel, n.midi & 0x7f, 0x40] });
  }

  // Note-offs sort before note-ons at the same tick so a repeated pitch
  // retriggers cleanly instead of cutting its own tail.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [];

  // Track name
  const nameBytes = Array.from(new TextEncoder().encode(song.name || "untitled"));
  track.push(...writeVarInt(0), 0xff, 0x03, ...writeVarInt(nameBytes.length), ...nameBytes);

  // Tempo, as microseconds per quarter note
  const usPerQuarter = Math.round(60000000 / bpm);
  track.push(...writeVarInt(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);

  // Time signature 4/4, 24 clocks per beat, 8 32nds per quarter
  track.push(...writeVarInt(0), 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  let lastTick = 0;
  for (const ev of events) {
    track.push(...writeVarInt(ev.tick - lastTick), ...ev.bytes);
    lastTick = ev.tick;
  }

  // End of track
  track.push(...writeVarInt(0), 0xff, 0x2f, 0x00);

  //                        format 0, one track, ticks per quarter
  const header = [...writeUint16(0), ...writeUint16(1), ...writeUint16(PPQ)];

  return new Uint8Array([...chunk("MThd", header), ...chunk("MTrk", track)]);
}

function downloadType0(song, filename) {
  const blob = new Blob([encodeType0(song)], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || (song.name || "song") + ".mid";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

//////////////////////////////////////////////////////////////////////
// READING - classify a parsed file into the three buses
//////////////////////////////////////////////////////////////////////

// Which bus does this track belong to? Channel map first, since that is the
// convention our own editor writes. Then track names, for files from a DAW.
// Then a guess from the notes themselves, so something always plays.
function busForTrack(track, alreadyUsed) {
  const channel = track.channel;
  if (CHANNEL_MAP[channel] !== undefined) return CHANNEL_MAP[channel];

  const name = (track.name || "").toLowerCase();
  if (/drum|perc|kick|snare|hat|kit/.test(name)) return BUS.DRUMS;
  if (/pad|string|choir|atmos/.test(name)) return BUS.PADS;
  if (/bass|key|lead|piano|synth/.test(name)) return BUS.BASSKEYS;

  // No hint at all. If it sits low and is mostly monophonic, call it bass.
  const notes = track.notes;
  if (notes.length) {
    const avg = notes.reduce((sum, n) => sum + n.midi, 0) / notes.length;
    if (avg < BASS_KEYS_SPLIT) return BUS.BASSKEYS;
  }
  // Otherwise fill whichever melodic bus is still empty.
  return alreadyUsed.has(BUS.PADS) ? BUS.BASSKEYS : BUS.PADS;
}

/**
 * Turn a parsed Midi object into the flat score the game and audio engine use.
 *
 * @returns {Object} {name, duration, drums:[], pads:[], basskeys:[], counts:{}}
 */
// Lowest and highest pitch in a list, widened a little so a single repeated
// note does not collapse to a zero-width range.
function pitchRange(notes) {
  if (!notes.length) return { lo: 48, hi: 72 };
  let lo = Infinity, hi = -Infinity;
  for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
  if (hi - lo < 6) { lo -= 3; hi += 3; }
  return { lo, hi };
}

// The tempo at the top of the file. A file with a tempo map is imported at
// its first tempo; the editor has one bpm for the whole song.
function firstTempo(midi) {
  const tempos = midi && midi.header && midi.header.tempos;
  if (tempos && tempos.length && tempos[0].bpm) return tempos[0].bpm;
  return 120;
}

function classifyMidi(midi, name) {
  const score = {
    name: name || midi.name || "untitled",
    format: null,     // filled in by scoreFromArrayBuffer, which sees the bytes
    // The file's first tempo. The game does not need it - times arrive in
    // seconds with the tempo map already applied - but the editor does, since
    // it has to put the notes back on a step grid.
    bpm: firstTempo(midi),
    duration: 0,
    drums: [],     // {time, duration, velocity, drum: kick|snare|hihat}
    pads: [],      // {time, duration, velocity, midi}
    basskeys: [],  // {time, duration, velocity, midi, voice: bass|keys}
    counts: { kick: 0, snare: 0, hihat: 0, pads: 0, bass: 0, keys: 0, ignored: 0 },
    // Empty here, but present: a score from a single file and a score from a
    // song folder are read by the same code downstream, and one of them
    // having no such field is a crash waiting for whoever writes that code.
    retimed: [],
    warnings: []
  };

  const used = new Set();
  for (const track of midi.tracks) {
    if (!track.notes.length) continue;
    const bus = busForTrack(track, used);
    used.add(bus);

    for (const note of track.notes) {
      const base = {
        time: note.time,
        duration: note.duration,
        velocity: note.velocity
      };

      if (bus === BUS.DRUMS) {
        const drum = DRUM_NOTES[note.midi];
        if (!drum) { score.counts.ignored++; continue; }
        score.drums.push({ ...base, drum, midi: note.midi });
        score.counts[drum]++;
      } else if (bus === BUS.PADS) {
        score.pads.push({ ...base, midi: note.midi });
        score.counts.pads++;
      } else {
        const voice = note.midi < BASS_KEYS_SPLIT ? "bass" : "keys";
        score.basskeys.push({ ...base, midi: note.midi, voice });
        score.counts[voice]++;
      }
    }
  }

  return finishScore(score);
}

// Sort, measure and range a score once its three buses have been filled.
// Shared by the single-file path above and the song-folder path below, so the
// two cannot drift into disagreeing about what a finished score looks like.
function finishScore(score) {
  const sortByTime = (a, b) => a.time - b.time;
  score.drums.sort(sortByTime);
  score.pads.sort(sortByTime);
  score.basskeys.sort(sortByTime);

  const all = [...score.drums, ...score.pads, ...score.basskeys];
  score.duration = all.reduce((max, n) => Math.max(max, n.time + n.duration), 0);

  // Pitch spans of each melodic bus. The 3D layer spreads its shapes across
  // these rather than across a fixed range, so a file using a narrow voicing
  // still fills the screen instead of bunching up in the middle.
  score.range = {
    pads: pitchRange(score.pads),
    keys: pitchRange(score.basskeys.filter(n => n.voice === "keys"))
  };

  return score;
}

// The format lives in the header at bytes 8-9. @tonejs/midi parses every
// format correctly but does not hand the number back, and "did I actually
// export type 0?" is the thing you most want to see when a file misbehaves.
function readFormat(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 10) return null;
    // "MThd"
    if (view.getUint32(0) !== 0x4d546864) return null;
    return view.getUint16(8);
  } catch (err) {
    return null;
  }
}

// Parse raw bytes into a score. Throws if the bytes are not a MIDI file.
function scoreFromArrayBuffer(buffer, name) {
  const midi = new Midi(buffer);
  const score = classifyMidi(midi, name);
  score.format = readFormat(buffer);
  return score;
}

//////////////////////////////////////////////////////////////////////
// SONG FOLDERS
//
// One .mid per part plus a song.setup, because Ableton exports one track at
// a time. See the SONG FOLDERS block in config.js for the layout.
//////////////////////////////////////////////////////////////////////

// The filenames to try for one part, most likely first.
//
// A web server is case-sensitive and a person is not: "Pads.mid", "pads.mid"
// and "Pads.MID" are all obviously the same part, and getting a silent
// missing instrument because of a capital letter is a miserable half hour.
// So the plausible spellings are tried in turn.
function songFileNames(part) {
  const stem = part.replace(/\.mid$/i, "");
  const lower = stem.toLowerCase();
  const upper = stem.charAt(0).toUpperCase() + lower.slice(1);
  const names = [];
  for (const s of [stem, upper, lower, stem.toUpperCase()]) {
    for (const ext of [".mid", ".MID", ".Mid", ".midi", ".MIDI"]) {
      const name = s + ext;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

// Read a song.setup.
//
// It is JSON, but not strictly: // and /* */ comments are stripped and a
// trailing comma before } or ] is forgiven. The file is meant to be written
// and read by a person - the whole point of it is to be annotated - and JSON
// proper has nowhere to put a note to yourself.
//
// Comment stripping respects string literals, so a "//" inside a name or a
// url survives.
function parseSetup(text) {
  return JSON.parse(relaxJson(text, false));
}

// Read a sound-settings.txt: exactly what the sound panel's "export settings"
// button produces, pasted into the song's folder unchanged.
//
// That block is JavaScript, not JSON - `const SOUND_DEFAULTS = {` with
// unquoted keys and a trailing semicolon - so on top of the comments and
// trailing commas parseSetup() already forgives, the keys are quoted and the
// declaration around the object is peeled off. Handing back the bare object
// works too, for anyone who trims it themselves.
//
// Parsed rather than eval'd: this is a file from a song folder, and running
// it as code would mean every song could run anything.
function parseSoundSettings(text) {
  let body = relaxJson(text, true);
  body = body.replace(/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/, "");
  body = body.replace(/;\s*$/, "");
  return JSON.parse(body);
}

// Turn the relaxed dialect these two files are written in into strict JSON.
//
// Always: // and /* */ comments are stripped, and a trailing comma before a }
// or a ] is forgiven. With `quoteBareKeys`, an unquoted key is quoted, which
// is what lets the sound panel's own export be read back without editing.
//
// Comment stripping and key quoting both respect string literals, so a "//"
// inside a name and a word inside a string are left alone.
function relaxJson(text, quoteBareKeys) {
  let out = "";
  let inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];

    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;                                  // the loop's i++ eats the "/"
      out += " ";
      continue;
    }

    if (quoteBareKeys && /[A-Za-z_$]/.test(c)) {
      let end = i;
      while (end < text.length && /[\w$]/.test(text[end])) end++;
      const word = text.slice(i, end);

      // A key is a word whose next non-space character is a colon. Anything
      // else - `const`, `true`, `null` - is left exactly as it was, so it
      // either parses on its own or is peeled off by the caller.
      let after = end;
      while (after < text.length && /\s/.test(text[after])) after++;
      out += text[after] === ":" ? `"${word}"` : word;
      i = end - 1;
      continue;
    }

    out += c;
  }

  // Trailing commas: `[1, 2, ]` and `{ "a": 1, }`.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// Build one score from a folder's separate part files.
//
// `parts` maps a voice name to an already-parsed Midi, or to null for a part
// that is not there - every part is optional. Every track in a file is used,
// so a stray second track in an export is not silently dropped.
//
// The voice comes from which file a note was in, not from its channel or its
// pitch. That is the whole advantage of the folder format: Bass.mid is the
// bass whatever octave it is written in, and a drum is C, C# or D from any
// octave rather than a General MIDI number to look up.
function scoreFromParts(parts, meta) {
  const setup = meta || {};
  const score = {
    name: setup.name || "untitled",
    format: null,
    bpm: setup.bpm || firstTempo(parts.drums || parts.pads || parts.bass || parts.keys),
    duration: 0,
    drums: [],
    pads: [],
    basskeys: [],
    counts: { kick: 0, snare: 0, hihat: 0, pads: 0, bass: 0, keys: 0, ignored: 0 },
    parts: {},        // which parts were actually found, for the load report
    retimed: [],      // parts re-timed to song.setup's bpm - the normal case
    warnings: []      // two tempos that disagree and both look deliberate
  };

  for (const { file, voice } of SONG_PARTS) {
    const midi = parts[voice];
    score.parts[voice] = !!midi;
    if (!midi) continue;

    // Re-time the part to the tempo song.setup declares.
    //
    // @tonejs/midi hands back seconds, not ticks, and it works those out from
    // whatever tempo the file carries. Ableton's clip export carries none, so
    // the reader falls back to the MIDI standard's 120 and a 70 bpm song
    // arrives timed as though it were 120 - the note *positions* are right,
    // the seconds are not, and it plays 1.7x too fast.
    //
    // So the declared bpm re-times rather than merely labels: everything is
    // scaled by fileTempo / declaredTempo. A file that does carry the right
    // tempo scales by 1 and is untouched.
    const tempo = firstTempo(midi);
    const scale = setup.bpm ? tempo / setup.bpm : 1;

    if (setup.bpm && Math.abs(tempo - setup.bpm) > 0.01) {
      // 120 means "the file said nothing" as often as it means "the file said
      // 120", and the two are indistinguishable from here. So it is reported
      // as the routine re-timing it almost always is, while any *other*
      // disagreement is a real conflict between two things that both claim to
      // know the tempo, and says so.
      const line = `${file}: ${tempo.toFixed(1)} bpm in the file, ` +
                   `${setup.bpm} in song.setup`;
      if (Math.abs(tempo - STANDARD_MIDI_BPM) < 0.01) score.retimed.push(line);
      else score.warnings.push(line + " - one of them is wrong");
    }

    for (const track of midi.tracks) {
      for (const note of track.notes) {
        const base = {
          time: note.time * scale,
          duration: note.duration * scale,
          velocity: note.velocity
        };

        if (voice === "drums") {
          // The pitch class, so any octave works.
          const drum = DRUM_PITCH_CLASSES[((note.midi % 12) + 12) % 12];
          if (!drum) { score.counts.ignored++; continue; }
          score.drums.push({ ...base, drum, midi: note.midi });
          score.counts[drum]++;
        } else if (voice === "pads") {
          score.pads.push({ ...base, midi: note.midi });
          score.counts.pads++;
        } else {
          score.basskeys.push({ ...base, midi: note.midi, voice });
          score.counts[voice]++;
        }
      }
    }
  }

  return finishScore(score);
}

// Push every note later by `seconds`, so there is a beat of silence before
// the first hit. Times are shifted once, here, rather than being offset at
// every point of use - the audio and the visuals then share one timeline.
function shiftScore(score, seconds) {
  for (const list of [score.drums, score.pads, score.basskeys]) {
    for (const note of list) note.time += seconds;
  }
  score.duration += seconds;
  score.countIn = seconds;
  return score;
}

// Put an audible count-in on the front: "one, two, three, four" on the hi-hat,
// at the song's own tempo, with the whole piece pushed back to make room.
//
// The ticks are real notes in score.drums, not a special case bolted on beside
// it. That is the point - they go down the same pipe as everything else, so
// they are heard by the audio, drawn by the visuals, and paused and restarted
// with the song, without a single one of those three having to know that a
// count-in is a thing that exists.
//
// Hi-hat, because it is the one drum with no falling box and no micro:bit
// message behind it: the count is heard and seen, no hardware fires, and there
// is nothing for the player to try to hit.
//
// Call this on a copy. It mutates the score, and score.counts is deliberately
// left alone so the ticks never show up in the note counts on a song card -
// those describe the song, and four of them are not part of it.
function addCountIn(score, beats, lead) {
  const count = beats === undefined ? COUNT_IN_BEATS : beats;
  const silence = lead === undefined ? COUNT_IN_LEAD_SECONDS : lead;
  const perBeat = 60 / (score.bpm || 120);

  shiftScore(score, silence + count * perBeat);

  // The tick times, kept where the drawing can find them. The numbers on
  // screen are then driven off the very same list the sound is, so what you
  // see and what you hear are one event and there is no second clock to
  // drift.
  score.countInAt = [];

  for (let i = 0; i < count; i++) {
    score.countInAt.push(silence + i * perBeat);
    score.drums.push({
      time: silence + i * perBeat,
      duration: 0.12,
      // The "one" is accented, so it is a count and not four identical ticks.
      velocity: i === 0 ? 1.0 : 0.7,
      drum: "hihat",
      midi: 42,              // GM Closed Hi-Hat, as in DRUM_NOTES
      countIn: true          // so a tick can be told from a note of the song
    });
  }
  // Everything downstream walks the drums with a cursor and trusts the order.
  score.drums.sort((a, b) => a.time - b.time);

  score.countIn = silence + count * perBeat;
  return score;
}
