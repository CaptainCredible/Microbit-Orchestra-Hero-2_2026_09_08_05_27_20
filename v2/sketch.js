// Microbit Orchestra Hero 2
//
// Reads a MIDI file, drops boxes down two lanes, explodes them on the hit
// line, plays the whole arrangement through Tone.js, and fires the same
// A / B / X messages at a micro:bit that the original version did.
//
//   kick  -> "A"      snare -> "B"      both at once -> "X"

let page = "STAGE_SELECT";   // STAGE_SELECT | GAME | PAUSE | END | EDITOR
let score = null;            // the score being played, count-in already applied
let currentSong = null;
let stageList = [];
let loadError = "";
let loading = false;

let ui = {};
let microbitCursor = 0;
let sentCount = 0;
let lastSent = "";
let dropHighlight = 0;
let songTimeNow = 0;   // shared with the 3D layer
let bodyFontReady = false;    // the body face has loaded and can be used
let titleFontReady = false;   // the display font has loaded and can be used

let titleLogo = null;         // the logo artwork, once it has loaded
let logoReady = false;
let logoAspect = 406.378 / 227.468;   // from the file; replaced once it loads
let logoMask = null;          // the artwork rasterised at the drawn size
let logoTint = null;          // scratch canvas the gradient is painted through
let hoveredCard = -1;
let hoveredInfo = -1;   // index of the card whose "i" icon the mouse is over, or -1

//////////////////////////////////////////////////////////////////////
// SETUP
//////////////////////////////////////////////////////////////////////

// The family to draw ordinary text in. A function rather than a constant
// because the face arrives asynchronously and can fail to arrive at all -
// Chrome refuses to load one over file:// - and every place that sets the
// font runs long after setup(), so each one asks again rather than caching an
// answer from before the file landed.
function bodyFont() {
  return bodyFontReady ? BODY_FONT_FAMILY : "monospace";
}

function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.addClass("main2d");
  textFont(bodyFont());

  // Ask for the display font up front, and only use it once it has actually
  // arrived. A canvas does not fetch a font by being asked to draw with it,
  // and Chrome will not load one over file:// at all, so the title has to be
  // able to fall back on its own.
  // The logo is a plain <img>; a canvas can draw one of those directly, and a
  // failure just leaves logoReady false and the text lockup in charge.
  titleLogo = new Image();
  titleLogo.onload = () => {
    if (titleLogo.naturalWidth && titleLogo.naturalHeight) {
      logoAspect = titleLogo.naturalWidth / titleLogo.naturalHeight;
    }
    logoMask = null;                 // any cached raster is the wrong size now
    logoReady = true;
  };
  titleLogo.onerror = () => { logoReady = false; };
  titleLogo.src = TITLE_LOGO_FILE;

  if (document.fonts && document.fonts.load) {
    const face = `${TITLE_SIZE}px "${TITLE_FONT_FAMILY}"`;
    document.fonts.load(face)
      .then(() => { titleFontReady = document.fonts.check(face); })
      .catch(() => { titleFontReady = false; });

    // Asked for separately: two different files, either of which can fail on
    // its own, so one flag cannot stand for both.
    const body = `16px "${BODY_FONT_FAMILY}"`;
    document.fonts.load(body)
      .then(() => { bodyFontReady = document.fonts.check(body); })
      .catch(() => { bodyFontReady = false; });
  }
  Editor.init();
  buildUI();
  applyPageUI();      // without this every page's controls show at once
  setupDragAndDrop();
  loadStageList();
  Ambient3D.init();
  SoundPanel.build();
  TimingDrawer.build(ui);
  Scoreboard.init();
  Scoreboard.build();
  // Anything submitted while the sheet was out of reach last time goes now.
  Scoreboard.startOutbox();
}

function buildUI() {
  // Pad cutoff and reverb used to live here. They are sound design, so they
  // are in the sound panel now; these two are rig calibration and go in the
  // timing drawer along the bottom.
  ui.microbitOffset = createSlider(
    MICROBIT_OFFSET_RANGE[0], MICROBIT_OFFSET_RANGE[1], DEFAULT_MICROBIT_OFFSET_MS, 1);
  ui.visualOffset = createSlider(-300, 300, DEFAULT_VISUAL_OFFSET_MS, 1);

  ui.connect = createButton("connect micro:bit").mousePressed(connectMicrobit);
  ui.disconnect = createButton("disconnect").mousePressed(disconnectMicrobit);
  // A dedicated button rather than a card in the song list, since it is not
  // something you play through so much as a tool you run before you do.
  ui.calibrate = createButton("calibrate timing").mousePressed(startCalibration);
  ui.resetScores = createButton("reset player scores").mousePressed(resetPlayerScores);
  ui.editor = createButton("open MIDI editor").mousePressed(() => setPage("EDITOR"));
  ui.hex = createA("https://makecode.microbit.org/_5F62ug11KMCc",
    "get the hex file for your micro:bit", "_blank");

  ui.back = createButton("back to songs").mousePressed(stopAndExit);
  ui.restart = createButton("restart").mousePressed(() => startSong(currentSong));
  ui.resume = createButton("resume").mousePressed(togglePause);

  // Editor controls, page row
  ui.edPrev = createButton("< page").mousePressed(() => editorGotoPage(-1));
  ui.edNext = createButton("page >").mousePressed(() => editorGotoPage(1));
  ui.edAddPage = createButton("add page").mousePressed(() => Editor.addPage());
  ui.edRemovePage = createButton("remove page").mousePressed(() => Editor.removePage());
  ui.edCopyPage = createButton("copy page").mousePressed(() => Editor.copyPage());
  ui.edPastePage = createButton("paste page").mousePressed(() => Editor.pastePage());
  ui.edBarsDown = createButton("bars -").mousePressed(() => { Editor.bars = Editor.bars - 1; });
  ui.edBarsUp = createButton("bars +").mousePressed(() => { Editor.bars = Editor.bars + 1; });

  // Editor controls, song row
  ui.edBpmDown = createButton("bpm -").mousePressed(() => { Editor.bpm = max(40, Editor.bpm - 5); Editor.dirty = true; });
  ui.edBpmUp = createButton("bpm +").mousePressed(() => { Editor.bpm = min(220, Editor.bpm + 5); Editor.dirty = true; });
  ui.edClear = createButton("clear page").mousePressed(() => { Editor.cells.clear(); Editor.dirty = true; });
  ui.edPlayPause = createButton("play").mousePressed(toggleEditorPlayback);
  ui.edLoopMode = createButton("mode: advance").mousePressed(toggleEditorLoopMode);
  ui.edImport = createButton("import .mid").mousePressed(importIntoEditor);
  ui.edDownload = createButton("download .mid").mousePressed(() => Editor.download());
  ui.edPlay = createButton("play this in the game").mousePressed(playEditorSong);
  ui.edBack = createButton("back to songs").mousePressed(() => { stopEditorPlayback(); setPage("STAGE_SELECT"); });

  // No font set here: style.css puts the body face on every button, so these
  // get it along with the ones the sound panel and the scoreboard build for
  // themselves. An inline family would beat the stylesheet and leave this
  // handful of buttons behind - which is exactly what it did.
  layoutUI();
}

// Positions the buttons that sit at fixed corners. The menu's own buttons
// follow the centred column and are placed by positionMenuButtons(); the two
// timing sliders live in the drawer and are laid out by CSS.
function layoutUI() {
  const pad = 22;

  ui.editor.position(width - 190, pad);

  ui.back.position(pad, pad);
  ui.restart.position(pad + 130, pad);
  ui.resume.position(pad + 220, pad);

  // Two rows, both clear of the drawer handle along the very bottom.
  const pageRow = height - 112;
  let x = pad;
  const place = (key, w) => { ui[key].position(x, pageRow); x += w; };
  place("edPrev", 78);
  place("edNext", 82);
  x += 14;
  place("edAddPage", 90);
  place("edRemovePage", 118);
  place("edCopyPage", 96);
  place("edPastePage", 100);
  x += 14;
  place("edBarsDown", 72);
  place("edBarsUp", 72);

  const songRow = height - 78;
  let sx = pad;
  const placeSong = (key, w) => { ui[key].position(sx, songRow); sx += w; };
  placeSong("edBpmDown", 70);
  placeSong("edBpmUp", 74);
  sx += 14;
  placeSong("edClear", 96);
  placeSong("edPlayPause", 70);
  placeSong("edLoopMode", 130);
  sx += 14;
  placeSong("edImport", 116);
  placeSong("edDownload", 130);
  placeSong("edPlay", 172);
  sx += 14;
  placeSong("edBack", 110);
}

// HUD text rows, measured up from the bottom edge. The bottom ~30px belong
// to the timing drawer handle, so nothing is drawn there.
const BAND = {
  microbitStatus: 96,
  songName: 74,
  transport: 46
};

