// Built-in songs for the stage select.
//
// These are written as step patterns and expanded into plain note lists at
// load time. The same data is what generated the .mid files in songs/ - so
// the stage select works whether or not it can reach the filesystem.
//
// Step strings are 16 steps to the bar:  x = hit, X = accent, . = rest

const DRUM_MIDI = { kick: 36, snare: 38, hihat: 42 };
const DRUM_CH = 9, PAD_CH = 0, BASSKEYS_CH = 1;

// Expand "x...x..." into notes. `bars` repeats the pattern.
function steps(pattern, drum, bpm, bars, startBar) {
  const secondsPerStep = (60 / bpm) / 4; // 16ths
  const notes = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "." || c === " ") continue;
      notes.push({
        midi: DRUM_MIDI[drum],
        channel: DRUM_CH,
        time: ((startBar + bar) * pattern.length + i) * secondsPerStep,
        duration: 0.12,
        velocity: c === "X" ? 1.0 : 0.75
      });
    }
  }
  return notes;
}

// A held chord, one note per pitch.
function chord(midis, bpm, startBar, bars, channel, velocity) {
  const barSeconds = (60 / bpm) * 4;
  return midis.map(m => ({
    midi: m,
    channel: channel,
    time: startBar * barSeconds,
    duration: bars * barSeconds * 0.98,
    velocity: velocity ?? 0.55
  }));
}

// A melodic line from [pitch, stepIndex, lengthInSteps] triples.
// Named melodyLine rather than line: p5 already puts a global line() on the
// window for drawing, and a bare function line() here would collide with it.
function melodyLine(events, bpm, startBar, channel, velocity) {
  const secondsPerStep = (60 / bpm) / 4;
  return events.map(([midi, step, len]) => ({
    midi,
    channel,
    time: (startBar * 16 + step) * secondsPerStep,
    duration: len * secondsPerStep * 0.9,
    velocity: velocity ?? 0.8
  }));
}

