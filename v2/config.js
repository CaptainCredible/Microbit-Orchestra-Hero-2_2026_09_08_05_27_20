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

// The song's setup, as written in a folder. A dropped zip is allowed the
// other obvious spellings as well: a zip arrives from someone else's machine,
// where the file was named from memory rather than copied from a sibling
// folder, and a song that silently lost its name and tempo over a hyphen is a
// bad way to find out. Matched case-insensitively, so these are lowercase.
// What a song.setup may say about its backdrop.
//
// Several spellings for the one thing, because "video" was the name before a
// backdrop could be a shader and it is the wrong word now - but every song
// already written says it, so it keeps working. `backdrop` is the name to use.
const SONG_BACKDROP_KEYS = ["backdrop", "background", "shader", "video"];
const SONG_BACKDROP_DIM_KEYS = ["backdropDim", "videoDim"];
const SONG_BACKDROP_BRIGHTNESS_KEYS = ["backdropBrightness", "videoBrightness"];
const SONG_BACKDROP_CONTRAST_KEYS = ["backdropContrast", "videoContrast"];

// Every key a song.setup is allowed to have. Anything else in the file is a
// typo or a leftover from an older version, and is REPORTED rather than
// quietly skipped - a setting that does nothing and says nothing is a very
// long afternoon.
const SONG_SETUP_KEYS = ["name", "bpm", "blurb", "sounds"]
  .concat(SONG_BACKDROP_KEYS)
  .concat(SONG_BACKDROP_DIM_KEYS)
  .concat(SONG_BACKDROP_BRIGHTNESS_KEYS)
  .concat(SONG_BACKDROP_CONTRAST_KEYS);

// Exact spellings, canonical first. A folder is read over http, where the
// server cares about capital letters, so these are tried as written - the
// first one that answers wins and the rest are never asked for. A song using
// the canonical name costs exactly one request.
//
// (Inside a zip it does not matter: those names are matched case-insensitively,
// because a zip carries its own directory and there is nothing to ask.)
const SONG_SETUP_FILES = [
  "song.setup", "song-setup.txt", "songSetup.txt", "song_setup.txt", "setup.txt"
];