// One place that decides which controls exist on which page.
const PAGE_UI = {
  STAGE_SELECT: ["connect", "disconnect", "calibrate", "resetScores", "editor", "hex"],
  GAME:         [],
  PAUSE:        ["back", "restart", "resume"],
  // Nothing: at the end of a song "back to songs" and "restart" are in the
  // scoreboard's own footer instead. The board owns the middle of the screen,
  // so the way out belongs on it rather than tucked in a corner behind it.
  END:          [],
  EDITOR:       ["edPrev", "edNext", "edAddPage", "edRemovePage", "edCopyPage",
                 "edPastePage", "edBarsDown", "edBarsUp",
                 "edBpmDown", "edBpmUp", "edClear", "edPlayPause", "edLoopMode",
                 "edImport", "edDownload", "edPlay", "edBack"]
};

// The two timing sliders live in the drawer and are shown and hidden with
// it, so the per-page rules must not touch them.
const DRAWER_KEYS = ["microbitOffset", "visualOffset"];

function applyPageUI() {
  const visible = new Set(PAGE_UI[page] || []);
  const connected = connectedDevice != null;

  // The menu has two states, and only one thing to do in the first of them.
  // With nothing plugged in, the only control that means anything is the one
  // that plugs something in - calibrating the timing of a rig that is not
  // there, or resetting scores nothing will receive, are both dead ends. So
  // they are not offered until there is a micro:bit on the other end.
  //
  // Filtered here rather than listed per page so the rule lives in one place,
  // and re-applied whenever the connection changes - the state moves on its
  // own, without a page change to hang it off.
  if (connected) {
    visible.delete("connect");
  } else {
    ["disconnect", "calibrate", "resetScores"].forEach(k => visible.delete(k));
  }

  // The editor is a workshop tool, not part of the installation.
  if (!DEBUG) visible.delete("editor");

  // Blink it red while there is nothing on the other end. Set here rather
  // than once at build time because the connection can drop on its own - a
  // pulled cable raises "disconnected", which lands back here - and the
  // button has to come back shouting when it does.
  if (ui.connect && ui.connect.elt && ui.connect.elt.classList) {
    ui.connect.elt.classList.toggle("needs-connection", !connected);
  }

  for (const key of Object.keys(ui)) {
    if (DRAWER_KEYS.includes(key)) continue;
    if (visible.has(key)) ui[key].show(); else ui[key].hide();
  }
}

function setPage(next) {
  page = next;
  if (next !== "STAGE_SELECT") { hoveredCard = -1; hoveredInfo = -1; }
  applyPageUI();

  // The scoreboard is DOM rather than a p5 element, so applyPageUI() - which
  // only walks `ui` - does not reach it.
  if (next === "END") {
    Scoreboard.show();
    // Measured after show(), never before: a hidden element is 0x0, and a
    // burst around a zero-sized box all comes out of the top left corner.
    Embers.burst(Scoreboard.rect(), millis() / 1000);
  } else {
    Scoreboard.hide();
    Embers.clear();
  }
}

//////////////////////////////////////////////////////////////////////
// LOADING SONGS
//////////////////////////////////////////////////////////////////////

// Each built-in song is tried from songs/*.mid first. Opening the page
// straight off disk blocks that fetch, so the same song is then rebuilt
// from the data in songs.js and parsed from memory instead. Either way it
// goes through the real MIDI parser, so both paths are the same code.
async function loadStageList() {
  loading = true;
  stageList = [];

  const folders = await loadSongManifest();

  for (const id of folders) {
    try {
      const song = await loadSongFolder(id);
      if (song) stageList.push(song);
    } catch (err) {
      loadError = `songs/${id}: ${err.message}`;
    }
  }

  // Nothing fetched at all - opened off the filesystem, most likely, where
  // Chrome blocks every fetch. The songs compiled into songs.js are the
  // fallback, so the menu is never empty and the app is still demonstrable
  // from a bare folder with no server.
  if (!stageList.length) loadFallbackSongs();

  loading = false;
}

// The folder list. A browser cannot list a directory over http, so it has to
// be written down; songs/songs.json is a plain array of folder names, in the
// order they should appear on the menu.
async function loadSongManifest() {
  try {
    const response = await fetch(SONGS_MANIFEST);
    if (!response.ok) throw new Error("not found");
    const list = JSON.parse(await response.text());
    // An array is the documented shape; { songs: [...] } is accepted too,
    // because it is the other obvious thing to write.
    const names = Array.isArray(list) ? list : (list && list.songs);
    if (!Array.isArray(names)) throw new Error("not a list of folder names");
    return names.filter(n => typeof n === "string" && n.length);
  } catch (err) {
    return [];
  }
}

// One song folder: song.setup, then a .mid per part. Every part is optional -
// a song with nothing but Drums.mid is a song - but a folder with no parts at
// all is not, and says so rather than appearing as a silent card.
async function loadSongFolder(id) {
  const setup = await loadSongSetup(id);
  const parts = {};
  const found = [];

  for (const part of SONG_PARTS) {
    const hit = await fetchFirstMidi(`songs/${id}`, songFileNames(part.file));
    parts[part.voice] = hit ? hit.midi : null;
    // The name it was actually found under, not the one that was looked for -
    // if a part loaded because of the case-insensitive fallback, the line on
    // the console should say so rather than quietly reporting the tidy name.
    if (hit) found.push(hit.name);
  }

  if (!found.length) throw new Error("no .mid files in the folder");

  const score = scoreFromParts(parts, setup);

  // Re-timing a part to song.setup's bpm is the ordinary case - it is what
  // every Ableton export needs - so it is a note in the console, not an error
  // on the menu.
  for (const line of score.retimed) console.info(`songs/${id}: re-timed ${line}`);

  // A file that names some *other* tempo is a real conflict: two things both
  // claim to know how fast the song is and they disagree, and whichever is
  // wrong, nobody finds out by listening until it is too late. That goes on
  // screen. One line, because a song is usually exported in one go and all
  // four parts carry the same mistake.
  for (const warning of score.warnings) console.warn(`songs/${id}: ${warning}`);
  if (score.warnings.length) {
    loadError = `songs/${id}: ${score.warnings[0]}` +
                (score.warnings.length > 1 ? ` (+${score.warnings.length - 1} more)` : "");
  }

  const sounds = await loadSongSounds(id);

  // The sounds used to live in song.setup and do not any more. Silently
  // ignoring a block left behind there would be the worst of both: the song
  // would play with the default sound and the file would look like it said
  // otherwise.
  if (setup.sounds) {
    loadError = `songs/${id}/song.setup still has a "sounds" block - ` +
                `sounds come from sound-settings.txt now, and it is being ignored`;
  }

  return {
    id,
    name: setup.name || id,
    blurb: setup.blurb || "",
    bpm: score.bpm,
    sounds,
    score,
    source: `songs/${id}/ · ${found.join(" ")}` + (sounds ? " · sounds" : "")
  };
}

// The song's sounds: whatever the sound panel exported, pasted into the
// folder unchanged. Absent is normal and means the defaults; broken is
// reported, because a typo that quietly reverted a whole song's sound would
// be very hard to spot.
async function loadSongSounds(id) {
  for (const name of SOUND_SETTINGS_FILES) {
    let text = null;
    try {
      const response = await fetch(`songs/${id}/${name}`);
      if (!response.ok) continue;
      text = await response.text();
    } catch (err) { continue; }

    try {
      return parseSoundSettings(text);
    } catch (err) {
      loadError = `songs/${id}/${name} is not valid: ${err.message}`;
      return null;
    }
  }
  return null;
}

// song.setup is optional in the sense that a folder without one still plays -
// it just has no name of its own and no sounds. A *broken* one is different,
// and is reported rather than swallowed: a typo in the JSON that silently
// reverted the whole song to defaults would be very hard to spot.
async function loadSongSetup(id) {
  let text = null;
  try {
    const response = await fetch(`songs/${id}/song.setup`);
    if (!response.ok) throw new Error("not found");
    text = await response.text();
  } catch (err) {
    return {};
  }

  try {
    return parseSetup(text);
  } catch (err) {
    loadError = `songs/${id}/song.setup is not valid: ${err.message}`;
    return {};
  }
}

// Try each spelling of a part's filename in turn. A 404 for one of them is
// the normal case, not an error.
async function fetchFirstMidi(dir, names) {
  for (const name of names) {
    try {
      const response = await fetch(`${dir}/${name}`);
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (!buffer || buffer.byteLength < 14) continue;   // too small to be a .mid
      return { midi: new Midi(buffer), name };
    } catch (err) { /* try the next spelling */ }
  }
  return null;
}

// The songs compiled into songs.js, built in memory through the real MIDI
// encoder and parser so they go down exactly the same pipe a file does.
function loadFallbackSongs() {
  for (const builtin of BUILTIN_SONGS) {
    try {
      const bytes = encodeType0(builtin);
      const score = scoreFromArrayBuffer(bytes.buffer, builtin.name);
      stageList.push({
        id: builtin.id, name: builtin.name, blurb: builtin.blurb,
        bpm: builtin.bpm, sounds: null, score, source: "built in"
      });
    } catch (err) {
      loadError = `could not build ${builtin.id}: ${err.message}`;
    }
  }
}

