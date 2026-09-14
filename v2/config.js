// Microbit Orchestra Hero 2 - tunable constants.
// Everything you are likely to want to retune by hand lives in this file.

//////////////////////////////////////////////////////////////////////
// CHANNEL MAP
//
// Three buses. The editor writes files using exactly this convention;
// imported files are matched against it first, then guessed at.
// (MIDI channels are 0-indexed here: channel 9 is what a DAW calls "10".)
//////////////////////////////////////////////////////////////////////

const BUS = { DRUMS: "drums", PADS: "pads", BASSKEYS: "basskeys" };

const CHANNEL_MAP = {
  9: BUS.DRUMS,     // GM percussion channel
  0: BUS.PADS,
  1: BUS.BASSKEYS
};

// General MIDI drum note numbers. Only these three do anything.
const DRUM_NOTES = {
  36: "kick",   // GM Bass Drum 1
  35: "kick",   // GM Acoustic Bass Drum - treated the same
  38: "snare",  // GM Acoustic Snare
  40: "snare",  // GM Electric Snare
  42: "hihat",  // GM Closed Hi-Hat
  44: "hihat",  // GM Pedal Hi-Hat
  46: "hihat"   // GM Open Hi-Hat
};

// Kick and snare are the two lanes that spawn falling boxes, and they are
// also what the micro:bit hears: kick -> "A", snare -> "B", both -> "X".
// That is the same protocol the original hex file already speaks.
const BOX_LANES = ["kick", "snare"];

// Inside the bass/keys bus, notes below this split to the bass voice.
//
// This is only used for a single file that carries both - a dropped .mid, or
// the editor's own export. A song folder has Bass.mid and Keys.mid as separate
// files, and there the voice comes from the filename, so a low keys line or a
// high bass line is perfectly possible.
const BASS_KEYS_SPLIT = 48; // C3

//////////////////////////////////////////////////////////////////////
// SONG FOLDERS
//
// A song is a folder under songs/, holding one .mid per part plus a
// song.setup describing it:
//
//   songs/
//     songs.json          the list of folders, in menu order
//     my-song/
//       song.setup        name, bpm, blurb and the sounds to play it with
//       Drums.mid
//       Bass.mid
//       Keys.mid
//       Pads.mid
//
// One file per part, because Ableton exports one track at a time - there is
// no multi-track type 1 export to work with. Every part is optional: a song
// with nothing but Drums.mid is a song.
//////////////////////////////////////////////////////////////////////

// A browser cannot list a directory over http, so the folders have to be
// named somewhere. This file is a plain JSON array of folder names, and the
// order in it is the order they appear on the menu.
const SONGS_MANIFEST = "songs/songs.json";

// The song's sounds, as a file of its own beside the parts.
//
// It is *exactly* what the sound panel's "export settings" button produces -
// the whole `const SOUND_DEFAULTS = { ... };` block - so tuning a song is:
// press d, move sliders, press "export settings", paste over this file. No
// reformatting, no picking bits out, no quoting.
//
// Several spellings are tried for the same reason the part files have
// several: a web server cares about capital letters and a hyphen, and nobody
// else does.
const SOUND_SETTINGS_FILES = [
  "sound-settings.txt", "sound_settings.txt", "sound settings.txt",
  "sound-settings.js", "sound-settings.json", "sounds.txt",
  "Sound-Settings.txt", "SOUND-SETTINGS.TXT"
];

// What a MIDI reader assumes when a file carries no tempo of its own. It is
// the MIDI standard's default, and it is what Ableton leaves you with:
// exporting a clip writes the notes but no tempo meta-event, so every reader
// - ours included - times them at 120 however slow the project was.
//
// That is why `bpm` in song.setup re-times the notes rather than just
// labelling them. See scoreFromParts().
const STANDARD_MIDI_BPM = 120;

// The parts, and which voice each file feeds. Filenames are matched
// case-insensitively - see songFileNames() in midi-io.js - because "Pads.mid"
// and "pads.MID" are the same part to everyone except a web server.
const SONG_PARTS = [
  { file: "Drums.mid", voice: "drums" },
  { file: "Pads.mid",  voice: "pads" },
  { file: "Bass.mid",  voice: "bass" },
  { file: "Keys.mid",  voice: "keys" }
];

// In a song folder's Drums.mid the drum is the *pitch class*, so C, C# and D
// work from any octave. That means you can write the part wherever it is
// comfortable on Ableton's piano roll rather than hunting for the GM numbers,
// and an octave shift cannot silently change which drum you meant.
//
// C and D agree with General MIDI - GM kick is 36 (C) and GM snare is 38 (D) -
// so the two ends of the kit land where a drummer expects. C# is the odd one:
// GM has nothing there, and GM's hi-hat is up at 42 (F#), which is not in this
// map at all. So the two conventions still disagree and must never be applied
// to the same file: DRUM_NOTES is General MIDI, for dropped files and the
// editor's own exports; this is for a song folder's Drums.mid.
const DRUM_PITCH_CLASSES = {
  0: "kick",    // C
  1: "hihat",   // C#
  2: "snare"    // D
};