// The song's sounds, as a file of its own beside the parts.
//
// It is *exactly* what the sound panel's "export settings" button produces -
// the whole `const SOUND_DEFAULTS = { ... };` block - so tuning a song is:
// press d, move sliders, press "export settings", paste over this file. No
// reformatting, no picking bits out, no quoting.
//
// A few spellings are tried, for the same reason the part files have a few:
// a web server cares about capital letters and a hyphen, and nobody else does.
//
// Only a few, though. Every spelling that is not there is a request that has
// to go out and come back 404 - which is free off a local disk and is not free
// at all off a web server, where it is a round trip per guess and, on a host
// that redirects its 404s, a CORS error in the console for each one. The
// canonical name is the first entry and is what to use.
const SOUND_SETTINGS_FILES = [
  "sound-settings.txt", "sound_settings.txt", "sounds.txt"
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

// THE A AND B BUTTON LETTERS
//
// When a box lands, the button a player is meant to be hitting appears under
// the hit line: A over the kick lane, B over the snare - the very letters the
// micro:bit is sent, so what is on screen and what is in their hands agree.
//
// Two things spawn together:
//
//   the letter   set in Futura, coloured off the title's palette, and then
//                carried on down the highway toward the camera on the same
//                projection the boxes travel through. It leaves the frame by
//                growing and moving, not by fading.
//
//   the shaft    a stationary block the width of the lane, hung from the hit
//                line and running off the bottom of the screen. It does not
//                move or scale - it simply fades - so it reads as the lane
//                itself lighting up rather than as another flying object.
const BUTTON_POP_LETTERS = { kick: "A", snare: "B" };

// The face the letters are set in. Each entry is either
//
//   a font FILE      "fonts/KARNIVOD.ttf" - loaded and registered for you, so
//                    dropping a .ttf into fonts/ and naming it here is the
//                    whole job. No @font-face to write.
//
//   a family NAME    "Futura" - a face the machine already has installed.
//
// The first one that is actually available is used, so put the one you want
// first and leave something behind it to land on. Until a file has finished
// loading the next entry is used, which is usually invisible - it is a few
// frames at startup.
//
// A LIST, never a CSS stack in one string. p5's textFont() cannot take a
// stack: handed "Futura, Avenir, sans-serif" it quietly stops applying
// textSize at all and every letter comes out at the default size however large
// you asked for. So exactly one name is ever handed to it - see
// ButtonPops.face() in game.js.
const BUTTON_POP_FONT = ["fonts/KARNIVOD.ttf", "Futura", "sans-serif"];

// How big the letter is at the hit line, as a fraction of the smaller side of
// the window - so it holds its proportions on any screen rather than being a
// fistful of pixels on a projector and half the stage on a laptop.
//
// A TYPE SIZE, not a target width. Sizing each letter to a fixed width makes
// them different sizes, because a B is narrower than an A: fitting both to the
// same width leaves the B taller, which is exactly the wrong way round. One
// size for every letter is what makes them match, and their widths then differ
// the way the face intends.
const BUTTON_POP_SIZE_FRAC = 0.15;

// How long a letter lasts, in seconds, and how much of that is spent fading.
//
// Needed because the letter no longer has to move. When it travels it leaves
// by going off the edge; standing still, a lifetime is the only thing that
// ever takes it away - without one they stack up for the whole song.
const BUTTON_POP_LIFE = 0.4;
const BUTTON_POP_FADE = 0.55;   // the last fraction of the life, fading out

// How far past the hit line the letter travels before it is gone, in the same
// `u` the boxes and the starfield tunnel use: 1 is the horizon, 0 the hit
// line, and negative is nearer than the hit line - out through the camera.
//
// It does NOT get a lifetime of its own. It carries on at exactly the rate the
// notes were coming at, so how long it lasts is this distance over that speed -
// about half a second at the default lookahead. That is the whole point: the
// letter does not do something of its own, it keeps going the way everything
// else on the highway was already going.
//
// Scale is 1/(1 + u * PERSPECTIVE_DEPTH), so this must stay well above
// -1/PERSPECTIVE_DEPTH or the last frame before it wraps is a letter the size
// of the building. At the defaults -0.12 leaves it about 4.5x, which is
// already off both the bottom of the screen and the side.
const BUTTON_POP_U_MIN = -0.12;

// How fast it travels, as a multiple of the speed the notes come at. 1 is
// exactly the speed of the box it came from, which is the most honest - the
// letter simply carries on where the box stopped. Below 1 it lingers, which
// makes it easier to read at the cost of looking like a thing of its own
// rather than part of the same flow.
const BUTTON_POP_SPEED = 0.0;

// Clear air between the bar and the top of the letter, at the hit line. It
// grows with the perspective like everything else.
const BUTTON_POP_DROP = 10;

// Colour. Every letter is given its own off the title's palette - the same law
// the embers and the starfield use - so a run of them reads as sparks off the
// same fire rather than one flat colour repeated.
//
// `heat` is titleStop()'s band, and on the flame palette it drives the HUE as
// well as the brightness: low is deep red, high runs up through orange to
// near white. So the two lanes are given different bands, and A comes out red
// where B comes out orange while both stay on the one ramp.
//
// They are bands rather than fixed values because titleStop() mixes a shimmer
// of its own in on top; these bias the result, they do not pin it.
const BUTTON_POP_HEAT = {
  kick:  [0.00, 0.30],    // A - the red end
  snare: [0.55, 1.00]     // B - up into orange
};

// The shaft under each letter. Its colour is rolled separately from the
// letter's, so the two are never quite the same, and out of the whole ramp
// rather than the lane's band - a red letter on an orange shaft, or the other
// way about.
const BUTTON_POP_SHAFT_HEAT = [0.15, 0.95];
const BUTTON_POP_SHAFT_ALPHA = 0.30;   // it is a big block, so it stays quiet

// And its own lifetime, separate from the letter's, so the lane can hold its
// colour a moment longer than the letter that lit it - or go first.
const BUTTON_POP_SHAFT_LIFE = 0.2;
const BUTTON_POP_SHAFT_FADE = 0.75;

// How fast a shaft travels, down the same axis as everything else, as a
// multiple of the speed the notes come at - so 1 would keep pace with the
// letter above it.
//
// Rolled fresh for every shaft somewhere between these two, which is what
// stops a run of them moving as one slab: they set off together and then
// spread out. Either order; the smaller is the slower.
//
// Well under 1 on purpose. The letter is the thing being thrown at you; the
// shaft is the lane it came out of, and a lane that kept up with the letter
// would be a second projectile rather than a wake.
const BUTTON_POP_SHAFT_SPEED = [0.0, 0.0];

// Milliseconds added to every micro:bit send, relative to the audible hit.
// Positive = hardware fires later. Negative = earlier, to cover radio and
// solenoid travel time. Tunable live from the slider during play.
const DEFAULT_MICROBIT_OFFSET_MS = 100;
const MICROBIT_OFFSET_RANGE = [0, 200];

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

// ---- the highscore database ------------------------------------------------
//
// Scores go to Cloud Firestore on Firebase's free Spark plan - no card, and no
// way to be billed. The setup steps are in the README under "The highscore
// database", and the security rules to paste in are firebase/firestore.rules.
//
// Paste in the config Firebase shows for a web app. None of these values are
// secret: they only say which project to talk to. What protects the scores is
// the rules - anyone may read the published list, and only the operator
// account can add to it.
//
// Left empty, submitting still works: boards wait on this machine until this
// is filled in and the operator signs in on the highscores page.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD83F6NBFWx7ihs4Q_oRdQLwJSPzZP3YQs",
  authDomain: "mbohscores.firebaseapp.com",
  projectId: "mbohscores",
  storageBucket: "mbohscores.firebasestorage.app",
  messagingSenderId: "24449322097",
  appId: "1:24449322097:web:c493c9926c6aa5f0475fd0"
};