// Calibration has its own button now rather than a card, so every place that
// lays out or hit-tests the song grid works from this instead of stageList
// directly - one filter, rather than the same exclusion repeated at each
// call site.
function songCards() {
  return stageList.filter(s => s.id !== "calibration");
}

// The calibrate button goes through the exact same stageList entry the old
// calibration card did - same fetch-or-build score - so it is not a special
// case for the audio or visuals, only for where it appears on the menu.
function startCalibration() {
  const song = stageList.find(s => s.id === "calibration");
  if (song) startSong(song);
}

function addDroppedScore(score, filename) {
  stageList.push({
    id: "dropped-" + stageList.length,
    name: score.name || filename,
    blurb: `dropped in · ${score.format === null ? "unknown format" : "type " + score.format} · ` +
           `${score.counts.kick} kick, ${score.counts.snare} snare, ${score.counts.hihat} hat`,
    bpm: null, score, source: filename, dropped: true
  });
}

//////////////////////////////////////////////////////////////////////
// IMPORTING INTO THE EDITOR
//////////////////////////////////////////////////////////////////////

let editorFileInput = null;

function importIntoEditor() {
  if (!editorFileInput) {
    editorFileInput = document.createElement("input");
    editorFileInput.type = "file";
    editorFileInput.accept = ".mid,.midi,audio/midi";
    editorFileInput.style.display = "none";
    document.body.appendChild(editorFileInput);
  }
  editorFileInput.value = "";
  editorFileInput.onchange = () => {
    const file = editorFileInput.files[0];
    if (file) loadFileIntoEditor(file);
  };
  editorFileInput.click();
}

// Importing throws the whole arrangement away and the editor has no undo, so
// anything already written is worth one question.
function confirmReplaceSong() {
  const written = Editor.pages.some(p => p.cells.size > 0);
  if (!written) return true;
  return window.confirm(
    "Importing replaces the whole song, and there is no undo. Continue?");
}

async function loadFileIntoEditor(file) {
  if (!/\.midi?$/i.test(file.name)) {
    Editor.status = file.name + " is not a .mid file";
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const score = scoreFromArrayBuffer(buffer, file.name.replace(/\.midi?$/i, ""));
    if (!score.drums.length && !score.pads.length && !score.basskeys.length) {
      Editor.status = file.name + " has no notes we can use";
      return;
    }
    if (!confirmReplaceSong()) return;

    stopEditorPlayback();
    const report = Editor.importScore(score);
    Editor.status =
      `imported ${report.notes} notes · ${report.pages} pages · ${report.bpm} bpm · ` +
      `${report.root} ${report.scaleName}` +
      (report.snapped ? ` · ${report.snapped} snapped into key` : "") +
      (report.dropped ? ` · ${report.dropped} past the end dropped` : "");
  } catch (err) {
    Editor.status = "could not read " + file.name + ": " + err.message;
  }
}

function setupDragAndDrop() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  window.addEventListener("dragover", (e) => {
    stop(e);
    if (page === "EDITOR" || (page === "STAGE_SELECT" && DEBUG)) dropHighlight = 1;
  });
  window.addEventListener("dragleave", (e) => { stop(e); dropHighlight = 0; });

  window.addEventListener("drop", async (e) => {
    stop(e);
    dropHighlight = 0;

    // In the editor a dropped file is imported onto the grid rather than
    // added to the stage list, and only the first one - importing replaces
    // the song, so a second file would just undo the first.
    if (page === "EDITOR") {
      if (e.dataTransfer.files[0]) await loadFileIntoEditor(e.dataTransfer.files[0]);
      return;
    }
    // Outside debug the menu has no drop zone, so a file dropped on it is
    // ignored rather than silently loaded into a target that is not there.
    if (page !== "STAGE_SELECT" || !DEBUG) return;

    for (const file of e.dataTransfer.files) {
      if (!/\.midi?$/i.test(file.name)) {
        loadError = `${file.name} is not a .mid file`;
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        const parsed = scoreFromArrayBuffer(buffer, file.name.replace(/\.midi?$/i, ""));
        if (!parsed.drums.length && !parsed.pads.length && !parsed.basskeys.length) {
          loadError = `${file.name} has no notes we can use`;
          continue;
        }
        addDroppedScore(parsed, file.name);
        loadError = "";
      } catch (err) {
        loadError = `could not read ${file.name}: ${err.message}`;
      }
    }
  });
}

//////////////////////////////////////////////////////////////////////
// PLAYBACK
//////////////////////////////////////////////////////////////////////

async function startSong(song) {
  if (!song) return;
  currentSong = song;

  await AudioEngine.start();
  applySongSounds(song);

  // Fresh copy each time, so restarting does not shift the times twice - and
  // so the count-in ticks are added to the copy rather than accumulating on
  // the stage list's own score.
  score = JSON.parse(JSON.stringify(song.score));
  addCountIn(score);

  Visuals.reset();
  Ambient3D.reset();
  // The 3D canvas runs its own draw loop off this, and can get a frame in
  // before drawPerformance() next writes it. Left alone it still holds where
  // the last song was escaped from, and that frame skips the 3D layer's
  // cursors straight past every note up to there.
  songTimeNow = 0;
  microbitCursor = 0;
  sentCount = 0;
  lastSent = "";

  Tone.getTransport().stop();
  Tone.getTransport().cancel(0);
  Tone.getTransport().seconds = 0;
  AudioEngine.scheduleScore(score, 0);
  Tone.getTransport().start();

  setPage("GAME");
}

// The song's own sounds, from the `sounds` block in its song.setup.
//
// Only when the song actually changes, not on every start. Restarting is what
// you do constantly while tuning with the sound panel, and having each restart
// throw away the tweak you just made would make the panel useless. Switching
// songs and coming back does reload from the file, which is how you hear
// whether the block you pasted in is what you meant.
let soundsLoadedFor = null;

function applySongSounds(song) {
  if (!song || song.id === soundsLoadedFor) return;
  soundsLoadedFor = song.id;
  AudioEngine.applySongSounds(song.sounds);
}

function stopAndExit() {
  Tone.getTransport().stop();
  Tone.getTransport().cancel(0);
  AudioEngine.releaseAll();
  score = null;
  setPage("STAGE_SELECT");
}

function togglePause() {
  if (page === "GAME") {
    Tone.getTransport().pause();
    AudioEngine.releaseAll();
    setPage("PAUSE");
  } else if (page === "PAUSE") {
    Tone.getTransport().start();
    setPage("GAME");
  }
}

function playEditorSong() {
  stopEditorPlayback();
  const song = Editor.toSong();
  try {
    const parsed = scoreFromArrayBuffer(encodeType0(song).buffer, song.name);
    startSong({ id: "editor", name: song.name, blurb: "from the editor", bpm: song.bpm, score: parsed });
  } catch (err) {
    loadError = "editor song would not parse: " + err.message;
  }
}

// Play or stop the whole arrangement - every page, one after another, on a
// loop. Play starts at the top of the page being viewed, so you can work on
// page four without sitting through the first three; it then runs on into
// the following pages and wraps at the end. Stop returns to the start rather
// than holding position.
async function toggleEditorPlayback() {
  if (Editor.playing) { stopEditorPlayback(); return; }

  await AudioEngine.start();

  // Always rebuilt from the current song. Reusing whatever was already on
  // the transport is what made edits go unheard until a reload.
  scheduleEditorSong(false);
  Tone.getTransport().start();
  Editor.playing = true;
  ui.edPlayPause.html("stop");
}

// Puts the whole arrangement on the transport, looping either the current
// page or the whole song depending on Editor.loopMode. `keepPosition` is for
// rebuilding under a playhead that is already running, so an edit made
// mid-playback is heard without jumping back to the start.
function scheduleEditorSong(keepPosition) {
  const song = Editor.toSong();
  const parsed = scoreFromArrayBuffer(encodeType0(song).buffer, song.name);
  const resumeAt = Tone.getTransport().seconds;

  Tone.getTransport().cancel(0);
  AudioEngine.scheduleScore(parsed, 0);

  const sps = Editor.secondsPerStep;
  const length = Math.max(0.1, Editor.songSeconds);

  // "page" loops just the page currently being viewed, so it repeats until
  // you move on rather than running into whatever comes after it. "advance"
  // is the whole arrangement end to end, wrapping back to page one.
  let loopStart, loopEnd;
  if (Editor.loopMode === "page") {
    loopStart = Editor.pageStartStep(Editor.index) * sps;
    loopEnd = Math.min(loopStart + Editor.bars * STEPS_PER_BAR * sps, length);
  } else {
    loopStart = 0;
    loopEnd = length;
  }

  Tone.getTransport().loop = true;
  Tone.getTransport().loopStart = loopStart;
  Tone.getTransport().loopEnd = Math.max(loopStart + 0.05, loopEnd);

  if (keepPosition) {
    Tone.getTransport().seconds = Math.min(Math.max(resumeAt, loopStart), length);
  } else {
    Tone.getTransport().stop();
    Tone.getTransport().seconds =
      Math.min(Editor.pageStartStep(Editor.index) * sps, length);
  }
  Editor.dirty = false;
}

