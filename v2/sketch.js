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
  ButtonPops.loadFonts();
  buildUI();
  watchFullscreen();
  applyPageUI();      // without this every page's controls show at once
  setupDragAndDrop();
  loadStageList();
  Ambient3D.init();
  Backdrop.build();
  BackdropPanel.build();
  // Set here as well as in toggleDebug(), or starting up with DEBUG already on
  // builds the panel and then never feeds it.
  Perf.on = DEBUG;
  PerfPanel.build();
  // setup() never goes through setPage(), so the opening page has to ask for
  // its backdrop itself - otherwise the menu sits there with no video until
  // the first time you navigate away and back.
  Backdrop.onPage(page);
  SoundPanel.build();
  TimingDrawer.build(ui);
  Scoreboard.init();
  Scoreboard.build();
  // Anything submitted while the sheet was out of reach last time goes now.
  Scoreboard.startOutbox();
  Leaderboard.build();
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
  ui.mute = createButton(muteLabel()).mousePressed(toggleRobotsMute);
  ui.editor = createButton("open MIDI editor").mousePressed(() => setPage("EDITOR"));
  ui.fullscreen = createButton(FULLSCREEN_LABEL[0]).mousePressed(toggleFullscreen);
  ui.highscores = createButton("highscores").mousePressed(() => setPage("HIGHSCORES"));
  // The file itself, which sits next to index.html, rather than the MakeCode
  // project: saving it and dragging it onto the MICROBIT drive is the whole
  // job. `download` makes it save instead of opening a megabyte of hex as text
  // in a tab, and names the saved file - the %20 is only in the address, the
  // file keeps its space. It only works same-origin, which this is.
  ui.hex = createA("conductor%20gamemaster.hex", "get the hex file for your micro:bit");
  ui.hex.attribute("download", "conductor gamemaster.hex");

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

  // The top-right pair, laid out from the right edge inwards rather than from
  // fixed offsets: the fullscreen button's label changes length when it is
  // pressed, and anything measured from the left would step sideways or run
  // off the edge when it did.
  let rx = width - pad;
  const placeFromRight = (key, fallback) => {
    // offsetWidth is 0 for exactly one frame, before the browser has ever laid
    // the element out, so the fallback covers only that frame.
    const w = ui[key].elt.offsetWidth || fallback;
    rx -= w;
    ui[key].position(rx, pad);
    rx -= 12;
  };
  placeFromRight("fullscreen", 104);
  placeFromRight("editor", 152);

  ui.highscores.position(pad, pad);

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

// Where the drawer handle is, so the readout line can keep out of its way.
//
// The handle is a DOM button across the middle of the very bottom, and its
// width depends on the text it is showing. Measured rather than assumed - and
// cached, because reading an element's box forces the browser to work out its
// layout, which is not a thing to ask for sixty times a second.
let drawerBox = null;

function forgetDrawerBox() {
  drawerBox = null;
}

// The top of the readout bar.
//
// The bar is exactly HUD_STRIP_H tall and is hung around the line of text,
// which is itself kept clear of the drawer handle. Two consequences worth
// knowing, and both are wanted:
//
//   a tall bar  reaches the bottom of the window exactly as it always did -
//               at the original 118 this is height - 118 to the pixel.
//
//   a slim bar  floats just above the handle rather than hiding behind it.
//               A 20px bar pinned to the bottom edge would be completely
//               covered by the handle, which is 24px tall and sits there.
function hudLineY() {
  return Math.min(height - HUD_STRIP_H / 2, height - HUD_DRAWER_CLEARANCE);
}

function hudStripTop() {
  return hudLineY() - HUD_STRIP_H / 2;
}

function drawerHandleBox() {
  if (drawerBox) return drawerBox;

  const handle = document.getElementById("td-handle");
  if (!handle) return { left: width / 2, right: width / 2 };

  const r = handle.getBoundingClientRect();
  // A hidden or not-yet-laid-out handle measures zero; treated as a point in
  // the middle rather than as a band covering the left half of the screen.
  drawerBox = r.width
    ? { left: r.left, right: r.right }
    : { left: width / 2, right: width / 2 };
  return drawerBox;
}

// One place that decides which controls exist on which page.
const PAGE_UI = {
  STAGE_SELECT: ["connect", "disconnect", "calibrate", "resetScores", "mute", "editor",
                 "hex", "highscores", "fullscreen"],
  GAME:         [],
  PAUSE:        ["back", "restart", "resume"],
  // Nothing: at the end of a song "back to songs" and "restart" are in the
  // scoreboard's own footer instead. The board owns the middle of the screen,
  // so the way out belongs on it rather than tucked in a corner behind it.
  END:          [],
  // The list is a DOM panel with its own "back to songs", like the scoreboard.
  HIGHSCORES:   [],
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
    ["disconnect", "calibrate", "resetScores", "mute"].forEach(k => visible.delete(k));
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

//////////////////////////////////////////////////////////////////////
// THE BACKDROP
//
// A video under both canvases, washed over with the background colour so it
// sits behind the stars rather than competing with them.
//
// There is one <video> element, not one per song: swapping its src is what
// changes the backdrop, so only the clip being shown is ever in memory.
//
// Built here rather than written into index.html so that the config alone
// decides whether any of it exists: with no file named anywhere there is no
// element, no decode, and the game is exactly what it was.
//
// It runs only where it can be seen, and only where it belongs:
//
//   STAGE_SELECT, HIGHSCORES   BG_VIDEO_MENU - front of house
//   GAME, PAUSE, END           the song's own, or BG_VIDEO_DEFAULT
//   EDITOR                     none, for the same reason it has no stars
//////////////////////////////////////////////////////////////////////

const MENU_BACKDROP_PAGES = ["STAGE_SELECT"];
const SONG_BACKDROP_PAGES = ["GAME", "PAUSE"];
const HIGHSCORE_BACKDROP_PAGES = ["END", "HIGHSCORES"];

// Where the 3D layer paints and so where the 2D canvas has to be transparent.
// Not the same list as SONG_BACKDROP_PAGES any more: END is still a playing
// page as far as the canvases are concerned, but its backdrop belongs to the
// score, not to the song that just finished.
const PLAYING_PAGES = ["GAME", "PAUSE", "END"];

// A backdrop is a video, a shader or a still image, and the extension is what
// says which. A shader is a fragment shader in Shadertoy's dialect - see
// shaderbg.js. Anything that is neither of the other two is taken for a video,
// which is what a blob: url out of a dropped zip always is.
function isShaderSource(src) {
  return /\.(txt|glsl|frag|fs)$/i.test(src || "");
}

function isImageSource(src) {
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(src || "");
}

// Where a song's `"video"` points. A bare name lives in BG_VIDEO_DIR, or in
// BG_SHADER_DIR if it is a shader, shared between songs; anything with a path
// in it - or a blob: url, which is what a video carried inside a dropped zip
// becomes - is used exactly as written.
function backdropSource(name) {
  if (!name || typeof name !== "string") return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/[/:]/.test(trimmed)) return trimmed;
  return (isShaderSource(trimmed) ? BG_SHADER_DIR : BG_VIDEO_DIR) + trimmed;
}