//////////////////////////////////////////////////////////////////////
// TIMING
//////////////////////////////////////////////////////////////////////

// How far ahead of the hit line a note is spawned, in seconds. This is also
// how long the player sees a box before it lands. The perspective view packs
// distant notes into very little height, so this can be much longer than a
// flat scrolling view would allow.
const LOOKAHEAD_SECONDS = 4.5;

// The count-in: "one, two, three, four" on the hi-hat before every song, so a
// player has the tempo in their body before the first box lands.
//
// Counted in beats rather than seconds, and timed off the song's own bpm, so
// the four ticks are the song's four beats - a fixed number of seconds would
// count a 72bpm march at the same rate as a 140bpm breakbeat, which is worse
// than no count at all.
//
// Hi-hat on purpose: it is the one drum that spawns no falling box and sends
// nothing to the micro:bit, so the count is heard and seen without any
// hardware firing and without four phantom notes to hit.
const COUNT_IN_BEATS = 4;

// A moment of silence before the first tick, so the count does not begin in
// the same instant the audio engine wakes up.
const COUNT_IN_LEAD_SECONDS = 0.6;

// The numbers stamped in the middle of the screen with each tick - "1", "2",
// "3", "4" in the logo's display face, big and white.
//
// Sized against the window's shorter side so it fits a tall narrow window as
// well as a wide one, and so it is the same size relative to the screen on a
// laptop and a projector.
const COUNT_IN_NUMBER_FRAC = 0.42;

// Each number lands oversized and snaps down to full size, the way a stamp
// hits paper - it reads as struck rather than as a number being scaled up.
const COUNT_IN_POP = 1.7;            // the scale it arrives at
const COUNT_IN_SNAP = 0.16;          // seconds to settle from there

// How much of the beat is spent fading out, as a fraction. The number is gone
// before the next one lands, so two are never on screen at once.
const COUNT_IN_FADE = 0.45;

// Milliseconds added to every micro:bit send, relative to the audible hit.
// Positive = hardware fires later. Negative = earlier, to cover radio and
// solenoid travel time. Tunable live from the slider during play.
const DEFAULT_MICROBIT_OFFSET_MS = 25;
const MICROBIT_OFFSET_RANGE = [-500, 500];

// Nudges the visuals against the audio without touching either clock.
const DEFAULT_VISUAL_OFFSET_MS = 0;

//////////////////////////////////////////////////////////////////////
// SOUND
//////////////////////////////////////////////////////////////////////

// How many notes each polyphonic instrument may have sounding at once,
// counting release tails - with a 2.6s pad release the tails are most of what
// is audible, so a limit that ignored them would not be a limit.
//
// Going over does not drop a note: the quietest voice is stolen. See
// VoicePool in audio.js, and note that Tone's own PolySynth does the opposite
// and throws the newest note away, which is why the pool exists at all.
//
// The bass is monophonic and has no pool.
const PAD_VOICES = 8;
const KEYS_VOICES = 8;

// How long past its nominal release a voice is still counted as sounding.
// Tone's envelopes approach zero exponentially and report silence somewhat
// after the release time is up, so the pool has to allow for it or it hands
// out voices the synth does not think are free yet.
const RELEASE_MARGIN = 1.6;

// How quickly a stolen voice is faded out, in seconds. Long enough not to
// click, short enough that the voice is genuinely free again straight away -
// which is the whole point of stealing it.
const STEAL_FADE = 0.08;

// Tone's own maxPolyphony is set this much above the pool limit.
//
// It is a bookkeeping ceiling, not a voice count. Tone frees a voice only
// when its oscillator actually stops, which cannot happen inside the same
// call that needs it, so a stolen voice is never available to the note that
// stole it and Tone has to reach for a fresh one every time. Give it too
// little room and it drops notes: measured over the same busy passage,
// ceiling 16 dropped 16 notes, ceiling 20 dropped 8.
//
// Idle voices are close to free - Tone stops the oscillator rather than
// gating it, and its own garbage collection disposes voices back down to
// roughly the average number sounding - so the ceiling is cheap and the pool
// is what governs the DSP.
const POLY_HEADROOM = 24;

// Scores arriving over serial from the game master micro:bit, one line per
// controller:
//
//   S1, 45        S2, 126        S3, 0
//
// The number after the S is the *controller* number, and this is what it means
// on the scoreboard. At 0, controller S0 is player 0 - the first robot, Ali.
// Set it to 1 if the controllers count from S1 instead.
//
// Worth checking against the real hardware before an installation: an
// off-by-one here puts every score on the wrong robot, and the board will look
// perfectly plausible while it does.
const SCORE_CONTROLLER_BASE = 0;