function buildSongs() {
  const songs = [];

  //////////////////////////////////////////////////////////////////
  // 1. CALIBRATION - kick and snare taking turns, one per beat.
  // Use this one to dial in the micro:bit offset slider.
  //
  // Alternating rather than a kick on every beat, because with every beat the
  // same an offset a whole beat out looks exactly as right as one that is
  // spot on - the eye matches the flash to the NEAREST note, not the right
  // one. A-B-A-B only repeats every two beats (1.2s at 100 bpm), well past
  // anything the slider can reach, so the only way it lines up is correctly.
  //
  // This is the fallback. What normally plays is songs/calibration/Drums.mid,
  // which holds the same pattern and has to be kept in step with it.
  //////////////////////////////////////////////////////////////////
  {
    const bpm = 100;
    songs.push({
      id: "calibration",
      // Not a song card any more - it has its own button on the menu, right
      // under "connect micro:bit" - but the id and the rest of the pipeline
      // (fetch -> parse -> score) stay the same, so it is still a real song
      // with a real score by the time the button can start it.
      name: "Calibrate",
      blurb: "A and B taking turns on the beat. Use it to dial in the offset slider.",
      bpm,
      notes: steps("X.......x.......", "kick", bpm, 16, 0)
        .concat(steps("....x.......x...", "snare", bpm, 16, 0))
    });
  }

  //////////////////////////////////////////////////////////////////
  // 2. FOUR ON THE FLOOR - the straightforward one.
  //////////////////////////////////////////////////////////////////
  {
    const bpm = 120;
    let notes = [];
    notes = notes.concat(
      steps("X...x...x...x...", "kick",  bpm, 16, 0),
      steps("....X.......X...", "snare", bpm, 14, 2),
      steps("..x...x...x...x.", "hihat", bpm, 16, 0)
    );
    // One progression for the whole song - a slow i - VI - III - VII in A
    // minor - two bars a chord, eight chords, sixteen bars. Pads, bass and
    // keys all walk it together and all three now start in bar 0; the pads
    // and the bass used to wait until bar 4, and there were no keys at all.
    //
    // Written as one table rather than three loops so a chord cannot be
    // changed in one voice and forgotten in another: the pad, the bass root
    // and the keys figure for a chord sit on the same line.
    const CHORDS = [
      { pad: [57, 60, 64], root: 33,   // Am
        keys: [[64, 0, 4], [67, 8, 4], [72, 16, 6], [69, 24, 6]] },
      { pad: [53, 57, 60], root: 29,   // F
        keys: [[65, 0, 4], [69, 8, 4], [72, 16, 6], [77, 24, 6]] },
      { pad: [48, 52, 55], root: 24,   // C
        keys: [[64, 0, 4], [67, 8, 4], [72, 16, 6], [76, 24, 6]] },
      { pad: [55, 59, 62], root: 31,   // G
        keys: [[62, 0, 4], [67, 8, 4], [71, 16, 6], [74, 24, 6]] }
    ];
    for (let i = 0; i < 8; i++) {
      const c = CHORDS[i % 4];
      const bar = i * 2;
      notes = notes.concat(chord(c.pad, bpm, bar, 2, PAD_CH, 0.5));
      // Bass, low enough to land on the bass voice
      notes = notes.concat(melodyLine(
        [[c.root, 0, 3], [c.root, 6, 2], [c.root + 7, 10, 2], [c.root, 14, 2]],
        bpm, bar, BASSKEYS_CH, 0.85
      ));
      // Keys, above BASS_KEYS_SPLIT so the same bus routes them to the bright
      // voice. Steps run 0..31 because the figure spans both bars of a chord.
      notes = notes.concat(melodyLine(c.keys, bpm, bar, BASSKEYS_CH, 0.6));
    }
    songs.push({
      id: "four-on-the-floor",
      name: "Four On The Floor",
      blurb: "120 bpm. Steady kick, backbeat snare, pads, bass and keys from bar one.",
      bpm, notes
    });
  }

  //////////////////////////////////////////////////////////////////
  // 3. BREAKBEAT - syncopated, to check the boxes read correctly
  // when kick and snare land close together.
  //////////////////////////////////////////////////////////////////
  {
    const bpm = 140;
    let notes = [];
    notes = notes.concat(
      steps("X.....x...X..x..", "kick",  bpm, 16, 0),
      steps("....X.......X.x.", "snare", bpm, 16, 0),
      steps("x.x.x.x.x.x.x.x.", "hihat", bpm, 16, 0)
    );
    // Keys, above the split so they play the bright voice
    for (let bar = 2; bar < 16; bar += 4) {
      notes = notes.concat(melodyLine(
        [[72, 0, 2], [75, 4, 2], [79, 8, 2], [77, 12, 4]],
        bpm, bar, BASSKEYS_CH, 0.7
      ));
    }
    notes = notes.concat(chord([50, 57, 62], bpm, 0, 8, PAD_CH, 0.4));
    notes = notes.concat(chord([48, 55, 60], bpm, 8, 8, PAD_CH, 0.4));
    songs.push({
      id: "breakbeat",
      name: "Breakbeat",
      blurb: "140 bpm. Syncopated - kick and snare collide, so you get X messages.",
      bpm, notes
    });
  }

  //////////////////////////////////////////////////////////////////
  // 4. SLOW MARCH - sparse, easy to watch a single box land.
  //////////////////////////////////////////////////////////////////
  {
    const bpm = 72;
    let notes = [];
    notes = notes.concat(
      steps("X.......x.......", "kick",  bpm, 12, 0),
      steps("........X.......", "snare", bpm, 12, 0),
      steps("....x.......x...", "hihat", bpm, 12, 0)
    );
    notes = notes.concat(chord([45, 48, 52, 55], bpm, 0, 6, PAD_CH, 0.45));
    notes = notes.concat(chord([43, 47, 50, 55], bpm, 6, 6, PAD_CH, 0.45));
    notes = notes.concat(melodyLine([[28, 0, 8], [28, 8, 8]], bpm, 2, BASSKEYS_CH, 0.9));
    notes = notes.concat(melodyLine([[26, 0, 8], [31, 8, 8]], bpm, 8, BASSKEYS_CH, 0.9));
    songs.push({
      id: "slow-march",
      name: "Slow March",
      blurb: "72 bpm. Sparse and slow - good for watching one box at a time.",
      bpm, notes
    });
  }

  return songs;
}

const BUILTIN_SONGS = buildSongs();

//////////////////////////////////////////////////////////////////////
// The ten second one, for testing
//
// Deliberately NOT part of buildSongs(): those are the fallback songs, used
// when nothing can be fetched, and this one has to be there on every path -
// the whole point is to reach the END screen and the highscore list without
// sitting through a song first.
//
// It only appears on the menu with DEBUG on (⌘⇧D), which songCards() decides,
// so it can be built every time without ever showing at a performance.
//
// Five bars at 120 bpm is 10.0 s, plus whatever the count-in adds.
//////////////////////////////////////////////////////////////////////

function buildQuickTest() {
  const bpm = 120;
  const bars = 5;
  return {
    id: "quick-test",
    name: "Quick Test",
    // Says on the card what it is, since a card nobody recognises on a menu is
    // its own small emergency.
    blurb: "10 seconds, then the scoreboard. Debug only - it is not on the menu with DEBUG off.",
    bpm,
    notes: [].concat(
      steps("X.......x.......", "kick",  bpm, bars, 0),
      steps("....x.......x...", "snare", bpm, bars, 0),
      steps("x.x.x.x.x.x.x.x.", "hihat", bpm, bars, 0)
    )
  };
}

const QUICK_TEST_SONG = buildQuickTest();