const Backdrop = {
  video: null,
  dim: null,
  visible: false,
  src: "",          // what is loaded now, to avoid reloading it
  shader: false,    // whether `src` is a shader rather than a video
  img: null,        // the element a still image is shown in
  isImage: false,   // whether `src` is a still image
  look: null,       // dim + grade in force, which the debug panel edits live
  page: "",         // the page it was last told about, to spot what changed
  fade: 1,          // 0 washed out completely, 1 the look's own dim
  fadeTo: 1,        // where `fade` is heading
  fadeRate: 0,      // how fast, per second
  pending: null,    // a backdrop waiting for the fade-out to finish

  build() {
    // Nothing is named anywhere and no song can name one either, so there is
    // nothing to build. A song naming its own backdrop still needs the wash,
    // which is why this is not simply "is there a default".
    if (!BG_VIDEO_MENU && !BG_VIDEO_DEFAULT && !this.anySongHasOne()) return;

    const video = document.createElement("video");
    video.id = "backdrop";
    video.loop = true;
    // Muted in the property as well as the attribute: autoplay is refused
    // for anything audible, and a backdrop with a soundtrack of its own
    // would be fighting the song.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.disablePictureInPicture = true;

    // A flat wash rather than a CSS filter on the video. Same look, and it
    // does not put a shader pass on every decoded frame.
    const dim = document.createElement("div");
    dim.id = "backdrop-dim";
    dim.style.background = `rgb(${COLORS.bg[0]}, ${COLORS.bg[1]}, ${COLORS.bg[2]})`;

    // A still image gets an element of its own rather than being a video's
    // poster: a poster only shows while a video is loading, and a video with
    // nothing to play reports itself not ready - which would have the
    // canvases paint straight over it.
    const img = document.createElement("img");
    img.id = "backdrop-image";
    img.alt = "";
    img.decoding = "async";
    img.style.objectFit = BG_IMAGE_FIT === "cover" ? "cover" : "contain";

    video.style.display = "none";
    img.style.display = "none";
    dim.style.display = "none";

    document.body.append(video, img, dim);
    this.video = video;
    this.img = img;
    this.dim = dim;
    // Seeded for whatever page is up, so applyLook() below has something real
    // to write. onPage() sets it properly a moment later, but build() must not
    // leave the elements ungraded in between.
    this.look = this.wants(page).look;
    this.applyLook();
  },

  // The stage list is loaded asynchronously and is usually still empty when
  // build() runs, so this is only ever a "maybe" - but it costs nothing and
  // it means a config with no house videos at all, whose songs all name their
  // own, still gets an element once the songs are in.
  anySongHasOne() {
    return typeof stageList !== "undefined" && stageList.some(s => s && s.video);
  },

  // Which clip a page wants, and how it should be graded.
  //
  // The menu and a song grade independently - the menu has to stay readable
  // under a logo and a column of cards, a song's backdrop only has a highway
  // over it - and on top of that a song can carry settings of its own,
  // because clips differ wildly and there is no single answer.
  wants(next) {
    if (MENU_BACKDROP_PAGES.includes(next)) {
      return { src: backdropSource(BG_VIDEO_MENU), look: this.menuLook() };
    }
    if (HIGHSCORE_BACKDROP_PAGES.includes(next)) {
      // Falls back to the stage select's, so leaving BG_SHADER_HIGHSCORE empty
      // keeps what was already there rather than going blank.
      return {
        src: backdropSource(BG_SHADER_HIGHSCORE) || backdropSource(BG_VIDEO_MENU),
        look: this.menuLook()
      };
    }
    if (SONG_BACKDROP_PAGES.includes(next)) {
      const song = currentSong || {};
      const look = this.songLook();
      // Only the ones the song actually names, so leaving a setting out of a
      // song.setup means "the house default" rather than "zero".
      if (typeof song.videoDim === "number") look.dim = song.videoDim;
      if (typeof song.videoBrightness === "number") look.brightness = song.videoBrightness;
      if (typeof song.videoContrast === "number") look.contrast = song.videoContrast;
      return { src: backdropSource(song.video) || backdropSource(BG_VIDEO_DEFAULT), look };
    }
    return { src: "", look: this.songLook() };   // the editor, and anywhere new
  },

  menuLook() {
    return { dim: BG_MENU_DIM, brightness: BG_MENU_BRIGHTNESS, contrast: BG_MENU_CONTRAST };
  },

  songLook() {
    return { dim: BG_SONG_DIM, brightness: BG_SONG_BRIGHTNESS, contrast: BG_SONG_CONTRAST };
  },

  // The wash and the grade, put on the elements. Called on every page change
  // and on every slider move, so it has to be cheap and it has to be the one
  // place either of them is written.
  //
  // brightness and contrast are a CSS filter on the video, which is a shader
  // pass over the decoded frame - more than the flat wash costs, still small,
  // and skipped entirely while both are at 1.
  applyLook() {
    if (!this.video) return;
    const { dim, brightness, contrast } = this.look;

    // `fade` runs 0 to 1 and decides how much of the backdrop's own dim is in
    // force: at 1 you see the dim that was asked for, at 0 the wash is solid
    // and the backdrop is gone. Fading this rather than the video's opacity
    // means one number covers a video, a shader and the plain background
    // alike, and nothing has to know which is underneath.
    this.dim.style.opacity = 1 - this.fade * (1 - dim);

    const grade = (brightness === 1 && contrast === 1)
      ? "none"
      : `brightness(${brightness}) contrast(${contrast})`;
    // On both, because only one of them is ever showing and this way neither
    // can be left wearing the last backdrop's grade.
    this.video.style.filter = grade;
    this.img.style.filter = grade;
    if (ShaderBackdrop.canvas) ShaderBackdrop.canvas.style.filter = grade;
  },

  // Every page change comes through setPage(), and startSong() sets
  // currentSong before it, so this is the only place the backdrop has to be
  // told anything.
  //
  // What it decides is WHEN the change happens, not what it is:
  //
  //   leaving a song       wash the song's backdrop out first, and only put
  //                        the score page's up once it has gone. Cutting
  //                        between two moving pictures reads as a glitch, and
  //                        the end of a song is the one moment everybody is
  //                        looking at the screen.
  //
  //   starting a song      put it up immediately but invisible, and bring it
  //                        in over the count-in. No fade-out first: that would
  //                        eat into the count and the picture would still be
  //                        arriving when the first note landed.
  //
  //   anything else        up immediately, faded in over BG_FADE_SECONDS.
  onPage(next) {
    if (!this.video && this.anySongHasOne()) this.build();
    if (!this.video) return;

    const want = this.wants(next);
    const wasSong = SONG_BACKDROP_PAGES.includes(this.page);
    const isSong = SONG_BACKDROP_PAGES.includes(next);
    const swapping = want.src !== this.src;
    const from = this.page;
    this.page = next;

    if (swapping && wasSong && !isSong && this.fade > 0.01 && BG_FADE_SECONDS > 0) {
      // The outgoing backdrop is left running and simply washed out; install()
      // happens in update(), once there is nothing left to see.
      this.pending = { want, page: next };
      this.startFade(0, BG_FADE_SECONDS);
      return;
    }

    this.pending = null;

    // A fade is restarted only when there is something new to reveal. Coming
    // back from PAUSE is not that: the picture never went away, and fading it
    // in again would be a flicker at exactly the wrong moment.
    const starting = next === "GAME" && !SONG_BACKDROP_PAGES.includes(from);
    if (swapping || starting) this.startFade(1, this.fadeInSeconds(next), 0);

    this.install(want, next);
  },

  // How long the way in should take. A song gets its count-in, so the backdrop
  // arrives exactly as the music does; everything else gets the house fade.
  fadeInSeconds(next) {
    if (next === "GAME" && score && score.countIn > 0) return score.countIn;
    return BG_FADE_SECONDS;
  },

  // `from` is where to start, for a fade that should begin from nothing rather
  // than from wherever the last one got to.
  startFade(to, seconds, from) {
    if (from !== undefined) this.fade = from;
    this.fadeTo = to;
    this.fadeRate = seconds > 0 ? 1 / seconds : Infinity;
    if (!isFinite(this.fadeRate)) this.fade = to;
  },

  // Called every frame from the draw loop. Nothing else moves the fade, so a
  // paused or stalled page simply holds where it is.
  update(dt) {
    if (!this.video || this.fade === this.fadeTo) return;

    const step = this.fadeRate * Math.min(0.1, Math.max(0, dt));
    this.fade = this.fadeTo > this.fade
      ? Math.min(this.fadeTo, this.fade + step)
      : Math.max(this.fadeTo, this.fade - step);

    this.applyLook();

    // Fully washed out, and something is waiting to take its place.
    if (this.fade <= 0.0001 && this.pending) {
      const { want, page: at } = this.pending;
      this.pending = null;
      this.startFade(1, this.fadeInSeconds(at), 0);
      this.install(want, at);
    }
  },

  // Put a backdrop up: point the video or the shader at it, show the right
  // one, and set it running or holding still.
  //
  // It is held still on PAUSE for the same reason the starfield is - a paused
  // game should look paused, not like a screensaver with the boxes stopped on
  // top of it.
  install(want, next) {
    const { src, look } = want;
    this.look = look;

    this.visible = !!src;
    this.shader = isShaderSource(src);
    this.isImage = !this.shader && isImageSource(src);
    const moving = this.visible && next !== "PAUSE";

    if (src !== this.src) {
      this.src = src;
      // Handing either one a new source throws away the frame it was holding,
      // so showing() reports false until the new backdrop has something of its
      // own to show. That is what keeps a swap from flashing the last song's
      // backdrop under the new one.
      // Whichever two are not wanted let go of what they had, so nothing
      // from the last backdrop can be left showing underneath the new one.
      if (!this.isImage) this.img.removeAttribute("src");
      if (this.shader) {
        this.video.pause();
        this.video.removeAttribute("src");
        // Fetching and compiling takes a moment. Nothing waits for it: the
        // layers keep painting their own background until ready() turns true,
        // and if it never does they simply go on doing so.
        ShaderBackdrop.use(src).then(ok => {
          // Only now is there anything on the canvas worth showing. Until
          // this lands - and for good, if it never compiles - it stays hidden
          // and the layers above go on painting their own background.
          ShaderBackdrop.show(ok && this.visible && this.shader);
          if (ok && moving) ShaderBackdrop.start();
        });
      } else if (this.isImage) {
        ShaderBackdrop.stop();
        this.video.pause();
        this.video.removeAttribute("src");
        this.img.src = src;
      } else {
        ShaderBackdrop.stop();
        if (src) this.video.src = src;
        else this.video.removeAttribute("src");
      }
    }

    // The menu and a song render a shader at different sizes, so the canvas has
    // to be resized on the way in and out of a song - not only when the window
    // changes. A no-op when the size already matches, which is every page
    // change that stays on the same side of that line.
    ShaderBackdrop.resize();

    this.applyLook();
    BackdropPanel.refresh();

    this.video.style.display = (this.visible && !this.shader && !this.isImage) ? "block" : "none";
    this.img.style.display = (this.visible && this.isImage) ? "block" : "none";
    ShaderBackdrop.show(this.visible && this.shader && !!ShaderBackdrop.program);
    this.dim.style.display = this.visible ? "block" : "none";

    if (this.shader) {
      // Stopped rather than reset: the last frame stays on the canvas, which
      // is what a paused game should look like.
      if (moving) ShaderBackdrop.start();
      else ShaderBackdrop.stop();
    } else if (this.isImage) {
      // Nothing to run. It holds still because it is still.
    } else if (moving) {
      // play() hands back a promise that rejects if the browser is not
      // convinced this is allowed. By the time a song is running it always
      // is - it took a click to get here - and a backdrop that did not start
      // is not worth interrupting the game over.
      this.video.play().catch(() => {});
    } else {
      this.video.pause();
    }
  },

  // Whether the canvases have to leave themselves transparent for this.
  //
  // False with nothing configured, and false while a backdrop is still
  // loading - or failed to, which is how a missing file and a shader that
  // will not compile both end up harmless. Every one of those falls back to
  // the layers painting their own background exactly as they always did.
  showing() {
    if (!this.visible) return false;
    if (this.shader) return ShaderBackdrop.ready();
    // Loaded, and decoded to something with a size - a missing file finishes
    // loading too, just with nothing in it.
    if (this.isImage) return this.img.complete && this.img.naturalWidth > 0;
    return !!this.video && this.video.readyState > 0;
  }
};