// Housekeeping sent to the game master, down the same wire the A / B / X of
// play go down. One letter each, to match the protocol that is already there.
//
//   R  reset every controller's score to zero
//   S  ask every controller to report its score, which comes back as the
//      "S1, 45" lines below
const MICROBIT_RESET_SCORES = "R";
const MICROBIT_REQUEST_SCORES = "S";

// How long a line of feedback stays on the menu before fading out.
const NOTICE_SECONDS = 3.5;

// What a score line looks like. Deliberately loose about the separator and the
// spacing, because "S1, 45", "S1,45", "S1 45" and "S1:45" are all obviously
// the same message and which one the firmware sends is not worth a bug.
const SCORE_LINE = /^\s*[sS]\s*(\d+)\s*[,:; ]\s*(-?\d+(?:\.\d+)?)\s*$/;

// How many players the end-of-game scoreboard has room for, numbered 0..15 -
// the same count the micro:bit side works in, so a score reported over serial
// can be addressed by its player number with nothing to translate.
const SCOREBOARD_PLAYERS = 16;

// The robots' own names, in player order: player 0 is Ali, player 3 is Una.
// The board shows both, because they are two different things - the robot is
// the station you played at and never changes, the name in the box beside it
// is whoever is standing at it right now. Saying "Una got 400" across a noisy
// room works; saying "player 3 got 400" does not.
//
// Shorter than SCOREBOARD_PLAYERS is fine - a player past the end of this
// list simply shows no robot name - but keeping the two the same length is
// the point.
const ROBOT_NAMES = ["Ali", "Eir", "Ina", "Una", "Per", "Alf", "Ada", "Ela",
                     "Eli", "Mor", "Oda", "Ask", "Kai", "Ida", "Kim", "Eva"];

// ---- saving scores to a Google Sheet ---------------------------------------
//
// "submit scores" sends the board to a Google Sheet through a small Apps Script
// web app: free, no card, no server to run. The script is
// scores-backend/Code.gs, and the setup steps are in the README under "Saving
// scores to a Google Sheet".
//
// Every submission is saved on this machine BEFORE it is sent, and only
// deleted once the sheet confirms it has it. No internet at the venue loses
// nothing - it goes when the connection comes back. With SCORES_ENDPOINT left
// empty, submissions simply wait on this machine until one is set.
const SCORES_ENDPOINT = "";   // the web app URL, ending in /exec

// Must match SECRET in Code.gs. Not real security - anyone who can see this
// page's source can read it - just enough that stray requests to the URL are
// turned away. The worst someone holding it can do is add junk rows: the web
// app has no way to read, change or delete what is already in the sheet.
const SCORES_SECRET = "";

const SCORES_TIMEOUT_SECONDS = 20;   // Apps Script can take a few seconds to wake
const SCORES_RETRY_SECONDS = 60;     // how often to retry while anything is waiting

// How long a melodic note rings when the editor previews it on click - long
// enough to identify the pitch, short enough that clicking through a run of
// cells does not pile up overlapping tails. Drum previews need no duration;
// they are one-shots, same as a real hit.
const EDITOR_PREVIEW_DURATION = 0.35;

// Oscillator shapes offered by the waveform selectors.
const WAVEFORMS = ["sine", "triangle", "sawtooth", "square", "pulse",
                   "fatsawtooth", "fatsquare", "fattriangle"];

// Where the pad LFO can be routed.
//   pwm    - sweeps the pulse width, which is what actually makes it a PWM
//            sound. Needs a "pulse" waveform; on any other shape it does
//            nothing, because there is no width to move.
//   filter - sweeps the pad cutoff around wherever it is set.
//   level  - tremolo.
const LFO_DESTINATIONS = ["pwm", "filter", "level"];