// Which song a score was for, when the record does not say.
//
// The game did not record a song at first, so every entry from before it did
// has none - and every one of them was the original. They are shown under this
// name rather than under a blank, which would look like a song of its own and
// sort to the top of the switcher.
//
// It has to match the song's `name` in its song.setup exactly, or the old
// scores end up in a second list beside the new ones for the same song.
const HIGHSCORES_DEFAULT_SONG = "The O.G.";

const HIGHSCORES_COLLECTION = "highscores";          // one document per result
const HIGHSCORES_TABLE_DOC = "highscores_meta/table";  // the published list: one read per view

const SCORES_TIMEOUT_SECONDS = 20;   // how long to wait for the database to answer
const SCORES_RETRY_SECONDS = 60;     // how often to retry while anything is waiting

// ---- telling somebody they have been approved ------------------------------
//
// Firebase does not send this one. The Spark plan sends exactly two mails, the
// verification and the password reset, both from fixed templates; a mail of
// your own needs Cloud Functions or the Trigger Email extension, and both of
// those want the Blaze plan and a card on file.
//
// So the manage tool writes it and hands it to YOUR mail client, already
// addressed and filled in, and you press send. One extra click, and better
// post than the free version would have been: it arrives from a real person at
// a real domain instead of noreply@<project>.firebaseapp.com, which is the
// address that keeps landing in everyone's spam folder, and a reply comes back
// to you rather than into a void.
//
// {name} {email} {url} are filled in; {url} is worked out from where the tool
// is being served, so it is right on a local copy and on the deployed site
// without being written down anywhere.
const OPERATOR_WELCOME_AUTO = true;   // false: don't open the mail client on approve,
                                      // just leave the button to press

const OPERATOR_WELCOME_SUBJECT = "You can now send micro:bit Orchestra Hero highscores";

const OPERATOR_WELCOME_BODY = `Hi {name},

Your request to become a highscore operator has been approved.

Open the game and go to the HIGHSCORES page, then sign in with {email} and the
password you chose when you asked. Scores from your sessions will go to the
global list from then on.

{url}

If it does not work, or you need anything, just reply to this email.
`;

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
let DEBUG = false;

let DEBUG_SOUND = false;

//////////////////////////////////////////////////////////////////////
// LOOK
//////////////////////////////////////////////////////////////////////