// Cycles between the two loop modes and rebuilds the schedule in place if
// something is already playing, so the new loop bounds take hold on the very
// next frame rather than waiting for an unrelated edit to mark it dirty.
function toggleEditorLoopMode() {
  Editor.loopMode = Editor.loopMode === "page" ? "advance" : "page";
  ui.edLoopMode.html(Editor.loopMode === "page" ? "mode: loop page" : "mode: advance");
  if (Editor.playing) scheduleEditorSong(true);
}

// Jumps playback to the same position on the page before or after the one
// being viewed, rather than only changing which page is shown - the
// playhead in Editor.draw() would otherwise snap the view straight back to
// wherever the transport actually is, on the very next frame.
//
// Not playing is the simple case: just look at a different page.
function editorGotoPage(delta) {
  const target = Editor.index + delta;
  if (target < 0 || target >= Editor.pages.length) return;

  if (!Editor.playing) { Editor.gotoPage(target); return; }

  const head = Editor.playhead();
  const withinPage = head ? head.step : 0;
  const targetSteps = Editor.pages[target].bars * STEPS_PER_BAR;
  const step = Editor.pageStartStep(target) + Math.min(withinPage, targetSteps - 1);

  Editor.index = target;
  Tone.getTransport().seconds = step * Editor.secondsPerStep;
  // Rebuilds in place at the position just set: in "page" loop mode this is
  // what re-centres the loop on the new page rather than the one just left.
  scheduleEditorSong(true);
}

function stopEditorPlayback() {
  Tone.getTransport().stop();
  Tone.getTransport().cancel(0);
  Tone.getTransport().seconds = 0;
  Tone.getTransport().loop = false;
  AudioEngine.releaseAll();
  Editor.playing = false;
  Editor.dirty = true;
  if (ui.edPlayPause) ui.edPlayPause.html("play");
}

// Called every frame while the editor is playing: an edit rebuilds the
// schedule in place, so what you draw is heard on the next pass without
// having to stop and start again.
function refreshEditorPlayback() {
  if (!Editor.playing || !Editor.dirty || !AudioEngine.started) return;
  scheduleEditorSong(true);
}

//////////////////////////////////////////////////////////////////////
// MICRO:BIT
//////////////////////////////////////////////////////////////////////

function connectMicrobit() {
  uBitConnectDevice(onMicrobitEvent);
}

function disconnectMicrobit() {
  uBitDisconnect(connectedDevice);
  connectedDevice = null;
  applyPageUI();
}

// Every event the library raises, for the whole life of the connection.
//
// This is the ONLY handler: uBitConnectDevice() takes one callback, and the
// app passes this one, so ubitwebusb's own uBitEventHandler never runs. That
// matters more than it looks - the incoming data cases have to be handled
// *here*, because nothing else is going to. Handling only "connected" and
// "disconnected" is exactly how the scores went missing: the library received
// them, bundled them, called this, and this dropped them.
//
// The library's own handler was not used because it shows and hides a button
// of its own, which fights with the page UI.
function onMicrobitEvent(reason, device, data) {
  switch (reason) {
    case "connected":
      connectedDevice = device;
      break;

    case "disconnected":
    case "connection failure":
      connectedDevice = null;
      break;

    case "error":
      loadError = "micro:bit: " + data;
      break;

    // A line the library could not split into name and value - which is every
    // line without a colon in it, so "S1, 45" arrives here.
    case "console":
      onReceivedString(data && data.data);
      return;

    // A line it could split, on a colon: "S1:45". graph-data when the value
    // is a number, graph-event when it is not - both are routed the same way,
    // because whether a score happens to parse as a number is not something
    // this should depend on.
    case "graph-data":
    case "graph-event":
      onReceivedValue(data && data.graph, data && data.data);
      return;

    default:
      return;
  }

  // Only for the connection cases above, which are the ones that change which
  // buttons belong on screen. Scores arrive a line at a time and would
  // otherwise re-lay the whole UI on every one of them.
  //
  // The device can go away on its own - unplugged, or a failed connection -
  // so the buttons are refreshed on the event rather than only when a button
  // is pressed.
  applyPageUI();
}

//////////////////////////////////////////////////////////////////////
// COMING BACK THE OTHER WAY
//
// The controllers report their scores over radio to the game master, which
// forwards them down the USB wire as one line per controller: "S1, 45".
//
// ubitwebusb.js calls one of these two depending on whether it could split
// the line itself - it only does that when the line contains a colon, so
// "S1:45" arrives as a value and "S1, 45" arrives as a string. Both are
// defined, so the firmware can use either and nothing has to be fussy.
// Anything that is not a score line is ignored, leaving the wire free for
// whatever else the game master wants to log.
//////////////////////////////////////////////////////////////////////

function onReceivedString(line) {
  Scoreboard.readSerial(line);
}

function onReceivedValue(name, value) {
  Scoreboard.readSerialValue(name, value);
}

function sendToMicrobit(message) {
  lastSent = message;
  sentCount++;
  if (connectedDevice != null) uBitSend(connectedDevice, message);
}

// Housekeeping sent down the same wire as the notes, but deliberately not
// through sendToMicrobit(): `sentCount` is how many *notes* a song fired at
// the hardware, and it is shown on the END screen. A reset pressed on the
// menu is not a note, and counting it there would make that number a lie.
//
// Returns whether it actually went anywhere, so the button that asked can
// say - pressing something and having nothing happen, with nothing said, is
// the worst thing this could do in a room full of people.
function commandMicrobit(message, what) {
  if (connectedDevice == null) {
    say(`${what}: no micro:bit connected`);
    return false;
  }
  uBitSend(connectedDevice, message);
  say(`${what}: sent "${message}"`);
  return true;
}

// The two commands the game master understands, beyond the A/B/X of play.
function resetPlayerScores() {
  return commandMicrobit(MICROBIT_RESET_SCORES, "reset player scores");
}

function requestPlayerScores() {
  return commandMicrobit(MICROBIT_REQUEST_SCORES, "get scores from players");
}

//////////////////////////////////////////////////////////////////////
// A line of feedback, wherever it will be seen
//
// The scoreboard has its own status line and is the thing you are looking at
// on the END screen. On the menu there is no such place, so the same message
// goes to a note under the buttons that fades out on its own.
//////////////////////////////////////////////////////////////////////

let notice = "", noticeAt = 0;

function say(message) {
  notice = message;
  noticeAt = millis();
  if (typeof Scoreboard !== "undefined" && Scoreboard.root) Scoreboard.say(message);
}

function noticeAlpha() {
  const age = (millis() - noticeAt) / 1000;
  if (!notice || age > NOTICE_SECONDS) return 0;
  const fade = NOTICE_SECONDS - age;
  return 255 * Math.min(1, fade / 0.6);
}

// Fire A / B / X for every kick and snare whose adjusted time has arrived.
// The offset can be negative, to fire ahead of the sound and let the radio
// and the solenoid catch up.
function updateMicrobit(songTime) {
  const offset = ui.microbitOffset.value() / 1000;
  let kick = false, snare = false;

  while (microbitCursor < score.drums.length) {
    const note = score.drums[microbitCursor];
    if (note.time + offset > songTime) break;
    microbitCursor++;
    if (note.drum === "kick") kick = true;
    if (note.drum === "snare") snare = true;
  }

  if (kick && snare) sendToMicrobit("X");
  else if (kick) sendToMicrobit("A");
  else if (snare) sendToMicrobit("B");
}

//////////////////////////////////////////////////////////////////////
// DRAW
//////////////////////////////////////////////////////////////////////

let soundPanelApplied = false;

function draw() {
  // Set every frame, not once in setup(). The face arrives over the network
  // some frames after setup() runs, so a single call there pins the canvas to
  // the fallback for the life of the page - and the menu, which never touches
  // the font again, would sit in monospace forever while the DOM buttons
  // around it drew in the real face. Costs one string assignment a frame.
  textFont(bodyFont());

  // The audio nodes are only built on the first Tone.start(), so anything
  // already moved in the sound panel has to be pushed in once at that point.
  if (AudioEngine.started && !soundPanelApplied) {
    SoundPanel.applyAll();
    soundPanelApplied = true;
  }
  TimingDrawer.refresh();

  // On the playing pages the 3D layer behind paints the backdrop, so this
  // canvas has to be transparent. Everywhere else it paints its own.
  if (page === "GAME" || page === "PAUSE" || page === "END") clear();
  else background(COLORS.bg[0], COLORS.bg[1], COLORS.bg[2]);

  // Stars sit behind everything. Skipped in the editor, where they would
  // just be noise behind the grid.
  //
  // On the menu they drift down the screen. On the playing pages they fly at
  // the camera instead, off the highway's own vanishing point, and they run
  // on the song clock rather than the wall clock so they hold still while the
  // song is paused.
  if (page === "GAME" || page === "PAUSE" || page === "END") {
    Starfield.draw(songTimeNow, Visuals.layout());
  } else if (page !== "EDITOR") {
    Starfield.draw(millis() / 1000);
  }

  switch (page) {
    case "STAGE_SELECT": drawStageSelect(); break;
    case "EDITOR":       refreshEditorPlayback(); Editor.draw(); break;
    case "GAME":
    case "PAUSE":
    case "END":          drawPerformance(); break;
  }
}