// Everything tunable about the sound. The debug panel edits this live and
// hands the whole object back; paste an exported one over this to change the
// defaults.
//
// Reverb is a plain wet/dry amount per instrument: 0 is completely dry, 1 is
// completely wet. They all share one reverb, whose size is set once below.
const SOUND_DEFAULTS = {
  pads: {
    wave: "pulse",
    attack: 0.9,
    decay: 0.5,
    sustain: 0.7,
    release: 2.6,
    cutoff: 2085,        // Hz
    resonance: 1.0,

    // Per-voice filter envelope. Every sounding pad note gets its own filter
    // and its own sweep, which is what a filter envelope normally means and
    // what the one shared filter below cannot do - a shared one would
    // re-trigger its sweep on notes that were already ringing.
    //
    // filterOctaves is the master switch as well as the amount: at 0 the
    // per-voice filter is pinned wide open and the pads sound exactly as they
    // did without it. Above 0 each note sweeps from `cutoff` up by this many
    // octaves and back down.
    //
    // Measured: with it engaged the pad bus costs about 60% more than without,
    // which is around 27% of the whole mix - 7.3% of one core to 9.3% on a
    // 2023 laptop. PAD_VOICES is the knob if that is too much on a slow
    // machine, since the cost is per sounding voice.
    filterOctaves: 0,    // 0 = off. 2-3 is an obvious sweep
    filterAttack: 0.6,   // seconds
    filterDecay: 1.2,
    filterSustain: 0.35, // 0..1 of the way up
    filterRelease: 2.0,

    level: 0.5,
    reverb: 0.35,        // wet/dry, 0..1
    vibratoRate: 4.5,    // Hz
    vibratoDepth: 0.06,
    lfoDest: "pwm",
    lfoRate: 0.24,       // Hz
    lfoAmount: 0.35
  },
  bass: {
    wave: "sawtooth",
    attack: 0.01,
    decay: 0.25,
    sustain: 0.5,
    release: 0.6,
    cutoff: 700,
    resonance: 2.0,
    level: 0.8,
    reverb: 0.12
  },
  keys: {
    wave: "triangle",
    attack: 0.006,
    decay: 0.5,
    sustain: 0.15,
    release: 0.9,
    cutoff: 4500,
    resonance: 0.8,
    level: 0.6,
    reverb: 0.22
  },
  drums: {
    level: 1.0,
    reverb: 0.06
  },
  chorus: {
    rate: 0.35,
    depth: 0.45,
    wet: 0.5
  },
  reverb: {
    decay: 4.2,
    preDelay: 0.02,
    // Output gain of the shared reverb. A convolution tail spreads one note's
    // energy across the whole decay, so it returns far quieter than it went
    // in; without makeup here a wet setting of 1 would sound quieter than dry.
    level: 3.5
  }
};

// Range of every cutoff control, in Hz. The sliders move exponentially across
// it, because brightness is heard logarithmically - a linear sweep spends most
// of its travel where nothing much changes.
const CUTOFF_HZ = [60, 14000];

// Shows the sound parameter panel. Flip to true to tune the synths live and
// export the result; `d` then toggles the panel while the app is running.
// Developer affordances that should not be on screen at a performance. The
// sound panel has its own switch below, so the two can be turned on
// independently - tuning the sound on the night should not put a drop target
// back on the menu.
let DEBUG = true;

let DEBUG_SOUND = true;

//////////////////////////////////////////////////////////////////////
// LOOK
//////////////////////////////////////////////////////////////////////

// The hit line sits above the HUD strip at the bottom, so exploding boxes
// and the readouts do not fight for the same pixels.
const HIT_LINE_FRAC = 0.70;   // hit line position, as a fraction of height
const HUD_STRIP_H = 118;      // reserved height for the readouts

// Fake perspective for the note highway. The lanes converge on a vanishing
// point at HORIZON_FRAC, and a note's depth runs from 1 at the hit line to
// 1 + PERSPECTIVE_DEPTH at the far end of the lookahead. Everything is
// scaled by 1/depth, which is what gives the Guitar Hero recession - near
// notes big and far apart, distant notes small and bunched at the horizon.
const HORIZON_FRAC = 0.17;
const PERSPECTIVE_DEPTH = 6.5;

// Distant boxes fade out rather than piling up as unreadable slivers.
const FAR_FADE_START = 0.72;  // as a fraction of the lookahead
const BOX_W_FRAC = 0.17;      // box width, as a fraction of width
const BOX_H = 46;
const LANE_GAP_FRAC = 0.06;

// Everything that plays is taken off the flame ramp - the same one the logo,
// the starfield and the scoreboard's embers run on. Each instrument is a
// point on it, quoted below as its `heat` in titleStop()'s terms, so a colour
// can be nudged along the fire rather than picked out of the air:
//
//   heat 0.00  [151, 12, 2]     deepest ember
//   heat 0.30  [221, 67, 6]
//   heat 0.55  [247, 138, 41]
//   heat 0.75  [247, 187, 90]
//   heat 1.00  [248, 229, 150]  white-hot
//
// What separates one instrument from another is where it sits on that ramp,
// not a different hue: low and heavy things burn deep red, high and bright
// things burn near white. Kick and snare are the two lanes that must never be
// confused, so they are taken from opposite ends of it.
//
// text, dim, good and bad are deliberately NOT on the ramp. They are status
// colours - "micro:bit connected" in green, "not connected" in red - and
// making those two the same family of orange as everything else would cost
// the one distinction on screen that has to be readable at a glance.
const COLORS = {
  bg:        [8, 8, 14],
  hitLine:   [255, 246, 226],   // white-hot, just off white
  kick:      [175, 27, 3],      // heat 0.10 - deep, heavy
  snare:     [247, 187, 90],    // heat 0.75 - bright, cutting
  hihat:     [186, 172, 148],   // warm ash: on the ramp but desaturated
  pads:      [221, 67, 6],      // heat 0.30 - the bed the chord sits on
  bass:      [151, 12, 2],      // heat 0.00 - the lowest, so the darkest
  keys:      [248, 222, 138],   // heat 0.95 - the highest, so the hottest
  text:      [235, 235, 245],
  dim:       [130, 130, 150],
  bad:       [180, 64, 64],
  good:      [70, 225, 134]
};