// The hit line sits above the HUD strip at the bottom, so exploding boxes
// and the readouts do not fight for the same pixels.
const HIT_LINE_FRAC = 0.80;   // hit line position, as a fraction of height
// The dark strip along the bottom of a playing page, and everything in it.
//
// Shrinking HUD_STRIP_H pulls the readouts down with it: they are one line,
// centred in the strip, so they follow it rather than staying put.
//
// WHAT IT DOES NOT DO BY ITSELF is move the highway down. The hit line takes
// the higher of two limits:
//
//     min(height * HIT_LINE_FRAC, height - HUD_STRIP_H - HUD_CLEARANCE)
//
// and at an ordinary window shape it is HIT_LINE_FRAC that decides, with the
// strip nowhere near it. So shrinking the strip only raises the CEILING on how
// far down the hit line is allowed to go - to actually use the room, raise
// HIT_LINE_FRAC as well.
//
// The readouts are ONE horizontal line, so the strip only has to be tall
// enough for a single row of type - about HUD_TEXT_SIZE + 8. They were three
// stacked rows once, which needed 118.
const HUD_STRIP_H = 20;      // reserved height for the readouts

// The line itself: size, the margin from the window edges, and the space
// either side of the separator between items.
const HUD_TEXT_SIZE = 12;
const HUD_PAD = 22;
const HUD_GAP = 10;
const HUD_SEPARATOR = "·";

// Space kept clear above the bottom edge for the timing drawer's handle, which
// is a DOM button sitting across the middle of the very bottom.
//
// Two things use it. The readout line will not sit lower than this, however
// short the strip gets - underneath the handle is no place for it. And the
// menu puts its own connection status here, so the line reads in the same
// place whichever page you are on.
const HUD_DRAWER_CLEARANCE = 0;

// Clear air between the hit line and the top of the strip, so an exploding box
// does not land on the readouts.
const HUD_CLEARANCE = 20;

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

// THE HIGHWAY, over a backdrop
//
// The lanes were drawn as a faint coloured wash when there was nothing behind
// them but a flat background. With a shader moving about back there they need
// two separate things, and they are separate knobs because they do opposite
// jobs:
//
//   GRID_OPACITY   how strongly the lanes themselves read - the coloured
//                  fill, the rails down the sides and the rungs across. Turn
//                  it up to make the highway assert itself.
//
//   GRID_DARKNESS  how much of the background colour is laid down INSIDE the
//                  lanes first, sinking whatever is behind them. Turn it up
//                  when a busy backdrop is showing through and making the
//                  notes hard to read. 0 leaves the backdrop untouched.
//
// Both are `let`, so they can be dialled from the console or from the sliders
// in the LOOK panel while a song is actually playing - which is the only way
// to judge them, since it depends entirely on the backdrop behind.
let GRID_OPACITY = 4.0;     // 0 invisible · 1 as drawn · up to 3 for emphatic
let GRID_DARKNESS = 0.62;    // 0 none · 1 solid background colour under the lanes

// The hi-hat diamonds in the middle lane. They are the only thing marking the
// hat, so they have to be findable against whatever is behind them, and they
// were sized for a plain background.
let HIHAT_SIZE = 24;        // at the hit line, in pixels, before perspective
let HIHAT_ALPHA = 255;      // out of 255
let HIHAT_GLOW = 2.2;       // halo size, as a multiple of the diamond; 0 for none

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
// A video behind everything, dimmed until it is only a suggestion of movement
// behind the stars.
//
// It is a plain DOM <video> under both canvases, not something drawn into
// them. The browser decodes it on the media engine and composites it on the
// GPU, so it never touches the frame budget - where pulling frames in with
// image() would mean a 1280x720 texture upload every frame, on the main
// thread. That is the whole reason this is a separate layer.
//
// There are three of them: the stage select, the score pages, and one per
// song. The editor never gets one, for the same reason it never gets stars -
// it is a workshop tool and a moving backdrop behind a grid is just noise.

// Behind the stage select. "" for none.
const BG_VIDEO_MENU = "shaders/fire.txt";
//const BG_VIDEO_MENU = "shaders/purpleOcean.txt";


// Behind the score pages: the scoreboard at the end of a song, and the
// highscores list off the menu. "" falls back to whatever the stage select is
// showing, so leaving it empty changes nothing rather than going blank.
//
// Named for a shader because that is what it is for, but it takes a video
// just as happily - the extension decides, the same as everywhere else.
const BG_SHADER_HIGHSCORE = "shaders/embers.txt";