function drawPerformance() {
  if (!score) { setPage("STAGE_SELECT"); return; }

  const visualOffset = ui.visualOffset.value() / 1000;
  const songTime = Tone.getTransport().seconds + visualOffset;
  songTimeNow = songTime;

  if (page === "GAME") {
    updateMicrobit(Tone.getTransport().seconds);
    Visuals.update(score, songTime);
    if (Tone.getTransport().seconds > score.duration + 2) {
      Tone.getTransport().stop();
      setPage("END");
    }
  }

  Visuals.draw(score, songTime);
  drawVanishingPoints();
  drawCountIn(songTime);

  if (page === "PAUSE") {
    push();
    noStroke();
    fill(0, 0, 0, 170);
    rect(0, 0, width, height);
    fill(COLORS.text);
    textSize(54);
    textAlign(CENTER, CENTER);
    text("PAUSED", width / 2, height / 2);
    textSize(14);
    fill(COLORS.dim);
    text("space to resume", width / 2, height / 2 + 46);
    pop();
  }

  if (page === "END") {
    push();
    noStroke();
    fill(0, 0, 0, 190);
    rect(0, 0, width, height);
    // Up at the top rather than centred: the scoreboard panel has the middle
    // of the screen now.
    textAlign(CENTER, TOP);
    fill(COLORS.text);
    textSize(38);
    text(" ", width / 2, 40);
    textSize(13);
    fill(COLORS.dim);
    text(`${currentSong ? currentSong.name + "  ·  " : ""}` +
         `${sentCount} messages sent to the micro:bit`, width / 2, 88);
    pop();

    // After the dimming rectangle, so the embers are not dimmed with the
    // rest of the screen - they are the brightest thing on it.
    Embers.draw(millis() / 1000);
  }

  drawHud();
}

// "1", "2", "3", "4" in the middle of the screen, one a beat, in the logo's
// display face. Big and white, and gone before the first note lands.
//
// Driven off score.countInAt - the very list of times the hi-hat ticks were
// scheduled from - rather than off a counter of its own. The number you see
// and the tick you hear are then one event: there is no second clock that can
// drift, and pausing freezes both together because both are the song's time.
function drawCountIn(songTime) {
  if (!score || !score.countInAt || !score.countInAt.length) return;

  const ticks = score.countInAt;
  let i = -1;
  while (i + 1 < ticks.length && ticks[i + 1] <= songTime) i++;
  if (i < 0) return;                       // still in the lead-in silence

  const beat = ticks.length > 1 ? ticks[1] - ticks[0] : 0.5;
  const age = songTime - ticks[i];
  if (age > beat) return;                  // the fourth has had its beat

  // A stamp: it arrives oversized and snaps down, on a cubic ease so the
  // settle is fast at first and then gentle. Scaling up instead would read as
  // something approaching, which is what the whole rest of the screen is
  // already doing.
  const snap = Math.min(1, age / COUNT_IN_SNAP);
  const scale = COUNT_IN_POP + (1 - COUNT_IN_POP) * (1 - Math.pow(1 - snap, 3));

  const fadeFrom = beat * (1 - COUNT_IN_FADE);
  const alpha = age <= fadeFrom
    ? 1
    : Math.max(0, 1 - (age - fadeFrom) / (beat * COUNT_IN_FADE));
  // Under one 255th there is no pixel to paint, and the beat length is a
  // difference of two floats, so the tail end of the fade lands on values like
  // 1e-16 rather than on a clean zero.
  if (alpha < 1 / 255) return;

  push();
  noStroke();
  textFont(titleFontReady ? TITLE_FONT_FAMILY : bodyFont());
  textAlign(CENTER, CENTER);
  textSize(Math.min(width, height) * COUNT_IN_NUMBER_FRAC * scale);
  fill(255, 255, 255, 255 * alpha);
  text(String(i + 1), width / 2, height / 2);
  pop();

  // p5 keeps the font on the renderer and does not always hand it back with
  // pop(), so it is put back by hand - the same thing drawTitleText does.
  textFont(bodyFont());
  textAlign(LEFT, TOP);
}

// The two vanishing points, drawn only in debug, for lining the 3D shapes up
// with the highway by eye.
//
// Green is the highway's - where the lanes converge and where the starfield
// flies out of. Orange is where the shapes converge, which SHAPE_VP_X and
// SHAPE_VP_Y in config.js move. Nudge until the orange sits on the green.
//
// The three faint lines run from that orange X out to where each family of
// shapes is heading, which SHAPE_DEST_X and SHAPE_DEST_Y move. Those are the
// trajectories: nudge the pair until they lie along the highway's lanes.
//
// Worth having as a picture rather than as numbers: the arithmetic has agreed
// with the highway all along, and it is the rendered silhouettes that do not
// quite - so this has to be judged by looking, not by calculating.
const SHAPE_TRAJECTORIES = [
  { name: "pads", x: () => PAD_X, y: () => PAD_Y, rgb: [120, 190, 255] },
  { name: "bass", x: () => BASS_X, y: () => BASS_Y, rgb: [255, 110, 90] },
  { name: "keys", x: () => KEYS_X, y: () => KEYS_Y, rgb: [255, 210, 110] }
];

function drawVanishingPoints() {
  if (!DEBUG) return;
  const geo = Visuals.layout();
  const p3 = Ambient3D.p;
  const shapes = p3 ? Ambient3D.vanishingPoint(p3) : null;

  push();
  noFill();
  strokeWeight(1);

  stroke(70, 225, 134, 200);
  line(geo.centreX - 24, geo.horizonY, geo.centreX + 24, geo.horizonY);
  line(geo.centreX, geo.horizonY - 24, geo.centreX, geo.horizonY + 24);

  if (shapes) {
    // The line each family travels, far end to near end, in its own colour.
    // Drawn before the X so the marker stays on top of them.
    for (const t of SHAPE_TRAJECTORIES) {
      const end = Ambient3D.destination(p3, t.x(), t.y());
      stroke(t.rgb[0], t.rgb[1], t.rgb[2], 120);
      line(shapes.x, shapes.y, end.x, end.y);
      noStroke();
      fill(t.rgb[0], t.rgb[1], t.rgb[2], 200);
      circle(end.x, end.y, 7);
      noFill();
      strokeWeight(1);
    }

    stroke(255, 150, 40, 200);
    line(shapes.x - 16, shapes.y - 16, shapes.x + 16, shapes.y + 16);
    line(shapes.x - 16, shapes.y + 16, shapes.x + 16, shapes.y - 16);
  }

  noStroke();
  fill(COLORS.dim);
  textAlign(LEFT, TOP);
  textSize(10);
  text(`highway VP  y ${geo.horizonY.toFixed(0)}` +
       (shapes ? `   ·   shapes VP y ${shapes.y.toFixed(0)}` +
                 `   ·   SHAPE_VP_X ${SHAPE_VP_X}  SHAPE_VP_Y ${SHAPE_VP_Y}` +
                 `   ·   SHAPE_DEST_X ${SHAPE_DEST_X}  ` +
                 `SHAPE_DEST_Y ${SHAPE_DEST_Y}` : ""),
       geo.centreX + 30, geo.horizonY - 6);
  pop();
  textAlign(LEFT, TOP);
}

function drawHud() {
  const songTime = Tone.getTransport().seconds;
  push();
  noStroke();

  // Particles land in this strip, so the readouts get their own backdrop.
  fill(COLORS.bg[0], COLORS.bg[1], COLORS.bg[2], 225);
  rect(0, height - HUD_STRIP_H, width, HUD_STRIP_H);

  textAlign(LEFT, TOP);
  textSize(12);

  fill(COLORS.dim);
  text(currentSong ? currentSong.name : "", 22, height - BAND.songName);

  fill(connectedDevice != null ? COLORS.good : COLORS.bad);
  text(connectedDevice != null ? "micro:bit connected" : "micro:bit not connected",
    22, height - BAND.microbitStatus);

  fill(COLORS.dim);
  text(`t ${songTime.toFixed(2)}s / ${score.duration.toFixed(1)}s`, 22, height - BAND.transport);
  text(`sent ${sentCount}`, 220, height - BAND.transport);

  if (lastSent) {
    fill(COLORS.text);
    textSize(15);
    text(lastSent, 320, height - BAND.transport - 2);
  }

  textSize(11);
  fill(COLORS.dim);
  textAlign(RIGHT, TOP);
  text("space pause   ·   r restart   ·   esc back", width - 22, height - 20);
  pop();
}