// The menu title's display font. The family name is the one inside the .ttf,
// and the @font-face that loads it is in style.css. Everything else in the
// app stays monospace.
//
// The fallback matters: Chrome refuses to load a font over file://, so opening
// the page straight off disk draws the title in monospace rather than not at
// all.
// Bare family name, no quotes and no fallback list. p5 quotes the name
// itself if it contains whitespace, and it quotes the *whole string*, so
// handing it `"Nightmare Hero", monospace` comes back out as
// `""Nightmare Hero", monospace"`, which the browser rejects outright and
// silently leaves the previous font in place. The fallback is done in JS
// instead, in titleFont().
const TITLE_FONT_FAMILY = "Nightmare Hero";

// Everything that is not the title, canvas and DOM alike. The @font-face that
// loads it is in style.css, from fonts/ inside this folder.
//
// Same rule as above: a bare family name, no quotes and no fallback list. p5
// quotes whatever it is handed as a single family, so "hanken round,
// monospace" comes back out of the canvas as one family name that matches
// nothing and the text silently draws in the browser's default face. A space
// in the name is fine - measured, p5 quotes that correctly. The fallback is
// done in JS instead, by bodyFont().
//
// The DOM side takes a real stack, in style.css, so it falls back per glyph.
const BODY_FONT_FAMILY = "hanken round";
// A display face renders visually smaller than monospace at the same nominal
// size - measured, this one is 385px wide against monospace's 512px at 34px -
// so it is set larger to keep the weight the title had before. The subtitle
// below it is positioned from this, so changing it cannot make the two
// collide.
// Per line, not for the whole title. Three stacked lines make the block
// roughly 2.8x this tall, so it is much smaller than a one-line title would
// want. The lockup is scaled down at draw time if it would be wider than the
// cards below it, so setting this too large costs space rather than spilling
// off the edges.
const TITLE_SIZE = 140;

// The title cycles a rainbow through the letters and pulses as it goes.
// Costs two fillText calls a frame on the menu only, so it is affordable
// everywhere - there is deliberately no shadowBlur, which is the expensive
// way to get a glow.
// "logo" paints mBorchLOGO.svg; "text" sets the title from TITLE_LINES below.
// The logo falls back to the text on its own if the file cannot be loaded, so
// this is safe to leave on "logo" - opening the page straight off disk, or
// losing the file, still gives a title.
let TITLE_MODE = "logo";

const TITLE_LOGO_FILE = "mBorchLOGO.svg";
const TITLE_LOGO_HEIGHT = 300;   // wished height in px; fitted like TITLE_SIZE

// The artwork is a solid black silhouette - 25 paths, no strokes, no colours
// of its own - so it is used as a stencil and the same flame gradient that
// lit the text is painted through it. Drawn as-is it would be black on a
// black background.

// The title is a lockup: three stacked lines with one big numeral standing
// alongside them, spanning the whole stack. Used when TITLE_MODE is "text",
// and as the fallback when the logo cannot be loaded.
const TITLE_LINES = ["micro:bit", "ORCHESTRA", "HERO"];
const TITLE_BIG = "2";

// How the stacked lines line up with each other: "left", "center" or "right".
// The numeral always sits to the right of the stack whichever you pick, so
// "right" is the setting that butts the lines up against it.
let TITLE_ALIGN = "center";   // let, so it can be tried live from the console

// The vertical distance from the top of one line to the top of the next, as a
// fraction of TITLE_SIZE. 1.0 would leave a full font size between line tops;
// below that sets them tighter, which display faces usually want because
// their glyphs do not fill the em box. At TITLE_SIZE 88 this is 81px.
const TITLE_LINE_PITCH = 0.92;
const TITLE_BIG_SCALE = 1.06;   // the numeral's size against the stack height
const TITLE_BIG_GAP = 26;       // px between the stack and the numeral
const TITLE_BIG_DY = 0;         // nudge, for fonts whose digits sit high or low

// How tall the stack of lines is. The menu reserves its title space from
// this, so changing the size or the number of lines cannot overlap the cards.
const TITLE_BLOCK_H =
  TITLE_SIZE * TITLE_LINE_PITCH * (TITLE_LINES.length - 1) + TITLE_SIZE;