// The backdrop's own debug panel: dim, brightness and contrast, live.
//
// Separate from the sound panel rather than a group inside it, because that
// panel's "export settings" writes sound-settings.txt and these are not
// sounds - they belong to the song, in its song.setup. So this has its own
// little export that writes the lines to paste there.
//
// It borrows the sound panel's CSS wholesale (the .sp-* classes), because it
// is the same kind of object and there is no reason for it to look different.
// The panel's rows. `group` starts a section; everything else is a slider,
// which reads its value through get() and writes it through set() rather than
// naming a property - because the two halves of this panel keep their values
// in quite different places. The backdrop's live on Backdrop.look, which is
// rebuilt on every page change; the highway's are plain globals from config.js.
// The right-hand column the debug panels stack in.
//
// They used to be placed individually with fixed offsets from the top, which
// only held while none of them changed height - and the moment LOOK grew a
// second group it sat on top of PERFORMANCE. A flex column costs nothing and
// cannot drift out of date.
function debugColumn() {
  let column = document.getElementById("debugcolumn");
  if (!column) {
    column = document.createElement("div");
    column.id = "debugcolumn";
    document.body.appendChild(column);
  }
  return column;
}

const LOOK_PARAMS = [
  { group: "backdrop" },
  { label: "dim",        min: 0,   max: 1, step: 0.01,
    get: () => Backdrop.look.dim,
    set: v => { Backdrop.look.dim = v; Backdrop.applyLook(); } },
  { label: "brightness", min: 0.1, max: 3, step: 0.01,
    get: () => Backdrop.look.brightness,
    set: v => { Backdrop.look.brightness = v; Backdrop.applyLook(); } },
  { label: "contrast",   min: 0.1, max: 3, step: 0.01,
    get: () => Backdrop.look.contrast,
    set: v => { Backdrop.look.contrast = v; Backdrop.applyLook(); } },

  { group: "highway" },
  // Up to 4 because that is where config.js has been taken by hand, and a
  // slider that cannot reach the value it is showing is worse than no slider.
  { label: "grid opacity",  min: 0, max: 4, step: 0.01,
    get: () => GRID_OPACITY,  set: v => { GRID_OPACITY = v; } },
  { label: "grid darkness", min: 0, max: 1, step: 0.01,
    get: () => GRID_DARKNESS, set: v => { GRID_DARKNESS = v; } },
  { label: "hihat size",    min: 4, max: 40, step: 0.5,
    get: () => HIHAT_SIZE,    set: v => { HIHAT_SIZE = v; } },
  { label: "hihat alpha",   min: 0, max: 255, step: 1,
    get: () => HIHAT_ALPHA,   set: v => { HIHAT_ALPHA = v; } },
  { label: "hihat glow",    min: 0, max: 5, step: 0.05,
    get: () => HIHAT_GLOW,    set: v => { HIHAT_GLOW = v; } }
];

