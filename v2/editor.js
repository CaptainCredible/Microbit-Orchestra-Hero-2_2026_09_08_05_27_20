// A step editor for making type 0 MIDI files.
//
// A song is a list of pages. Each page has its own length and its own notes,
// and they play one after another, so a piece is built as an arrangement
// rather than one long grid.
//
// Cells are keyed by pitch, not by row position. That is what lets a section
// be scrolled to reach higher or lower notes without the notes already
// written moving with the view.

const STEPS_PER_BAR = 16;

// Importing has to pick a page length. Four bars is what the rest of the
// editor defaults to, so an imported song is cut into four-bar pages.
const IMPORT_BARS_PER_PAGE = 4;
const IMPORT_MAX_PAGES = 64;                 // 256 bars, ~9 minutes at 110bpm

// The three drum rows an imported hit is folded onto. A file may use any of
// the GM numbers in DRUM_NOTES; the editor only has these three rows.
const EDITOR_DRUM_MIDI = { kick: 36, snare: 38, hihat: 42 };

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10]
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

// The melodic sections, top to bottom. `base` is the lowest pitch shown
// before any scrolling; `count` is how many rows the section gets.
const EDITOR_SECTIONS = [
  { id: "keys", label: "KEYS", base: 60, count: 10, channel: 1, colour: "keys" },
  { id: "bass", label: "BASS", base: 33, count: 8,  channel: 1, colour: "bass" },
  { id: "pads", label: "PADS", base: 45, count: 12, channel: 0, colour: "pads" }
];