const TITLE_HUE_SPEED = 0.11;    // full turns of the colour wheel per second
const TITLE_HUE_SPREAD = 0.8;   // how many turns are laid across the width

// Which set of colours the title uses. Anything not in TITLE_PALETTES below
// falls back to "rainbow".
let TITLE_PALETTE = "flame";   // let, so it can also be flipped live from the console

// `wheel` says how the hue is derived, and it is the real difference between
// the two:
//
//   wheel: true  - the hue runs right round the colour wheel and the
//                  travelling band lifts the lightness. Every hue appears.
//   wheel: false - the hue stays inside `hue` and the band is read as *heat*:
//                  where the band is strong the colour runs up to the top of
//                  the range and almost white, and the rest sits down at the
//                  bottom of it. That is what makes fire look like fire -
//                  the colour and the brightness move together, rather than
//                  a fixed colour simply getting brighter.
//
// A new palette is just another entry here; "ice" would be hue [175, 205].
const TITLE_PALETTES = {
  rainbow: { wheel: true,  hue: [0, 360], sat: 95, light: [50, 70], glowLight: 66 },
  flame:   { wheel: false, hue: [4, 48],  sat: 98, light: [30, 78], glowLight: 50 }
};
// The pulse is a bright band that travels along the title from left to right
// rather than the whole word brightening at once.
const TITLE_PULSE_RATE = 0.45;      // trips along the title per second
const TITLE_PULSE_SPREAD = 1.0;     // bands visible across the width at once
const TITLE_PULSE_SHARPNESS = 2.5;  // higher is a tighter, more defined band
const TITLE_GLOW = 0.20;         // how bright the glow gets under the band
const TITLE_GLOW_RADIUS = 5;     // px the glow copies sit out from the letters
const TITLE_GLOW_COPIES = 6;     // drawn in a ring, so the falloff is even
const TITLE_GRADIENT_STOPS = 14; // smoothness of the sweep

// Starfield. Density is per pixel of canvas, clamped, so a big window does
// not end up with thousands of them.
const STAR_DENSITY = 1 / 9000;
const STAR_COUNT_RANGE = [60, 220];

// Star size in pixels: [furthest, nearest]. Each star is given a random
// distance and its size is taken from somewhere in this range, which is what
// makes the field read as having depth. Widen the gap for more parallax; set
// both to the same number for a flat field of identical dots.
//
// Two ranges, because the field is doing two different jobs. On the menu it is
// wallpaper behind the logo and wants to stay quiet. In the game it is flying
// at the camera through the same projection as the blocks, and a star is
// already shrunk by its own distance before it is drawn - so the numbers that
// look right standing still look like dust in flight.
//
// The size is taken from the star's `layer` at draw time rather than baked in
// when the field is built, so these can be changed live from the console and
// the menu and the game never have to agree.
const STAR_SIZE_MENU = [4.7, 8.5];
const STAR_SIZE_GAME = [6.0, 13.0];

// While a song is playing the field stops drifting down and flies at the
// camera instead, through the same projection as the falling blocks and off
// the same vanishing point, so the stars run parallel to the notes.
//
// How long a star takes to come from the horizon to the hit line. Defaulting
// to the lookahead makes a star travel at exactly the speed of the blocks;
// lower it for a faster rush past.
const STAR_APPROACH_SECONDS = LOOKAHEAD_SECONDS;

// How far past the hit line stars keep coming before they wrap. Negative is
// nearer than the hit line, and scale is 1/(1 + u * PERSPECTIVE_DEPTH), so
// this must stay above -1/PERSPECTIVE_DEPTH or the scale blows up.
const STAR_TUNNEL_U_MIN = -0.12;

// How far out from the vanishing point a star sits, as a fraction of the
// screen. The minimum is what stops one parking on the vanishing point and
// never appearing to move.
const STAR_TUNNEL_SPREAD = [0.18, 1.15];

// Stars grow as they approach; this stops the last frames before one leaves
// the screen turning into a large square.
const STAR_TUNNEL_MAX_SIZE = 9;