const BackdropPanel = {
  root: null,
  rows: [],
  out: null,
  copyBtn: null,

  build() {
    // No backdrop, nothing to grade. Behind DEBUG rather than DEBUG_SOUND:
    // this is picture, not sound, and the two switches are independent.
    if (this.root || !DEBUG || !Backdrop.video) return;

    const root = document.createElement("div");
    root.id = "backdroppanel";

    const head = document.createElement("header");
    const title = document.createElement("span");
    title.textContent = "LOOK";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "copy";
    copyBtn.onclick = () => this.exportSetup();
    this.copyBtn = copyBtn;

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "reset";
    resetBtn.onclick = () => {
      // Back to the defaults for the page you are on, not to one shared set:
      // resetting the menu should not hand it a song's grade.
      Backdrop.look = SONG_BACKDROP_PAGES.includes(page)
        ? Backdrop.songLook() : Backdrop.menuLook();
      Backdrop.applyLook();
      // The highway has no per-page variant, so it goes back to one set.
      GRID_OPACITY = 1.0;
      GRID_DARKNESS = 0.0;
      HIHAT_SIZE = 16;
      HIHAT_ALPHA = 235;
      HIHAT_GLOW = 2.2;
      this.refresh();
    };

    const hideBtn = document.createElement("button");
    hideBtn.textContent = "hide";
    hideBtn.onclick = () => this.toggle();

    head.append(title, copyBtn, resetBtn, hideBtn);

    const body = document.createElement("div");
    body.className = "sp-body";
    for (const param of LOOK_PARAMS) {
      if (param.group) {
        const head = document.createElement("div");
        head.className = "sp-group";
        const label = document.createElement("span");
        label.textContent = param.group;
        head.appendChild(label);
        body.appendChild(head);
        continue;
      }
      body.appendChild(this._buildRow(param));
    }

    const out = document.createElement("textarea");
    out.className = "sp-out";
    out.readOnly = true;
    out.hidden = true;

    root.append(head, body, out);
    debugColumn().appendChild(root);
    this.root = root;
    this.out = out;
    this.refresh();
  },

  _buildRow(param) {
    const row = document.createElement("label");
    row.className = "sp-row";

    const name = document.createElement("span");
    name.className = "sp-name";
    name.textContent = param.label;

    const readout = document.createElement("span");
    readout.className = "sp-val";

    const input = document.createElement("input");
    input.type = "range";
    input.min = param.min;
    input.max = param.max;
    input.step = param.step;

    // Whole numbers for the ones that are counts of something - an alpha of
    // "235.00" is just noise to read past.
    const places = param.step >= 1 ? 0 : 2;
    const show = () => { readout.textContent = param.get().toFixed(places); };

    input.oninput = () => {
      param.set(parseFloat(input.value));
      show();
    };

    row.append(name, input, readout);
    this.rows.push({ param, input, show });
    return row;
  },

  // Put the controls back in step with what is actually showing. Needed on
  // every page change, because each song brings its own settings with it and
  // sliders left where the last song put them would be lying.
  refresh() {
    if (!this.root || !Backdrop.look) return;
    for (const { param, input, show } of this.rows) {
      input.value = param.get();
      show();
    }
    // The copy button writes into a different file depending on where you
    // are, so it says which.
    const song = SONG_BACKDROP_PAGES.includes(page);
    this.copyBtn.title = song
      ? "copy these as song.setup lines"
      : "copy these as config.js lines";
  },

  toggle() {
    if (!this.root) return;
    this.root.classList.toggle("sp-hidden");
  },

  // The lines to paste back where these settings actually live: a song's go
  // into its song.setup, the menu's into config.js. A song's are written with
  // the clip they are grading named alongside them, since settings are worth
  // nothing attached to the wrong one.
  exportSetup() {
    const { dim, brightness, contrast } = Backdrop.look;
    const n = v => +v.toFixed(2);

    if (SONG_BACKDROP_PAGES.includes(page)) {
      const named = ((currentSong || {}).video || "").trim();
      this.out.value =
        (named ? `"video": ${JSON.stringify(named)},\n` : "") +
        `"videoDim": ${n(dim)},\n` +
        `"videoBrightness": ${n(brightness)},\n` +
        `"videoContrast": ${n(contrast)}`;
    } else {
      this.out.value =
        `const BG_MENU_DIM = ${n(dim)};\n` +
        `const BG_MENU_BRIGHTNESS = ${n(brightness)};\n` +
        `const BG_MENU_CONTRAST = ${n(contrast)};`;
    }

    // The highway settings are globals in config.js wherever you tuned them,
    // so they are always appended and always labelled - the backdrop half
    // above goes somewhere else entirely and the two must not be pasted into
    // the same place by mistake.
    this.out.value +=
      `\n\n// config.js\n` +
      `let GRID_OPACITY = ${n(GRID_OPACITY)};\n` +
      `let GRID_DARKNESS = ${n(GRID_DARKNESS)};\n` +
      `let HIHAT_SIZE = ${n(HIHAT_SIZE)};\n` +
      `let HIHAT_ALPHA = ${Math.round(HIHAT_ALPHA)};\n` +
      `let HIHAT_GLOW = ${n(HIHAT_GLOW)};`;
    this.out.hidden = false;
    this.out.select();
    // Copying can be refused - an unfocused window, a browser that wants a
    // fresher gesture - and the textarea is right there and selected either
    // way, so a refusal is not worth saying anything about.
    try { navigator.clipboard.writeText(this.out.value); } catch (err) { /* it is on screen */ }
  }
};