// Card geometry lives in one place, used by both the drawing and the hit
// test. Hit testing at click time rather than trusting the last frame's
// hover matters because p5 binds mouse events to the window: a click on a
// DOM button also runs mousePressed(), and on any page other than the stage
// select the hover from the last frame is stale.
// The whole menu is one centred column. Every piece of it is measured here
// so the drawing and the DOM buttons agree on where things are, and so the
// block re-centres itself as songs are added.
// The menu reads top to bottom as one flow: logo, connect/disconnect,
// calibrate, the hex link, "pick a song", then a single column of cards.
// Everything below the logo has a fixed height; the logo gets whatever is
// left, which is why it is the only measurement worked out per layout in
// cardLayout() rather than kept here as a constant - it depends on how much
// room the fixed pieces leave it.
//
// The micro:bit connected/not connected line is not part of this block at
// all any more - it sits centred directly above the timing drawer, at a
// fixed distance from the bottom of the window, so it is unaffected by how
// many songs are on the menu.
const MENU = {
  titleMin: 70,
  titleToButtonGap: 22,   // logo bottom -> connect button: tight, "immediately below"
  btnH: 30, btnGap: 8,    // between two stacked buttons
  hexGap: 12, hexH: 18,   // the top button -> the hex link
  toolsGap: 18,           // last card -> the rig tools: wider than btnGap, so
                          // they read as their own group and not as a card
  subtitleGap: 22, subtitleH: 20,   // hex link -> "pick a song" -> first card
  // The cards are the biggest block on the menu, and whatever they do not use
  // goes to the logo - see cardLayout(), where the title gets the room left
  // over. Four songs at the old 96+14 came to 440px and squeezed the logo to
  // less than half the size it asks for.
  dropH: 92, gapY: 10, cardH: 66
};

function cardLayout() {
  // A single column now, so there is no second card competing for width -
  // just a floor and a ceiling on how wide one card gets to be.
  const cardW = constrain(width - 90, 340, 680);
  const blockW = cardW;
  const cards = songCards();
  const rows = Math.max(1, cards.length);

  // The drop zone only exists in debug, and when it is gone its space goes
  // with it - leaving the gap behind would push the whole menu off centre.
  const dropH = DEBUG ? MENU.dropH : 0;
  const dropGap = DEBUG ? 10 : 0;

  // The menu is a different height in each connection state, and the block is
  // centred, so this has to know which one it is in. Above the cards there is
  // always exactly one button in the top slot - "connect micro:bit" when
  // there is nothing plugged in, "calibrate timing" when there is.
  const connected = connectedDevice != null;
  const controlsH = MENU.btnH + MENU.hexGap + MENU.hexH;
  const subtitleBlockH = MENU.subtitleGap + MENU.subtitleH;
  const cardsH = rows * (MENU.cardH + MENU.gapY);

  // Below the cards, only once connected: reset player scores, then
  // disconnect. Nothing there at all while disconnected, and the space goes
  // with them rather than being left as a hole.
  const toolsH = connected
    ? MENU.toolsGap + MENU.btnH * 2 + MENU.btnGap
    : 0;

  // Everything below the logo has a fixed height; the logo gets what is
  // left. TITLE_SIZE / TITLE_LOGO_HEIGHT is a wish in this direction too -
  // ask for something taller than the window can hold and it is drawn as
  // large as will fit, rather than pushing the cards off the bottom.
  const others = controlsH + subtitleBlockH + cardsH + toolsH + dropGap + dropH;
  const room = (height - HUD_STRIP_H) - 40 - others - MENU.titleToButtonGap;
  // Reserved from whichever title is selected, not from whether the artwork
  // has arrived yet - so the menu does not jump when the logo finishes
  // loading, and the lettering standing in for it fits the same box.
  const titleWish = TITLE_MODE === "logo" ? TITLE_LOGO_HEIGHT : TITLE_BLOCK_H;
  const titleBlockH = Math.max(MENU.titleMin, Math.min(titleWish, room));

  const blockH = titleBlockH + MENU.titleToButtonGap + others;

  // Centred in the space above the control strip, but never pushed off the
  // top when the window is short.
  const top = Math.max(20, (height - HUD_STRIP_H - blockH) / 2);

  // One slot above the hex link. Whichever button belongs there in this state
  // sits at topBtnY - they are never both up, so they share the place.
  const topBtnY = top + titleBlockH + MENU.titleToButtonGap;
  const hexY = topBtnY + MENU.btnH + MENU.hexGap;
  const subtitleY = hexY + MENU.hexH + MENU.subtitleGap;
  const y0 = subtitleY + MENU.subtitleH;

  // Under the last card. cardsH already carries one trailing gapY, so
  // toolsGap is measured from there rather than from the card's edge.
  const resetY = y0 + cardsH + MENU.toolsGap;
  const disconnectY = resetY + MENU.btnH + MENU.btnGap;

  return {
    cardW, blockW, rows, top, titleBlockH, connected,
    // connectY and calibrateY are the same slot, named for both readers.
    topBtnY, connectY: topBtnY, calibrateY: topBtnY,
    resetY, disconnectY, hexY, subtitleY,
    cardH: MENU.cardH, gapY: MENU.gapY,
    x0: (width - blockW) / 2,
    y0,
    dropY: (connected ? disconnectY + MENU.btnH : y0 + cardsH) + dropGap,
    dropH
  };
}

// The bottom of the centred block - the drop zone if it is showing,
// otherwise the last card. Used to check the block still fits the window;
// nothing is actually drawn here any more.
function menuBlockBottom() {
  const L = cardLayout();
  return L.dropY + L.dropH;
}

function cardRect(i) {
  const L = cardLayout();
  return {
    x: L.x0,
    y: L.y0 + i * (L.cardH + L.gapY),
    w: L.cardW, h: L.cardH
  };
}

// The little "i" in the top-right corner of a card, and the note-count
// tooltip it reveals. One place for both the geometry the drawing code uses
// and the geometry the hit test uses, so they cannot drift apart.
const CARD_INFO = {
  r: 9, marginX: 20, marginY: 15,          // the icon itself
  pad: 8, colW: 78, rowH: 14               // the tooltip: 2 columns, 3 rows
};

function infoIconRect(i) {
  const card = cardRect(i);
  return { cx: card.x + card.w - CARD_INFO.marginX, cy: card.y + CARD_INFO.marginY, r: CARD_INFO.r };
}

// Hit-tests the info icons the same way cardAt() hit-tests the cards - by
// index into songCards(), not into stageList.
function infoIconAt(mx, my) {
  const cards = songCards();
  for (let i = 0; i < cards.length; i++) {
    const c = infoIconRect(i);
    if ((mx - c.cx) ** 2 + (my - c.cy) ** 2 <= c.r ** 2) return i;
  }
  return -1;
}

// A target for trying a file without going through the editor. Kept behind
// DEBUG because a dashed box inviting a drop is developer furniture, not
// something to have on screen at a performance.
function drawDropZone(L) {
  push();
  drawingContext.setLineDash([7, 6]);
  noFill();
  stroke(255, 255, 255, dropHighlight ? 200 : 60);
  strokeWeight(2);
  rect(L.x0, L.dropY, L.blockW, L.dropH, 8);
  pop();

  noStroke();
  textAlign(CENTER, CENTER);
  fill(dropHighlight ? COLORS.text : COLORS.dim);
  textSize(14);
  text("drop a midi file here", width / 2, L.dropY + L.dropH / 2 - 10);
  textSize(11);
  text("channel 10 = drums · channel 1 = pads · channel 2 = bass and keys",
    width / 2, L.dropY + L.dropH / 2 + 14);
}

// The menu's own buttons follow the centred column, and the column moves as
// songs load or get dropped in, so they are placed each frame rather than
// only on resize.
// Centres a DOM element in the column by its own real rendered width, rather
// than a guessed pixel count - the guesses drifted out of sync with the
// actual CSS (padding, font) and left buttons visibly off-centre.
// offsetWidth is 0 for exactly one frame, before the browser has ever laid
// the element out, so `fallback` (the old guess) covers only that frame.
function centreInColumn(el, L, y, fallback) {
  const w = el.elt.offsetWidth || fallback;
  el.position(L.x0 + (L.blockW - w) / 2, y);
}

function positionMenuButtons() {
  const L = cardLayout();

  // Only ever one of these two in the top slot: with nothing connected the
  // menu offers connecting and nothing else, and once connected that button
  // is gone and calibration takes its place.
  if (L.connected) {
    centreInColumn(ui.calibrate, L, L.topBtnY, 128);
    centreInColumn(ui.resetScores, L, L.resetY, 168);
    centreInColumn(ui.disconnect, L, L.disconnectY, 112);
  } else {
    centreInColumn(ui.connect, L, L.topBtnY, 168);
  }
  centreInColumn(ui.hex, L, L.hexY, 300);
}