//////////////////////////////////////////////////////////////////////
// THE 3D SHAPES
//
// The lit shapes on the layer behind - pad spheres on the right, the bass
// ring and keys cubes on the left - fly at the camera while their note
// sounds, through the *same* depth law as the falling blocks, so the whole
// scene moves as one thing rather than as a highway with ornaments beside it.
//
// A shape's position is a depth `u`, exactly as a note's is: 1 at the horizon,
// 0 at the hit line, and everything scaled by 1/(1 + u * PERSPECTIVE_DEPTH).
// It is born at its own U_START and `u` falls at 1/approach per second, so an
// approach time equal to LOOKAHEAD_SECONDS is, by definition, the speed the
// blocks travel.
//
// The three shapes each get their own block below. Every one has the same six
// knobs, so they read the same way:
//
//   _U_START           where it is born, in highway depth. 1 is the horizon,
//                      0 the hit line. Bigger is further away, so the flight
//                      lasts longer and it starts smaller.
//   _X                 where it sits across the screen AT THE HIT LINE, as a
//                      fraction of the window from the middle. Negative is
//                      left, so -0.5 is the left edge and +0.5 the right.
//   _Y                 same, down the screen: negative is up. This is the
//                      middle of the shape, or of the chord for the two that
//                      spread by pitch.
//   _Y_SPREAD          how far a voicing opens out either side of _Y, by
//                      pitch, so a chord reads as a shape. 0 stacks every
//                      note on one spot. (Not on the bass - it is monophonic,
//                      there is never more than one ring.)
//   _APPROACH_SECONDS  how long it takes to cross the whole lookahead. Equal
//                      to LOOKAHEAD_SECONDS is exactly the blocks' speed;
//                      larger is slower. Written as a multiplier so a change
//                      says what it means.
//   _SIZE              [base, swell] in pixels, as it would appear at the hit
//                      line. base is its size at the quietest, swell is what
//                      the note's envelope adds on top. Perspective shrinks
//                      them from there, so a shape born at the horizon starts
//                      at about an eighth of these and grows as it comes.
//
// X and Y are measured *at the hit line*, in the same frame the lanes are.
// Behind that a shape opens out from the highway's vanishing point towards
// its place, exactly as a lane widens - so the further back it is born, the
// nearer the vanishing point it appears and the smaller it starts.
//
// They used to be measured at the shape's own start depth, which pinned every
// shape to one spot on screen however far back it was born: they always
// appeared around the middle and flew outwards from there, while the stars
// and the blocks radiated from the horizon. Two vanishing points, which is
// exactly what it looked like.
//
// _U_START and _APPROACH_SECONDS are the two knobs for how long a shape is
// visible: how far back it starts, and how fast it covers the ground.
//////////////////////////////////////////////////////////////////////

// The envelope below which a shape starts to disappear as well as quieten.
//
// Each shape's brightness is `base + span * envelope`, and that `base` is
// there so a quiet note is still visible - but it also means the brightness
// never reaches zero. A pad sphere used to sit at 55% of full while its note
// faded away, and then vanish outright the moment the envelope crossed the
// threshold that stops it being drawn at all: it did not fade out, it winked
// out at half brightness.
//
// So above this knee nothing changes, and below it the whole colour is scaled
// down to nothing. Raise it to start fading earlier and more gently; set it to
// 1 and a shape's brightness follows its envelope the whole way down.
const SHAPE_FADE_KNEE = 0.35;

// How long the arrival flash lasts, in seconds, and how far towards white it
// lifts the shape's own colour at its brightest.
//
// A shape does not fade in - it arrives at full strength, in a hot version of
// its colour, and settles into its own over this long. Fading in put the
// quietest part of a shape's life at the moment its note was struck, which is
// the one moment it should be loudest.
//
// How far it lifts is shared; how long it lasts is per family, down in each
// family's own block - PAD_PULSE_SECONDS, BASS_PULSE_SECONDS,
// KEYS_PULSE_SECONDS. The pads want a much longer one than the struck shapes:
// a chord is a thing that arrives and stays, and a flash the length of a bass
// hit is over before you have registered the chord at all.
//
// Set SHAPE_PULSE_LIFT to 0 to turn the flash off everywhere; set it to 1 and
// a shape arrives white. Set a family's seconds to 0 for no flash on that one.
const SHAPE_PULSE_LIFT = 0.75;

// How the bass rings and keys cubes arrive: bigger than their true size, and
// settling onto it over this long.
//
// They are struck, not swelled. Growing in from nothing is right for the pads
// - a chord really does bloom, and a sphere swelling reads as one - but a
// bass note and a key are hit, and a hit thing wants to arrive whole and
// overshoot, the way a drum skin does. The pads keep grow(); these two get
// settle() instead.
//
// Kept short and modest on purpose. This is the one place a shape is allowed
// to get SMALLER, which normally reads as retreating - see grow() for why
// that must not be allowed to happen anywhere else.
const SHAPE_SPAWN_OVERSHOOT = 1.35;
const SHAPE_SETTLE_SECONDS = 0.28;

// How long a shape takes to fade out after its note lets go, in seconds.
//
// This is the only fade there is. It was briefly joined by one that dimmed a
// shape as it neared the edge of the window; that was wrong - a shape on its
// way past the camera is not finishing, it is leaving, and dimming it made
// anything tuned to sit near an edge permanently dark.
//
// The fade is carried by ALPHA, not by scaling the colour down to black.
// Black is not the same as gone: a black shape still writes depth and paints
// a hole where whatever is behind it should be.
const SHAPE_RELEASE_SECONDS = 0.9;