// How long a backdrop takes to wash out and back in when it changes, in
// seconds. 0 cuts straight to the new one.
//
// There is one exception, and it is deliberate: starting a song fades the
// backdrop in over the COUNT-IN instead, however long that happens to be, so
// the picture arrives with the music rather than to a clock of its own. And
// finishing one washes the song's backdrop out before the score page's is
// put up, rather than cutting between two moving pictures.
const BG_FADE_SECONDS = 0.9;
// Behind a song that does not name one of its own. "" for none, and such a
// song plays against the plain background.
const BG_VIDEO_DEFAULT = "shaders/plasmaRainbowTunnel.txt";

// Where a bare filename is looked for. A song says `"backdrop": "aurora.mp4"`
// in its song.setup and the file lives here, shared between songs; anything
// with a "/" in it is used exactly as written instead, so a song folder can
// hold its own. `"video"`, `"background"` and `"shader"` all mean the same
// key - see SONG_BACKDROP_KEYS.
const BG_VIDEO_DIR = "videos/";

// A still image works as a backdrop too - .jpg, .jpeg, .png, .webp, .gif or
// .avif, named anywhere a video can be. How it fills a screen whose shape is
// not its own:
//
//   "contain"  all of it shows, with bars at the sides or top - for a card with
//              words or arrows on it, which must not have its edges cut off
//   "cover"    it fills the screen and its edges are cropped instead - for a
//              photo or a texture, where no edge matters
//
// The bars are black, which disappears against an image on black.
const BG_IMAGE_FIT = "contain";

// A backdrop can be a shader instead of a video, and the extension decides:
// .txt, .glsl, .frag or .fs is a fragment shader in GLSL ES 1.00, the WebGL 1
// dialect. Paste in the "Image" tab of a Shadertoy and it mostly runs.
//
// Mostly, because Shadertoy writes the newer GLSL ES 3.00 and a few things
// have to be translated by hand: tanh(), texture() for texture2D(), and
// for-loops, which in 1.00 must declare the index in the init and step it by a
// constant. See the top of shaderbg.js, which has the details and the reason
// this is not simply run as 3.00.
//
// See shaderbg.js for which uniforms are provided: all the plain ones, plus
// iSpark for the pointer's sparks, and none of the iChannel texture inputs,
// since there is nothing to plug into them.
//
// Bare shader names are looked for here, the way bare video names are looked
// for in BG_VIDEO_DIR.
const BG_SHADER_DIR = "shaders/";

// What fraction of the window a shader is rendered at, before the GPU scales
// it back up. This is the dial that decides what a shader backdrop costs.
//
// Unlike a video - decoded on the media engine and composited for free - a
// shader is real GPU work on every frame, as much as the shader asks for, and
// a heavy Shadertoy import can cost more than the game does. Sitting behind a
// heavy wash it is very forgiving of being rendered small: drop this to 0.5
// for a quarter of the pixels, and further if a clever shader is costing
// frames.
//
// Two of them, because the two screens are not competing for the same budget.
// The menu has nothing else to draw and can afford a sharp backdrop; a song
// has a highway of note boxes, the 3D shapes, the starfield tunnel and the
// micro:bit going at once, and a dropped frame there is a dropped frame in
// something somebody is playing along to. So the song is rendered smaller.
//
// Clamped to 0.1..1 when used, so an over-enthusiastic number here cannot ask
// for a zero-sized buffer or for more pixels than the window has.
const BG_SHADER_SCALE = 0.5;        // the stage select and the highscores
const BG_SONG_SHADER_SCALE = 0.5;   // GAME, PAUSE and END

// SPARKS
//
// Moving the pointer over a shader backdrop throws sparks off it. They are
// left along the path the pointer takes and then carried away by whatever the
// shader's own flow is - so they drift with the flames rather than floating
// over them - fading as they go. Clicking throws a handful at once.
//
// Any shader can use them. The preamble hands every one of them
//
//     uniform vec4 iSpark[N];     // x, y in 0..1 · a random seed · life 1..0
//
// and it is up to the shader to decide what a spark looks like and how its own
// flow should carry one. See the bottom of shaders/fire.txt for an example
// that puts each spark through the very same domain warp the fire is drawn
// through, which is what makes them look like part of it.

// How many sparks can be in the air at once. Each one costs every pixel a
// couple of instructions, which is nothing beside the noise these shaders are
// built from - but it is the dial if it ever matters.
const BG_SHADER_SPARKS = 28;

// How long a spark lasts, in seconds, from struck to gone.
const BG_SHADER_SPARK_LIFE = 2.2;