// The colour of the title at this moment, as a pair of left-to-right
// gradients spanning x0..x1 in whichever context is passed - the visible
// canvas for the text lockup, the stencil canvas for the logo.
//
// `grad` is the letters, `glow` is the halo behind them. The glow carries its
// own alpha per stop rather than being faded with one globalAlpha: a single
// alpha could only make the whole title glow at once, and putting it in the
// gradient is what lets the glow travel with the band.
function titleGradients(ctx, x0, x1, t, palette) {
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  const glow = ctx.createLinearGradient(x0, 0, x1, 0);

  for (let i = 0; i <= TITLE_GRADIENT_STOPS; i++) {
    const f = i / TITLE_GRADIENT_STOPS;
    const flow = ((((t * TITLE_HUE_SPEED + f * TITLE_HUE_SPREAD) % 1) + 1) % 1);

    // A band travelling left to right, not the whole title brightening at
    // once: a point's phase is set back by how far along it sits, so the peak
    // reaches the far end a moment after it left the near one. Raising it to
    // a power narrows the band into a defined highlight rather than a wash.
    const phase = (t * TITLE_PULSE_RATE - f * TITLE_PULSE_SPREAD) * Math.PI * 2;
    const band = Math.pow(0.5 + 0.5 * Math.sin(phase), TITLE_PULSE_SHARPNESS);

    const c = titleStop(palette, flow, band);
    grad.addColorStop(f, `hsl(${c.h}, ${c.s}%, ${c.l}%)`);
    glow.addColorStop(f,
      `hsla(${c.h}, ${c.s}%, ${palette.glowLight}%, ${0.03 + c.lit * TITLE_GLOW})`);
  }
  return { grad, glow };
}

// The artwork rasterised at the size it is about to be drawn, kept until the
// size changes. Redrawing an SVG every frame is the expensive part; blitting
// the result is not.
function logoSilhouette(w, h) {
  const pw = Math.max(1, Math.round(w));
  const ph = Math.max(1, Math.round(h));
  if (!logoMask || logoMask.width !== pw || logoMask.height !== ph) {
    logoMask = document.createElement("canvas");
    logoMask.width = pw;
    logoMask.height = ph;
    logoMask.getContext("2d").drawImage(titleLogo, 0, 0, pw, ph);
  }
  return logoMask;
}

// The silhouette filled with `style`. "source-in" keeps only the pixels the
// artwork already covers, so the gradient is painted through the logo like a
// stencil - which is the whole reason a flat black drawing can carry the same
// flame the lettering did.
function logoPaintedWith(mask, style) {
  if (!logoTint || logoTint.width !== mask.width || logoTint.height !== mask.height) {
    logoTint = document.createElement("canvas");
    logoTint.width = mask.width;
    logoTint.height = mask.height;
  }
  const c = logoTint.getContext("2d");
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, logoTint.width, logoTint.height);
  c.drawImage(mask, 0, 0);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = style;
  c.fillRect(0, 0, logoTint.width, logoTint.height);
  c.globalCompositeOperation = "source-over";
  return logoTint;
}

// The logo, lit and pulsing exactly as the lettering is.
function drawTitleLogo(centreX, top, maxW, maxH) {
  const t = millis() / 1000;
  const ctx = drawingContext;
  const palette = TITLE_PALETTES[TITLE_PALETTE] || TITLE_PALETTES.rainbow;

  let h = Math.min(TITLE_LOGO_HEIGHT, maxH || TITLE_LOGO_HEIGHT);
  let w = h * logoAspect;
  if (maxW && w > maxW) { w = maxW; h = w / logoAspect; }

  const mask = logoSilhouette(w, h);
  const x = centreX - mask.width / 2;

  // Gradients are built in the stencil's own coordinates, since that is the
  // canvas they are painted on.
  const scratch = logoPaintedWith(mask, "#000").getContext("2d");
  const { grad, glow } = titleGradients(scratch, 0, mask.width, t, palette);

  // Glow first, as a ring of faint copies, then the logo itself over them.
  const lit = logoPaintedWith(mask, glow);
  for (let i = 0; i < TITLE_GLOW_COPIES; i++) {
    const a = (i / TITLE_GLOW_COPIES) * Math.PI * 2;
    ctx.drawImage(lit,
      x + Math.cos(a) * TITLE_GLOW_RADIUS,
      top + Math.sin(a) * TITLE_GLOW_RADIUS);
  }
  ctx.drawImage(logoPaintedWith(mask, grad), x, top);
}

// The menu title: colour swept through the letters, with a bright band
// travelling along the word from left to right.
//
// The colour comes from a canvas gradient rather than from drawing each
// letter separately - one fill, and the sweep is smooth instead of stepping
// letter by letter. p5 only forces its own fill colour if fill() has never
// been called, so setting the context's fillStyle straight afterwards sticks.
// Draws whichever title is in force. The logo needs the file; without it the
// lettering stands in, so there is always a title.
function drawTitle(centreX, top, maxW, maxH) {
  if (TITLE_MODE === "logo" && logoReady && titleLogo) {
    drawTitleLogo(centreX, top, maxW, maxH);
    return;
  }
  drawTitleText(centreX, top, maxW, maxH);
}

function drawTitleText(centreX, top, maxW, maxH) {
  const t = millis() / 1000;
  const ctx = drawingContext;
  const palette = TITLE_PALETTES[TITLE_PALETTE] || TITLE_PALETTES.rainbow;

  textAlign(CENTER, TOP);
  fill(COLORS.text);                       // so p5 leaves the fillStyle alone
  textFont(titleFontReady ? TITLE_FONT_FAMILY : bodyFont());

  // Measure the lockup: a stack of lines with the numeral beside it. Widths
  // come from the font actually in use, so the fallback lays out too.
  textSize(TITLE_SIZE);
  const linePitch = TITLE_SIZE * TITLE_LINE_PITCH;
  let stackW = 0;
  for (const line of TITLE_LINES) stackW = Math.max(stackW, textWidth(line));

  const bigSize = TITLE_BLOCK_H * TITLE_BIG_SCALE;
  textSize(bigSize);
  let bigW = textWidth(TITLE_BIG);   // let: the fit below scales it

  // One scale covering both directions: the lockup is shrunk to whichever of
  // the width and the height pinches hardest. TITLE_SIZE is a wish rather
  // than a promise - ask for more than fits and the title comes out as large
  // as it can be, instead of running off the sides or pushing the cards off
  // the bottom.
  let totalW = stackW + TITLE_BIG_GAP + bigW;
  let k = 1;
  if (maxW && totalW > maxW) k = Math.min(k, maxW / totalW);
  if (maxH && TITLE_BLOCK_H > maxH) k = Math.min(k, maxH / TITLE_BLOCK_H);

  const lineSize = TITLE_SIZE * k;
  const gap = TITLE_BIG_GAP * k;
  const pitch = linePitch * k;
  const big = bigSize * k;
  stackW *= k; bigW *= k; totalW *= k;

  const left = centreX - totalW / 2;
  const bigX = left + stackW + gap + bigW / 2;

  // Where each line of the stack is anchored, and which edge of it that
  // anchor is. The numeral is always centred on its own slot to the right of
  // the stack, whichever way the lines are set.
  const lineAlign = TITLE_ALIGN === "right" ? RIGHT
                  : TITLE_ALIGN === "left"  ? LEFT
                  : CENTER;
  const stackX = TITLE_ALIGN === "right" ? left + stackW
               : TITLE_ALIGN === "left"  ? left
               : left + stackW / 2;

  // One gradient pair across the whole title, so the sweep crosses it as a
  // single piece rather than restarting on each line.
  const { grad, glow } = titleGradients(ctx, left, left + totalW, t, palette);

  const lockup = (dx, dy) => {
    textAlign(lineAlign, TOP);
    textSize(lineSize);
    TITLE_LINES.forEach((line, i) => {
      text(line, stackX + dx, top + i * pitch + dy);
    });
    textAlign(CENTER, TOP);
    textSize(big);
    text(TITLE_BIG, bigX + dx, top + TITLE_BIG_DY + dy);
  };

  // The glow is the same lockup drawn in a faint ring around itself.
  //
  // Offsets rather than a scaled-up copy: scaling a title this wide from its
  // centre throws the outer letters far enough out that it reads as a second,
  // larger word beside the first instead of a halo. Offsets rather than
  // shadowBlur because canvas blur is much the more expensive way to the same
  // look, and this has to run on weak machines.
  ctx.save();
  ctx.fillStyle = glow;
  for (let i = 0; i < TITLE_GLOW_COPIES; i++) {
    const a = (i / TITLE_GLOW_COPIES) * Math.PI * 2;
    lockup(Math.cos(a) * TITLE_GLOW_RADIUS, Math.sin(a) * TITLE_GLOW_RADIUS);
  }
  ctx.restore();

  ctx.fillStyle = grad;
  lockup(0, 0);

  textFont(bodyFont());
  textSize(TITLE_SIZE);
  textAlign(CENTER, TOP);      // as it was found, for the line under the title
}
// Hit-tests the visible cards, i.e. songCards() - calibration is not one of
// them any more, so its index never lines up with a card rectangle.
function cardAt(mx, my) {
  const cards = songCards();
  for (let i = 0; i < cards.length; i++) {
    const r = cardRect(i);
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
  }
  return -1;
}