const Editor = {
  bpm: 110,
  root: 57,               // A3
  scaleName: "minor",

  pages: [],
  index: 0,
  clipboard: null,

  // Per section, in scale degrees. Scroll moves the view only; transposing
  // moves the notes themselves, so it needs no stored offset.
  scroll: { keys: 0, bass: 0, pads: 0 },

  // Set whenever the song changes, so playback can pick the edit up.
  dirty: true,

  status: "",             // one line of feedback, drawn in the header

  rows: [],
  controls: [],           // canvas buttons, rebuilt every frame it draws
  painting: null,         // true = adding, false = erasing, while dragging
  paintingRow: null,      // the row a drag is locked to, so it cannot spill
                           // onto a neighbouring lane if the mouse drifts
  playing: false,
  loopMode: "advance",    // "advance" = play through every page in order and
                           // wrap at the end; "page" = loop the current page
  name: "my-song",

  init() {
    this.pages = [this.blankPage(4)];
    this.index = 0;
    this.status = "";
    this.buildRows();
    this.loadDemo();
  },

  blankPage(bars) {
    return { bars: bars || 4, cells: new Set() };
  },

  get page() { return this.pages[this.index]; },
  get cells() { return this.page.cells; },

  get bars() { return this.page.bars; },
  set bars(n) { this.page.bars = Math.max(1, Math.min(8, n)); this.dirty = true; },

  get totalSteps() { return this.page.bars * STEPS_PER_BAR; },
  get secondsPerStep() { return (60 / this.bpm) / 4; },

  get songSteps() {
    return this.pages.reduce((sum, p) => sum + p.bars * STEPS_PER_BAR, 0);
  },
  get songSeconds() { return this.songSteps * this.secondsPerStep; },

  // Step at which a page starts, counting from the beginning of the song.
  pageStartStep(index) {
    let steps = 0;
    for (let i = 0; i < index; i++) steps += this.pages[i].bars * STEPS_PER_BAR;
    return steps;
  },

  //////////////////////////////////////////////////////////////////
  // Pages
  //////////////////////////////////////////////////////////////////

  addPage() {
    this.pages.splice(this.index + 1, 0, this.blankPage(this.bars));
    this.index++;
    this.dirty = true;
  },

  removePage() {
    if (this.pages.length === 1) { this.cells.clear(); this.dirty = true; return; }
    this.pages.splice(this.index, 1);
    this.index = Math.min(this.index, this.pages.length - 1);
    this.dirty = true;
  },

  copyPage() {
    this.clipboard = { bars: this.page.bars, cells: new Set(this.cells) };
  },

  // Pastes over the current page rather than inserting, so copy/paste is a
  // way of duplicating a section into a page you have already made room for.
  pastePage() {
    if (!this.clipboard) return;
    this.pages[this.index] = {
      bars: this.clipboard.bars,
      cells: new Set(this.clipboard.cells)
    };
    this.dirty = true;
  },

  gotoPage(i) {
    this.index = Math.max(0, Math.min(this.pages.length - 1, i));
  },

  //////////////////////////////////////////////////////////////////
  // Rows
  //////////////////////////////////////////////////////////////////

  // Pitches are addressed by scale degree counted from the song's root, not
  // from wherever a section happens to start. Building them from the section
  // base instead put the rows in that base's key: a section starting on C
  // came out as C minor while everything else was in A minor.
  pitchByDegree(scale, degree) {
    const n = scale.length;
    const octave = Math.floor(degree / n);
    const idx = ((degree % n) + n) % n;
    return this.root + octave * 12 + scale[idx];
  },

  // The degree a pitch sits on. Pitches always come from the grid, so they
  // are in the scale; anything else is snapped down to the degree below it.
  degreeOfPitch(scale, midi) {
    const rel = midi - this.root;
    const octave = Math.floor(rel / 12);
    const pc = rel - octave * 12;
    let idx = scale.indexOf(pc);
    if (idx < 0) {
      idx = 0;
      for (let i = 0; i < scale.length; i++) if (scale[i] <= pc) idx = i;
    }
    return octave * scale.length + idx;
  },

  // Which section a stored note belongs to, by the same rule playback uses:
  // channel first, then the bass/keys split by pitch.
  sectionOfNote(channel, midi) {
    if (channel === 9) return "drums";
    if (channel === PAD_CH) return "pads";
    return midi < BASS_KEYS_SPLIT ? "bass" : "keys";
  },

  // The first degree whose pitch is at or above `base`.
  degreeAtOrAbove(scale, base) {
    let degree = (Math.floor((base - this.root) / 12) - 1) * scale.length;
    while (this.pitchByDegree(scale, degree) < base) degree++;
    return degree;
  },

  // Rebuilt whenever the scale, root or a section's scroll changes.
  buildRows() {
    const scale = SCALES[this.scaleName];
    const rows = [
      { kind: "drum", section: "drums", id: "kick",  label: "KICK",  midi: 36, channel: 9, colour: COLORS.kick },
      { kind: "drum", section: "drums", id: "snare", label: "SNARE", midi: 38, channel: 9, colour: COLORS.snare },
      { kind: "drum", section: "drums", id: "hihat", label: "HIHAT", midi: 42, channel: 9, colour: COLORS.hihat }
    ];

    for (const spec of EDITOR_SECTIONS) {
      // Scrolling moves the window one scale degree at a time, so the rows
      // stay in key however far you travel.
      const first = this.degreeAtOrAbove(scale, spec.base) + this.scroll[spec.id];
      const pitches = [];
      for (let i = 0; i < spec.count; i++) pitches.push(this.pitchByDegree(scale, first + i));
      // highest at the top, the way a piano roll reads
      for (const midi of pitches.slice().reverse()) {
        rows.push({
          kind: "melodic", section: spec.id, label: noteName(midi),
          midi, channel: spec.channel, colour: COLORS[spec.colour]
        });
      }
    }
    this.rows = rows;
  },

  scrollSection(id, steps) {
    this.scroll[id] += steps;
    this.buildRows();
  },

  // Moves the notes of one section on the current page up or down a scale
  // degree - the notes themselves change pitch, they are not merely played
  // back shifted. Degrees rather than semitones because the grid is scale
  // locked: a semitone step would land a note on a pitch that has no row and
  // make it invisible.
  transposeSection(id, degrees) {
    const scale = SCALES[this.scaleName];
    const moved = new Set();

    for (const cellKey of this.cells) {
      const parts = cellKey.split(":");
      const channel = Number(parts[0]), midi = Number(parts[1]), step = parts[2];

      if (this.sectionOfNote(channel, midi) !== id) { moved.add(cellKey); continue; }

      const pitch = this.pitchByDegree(scale, this.degreeOfPitch(scale, midi) + degrees);
      if (pitch < 0 || pitch > 127) { moved.add(cellKey); continue; }
      moved.add(channel + ":" + pitch + ":" + step);
    }

    this.page.cells = moved;
    this.dirty = true;
  },

  // Empties one part on the current page. `id` is a drum row ("kick",
  // "snare", "hihat") or a melodic section ("bass", "keys", "pads"). It works
  // on the stored notes, so notes scrolled out of view are cleared too.
  clearPart(id) {
    const drumRow = this.rows.find(r => r.kind === "drum" && r.id === id);
    const kept = new Set();

    for (const cellKey of this.cells) {
      const parts = cellKey.split(":");
      const channel = Number(parts[0]), midi = Number(parts[1]);
      const mine = drumRow
        ? (channel === drumRow.channel && midi === drumRow.midi)
        : this.sectionOfNote(channel, midi) === id;
      if (!mine) kept.add(cellKey);
    }

    this.page.cells = kept;
    this.dirty = true;
  },

  // Something on the grid at startup, so it is obvious what the editor does.
  loadDemo() {
    this.cells.clear();
    const kick = this.rows[0], snare = this.rows[1], hat = this.rows[2];
    for (let s = 0; s < this.totalSteps; s += 4) this.set(kick, s, true);
    for (let s = 4; s < this.totalSteps; s += 8) this.set(snare, s, true);
    for (let s = 2; s < this.totalSteps; s += 4) this.set(hat, s, true);
  },

  //////////////////////////////////////////////////////////////////
  // Cells, keyed by pitch so scrolling never moves a note
  //////////////////////////////////////////////////////////////////

  key(row, step) { return row.channel + ":" + row.midi + ":" + step; },
  has(row, step) { return this.cells.has(this.key(row, step)); },
  set(row, step, on) {
    if (on) this.cells.add(this.key(row, step));
    else this.cells.delete(this.key(row, step));
    this.dirty = true;
  },

  //////////////////////////////////////////////////////////////////
  // Import
  //////////////////////////////////////////////////////////////////

  // The root and scale that cover the most of a file's melodic material.
  // The grid only has rows for notes in the scale, so a file imported into
  // the wrong key would have half of it snapped to the wrong pitches.
  detectKey(midis) {
    if (!midis.length) return { root: this.root, scaleName: this.scaleName };

    const weight = new Array(12).fill(0);
    for (const midi of midis) weight[((midi % 12) + 12) % 12]++;

    // Minor first so that a tie goes to the key the rest of the app is
    // written in. Relative major and minor cover exactly the same pitches,
    // so between those two the choice is only a label anyway.
    let best = null;
    for (const scaleName of ["minor", "major", "dorian", "pentatonic"]) {
      const scale = SCALES[scaleName];
      for (let pc = 0; pc < 12; pc++) {
        let covered = 0;
        for (const degree of scale) covered += weight[(pc + degree) % 12];
        if (!best || covered > best.covered) best = { covered, pc, scaleName };
      }
    }
    return { root: 48 + best.pc, scaleName: best.scaleName };
  },

  // The nearest pitch that actually has a row, so an imported note is always
  // visible and editable. Ties go to the lower pitch.
  snapToScale(scale, midi) {
    const below = this.pitchByDegree(scale, this.degreeOfPitch(scale, midi));
    const above = this.pitchByDegree(scale, this.degreeOfPitch(scale, midi) + 1);
    const pick = (midi - below) <= (above - midi) ? below : above;
    return Math.max(0, Math.min(127, pick));
  },

  // Scrolls each section so the notes that landed in it are on screen. An
  // import that leaves the view somewhere else looks like it did nothing.
  focusSections(scale, placed) {
    for (const spec of EDITOR_SECTIONS) {
      const base = this.degreeAtOrAbove(scale, spec.base);
      let lo = Infinity, hi = -Infinity;

      for (const item of placed) {
        if (this.sectionOfNote(item.channel, item.midi) !== spec.id) continue;
        const degree = this.degreeOfPitch(scale, item.midi);
        if (degree < lo) lo = degree;
        if (degree > hi) hi = degree;
      }

      if (lo === Infinity) { this.scroll[spec.id] = 0; continue; }
      // Show from the lowest note up when the material fits in the window,
      // otherwise centre on it and let the ends scroll into view.
      const first = (hi - lo < spec.count)
        ? lo
        : Math.round((lo + hi - spec.count) / 2);
      this.scroll[spec.id] = first - base;
    }
  },

  /**
   * Replace the whole song with a classified score.
   *
   * The score arrives with times in seconds; the editor is a step grid in one
   * key at one tempo, so importing quantises to 16ths, folds the drums onto
   * the three rows the editor has, snaps melodic notes into the detected
   * scale, and cuts the result into fixed-length pages.
   *
   * @param {Object} score from scoreFromArrayBuffer
   * @returns {Object} what it had to do, for reporting back
   */
  importScore(score) {
    const bpm = Math.max(40, Math.min(220, Math.round(score.bpm || 120)));
    const melodic = score.pads.concat(score.basskeys);

    const detected = this.detectKey(melodic.map(n => n.midi));
    this.bpm = bpm;
    this.root = detected.root;
    this.scaleName = detected.scaleName;
    this.buildRows();

    const scale = SCALES[this.scaleName];
    const sps = this.secondsPerStep;
    const placed = [];
    let snapped = 0;

    for (const note of score.drums) {
      const midi = EDITOR_DRUM_MIDI[note.drum];
      if (midi === undefined) continue;
      placed.push({
        channel: DRUM_CH, midi,
        step: Math.max(0, Math.round(note.time / sps)),
        length: 1                       // drums are single hits, never tied
      });
    }

    const addMelodic = (note, channel) => {
      const midi = this.snapToScale(scale, note.midi);
      if (midi !== note.midi) snapped++;
      placed.push({
        channel, midi,
        step: Math.max(0, Math.round(note.time / sps)),
        length: Math.max(1, Math.round(note.duration / sps))
      });
    };
    for (const note of score.pads) addMelodic(note, PAD_CH);
    for (const note of score.basskeys) addMelodic(note, BASSKEYS_CH);

    // Long enough to hold the last note, rounded out to whole bars.
    let endStep = 0;
    for (const item of placed) endStep = Math.max(endStep, item.step + item.length);
    const pageSteps = IMPORT_BARS_PER_PAGE * STEPS_PER_BAR;
    let pageCount = Math.max(1, Math.ceil(endStep / pageSteps));
    const truncated = pageCount > IMPORT_MAX_PAGES;
    if (truncated) pageCount = IMPORT_MAX_PAGES;
    const limit = pageCount * pageSteps;

    this.pages = [];
    for (let i = 0; i < pageCount; i++) this.pages.push(this.blankPage(IMPORT_BARS_PER_PAGE));
    this.index = 0;

    let dropped = 0;
    for (const item of placed) {
      if (item.step >= limit) { dropped++; continue; }
      for (let k = 0; k < item.length; k++) {
        const abs = item.step + k;
        if (abs >= limit) break;
        const pageIndex = Math.floor(abs / pageSteps);
        this.pages[pageIndex].cells.add(
          item.channel + ":" + item.midi + ":" + (abs - pageIndex * pageSteps));
      }
    }

    this.focusSections(scale, placed);
    this.buildRows();
    this.name = String(score.name || "imported")
      .replace(/[^A-Za-z0-9 _-]/g, "").trim() || "imported";
    this.dirty = true;

    return {
      notes: placed.length, dropped, snapped, truncated,
      pages: pageCount, bpm,
      root: noteName(this.root), scaleName: this.scaleName
    };
  },

  //////////////////////////////////////////////////////////////////
  // Export
  //////////////////////////////////////////////////////////////////

  // Pages are laid end to end on one timeline. Drum cells are separate hits;
  // melodic cells that sit next to each other become one long note, and that
  // includes across a page boundary - a pad drawn to the end of one page and
  // on into the next is one held note, not two. Collecting page by page
  // instead retriggered every long note at each boundary, which importing a
  // file with sustained pads made very audible.
  toSong() {
    const notes = [];
    const sps = this.secondsPerStep;

    // The voices come from the stored cells, never from this.rows. Walking
    // the rows meant only what was on screen was exported, so a note that had
    // been scrolled out of view was silently dropped from the song.
    const voices = new Map();

    this.pages.forEach((page, pageIndex) => {
      const startStep = this.pageStartStep(pageIndex);
      const steps = page.bars * STEPS_PER_BAR;

      for (const cellKey of page.cells) {
        const parts = cellKey.split(":");
        const channel = Number(parts[0]);
        const midi = Number(parts[1]);
        const step = Number(parts[2]);
        if (step < 0 || step >= steps) continue;   // left over from a longer page

        const id = channel + ":" + midi;
        let voice = voices.get(id);
        if (!voice) { voice = { channel, midi, steps: [] }; voices.set(id, voice); }
        voice.steps.push(startStep + step);
      }
    });

    for (const voice of voices.values()) {
      const { channel, midi } = voice;

      if (channel === DRUM_CH) {
        for (const step of voice.steps) {
          notes.push({ midi, channel, time: step * sps, duration: 0.12, velocity: 0.9 });
        }
        continue;
      }

      const steps = voice.steps.sort((a, b) => a - b);
      let i = 0;
      while (i < steps.length) {
        let run = 1;
        while (i + run < steps.length && steps[i + run] === steps[i] + run) run++;
        notes.push({
          midi, channel,
          time: steps[i] * sps,
          duration: run * sps * 0.98, velocity: 0.75
        });
        i += run;
      }
    }

    notes.sort((a, b) => a.time - b.time);
    return { id: "editor", name: this.name, bpm: this.bpm, notes };
  },

  download() {
    downloadType0(this.toSong(), this.name + ".mid");
  },

  //////////////////////////////////////////////////////////////////
  // Playback position
  //////////////////////////////////////////////////////////////////

  // Where the transport is, as a page and a step inside it.
  playhead() {
    if (!this.playing || !AudioEngine.started) return null;
    const total = this.songSteps;
    if (!total) return null;

    const step = (Tone.getTransport().seconds / this.secondsPerStep) % total;
    let acc = 0;
    for (let i = 0; i < this.pages.length; i++) {
      const len = this.pages[i].bars * STEPS_PER_BAR;
      if (step < acc + len) return { page: i, step: step - acc };
      acc += len;
    }
    return null;
  },

  //////////////////////////////////////////////////////////////////
  // Layout
  //////////////////////////////////////////////////////////////////

  geo() {
    const labelW = 176;
    const top = 150;
    const bottom = height - 108;   // clear of the two button rows
    const gridW = width - labelW - 28;
    const rowH = Math.max(10, Math.min(19, (bottom - top) / this.rows.length));
    return {
      labelW, top, gridW, rowH,
      stepW: gridW / this.totalSteps,
      x0: labelW + 14
    };
  },

  cellAt(mx, my) {
    const g = this.geo();
    if (mx < g.x0 || mx > g.x0 + g.gridW || my < g.top) return null;
    const row = Math.floor((my - g.top) / g.rowH);
    const step = Math.floor((mx - g.x0) / g.stepW);
    if (row < 0 || row >= this.rows.length) return null;
    if (step < 0 || step >= this.totalSteps) return null;
    return { row: this.rows[row], step };
  },

  // The little scroll, transpose and clear buttons drawn in the gutter. Each
  // drum row gets its own clear, because kick, snare and hihat are separate
  // parts; the melodic sections get the whole set beside their first row.
  buildControls() {
    const g = this.geo();
    this.controls = [];
    let lastSection = null;

    this.rows.forEach((row, i) => {
      const y = g.top + i * g.rowH;
      const h = Math.min(15, g.rowH);
      const add = (x, w, action, glyph, part) =>
        this.controls.push({
          x, y, w, h, action, glyph, part,
          section: row.section, colour: row.colour
        });

      if (row.kind === "drum") {
        add(120, 15, "clear", "×", row.id);
        return;
      }

      if (row.section === lastSection) return;
      lastSection = row.section;

      // section name 6..38, buttons, then the pitch label right-aligned at
      // the gutter edge
      add(44,  15, "scrollUp",   "▲");
      add(61,  15, "scrollDown", "▼");
      add(83,  15, "transDown",  "−");
      add(100, 15, "transUp",    "+");
      add(120, 15, "clear",      "×", row.section);
    });
    return this.controls;
  },

  controlAt(mx, my) {
    for (const c of this.controls) {
      if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) return c;
    }
    return null;
  },

  //////////////////////////////////////////////////////////////////
  // Input
  //////////////////////////////////////////////////////////////////

  // True when `step` is filled and the step before it is not - the leftmost
  // cell of a held note, or of a single hit. Only melodic rows tie; a drum
  // row's steps are independent hits even sitting next to each other, so it
  // has no "head" to speak of.
  isRunHead(row, step) {
    return row.kind !== "drum" && this.has(row, step) && !this.has(row, step - 1);
  },

  // Erases every step of the run starting at `step`, not just that one cell -
  // clicking the head of a held note picks the whole thing up, the same way
  // you would not expect to be able to chip a single frame off one long note.
  eraseRun(row, step) {
    let s = step;
    while (this.has(row, s)) { this.set(row, s, false); s++; }
  },

  mousePressed(mx, my) {
    const control = this.controlAt(mx, my);
    if (control) {
      if (control.action === "scrollUp") this.scrollSection(control.section, 1);
      if (control.action === "scrollDown") this.scrollSection(control.section, -1);
      if (control.action === "transUp") this.transposeSection(control.section, 1);
      if (control.action === "transDown") this.transposeSection(control.section, -1);
      if (control.action === "clear") this.clearPart(control.part);
      return true;
    }

    const cell = this.cellAt(mx, my);
    if (!cell) return false;
    this.paintingRow = cell.row;   // a drag stays on this row, however the

    if (this.isRunHead(cell.row, cell.step)) {
      this.eraseRun(cell.row, cell.step);
      this.painting = false;
      return true;
    }

    // The first cell decides whether this drag paints or erases.
    this.painting = !this.has(cell.row, cell.step);
    this.set(cell.row, cell.step, this.painting);
    if (this.painting) this.previewNote(cell.row);
    return true;
  },

  // Locked to the row the drag started on and driven by the mouse's x only,
  // so a hand that drifts up or down while holding a long note does not spill
  // it onto a neighbouring lane. Only the click that starts a drag previews a
  // sound - retriggering on every step painted would turn one held note into
  // a machine-gun roll instead of the single note it is meant to be.
  mouseDragged(mx, my) {
    if (this.painting === null || !this.paintingRow) return;
    const g = this.geo();
    if (mx < g.x0 || mx > g.x0 + g.gridW) return;
    const step = Math.floor((mx - g.x0) / g.stepW);
    if (step < 0 || step >= this.totalSteps) return;
    this.set(this.paintingRow, step, this.painting);
  },

  mouseReleased() { this.painting = null; this.paintingRow = null; },

  // Plays whatever a row would sound like in the real arrangement, so
  // placing a note tells you straight away whether it is the right one.
  // AudioEngine starts on demand, the same way picking a song does; the note
  // is fired once it is ready rather than dropped if it was not already
  // running, which it usually is not on a fresh visit to the editor.
  previewNote(row) {
    if (typeof AudioEngine === "undefined") return;
    const fire = () => {
      if (row.kind === "drum") { AudioEngine.drum(row.id, Tone.now(), 0.9); return; }
      const now = Tone.now();
      if (row.section === "pads") AudioEngine.pad(row.midi, EDITOR_PREVIEW_DURATION, now, 0.6);
      else if (row.section === "bass") AudioEngine.bassNote(row.midi, EDITOR_PREVIEW_DURATION, now, 0.8);
      else AudioEngine.keysNote(row.midi, EDITOR_PREVIEW_DURATION, now, 0.75);
    };
    if (AudioEngine.started) fire();
    else AudioEngine.start().then(fire).catch(() => {});
  },

  // Which row, if any, sits under this y - used by the scroll wheel, which
  // scrolls whichever lane the mouse happens to be over rather than needing
  // the little on-screen arrows. x does not matter: a lane reads as spanning
  // the full width of the page, gutter included.
  rowAt(my) {
    const g = this.geo();
    if (my < g.top || my >= g.top + this.rows.length * g.rowH) return null;
    return this.rows[Math.floor((my - g.top) / g.rowH)];
  },

  // Scrolls the section under `my` by one scale degree, the same amount the
  // ▲▼ buttons move it. Drum rows do not scroll - there is nothing behind
  // them to reveal - so this quietly does nothing over one of those.
  scrollAt(my, direction) {
    const row = this.rowAt(my);
    if (!row || row.kind === "drum") return false;
    this.scrollSection(row.section, direction);
    return true;
  },

  //////////////////////////////////////////////////////////////////
  // Drawing
  //////////////////////////////////////////////////////////////////

  draw() {
    const g = this.geo();
    background(COLORS.bg[0], COLORS.bg[1], COLORS.bg[2]);

    // While playing, follow the transport from page to page.
    const head = this.playhead();
    if (head && head.page !== this.index) this.index = head.page;

    this.drawHeader();
    this.drawGrid(g);
    this.drawGutter(g);
    if (head && head.page === this.index) this.drawPlayhead(g, head.step);
  },

  drawHeader() {
    push();
    noStroke();
    fill(COLORS.text);
    textSize(24);
    textAlign(LEFT, TOP);
    text("MIDI EDITOR", 24, 22);

    textSize(12);
    fill(COLORS.dim);
    text("click and drag to draw  ·  melodic cells side by side become one held note  ·  " +
         "drop a .mid file to import",
      24, 54);

    if (this.status) {
      textAlign(RIGHT, TOP);
      fill(COLORS.text);
      text(this.status, width - 24, 26);
      textAlign(LEFT, TOP);
      fill(COLORS.dim);
      textSize(12);
    }
    text(`${this.bpm} bpm  ·  ${this.scaleName}  ·  root ${noteName(this.root)}  ·  exports as type 0`,
      24, 72);

    // Page strip, so the whole arrangement is visible at a glance.
    const x0 = 24, y = 100, w = 34, h = 20;
    textSize(10);
    for (let i = 0; i < this.pages.length; i++) {
      const x = x0 + i * (w + 5);
      const current = i === this.index;
      fill(current ? COLORS.kick[0] : 255,
           current ? COLORS.kick[1] : 255,
           current ? COLORS.kick[2] : 255, current ? 230 : 26);
      rect(x, y, w, h, 4);
      fill(current ? 255 : COLORS.dim);
      textAlign(CENTER, CENTER);
      text(`${i + 1}·${this.pages[i].bars}`, x + w / 2, y + h / 2);
    }
    textAlign(LEFT, CENTER);
    fill(COLORS.dim);
    text(`page ${this.index + 1} of ${this.pages.length}  ·  ${this.bars} bars  ·  ` +
         `song ${this.songSeconds.toFixed(1)}s`,
      x0 + this.pages.length * (w + 5) + 10, y + h / 2);
    pop();
  },

  drawGrid(g) {
    push();
    noStroke();

    // Alternate bar shading
    for (let bar = 0; bar < this.bars; bar++) {
      if (bar % 2 === 0) continue;
      fill(255, 255, 255, 8);
      rect(g.x0 + bar * STEPS_PER_BAR * g.stepW, g.top,
        STEPS_PER_BAR * g.stepW, this.rows.length * g.rowH);
    }

    // Empty grid first, so the notes can be drawn over it as whole shapes.
    this.rows.forEach((row, rowIndex) => {
      const y = g.top + rowIndex * g.rowH;
      for (let step = 0; step < this.totalSteps; step++) {
        fill(255, 255, 255, step % 4 === 0 ? 22 : 10);
        rect(g.x0 + step * g.stepW + 1, y + 1, g.stepW - 2, g.rowH - 2, 2);
      }
    });

    // Notes. A melodic run is one held note, so it is drawn as one bar
    // rather than a row of separate blocks - dragging across four steps has
    // to look like the single long note it becomes.
    this.rows.forEach((row, rowIndex) => {
      const y = g.top + rowIndex * g.rowH;

      if (row.kind === "drum") {
        for (let step = 0; step < this.totalSteps; step++) {
          if (!this.has(row, step)) continue;
          fill(row.colour[0], row.colour[1], row.colour[2], 235);
          rect(g.x0 + step * g.stepW + 1, y + 1, g.stepW - 2, g.rowH - 2, 2);
        }
        return;
      }

      let step = 0;
      while (step < this.totalSteps) {
        if (!this.has(row, step)) { step++; continue; }
        let run = 1;
        while (step + run < this.totalSteps && this.has(row, step + run)) run++;

        const x = g.x0 + step * g.stepW;
        const w = run * g.stepW - 2;
        fill(row.colour[0], row.colour[1], row.colour[2], 235);
        rect(x + 1, y + 1, w, g.rowH - 2, 3);

        // A brighter head, so where a held note is struck stays readable.
        fill(255, 255, 255, 70);
        rect(x + 1, y + 1, Math.min(3, g.stepW * 0.35), g.rowH - 2, 2);

        step += run;
      }
    });
    pop();
  },

  drawGutter(g) {
    const controls = this.buildControls();
    let lastSection = null;

    push();
    this.rows.forEach((row, rowIndex) => {
      const y = g.top + rowIndex * g.rowH;

      if (row.section !== lastSection) {
        lastSection = row.section;
        noStroke();
        fill(COLORS.text);
        textSize(9);
        textAlign(LEFT, CENTER);
        text(row.kind === "drum" ? "DRUMS" : row.section.toUpperCase(),
          6, y + g.rowH / 2);

        stroke(255, 255, 255, 34);
        strokeWeight(1);
        line(g.x0, y, g.x0 + g.gridW, y);
        noStroke();
      }

      // Every row names its own pitch, so you can see what you are clicking.
      fill(row.colour[0] + 70, row.colour[1] + 70, row.colour[2] + 70, 225);
      textSize(9);
      textAlign(RIGHT, CENTER);
      text(row.label, g.labelW, y + g.rowH / 2);
    });

    // Section buttons. The scroll pair is grey because it only moves the
    // view; the transpose and clear buttons take the part's colour because
    // they change the notes.
    textAlign(CENTER, CENTER);
    noStroke();
    for (const c of controls) {
      const moves = c.action !== "scrollUp" && c.action !== "scrollDown";
      const colour = moves ? c.colour : null;

      if (colour) fill(colour[0], colour[1], colour[2], 90);
      else fill(255, 255, 255, 26);
      rect(c.x, c.y, c.w, c.h, 3);

      fill(COLORS.text);
      textSize(moves ? 11 : 8);
      text(c.glyph, c.x + c.w / 2, c.y + c.h / 2);
    }
    pop();
  },

  drawPlayhead(g, step) {
    push();
    stroke(255, 255, 255, 200);
    strokeWeight(2);
    const x = g.x0 + step * g.stepW;
    line(x, g.top, x, g.top + this.rows.length * g.rowH);
    pop();
  }
};