function setPage(next) {
  page = next;
  if (next !== "STAGE_SELECT") { hoveredCard = -1; hoveredInfo = -1; }
  // Back on the menu from calibrating: put the drawer back the way it was.
  if (next === "STAGE_SELECT") TimingDrawer.release("calibration");
  applyPageUI();
  Backdrop.onPage(next);

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

  if (next === "HIGHSCORES") {
    Leaderboard.show();
    // Measured after show(), for the same reason as the scoreboard's burst.
    Embers.burst(Leaderboard.rect(), millis() / 1000);
  } else {
    Leaderboard.hide();
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

  // Every folder at once, not one after another.
  //
  // The songs do not depend on each other, and each one is a dozen or more
  // requests. Run in series that is every round trip of every song stacked end
  // to end, which off a local disk is nothing and over a real network is most
  // of the wait on a first visit - measured at six and a half seconds against
  // a server 30ms away.
  const loaded = await Promise.all(folders.map(async entry => {
    try {
      return await loadSongFolder(entry);
    } catch (err) {
      loadError = `songs/${entry.id}: ${err.message}`;
      return null;
    }
  }));

  // In the order the manifest lists them, not the order they happened to
  // finish - the manifest's order is the menu's order, and racing would
  // shuffle the cards differently on every visit.
  stageList = loaded.filter(Boolean);

  // Nothing fetched at all - opened off the filesystem, most likely, where
  // Chrome blocks every fetch. The songs compiled into songs.js are the
  // fallback, so the menu is never empty and the app is still demonstrable
  // from a bare folder with no server.
  if (!stageList.length) loadFallbackSongs();

  addQuickTestSong();

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

    // Two shapes, both fine. A plain name is a folder to go and look through,
    // the way it has always worked - drop a folder in, add its name, done.
    // An object is a folder somebody has already looked through for us, and
    // then nothing is guessed at: see tools/build-songs-json.py.
    return names
      .map(entry => (typeof entry === "string" ? { id: entry } : entry))
      .filter(entry => entry && typeof entry.id === "string" && entry.id.length);
  } catch (err) {
    return [];
  }
}

// One song folder: song.setup, then a .mid per part. Every part is optional -
// a song with nothing but Drums.mid is a song - but a folder with no parts at
// all is not, and says so rather than appearing as a silent card.
async function loadSongFolder(entry) {
  const id = entry.id;

  // A manifest entry carrying a `parts` map has been written by somebody who
  // could actually see the folder, so nothing here is guessed: each file is
  // asked for once, by name, and a part that is not listed is a part the song
  // does not have and is never asked for at all.
  //
  // Without one, every name is a guess and the misses are what they always
  // were. tools/build-songs-json.py is what turns the first into the second.
  const declared = !!entry.parts && typeof entry.parts === "object";

  const partNames = part => {
    if (!declared) return songFileNames(part.file);
    const named = entry.parts[part.voice];
    return named ? [named] : [];            // [] asks for nothing
  };

  // The setup, the four parts and the sounds all at once. Nothing here needs
  // anything else here: the setup is only wanted once the parts are in hand,
  // and the parts do not care what it says. Waiting for each in turn was
  // costing a round trip apiece for no reason at all.
  const [setup, hits, sounds] = await Promise.all([
    loadSongSetup(id, declared ? (entry.setup ? [entry.setup] : []) : SONG_SETUP_FILES),
    Promise.all(SONG_PARTS.map(part => fetchFirstMidi(`songs/${id}`, partNames(part)))),
    loadSongSounds(id, declared ? (entry.sounds ? [entry.sounds] : []) : SOUND_SETTINGS_FILES)
  ]);

  const parts = {};
  const found = [];

  SONG_PARTS.forEach((part, i) => {
    const hit = hits[i];
    parts[part.voice] = hit ? hit.midi : null;
    // The name it was actually found under, not the one that was looked for -
    // if a part loaded because of the case-insensitive fallback, the line on
    // the console should say so rather than quietly reporting the tidy name.
    if (hit) found.push(hit.name);
  });

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


  // The sounds used to live in song.setup and do not any more. Silently
  // ignoring a block left behind there would be the worst of both: the song
  // would play with the default sound and the file would look like it said
  // otherwise.
  if (setup.sounds) {
    loadError = `songs/${id}/song.setup still has a "sounds" block - ` +
                `sounds come from sound-settings.txt now, and it is being ignored`;
  }

  const strays = unknownSetupKeys(setup);
  if (strays.length) {
    loadError = `songs/${id}/song.setup: nothing reads ${strays.map(k => `"${k}"`).join(", ")}` +
                ` - check the spelling`;
    console.warn(loadError, "· known keys:", SONG_SETUP_KEYS.join(", "));
  }

  return {
    id,
    name: setup.name || id,
    blurb: setup.blurb || "",
    bpm: score.bpm,
    sounds,
    score,
    ...backdropFields(setup),
    source: `songs/${id}/ · ${found.join(" ")}` + (sounds ? " · sounds" : "")
  };
}

// The backdrop fields a song.setup may carry, copied onto the song.
//
// Split out so a folder and a dropped zip agree by construction rather than
// by both remembering to do it. `video` is resolved later, by backdropSource(),
// so what is written here is exactly what the file said.
function backdropFields(setup, videoOverride) {
  return {
    video: videoOverride || firstSetupString(setup, SONG_BACKDROP_KEYS),
    videoDim: firstSetupNumber(setup, SONG_BACKDROP_DIM_KEYS),
    videoBrightness: firstSetupNumber(setup, SONG_BACKDROP_BRIGHTNESS_KEYS),
    videoContrast: firstSetupNumber(setup, SONG_BACKDROP_CONTRAST_KEYS)
  };
}