// The last slice of a shape's flight, as a fraction, over which it fades out.
//
// Mostly insurance: a shape sweeps off the side of the window well before its
// flight ends, so this is rarely seen. It is here so that one which somehow is
// still in frame at the end goes out rather than blinking.
const SHAPE_FLIGHT_TAIL = 0.02;

// Manual nudge for where the 3D shapes converge, as a fraction of the window.

let SHAPE_VP_X = 0;
let SHAPE_VP_Y = 0.0;   // tuned by eye against the marker; see above

// Where the shapes are heading - the near end of the line, as a fraction of

let SHAPE_DEST_X = 0;
let SHAPE_DEST_Y = 0.5;

// How near the camera a shape may get before it is simply dropped.

const SHAPE_U_MIN = -0.12;

// ---- pads: the chord, one sphere per note, on the right ----------------
const PAD_U_START = 1.0;   // 1 = the horizon, where a block spawns
const PAD_X = 0.66;
const PAD_Y = -0.5;      // biased up: at the full spread the lowest note of
                          // a chord sat down inside the HUD strip
const PAD_Y_SPREAD = 1.00;
// Born at the horizon now, so it has the whole lookahead to cross rather
// than the last third of it. Much slower than this and a pad spends its
// entire note as a dot at the vanishing point.
const PAD_APPROACH_SECONDS = LOOKAHEAD_SECONDS * 1.0;
// A four-sided pyramid, drawn as a cone with four segments. The pair is the
// base radius: the first number is the size at the note's onset, the second
// how much more it grows to as the chord blooms.
const PAD_PYRAMID_SIZE = [25, 80];
// How tall, as a multiple of that base radius. Above about 2 it reads as a
// spike rather than a pyramid; below 1 it flattens into a plate.
const PAD_PYRAMID_HEIGHT = 1.6;
// Four for a square base. Raise it and the pyramid becomes a cone; three
// gives a tetrahedron.
const PAD_PYRAMID_SIDES = 4;
// Much the longest of the three. The pads bloom rather than being struck, and
// the flash has the whole bloom to sit over rather than a single hit.
const PAD_PULSE_SECONDS = 1.4;

// ---- bass: one heavy ring, low on the left -----------------------------
const BASS_U_START = 1.0;
const BASS_X = 0.0;
const BASS_Y = -1.0;      // lifted off the floor: down at 0.22 it sat in the
                          // explosion debris
const BASS_APPROACH_SECONDS = LOOKAHEAD_SECONDS * 0.3;
const BASS_RING_SIZE = [50, 70];
const BASS_PULSE_SECONDS = 0.55;
// The bass is monophonic: when a new ring spawns, the one before it fades out
// over this long, however long its own note was still meant to sound. Keep it
// short - it is a hand-off, not a release. 0 cuts the old ring off outright.
const BASS_CUTOFF_SECONDS = 0.12;

// ---- keys: cubes stacked by pitch, above the bass ----------------------
const KEYS_U_START = 1.0;
const KEYS_X = -0.66;
const KEYS_Y = -0.5;
const KEYS_Y_SPREAD = 0.5;
const KEYS_APPROACH_SECONDS = LOOKAHEAD_SECONDS * 0.3;
const KEYS_CUBE_SIZE = [32, 84];
const KEYS_PULSE_SECONDS = 0.55;

const PARTICLES_PER_EXPLOSION = 26;
const PARTICLE_LIFE = 20; // frames

// Embers thrown off the scoreboard as it lands at the end of a song.
//
// They are born on the panel's outline and fly outward, so they come out from
// behind its edges rather than being hidden under it - the panel is opaque
// and sits above this canvas, so anything spawned in the middle would simply
// not be seen.
//
// EMBER_COUNT is the whole burst, not a rate: it is spent over
// EMBER_BURST_SECONDS and then the thing is finished, so the cost is bounded
// no matter how long the END page is left up. They take their colours from
// whichever TITLE_PALETTE is active, the same as the starfield, so the fire
// on the board matches the fire on the logo.
const EMBER_COUNT = 150;
const EMBER_BURST_SECONDS = 1.5;    // how long the burst keeps throwing them
const EMBER_LIFE = [0.7, 1.7];      // seconds
const EMBER_SIZE = [4, 14];          // px, square, like the stars and particles
const EMBER_SPEED = [50, 320];      // px/s, outward from the edge it was born on
const EMBER_RISE = -170;            // px/s^2 - negative, so embers float upward
const EMBER_DRAG = 1.9;             // per second; higher slows them sooner
const EMBER_SPREAD = 0.7;           // radians of scatter either side of straight out