// The micro:bit connected/not connected line lives on its own, centred
// directly above the timing drawer - the same distance above the bottom edge
// the in-game transport readout uses, which is already the established
// "clear of the drawer handle" offset - rather than inside the scrolling
// menu block above. It reads the same way, and sits in the same place,
// whichever page you are on.
function drawMicrobitStatus() {
  const statusY = height - BAND.transport;

  textAlign(CENTER, TOP);
  textSize(12);
  fill(connectedDevice != null ? COLORS.good : COLORS.bad);
  text(connectedDevice != null ? "micro:bit connected" : "micro:bit not connected",
    width / 2, statusY);

  // A load error is worth surfacing wherever it happens to occur; the synth
  // voice summary is a quieter, secondary line above the connection status.
  if (loadError) {
    fill(COLORS.bad);
    textSize(11);
    text(loadError, width / 2, statusY - 18);
  } else if (AudioEngine.started) {
    fill(COLORS.dim);
    textSize(11);
    text(`synth voices · pads ${PAD_VOICES} · keys ${KEYS_VOICES} · bass mono`,
      width / 2, statusY - 18);
  }
}

// The counts used to sit on every card, permanently, in the per-instrument
// colours - six small coloured numbers between you and a song's name. They
// only matter for checking a song will actually do something on your rig,
// not for browsing, so they live behind this icon instead: revealed on
// hover, and in one colour, since there is nothing left to tell apart by
// colour once you are just reading numbers rather than scanning for one.
function drawCardInfo(i, song, open) {
  const icon = infoIconRect(i);

  fill(255, 255, 255, open ? 46 : 22);
  circle(icon.cx, icon.cy, icon.r * 2);
  fill(open ? COLORS.text : COLORS.dim);
  textAlign(CENTER, CENTER);
  textSize(11);
  text("i", icon.cx, icon.cy);
  textAlign(LEFT, TOP);          // put back for the rest of the card loop

  if (!open) return;

  const c = song.score.counts;
  const rows = [
    ["kick", c.kick], ["snare", c.snare],
    ["hat", c.hihat], ["pad", c.pads],
    ["bass", c.bass], ["keys", c.keys]
  ];

  const tw = CARD_INFO.pad * 2 + CARD_INFO.colW * 2;
  const th = CARD_INFO.pad * 2 + CARD_INFO.rowH * 3;
  const tx = icon.cx - tw + icon.r + 4;
  const ty = icon.cy + icon.r + 6;

  fill(14, 14, 22, 240);
  rect(tx, ty, tw, th, 6);

  fill(COLORS.dim);
  textSize(10);
  rows.forEach(([label, n], j) => {
    const col = j % 2, row = Math.floor(j / 2);
    text(`${n} ${label}`,
      tx + CARD_INFO.pad + col * CARD_INFO.colW,
      ty + CARD_INFO.pad + row * CARD_INFO.rowH);
  });
}

function drawStageSelect() {
  const L = cardLayout();
  positionMenuButtons();
  hoveredCard = cardAt(mouseX, mouseY);
  hoveredInfo = infoIconAt(mouseX, mouseY);
  const cards = songCards();

  push();
  noStroke();

  // Title, centred over the column. The display font is set and put back
  // around it - everything else on the page is monospace.
  drawTitle(width / 2, L.top, L.blockW, L.titleBlockH);

  textAlign(CENTER, TOP);
  textSize(13);
  fill(COLORS.dim);
  text("pick a song", width / 2, L.subtitleY);

  // Whatever the last button press had to say, fading out on its own. It sits
  // over the hex link's line rather than in the flow, so it cannot move the
  // menu about as it comes and goes.
  const alpha = noticeAlpha();
  if (alpha > 0) {
    fill(COLORS.text[0], COLORS.text[1], COLORS.text[2], alpha);
    textSize(11);
    text(notice, width / 2, L.hexY + MENU.hexH + 4);
  }

  // Song cards, one to a row
  textAlign(LEFT, TOP);
  cards.forEach((song, i) => {
    const { x, y } = cardRect(i);
    const hovering = hoveredCard === i;

    fill(255, 255, 255, hovering ? 26 : 12);
    rect(x, y, L.cardW, L.cardH, 8);

    const c = song.score.counts;
    // A file with no kick and no snare has nothing to drop down the lanes
    // and nothing to send the micro:bit, so say so rather than open an
    // empty stage. Worth seeing at a glance, so it stays on the card itself
    // rather than behind the info icon with the rest of the counts.
    const warn = c.kick + c.snare === 0;

    fill(COLORS.text);
    textSize(17);
    text(song.name, x + 16, y + 10);

    // The blurb gets two lines of the card, or one when the warning below
    // needs the other - on a card this size there is room for exactly one of
    // them, and the warning is the more urgent.
    fill(COLORS.dim);
    textSize(11);
    text(song.blurb, x + 16, y + 32, L.cardW - 32, warn ? 14 : 26);

    if (warn) {
      fill(COLORS.bad);
      textSize(10);
      text("no kick or snare - no boxes, no micro:bit messages", x + 16, y + L.cardH - 16);
    }

    drawCardInfo(i, song, hoveredInfo === i);
  });

  if (loading) {
    textAlign(CENTER, TOP);
    fill(COLORS.dim);
    textSize(14);
    text("loading songs...", width / 2, L.y0);
  }

  // Drop zone, developer affordance only
  if (DEBUG) drawDropZone(L);

  pop();

  drawMicrobitStatus();
}

//////////////////////////////////////////////////////////////////////
// INPUT
//////////////////////////////////////////////////////////////////////

function mousePressed(event) {
  // p5 binds mouse events to the window, so a click on the panel would also
  // land here and could start a song behind it.
  if (SoundPanel.ownsEvent(event) || TimingDrawer.ownsEvent(event) ||
      Scoreboard.ownsEvent(event)) return;

  if (page === "STAGE_SELECT") {
    // The icon sits inside the card it belongs to, so without this a click
    // meant to reveal the note counts would also launch the song underneath.
    if (infoIconAt(mouseX, mouseY) >= 0) return;
    const card = cardAt(mouseX, mouseY);
    if (card >= 0) startSong(songCards()[card]);
    return;
  }
  if (page === "EDITOR") Editor.mousePressed(mouseX, mouseY);
}

function mouseDragged() {
  if (page === "EDITOR") Editor.mouseDragged(mouseX, mouseY);
}

function mouseReleased() {
  if (page === "EDITOR") Editor.mouseReleased();
}

// Scrolls whichever lane the mouse is over, rather than needing the small
// on-screen ▲▼ arrows. p5 binds this to the window like every other mouse
// event, so it fires over the sound panel and timing drawer too - both of
// which want their own native scrolling left alone, hence the same
// ownsEvent() guard mousePressed() uses.
function mouseWheel(event) {
  if (page !== "EDITOR") return;
  if (SoundPanel.ownsEvent(event) || TimingDrawer.ownsEvent(event)) return;

  const direction = event.delta < 0 ? 1 : -1;   // wheel up -> higher pitches
  if (Editor.scrollAt(mouseY, direction)) return false;   // only then block the page scroll
}

// Input types you type letters and digits into. A range slider or a checkbox
// is an <input> too, but nothing is being typed into one, so the shortcuts
// should still work while the sound panel's sliders have focus.
const TEXT_ENTRY_TYPES = ["text", "number", "search", "email", "tel", "url", "password"];

// True while the keyboard belongs to a text box rather than to the app - a
// scoreboard name, a score. p5 binds keys to the window, so without this
// every letter typed into a name would also fire its own shortcut: "r" on
// the END page would restart the song out from under whoever is typing, and
// "d" would throw the sound panel open. Escape still gets through, since
// leaving is worth having from anywhere.
function typingInAField() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.isContentEditable === true) return true;

  const tag = (active.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  return TEXT_ENTRY_TYPES.includes((active.type || "text").toLowerCase());
}

function keyPressed() {
  if (typingInAField() && keyCode !== ESCAPE) return;

  if (key === " " && (page === "GAME" || page === "PAUSE")) {
    togglePause();
    return false;
  }
  if (key === " " && page === "EDITOR") {
    // A button that still holds focus would be clicked by the same keypress
    // on key up, toggling playback a second time, so drop focus first.
    blurFocusedButton();
    toggleEditorPlayback();
    return false;
  }
  if (key === "r" && (page === "GAME" || page === "PAUSE" || page === "END")) {
    startSong(currentSong);
  }
  if (key === "d" && DEBUG_SOUND) {
    SoundPanel.toggle();
    return;
  }
  if (keyCode === ESCAPE) {
    if (page === "EDITOR") { stopEditorPlayback(); setPage("STAGE_SELECT"); }
    else if (page !== "STAGE_SELECT") stopAndExit();
  }
}

// p5 listens on the window, so a focused DOM button would also fire on the
// spacebar. Nothing in this app wants a button held focused after a click.
function blurFocusedButton() {
  const active = document.activeElement;
  if (active && active !== document.body && active.blur) active.blur();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layoutUI();
}