// The first of several spellings a setup actually used. Blank strings are
// skipped, so `"video": ""` does not shadow a `"backdrop"` further down.
function firstSetupString(setup, names) {
  for (const name of names) {
    const value = setup[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstSetupNumber(setup, names) {
  for (const name of names) {
    if (typeof setup[name] === "number") return setup[name];
  }
  return undefined;
}

// Anything in a song.setup that nothing reads.
//
// This is the one check that catches the mistake you cannot see: a key that is
// spelt wrong, or right for a previous version, does exactly nothing and says
// exactly nothing, and the song plays on looking as though the line were never
// there. Naming them costs a loop over half a dozen keys, once, at load.
function unknownSetupKeys(setup) {
  return Object.keys(setup || {}).filter(key => !SONG_SETUP_KEYS.includes(key));
}

// The song's sounds: whatever the sound panel exported, pasted into the
// folder unchanged. Absent is normal and means the defaults; broken is
// reported, because a typo that quietly reverted a whole song's sound would
// be very hard to spot.
async function loadSongSounds(id, names) {
  for (const name of names) {
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
async function loadSongSetup(id, names) {
  // Every accepted spelling, not just the canonical one. SONG_SETUP_FILES has
  // always listed these and the zip reader has always honoured them; the
  // folder reader used to ask for "song.setup" and nothing else, so a folder
  // whose setup was named any of the others was read as having none at all -
  // no name, no tempo, no backdrop, and not a word said about it.
  let text = null;
  let found = null;

  for (const name of names) {
    try {
      const response = await fetch(`songs/${id}/${name}`);
      if (!response.ok) continue;
      text = await response.text();
      found = name;
      break;
    } catch (err) { /* try the next spelling */ }
  }

  if (found === null) {
    // Not an error: a folder with no setup still plays, it just has no name of
    // its own. Worth a line all the same, because the other reason to see this
    // is a setup that is there under a name nothing looks for. Silent when the
    // manifest already said there was none - that is not news.
    if (names.length) {
      console.info(`songs/${id}: no song.setup - tried ${names.join(", ")}`);
    }
    return {};
  }
  if (found !== names[0]) {
    console.info(`songs/${id}: read its setup from ${found}`);
  }

  try {
    return parseSetup(text);
  } catch (err) {
    loadError = `songs/${id}/${found} is not valid: ${err.message}`;
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

// The ten second song, for getting to the scoreboard and the highscore list
// without playing anything. Added however the rest of the list was loaded -
// from folders or from the built-in fallback - because it is wanted in both
// cases, and built through the same encode-and-parse path as the fallback
// songs so it is a real score by the time it is on the list.
//
// `debugOnly` is what keeps it off the menu; see songCards().
function addQuickTestSong() {
  if (typeof QUICK_TEST_SONG === "undefined") return;
  if (stageList.some(s => s.id === QUICK_TEST_SONG.id)) return;
  try {
    const bytes = encodeType0(QUICK_TEST_SONG);
    stageList.push({
      id: QUICK_TEST_SONG.id,
      name: QUICK_TEST_SONG.name,
      blurb: QUICK_TEST_SONG.blurb,
      bpm: QUICK_TEST_SONG.bpm,
      sounds: null,
      score: scoreFromArrayBuffer(bytes.buffer, QUICK_TEST_SONG.name),
      source: "built in",
      debugOnly: true
    });
  } catch (err) {
    loadError = `could not build the quick test song: ${err.message}`;
  }
}

// Calibration has its own button now rather than a card, so every place that
// lays out or hit-tests the song grid works from this instead of stageList
// directly - one filter, rather than the same exclusion repeated at each
// call site.
//
// Read fresh every frame, so ⌘⇧D puts the debug-only song on the menu and
// takes it away again without reloading.
function songCards() {
  return stageList.filter(s => s.id !== "calibration" && (DEBUG || !s.debugOnly));
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

// A whole song folder in one file.
//
// A zip holding the same Drums/Pads/Bass/Keys parts a folder holds, plus an
// optional song.setup and sound-settings.txt, dropped on the menu. It goes
// through the same parser, the same scoreFromParts() and the same sound
// settings reader as a folder does, so a zipped song and the folder it came
// from are the same song - the only difference is where the bytes came from.
async function addDroppedZip(file) {
  const index = zipIndex(await readZip(await file.arrayBuffer()));

  const setup = zippedSetup(index, file.name);
  const parts = {};
  const found = [];

  for (const part of SONG_PARTS) {
    // The name it was actually found under, not the one that was looked for,
    // so a card built from PADS.MID says so.
    const hit = firstZipMidi(index, songFileNames(part.file));
    parts[part.voice] = hit ? hit.midi : null;
    if (hit) found.push(hit.name);
  }

  if (!found.length) {
    throw new Error("no Drums.mid, Pads.mid, Bass.mid or Keys.mid inside");
  }

  const score = scoreFromParts(parts, setup);

  // Re-timing a part to the setup's bpm is the ordinary case - it is what
  // every Ableton export needs - so it is a note in the console. Two tempos
  // that disagree and both look deliberate go on screen, because whichever is
  // wrong, nobody finds out by listening until it is too late.
  for (const line of score.retimed) console.info(`${file.name}: re-timed ${line}`);
  for (const warning of score.warnings) console.warn(`${file.name}: ${warning}`);

  const sounds = zippedSounds(index, file.name);

  // A video carried inside the zip wins over anything the setup names: a zip
  // is meant to be self-contained, and a name that only resolves on the
  // machine it was packed on is exactly what zipping it up was avoiding.
  const video = zippedVideo(index);

  const missing = SONG_PARTS
    .filter(part => !score.parts[part.voice])
    .map(part => part.file.replace(/\.mid$/i, "").toLowerCase());

  stageList.push({
    id: "dropped-" + stageList.length,
    name: setup.name || file.name.replace(/\.zip$/i, ""),
    blurb: setup.blurb ||
           `dropped in · ${found.length} part${found.length === 1 ? "" : "s"}` +
           (missing.length ? ` · no ${missing.join(", ")}` : ""),
    bpm: score.bpm,
    sounds,
    score,
    ...backdropFields(setup, video),
    source: `${file.name} · ${found.join(" ")}` + (sounds ? " · sounds" : "") +
            (video ? " · video" : ""),
    dropped: true
  });

  // The warning is worth saying, but only after the song is on the menu -
  // it played, it just may not have played at the speed it meant to.
  if (score.warnings.length) {
    loadError = `${file.name}: ${score.warnings[0]}` +
                (score.warnings.length > 1 ? ` (+${score.warnings.length - 1} more)` : "");
  } else {
    loadError = "";
  }
}

// The setup out of a zip. Absent is normal - a zip of nothing but parts is a
// song, it simply has no name or tempo of its own. Broken is reported, since
// a typo in the JSON that silently reverted the whole song to defaults would
// be very hard to spot.
function zippedSetup(index, zipName) {
  const hit = zipText(index, SONG_SETUP_FILES);
  if (!hit) return {};
  try {
    return parseSetup(hit.text);
  } catch (err) {
    loadError = `${zipName}: ${hit.name} is not valid: ${err.message}`;
    return {};
  }
}

// A backdrop video out of a zip, as a blob: url the <video> can play
// straight from memory. Absent is normal.
//
// The url is never revoked: it is held for as long as the dropped song is on
// the menu, which is the rest of the session, and revoking it would break
// the card that is still pointing at it.
function zippedVideo(index) {
  for (const [name, bytes] of index) {
    if (!/\.(mp4|m4v|webm|ogv)$/i.test(name)) continue;
    const type = /\.webm$/i.test(name) ? "video/webm"
               : /\.ogv$/i.test(name) ? "video/ogg" : "video/mp4";
    return URL.createObjectURL(new Blob([bytes], { type }));
  }
  return "";
}

// The sounds out of a zip: whatever the sound panel's "export settings"
// produced, zipped up unchanged. Absent means the defaults.
function zippedSounds(index, zipName) {
  const hit = zipText(index, SOUND_SETTINGS_FILES);
  if (!hit) return null;
  try {
    return parseSoundSettings(hit.text);
  } catch (err) {
    loadError = `${zipName}: ${hit.name} is not valid: ${err.message}`;
    return null;
  }
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
      // A zip is a whole song folder - every part, plus its setup and its
      // sounds - so it makes one card on its own rather than one per part.
      if (/\.zip$/i.test(file.name)) {
        try {
          await addDroppedZip(file);
        } catch (err) {
          loadError = `could not read ${file.name}: ${err.message}`;
        }
        continue;
      }
      // A bare .mid still works, and still goes the old way: one file, one
      // card, with the voices worked out from its channels.
      if (!/\.midi?$/i.test(file.name)) {
        loadError = `${file.name} is not a .zip or a .mid file`;
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

  // Calibrating is setting the timing, so the timing sliders come up with it
  // rather than waiting to be found - its backdrop has arrows pointing at
  // them. Done first, before the audio starts, so the drawer is open by the
  // time anyone looks down.
  if (song.id === "calibration") TimingDrawer.hold("calibration");

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
// Muting the robots
//
// For talking over them. The mute is held rather than fired once: see
// MUTE_REPEAT_SECONDS in config.js for why it is sent again every few
// seconds while it is on.
//////////////////////////////////////////////////////////////////////

let robotsMuted = false;
let lastMuteSentAt = 0;

function muteLabel() {
  return robotsMuted ? "unmute robots" : "mute robots";
}

// For the scoreboard, which is built long after this and may be built while
// the mute is already on. A function rather than the variable itself, because
// a `let` cannot be read from another script before it is initialised and a
// function declaration can always be asked whether it exists.
function robotsAreMuted() {
  return robotsMuted;
}

function toggleRobotsMute() {
  const wanted = !robotsMuted;
  const sent = commandMicrobit(wanted ? MICROBIT_MUTE : MICROBIT_UNMUTE,
                               wanted ? "mute robots" : "unmute robots");
  // Nothing went out, so nothing changed at the other end. Saying "muted"
  // over a room full of thumping robots is worse than saying nothing.
  if (!sent) return false;
  robotsMuted = wanted;
  lastMuteSentAt = millis();
  syncMuteButtons();
  return true;
}

// Both buttons say the same thing, wherever they are. The menu's is a p5
// element and the scoreboard's is plain DOM, so each is told in its own way.
function syncMuteButtons() {
  if (ui.mute) {
    ui.mute.html(muteLabel());
    ui.mute.elt.classList.toggle("muted-on", robotsMuted);
  }
  if (typeof Scoreboard !== "undefined" && Scoreboard.muteEl) {
    Scoreboard.muteEl.textContent = muteLabel();
    Scoreboard.muteEl.classList.toggle("muted-on", robotsMuted);
  }
}

// Called every frame. Quiet on purpose - uBitSend rather than
// commandMicrobit - because a status line every two seconds would push
// everything else off the bar and read as though something were wrong.
function updateRobotMute() {
  if (!robotsMuted) return;
  // Unplugged while muted: the robots cannot be reached and are not muted any
  // more, so the buttons should stop claiming they are.
  if (connectedDevice == null) {
    robotsMuted = false;
    syncMuteButtons();
    return;
  }
  if (millis() - lastMuteSentAt < MUTE_REPEAT_SECONDS * 1000) return;
  lastMuteSentAt = millis();
  uBitSend(connectedDevice, MICROBIT_MUTE);
}

//////////////////////////////////////////////////////////////////////
// A line of feedback, in one place
//
// Every status line goes here - the menu's buttons, the scoreboard's, the
// micro:bit commands - and is shown in one place rather than each panel
// keeping a status line of its own. On the playing pages that is the bar
// along the bottom, beside the rest of the readouts; on the menu, where there
// is no bar, it is a note under the buttons. Either way it fades out on its
// own after NOTICE_SECONDS.
//////////////////////////////////////////////////////////////////////

let notice = "", noticeAt = 0;

function say(message) {
  notice = message;
  noticeAt = millis();
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

// The real draw loop is drawFrame(); this is the wrapper that bills it.
//
// Split rather than instrumented inline so there is exactly one timer around
// the whole of the 2D canvas, whatever the page does inside it.
function draw() {
  Perf.frameMark();
  Perf.time("2d canvas", drawFrame);
  PerfPanel.refresh();
}

function drawFrame() {
  // deltaTime is p5's, in milliseconds. The backdrop's fades are the only
  // thing in the app running on wall time rather than on the song clock, and
  // this is the one place they are advanced.
  Backdrop.update(deltaTime / 1000);

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
  updateRobotMute();

  // On the playing pages the 3D layer behind paints the backdrop, so this
  // canvas has to be transparent - and with a backdrop video running it has
  // to be transparent on the menu too, or the video is walled off behind it.
  // Everywhere else it paints its own.
  if (PLAYING_PAGES.includes(page) || Backdrop.showing()) clear();
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
  } else if (page !== "EDITOR" && STAR_ENABLED_MENU) {
    Starfield.draw(millis() / 1000);
  }

  switch (page) {
    case "STAGE_SELECT": drawStageSelect(); break;
    case "EDITOR":       refreshEditorPlayback(); Editor.draw(); break;
    case "GAME":
    case "PAUSE":
    case "END":          drawPerformance(); break;
    case "HIGHSCORES":   drawHighscores(); break;
  }
}

// The list itself is a DOM panel. All the canvas adds on this page is the fire
// around it, drawn behind the panel so it licks out from under the edges.
function drawHighscores() {
  Embers.glow(Leaderboard.rect(), EMBER_GLOW_RATE);
  Embers.draw(millis() / 1000);
}

function drawPerformance() {
  if (!score) { setPage("STAGE_SELECT"); return; }

  const visualOffset = ui.visualOffset.value() / 1000;
  const songTime = Tone.getTransport().seconds + visualOffset;
  songTimeNow = songTime;

  if (page === "GAME") {
    Perf.time("micro:bit", () => updateMicrobit(Tone.getTransport().seconds));
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
  const connected = connectedDevice != null;

  push();
  noStroke();

  // Particles land in this strip, so the readouts get their own backdrop.
  const y = hudLineY();
  fill(COLORS.bg[0], COLORS.bg[1], COLORS.bg[2], 225);
  rect(0, hudStripTop(), width, HUD_STRIP_H);

  textSize(HUD_TEXT_SIZE);

  // The key hints first, from the right, because where they end is where the
  // readouts have to stop.
  const hints = "space pause   ·   r restart   ·   esc back";
  const handle = drawerHandleBox();
  let hintsLeft = width - HUD_PAD;

  textAlign(RIGHT, CENTER);
  fill(COLORS.dim);
  if (width - HUD_PAD - textWidth(hints) > handle.right) {
    text(hints, width - HUD_PAD, y);
    hintsLeft = width - HUD_PAD - textWidth(hints);
  }

  // Everything the readouts must not run into: the hints on one side, the
  // drawer handle in the middle. Whichever comes first.
  const stopAt = Math.min(hintsLeft, handle.left) - HUD_GAP;

  // The notice goes first so a narrow window drops a readout rather than the
  // thing that was just said - and it is only in the list while it has not
  // faded, so the readouts get their space back rather than sitting behind a
  // permanent gap.
  const noticeFade = noticeAlpha();
  const items = [
    ...(notice && noticeFade > 0
      ? [{ text: notice, colour: COLORS.text, alpha: noticeFade }] : []),
    { text: connected ? "micro:bit connected" : "micro:bit not connected",
      colour: connected ? COLORS.good : COLORS.bad },
    { text: currentSong ? currentSong.name : "", colour: COLORS.dim },
    { text: `t ${songTime.toFixed(2)}s / ${score.duration.toFixed(1)}s`, colour: COLORS.dim },
    { text: `sent ${sentCount}`, colour: COLORS.dim },
    { text: lastSent, colour: COLORS.text }
  ];

  textAlign(LEFT, CENTER);
  let x = HUD_PAD;
  let first = true;

  for (const item of items) {
    if (!item.text) continue;

    const sep = first ? "" : `  ${HUD_SEPARATOR}  `;
    const needed = textWidth(sep + item.text);
    // Dropped rather than drawn over the handle. The list is in order of what
    // is worth losing last, so a narrow window loses the tail of it.
    if (x + needed > stopAt) break;

    if (sep) {
      fill(COLORS.dim);
      text(sep, x, y);
      x += textWidth(sep);
    }
    fill(item.colour[0], item.colour[1], item.colour[2],
         item.alpha === undefined ? 255 : item.alpha);
    text(item.text, x, y);
    x += textWidth(item.text);
    first = false;
  }

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
    ? MENU.toolsGap + MENU.btnH * 3 + MENU.btnGap * 2
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
  const muteY = resetY + MENU.btnH + MENU.btnGap;
  const disconnectY = muteY + MENU.btnH + MENU.btnGap;

  return {
    cardW, blockW, rows, top, titleBlockH, connected,
    // connectY and calibrateY are the same slot, named for both readers.
    topBtnY, connectY: topBtnY, calibrateY: topBtnY,
    resetY, muteY, disconnectY, hexY, subtitleY,
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
  text("drop song zip here", width / 2, L.dropY + L.dropH / 2 - 14);
  textSize(11);
  text("should contain Keys.mid, Pads.mid, Bass.mid and Drums.mid.",
    width / 2, L.dropY + L.dropH / 2 + 8);
  text("Optionally songSetup.txt and sound-settings.txt",
    width / 2, L.dropY + L.dropH / 2 + 24);
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
    centreInColumn(ui.mute, L, L.muteY, 168);
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
  const statusY = height - HUD_DRAWER_CLEARANCE;

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

    // Two passes: a backing of the background colour so the text has something
    // solid to sit on whatever is moving behind it, then the old white sheen
    // on top to separate the cards and pick out the hovered one.
    fill(COLORS.bg[0], COLORS.bg[1], COLORS.bg[2], 255 * CARD_OPACITY);
    rect(x, y, L.cardW, L.cardH, 8);
    fill(255, 255, 255, hovering ? CARD_SHEEN[1] : CARD_SHEEN[0]);
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
    text(song.blurb, x + 16, y + 38, L.cardW - 32, warn ? 14 : 26);

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
      Scoreboard.ownsEvent(event) || Leaderboard.ownsEvent(event)) return;

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

function keyPressed(event) {
  // The two developer switches. On a chord because they have to be safe to
  // leave armed during a show, and checked before the typing guard so they
  // still work with a name field focused - the whole point of them is to get
  // at the tools from wherever you happen to be.
  //
  // event.code rather than `key`, because with shift held `key` is "D", and
  // because the physical key is what was pressed whatever the layout says.
  if (event && event.shiftKey && (event.metaKey || event.ctrlKey)) {
    if (event.code === "KeyD") { toggleDebug(); return false; }
    if (event.code === "KeyS") { toggleSoundDebug(); return false; }
    if (event.code === "KeyU") { toggleSerialDebug(); return false; }
  }

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
  // The same gesture the sound panel has, for the picture instead: collapse
  // it to its header bar without losing where the sliders are.
  if (key === "b" && DEBUG && BackdropPanel.root) {
    BackdropPanel.toggle();
    return;
  }
  if (key === "p" && DEBUG && PerfPanel.root) {
    PerfPanel.toggle();
    return;
  }
  // Anywhere, including the playing pages, which carry no buttons at all.
  if (key === "f") {
    toggleFullscreen();
    return false;
  }
  if (keyCode === ESCAPE) {
    if (page === "EDITOR") { stopEditorPlayback(); setPage("STAGE_SELECT"); }
    else if (page === "HIGHSCORES") setPage("STAGE_SELECT");
    else if (page !== "STAGE_SELECT") stopAndExit();
  }
}

// The developer furniture: the drop zone, the editor button, the vanishing
// point markers. Kept separate from the sound panel's switch on purpose -
// tuning the sound on the night should not put a drop target back on the
// menu.
//
// No announcement, because turning it on *is* the announcement: the drop zone
// and the editor button appear.
function toggleDebug() {
  DEBUG = !DEBUG;
  // The editor button is only offered in debug, and the menu is laid out
  // around a drop zone that has just appeared or gone.
  applyPageUI();

  // Built the first time it is needed rather than at startup, since debug
  // may never be turned on at all. After that it is only shown and hidden,
  // and keeps whatever the sliders were left at.
  BackdropPanel.build();
  if (BackdropPanel.root) BackdropPanel.root.classList.toggle("sp-gone", !DEBUG);

  // The meters cost a clock read per measured call, so they only run while
  // they are being looked at.
  Perf.on = DEBUG;
  PerfPanel.build();
  if (PerfPanel.root) PerfPanel.root.classList.toggle("sp-gone", !DEBUG);

  console.info(`DEBUG ${DEBUG ? "on" : "off"}`);
}

// The sound panel. It is built lazily rather than at startup, so the first
// time this is switched on the panel has to be made before it can be shown;
// after that it is only hidden, and keeps whatever was moved on it.
// Every line to and from the micro:bit, in the console. Lives in
// ubitwebusb.js (serialLog); this only flips the switch and says so, since a
// console-only feature with no sign it is on is a feature nobody finds twice.
function toggleSerialDebug() {
  DEBUG_SERIAL = !DEBUG_SERIAL;
  say(`micro:bit serial log ${DEBUG_SERIAL ? "on" : "off"} - see the browser console`);
  if (DEBUG_SERIAL) {
    console.log(`micro:bit serial log ON. Every line sent and received is printed here.`);
    serialLogCommands();
  }
  return false;
}

function toggleSoundDebug() {
  DEBUG_SOUND = !DEBUG_SOUND;

  if (DEBUG_SOUND) {
    SoundPanel.build();               // does nothing once it exists
    if (SoundPanel.root) {
      // A song loaded while the panel was away has moved SoundState under it,
      // and audio.js only refreshes a panel that already exists. So the
      // controls are pulled back into line with what is actually playing -
      // rather than applyAll(), which would push the panel's stale values out
      // over the song's own sounds.
      SoundPanel.refresh();
      SoundPanel.root.classList.remove("sp-hidden");
    }
  } else if (SoundPanel.root) {
    SoundPanel.root.classList.add("sp-hidden");
  }
  console.info(`DEBUG_SOUND ${DEBUG_SOUND ? "on" : "off"}`);
}

// p5 listens on the window, so a focused DOM button would also fire on the
// spacebar. Nothing in this app wants a button held focused after a click.
function blurFocusedButton() {
  const active = document.activeElement;
  if (active && active !== document.body && active.blur) active.blur();
}

//////////////////////////////////////////////////////////////////////
// FULLSCREEN
//
// Worth having for a show: the browser chrome is the one thing on the screen
// that is not the piece.
//
// The whole document goes fullscreen, not the canvas - there are two canvases
// and a pile of DOM on top of them, and fullscreening one of them would leave
// the rest behind.
//////////////////////////////////////////////////////////////////////

const FULLSCREEN_LABEL = ["fullscreen", "exit fullscreen"];

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// Only ever from a click or a keypress: a browser refuses the request
// otherwise, and rightly so.
function toggleFullscreen() {
  if (isFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
    return;
  }

  const el = document.documentElement;
  const go = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!go) { say("fullscreen: this browser will not"); return; }

  // Refusal comes back as a rejected promise rather than an exception, and it
  // is worth saying out loud - silently doing nothing looks like a dead button.
  Promise.resolve(go.call(el)).catch(err => say(`fullscreen refused: ${err.message}`));
}

// Entering or leaving changes the window size, so p5 gets a resize event of
// its own and the canvases follow. What it does NOT do is relabel the button
// or notice Escape, which is what this is for.
function watchFullscreen() {
  const changed = () => {
    if (ui.fullscreen) ui.fullscreen.html(FULLSCREEN_LABEL[isFullscreen() ? 1 : 0]);
    // The label just changed width and the top-right row is laid out from the
    // right edge, so it has to be placed again.
    layoutUI();
  };
  document.addEventListener("fullscreenchange", changed);
  document.addEventListener("webkitfullscreenchange", changed);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layoutUI();
  forgetDrawerBox();
}