// How far the pointer travels, as a fraction of the screen, between one spark
// and the next. Smaller lays a denser trail; a fast drag throws more than a
// slow one either way, because it covers the ground quicker.
const BG_SHADER_SPARK_SPACING = 0.035;

// How many go up at once on a click.
const BG_SHADER_SPARK_BURST = 8;

// How far a burst scatters from the pointer, as a fraction of the screen, so
// a click reads as a shower rather than a stack of sparks in one spot.
const BG_SHADER_SPARK_SCATTER = 0.045;

// How a backdrop is graded. Two independent sets, because the two jobs are
// not the same: the menu has to stay readable under a logo, buttons and a
// column of song cards, while a song's backdrop is behind a note highway and
// can afford to be bolder.
//
//   dim         how much of the background colour is washed back over it.
//               0 shows it raw, 1 hides it completely. High, generally:
//               this is meant to be felt rather than watched.
//   brightness  a grade on top of the wash, for clips that are too flat or
//   contrast    too hot as shot. 1 and 1 leave the picture alone, and the
//               filter is skipped entirely when both are 1, so a backdrop
//               that needs no grading pays nothing for the feature.
//
// Turn on DEBUG and the BACKDROP panel works all three live, with a button
// that writes the lines to paste back - into the song's song.setup on a
// playing page, or into this file on the menu.

// The stage select and the highscores.
const BG_MENU_DIM = 0.0;
const BG_MENU_BRIGHTNESS = 1;
const BG_MENU_CONTRAST = 1;

// Songs. A song overrides any of these for itself with `"videoDim"`,
// `"videoBrightness"` and `"videoContrast"` in its song.setup; what it leaves
// out it takes from here.
const BG_SONG_DIM = 0.2;
const BG_SONG_BRIGHTNESS = 1;
const BG_SONG_CONTRAST = 1;

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

// How solid a song card sits on its background.
//
// The cards used to be nothing but a faint white sheen, which was fine over a
// flat background and became hard to read the moment there was a shader moving
// about behind them. So they get a backing of the background colour first, and
// this is how much of it: 0 is the old bare sheen, 1 is a card you cannot see
// through at all.
//
// `let`, so it can be dialled from the console against whatever backdrop is
// actually loaded rather than guessed at.
let CARD_OPACITY = 0.72;

// The sheen on top of that backing, which is what separates one card from the
// next and picks out the one under the pointer. Out of 255.
const CARD_SHEEN = [12, 26];    // [resting, hovered]

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
const STAR_SIZE_MENU = [1.7, 2.5];
const STAR_SIZE_GAME = [6.0, 13.0];

// Which way the menu field drifts, as a compass bearing in degrees:
//
//     0 up · 90 right · 180 down · 270 left
//
// 180 is the drift it has always had. Anything between works - 200 is a
// lazy diagonal - and the field wraps in both directions, so nothing runs out
// whichever way it is pointed.
//
// The angle is the one you see: it is corrected for the window's shape before
// it is used, so 45 is a true 45 degrees on screen rather than only on a
// square window.
//
// Read at draw time, so it can be turned live from the console.
let STAR_DIRECTION_MENU = 180;

// `let` rather than `const`, like DEBUG and TITLE_PALETTE, so both of these
// can be changed from the console while the thing is running and seen
// straight away - which is the only sane way to pick an angle.
//
// The menu field, on or off. The game's tunnel is a separate thing and is not
// affected - it flies off the highway's vanishing point and belongs to the
// song rather than to the wallpaper.
//
// Worth turning off when the backdrop is a busy shader: two sets of drifting
// sparks fight each other, and the shader usually wins.
let STAR_ENABLED_MENU = true;

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
const PAD_APPROACH_SECONDS = LOOKAHEAD_SECONDS * 0.4;
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

// The highscores page keeps a fire going around its list for as long as it is
// open: a steady trickle off the top and sides instead of one burst. Same
// embers - same life, rise, drag and colours as above - just gentler.
// The cost is a few dozen squares on screen at any moment.
const EMBER_GLOW_RATE = 55;          // embers a second
const EMBER_GLOW_SPEED = [30, 150];  // px/s - slower than the burst, so they drift
const EMBER_GLOW_SIZE = [4, 12];     // px
