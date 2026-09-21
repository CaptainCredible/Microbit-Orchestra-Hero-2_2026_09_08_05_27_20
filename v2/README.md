# Microbit Orchestra Hero 2

Reads a MIDI file, drops boxes down two lanes, explodes them on a hit line,
plays the whole arrangement through Tone.js, and fires the same messages at a
micro:bit that the first version did.

    kick  -> "A"        snare -> "B"        both at once -> "X"

That is the protocol the original hex file already speaks, so the micro:bit
side does not need changing.

## Running it

WebUSB only works from a secure context, so open it over localhost rather
than double-clicking the file:

    cd v2
    python3 -m http.server 8777
    # then open http://localhost:8777 in Chrome

Chrome or Edge only — Firefox and Safari have no WebUSB.

Opening `index.html` straight off disk mostly works: the built-in songs are
rebuilt in memory when `fetch` is blocked, and drag-and-drop still works. But
the micro:bit will not connect, so use the server.

## Adding a song

A song is a **folder** under `songs/`, with one `.mid` per part — because
Ableton exports one track at a time and there is no multi-track type 1 export
to work with.

```
songs/
  songs.json           the list of folders, in menu order
  my-song/
    song.setup         name, bpm, blurb
    sound-settings.txt the synth settings, exported from the sound panel
    Drums.mid          C = kick, C# = hihat, D = snare, in ANY octave
    Bass.mid
    Keys.mid
    Pads.mid
```

Export each track straight into the folder, then **add the folder's name to
`songs/songs.json`** — a browser cannot list a directory, so the folders have
to be written down somewhere, and the order in that file is the order on the
menu.

**Every part is optional.** A song with nothing but `Drums.mid` is a song;
`calibration/` is exactly that.

**The filename decides the instrument**, not the channel and not the pitch. A
bass line written up at C4 is still the bass, and a low keys part is still the
keys. Case does not matter — `Pads.mid`, `pads.mid` and `PADS.MID` are all
found, because a web server cares about capital letters and nobody else does.
The load line on the console reports the name a part was actually found under.

**A drum is its pitch class** — **C = kick, C# = hi-hat, D = snare** — from any
octave. Write the part wherever it is comfortable on the piano roll; an octave
shift cannot silently change which drum you meant.

C and D deliberately agree with General MIDI (GM kick is 36 = C, GM snare is
38 = D), so the two ends of the kit are where a drummer expects. The hi-hat is
where the two conventions part: GM puts it up at 42 (F#), which means nothing
as a pitch class, and C# means nothing in GM. So they must never both be
applied to the same file — `DRUM_NOTES` is General MIDI, for dropped files and
the editor's own exports; `DRUM_PITCH_CLASSES` is for a song folder's
`Drums.mid`.

### song.setup

`songs/four-on-the-floor/song.setup` is the annotated reference copy: every
field explained, and a full `sounds` block. A real one can be a tenth of the
size — `calibration/song.setup` is four lines.

It is JSON with two relaxations, because it is meant to be written and read by
a person: `//` and `/* */` comments are stripped, and a trailing comma before a
`}` or `]` is forgiven. A `//` inside a string survives. Anything else that
will not parse is *reported* on the menu rather than silently falling back to
defaults — a typo that quietly reverted a whole song would be very hard to
spot.

| Field | |
|---|---|
| `name` | shown on the card; falls back to the folder name |
| `bpm` | the tempo you set in Ableton |
| `blurb` | the line under the name; optional |

**`bpm` re-times the notes.** It is not a label — it is the tempo the song is
played at, and it has to be, because of how Ableton exports:

> Ableton writes the notes of a clip but **no tempo meta-event**. Every reader
> then falls back to the MIDI standard's 120 bpm. The note *positions* survive;
> the *seconds* do not.

So a 70 bpm song exported from Ableton arrives timed as though it were 120 and
plays 1.7× too fast. `scoreFromParts()` scales every time and duration by
`fileTempo / declaredTempo`, which for that case is `120 / 70`. A file that
does carry the right tempo scales by 1 and is untouched.

The test of whether the declared tempo is right is whether the notes land on a
grid: Slow Sorrow's first note read as 0.29 of a beat before this, and lands on
exactly 0.5 of one after it, with 96% of its notes on a 16th.

Two tempos, two different reports:

| in the file | meaning | what happens |
|---|---|---|
| nothing, or 120 | indistinguishable — and Ableton produces this constantly | re-timed, noted in the console |
| any other tempo | two things claim to know the tempo and disagree | re-timed **and** flagged on the menu in red |

### sound-settings.txt

A song's sounds are a file of their own, and it is **exactly what the sound
panel's "export settings" button produces** — the whole
`const SOUND_DEFAULTS = { … };` block, pasted in unchanged. So tuning a song
is: press `d`, move sliders, press **export settings**, paste over the file.
No reformatting, no picking bits out, no quoting.

`songs/four-on-the-floor/sound-settings.txt` is the annotated reference, with
every setting in it. `songs/breakbeat/sound-settings.txt` is the other
extreme — one `keys` block and nothing else.

That block is JavaScript rather than JSON, so `parseSoundSettings()` quotes the
bare keys and peels off the declaration and semicolon around the object, on top
of the comments and trailing commas `song.setup` already allows. Notes to
yourself in it survive until the next export. It is **parsed, never `eval`'d** —
a file out of a song folder must not be able to run code.

Anything left out uses the default, so you only write down what you changed.
Each song starts from `SOUND_DEFAULTS` rather than from whatever the song
before it left behind: a song that says nothing about the bass gets the
default bass, always. A setting whose name is unknown or whose type is wrong
is ignored and the rest still loads.

**Sounds used to live in `song.setup`.** A `sounds` block left behind there is
now reported on the menu rather than silently ignored — otherwise the song
would play with the default sound while its file appeared to say otherwise.

The per-instrument **save**/**load** buttons still exist and are unchanged:
they write a single instrument as a `{ kind, instrument, settings }` preset,
which is a different thing for a different job.

Sounds are loaded when you pick a **different** song, and deliberately not on
restart — restarting is what you do constantly while tuning, and having each
restart throw away the tweak you just made would make the panel useless.
Switching away and back does reload from the file, which is how you hear
whether the block you pasted in is what you meant.

## The three buses

Notes are sorted into three buses. The channel numbers below are what a DAW
calls them; internally they are 0-indexed. **This applies to a single file
carrying everything** — a dropped `.mid` or the editor's own export. In a song
folder the part files decide instead, and neither the channel nor the pitch is
consulted.

| Channel | Bus | What it does |
|---|---|---|
| 10 | drums | kick and snare fall as boxes and drive the micro:bit; hi-hats are the small diamonds |
| 1 | pads | swelling pyramids, stacked up the right-hand side |
| 2 | bass / keys | a swelling ring and cubes, down the left-hand side |

Drum notes follow General MIDI: 35/36 kick, 38/40 snare, 42/44/46 hi-hat.
Anything else on the drum channel is counted as ignored and dropped.

The bass/keys bus splits on pitch: below C3 (MIDI 48) plays the bass voice,
C3 and above plays the brighter keys voice. That is the "bass or keys
depending on octave" behaviour, and `BASS_KEYS_SPLIT` in `config.js` moves it.

**Only kick and snare make boxes**, because they are the only two things the
micro:bit can be told about. A file with neither is flagged on its card in the
stage select rather than opening an empty stage.

### Files that do not follow the convention

Imported files are matched in this order:

1. the channel map above,
2. the track name (`/drum|perc|kick|snare|hat|kit/`, `/pad|string|choir/`,
   `/bass|key|lead|piano/`),
3. a guess from the average pitch of the track.

Channel 10 is a General MIDI standard, so drums from a DAW usually land
correctly on their own. The other two are guesses, and a file with neither
useful channels nor useful track names can be sorted wrongly — the note counts
on each stage-select card show what actually happened.

## Type 0 or type 1?

**Both work.** Reading is done by `@tonejs/midi`, which parses either and
applies the tempo map for you. Type 1 is if anything easier, because separate
tracks give the classifier something to work with.

Type 0 matters only on the way *out*: the editor writes format 0, which is why
`midi-io.js` has its own encoder. `@tonejs/midi` can write MIDI but hardcodes
`format: 1` in the header, so it could not be used for that.

## The editor

`open MIDI editor` gives a step grid. Click and drag to draw.

- **Clicking to add a note plays it** — a drum hit fires as a one-shot, a
  melodic note rings for `EDITOR_PREVIEW_DURATION` (0.35s), just enough to
  tell you whether it is the right pitch and instrument. Audio starts on
  demand the same way picking a song does, so the very first click on a fresh
  visit to the editor is what turns it on. Erasing a note stays silent, and a
  drag that extends a held note previews once, at the click that starts it —
  not once per step, which would turn one long note into a machine-gun roll.
- Drum cells are one hit each.
- Melodic cells that sit next to each other are **tied into one held note**:
  drag across four steps and you get a single long pad, not four stabs. A tie
  is drawn as one joined bar with a brighter head where it is struck, so what
  you see is the note you get. Drum cells are never tied — each one is a hit.
  A tie carries **across a page boundary**: a pad drawn to the end of one page
  and on into the next is one held note, not two. Collecting the song page by
  page instead retriggered every long note at each boundary, which importing a
  file full of sustained pads made very audible.
- **Clicking the head of a held note removes the whole thing**, not just the
  step under the cursor — the same idea as picking up one long object rather
  than chipping at its edge. Clicking anywhere else in the middle only erases
  that one step, splitting the note in two, same as before. Drums have no
  "head" to speak of, since they are never tied, so a drum click always
  erases just that hit.
- **A drag is locked to the row it started on.** Only the mouse's left-right
  position moves the note along; if your hand drifts up or down while
  holding the button, the note being drawn stays on its own lane rather than
  spilling onto whichever row the cursor happens to wander over.
- **The scroll wheel scrolls whichever lane the mouse is over** — the same
  move the section's ▲▼ buttons make, just without having to aim for them.
  It works over a melodic row; a drum row has nothing behind it to reveal,
  so the wheel does nothing there.
- `import .mid` reads a file onto the grid — see below.
- `download .mid` writes a type 0 file you can drop back in, or open anywhere
  else.
- `play this in the game` sends it straight to the falling boxes.

### Pages

A song is a list of pages that play one after another, and each page has its
own length. The strip under the header shows them all as `number·bars`, with
the current one highlighted.

`add page` inserts a blank page after the current one and moves to it.
`remove page` drops the current one (on the last remaining page it clears it
instead). `copy page` and `paste page` duplicate a page — paste writes over the
page you are on rather than inserting, so it is a way of repeating a section
into a page you have already made room for. `bars -` / `bars +` change the
length of the current page only.

### Importing a .mid file

`import .mid`, or dropping a file anywhere on the editor page, reads it onto
the grid. Both type 0 and type 1 work, and the tracks are sorted into drums,
pads and bass/keys by exactly the rules the game uses — channel first, then
track names, then a guess from the notes.

The editor is a step grid, in one key, at one tempo, so a file has to be fitted
to it:

- **Tempo** comes from the file's first tempo mark, clamped to the 40–220 the
  editor can hold. A file with a tempo map is imported at its first tempo.
- **Times** are quantised to 16th notes, and note lengths with them.
- **Key** is detected, not assumed: the root and scale that cover the most of
  the file's melodic notes win. The grid only has rows for notes in the scale,
  so importing into the wrong key would snap half the file to wrong pitches.
- **Notes outside the detected scale** are snapped to the nearest pitch that
  has a row, so every imported note is one you could have drawn yourself. The
  count is reported.
- **Drums** are folded onto the three rows the editor has — any GM kick, snare
  or hat number lands on its row — and are never tied, however long the note.
- **Length** is cut into four-bar pages, up to 64 of them. Anything past that
  is dropped and reported.
- Each section is **scrolled to where its notes landed**, so an import you
  cannot see looks like an import that did not happen.

The result is reported in the top right: notes, pages, tempo, detected key, and
anything that had to be snapped or dropped.

Importing replaces the whole song and there is no undo, so it asks first if
there is anything written.

A song written in the editor survives the round trip exactly — `download .mid`
then `import .mid` gives back the same notes at the same pitches and times, the
same tempo, and the same page count. All the built-in songs do too.

### Play and stop

`play` — the button, or the **spacebar** — runs the arrangement from the top of
the page you are looking at, then on into whatever `mode: advance` / `mode:
loop page` says happens next. A playhead sweeps the grid and the view follows
it from page to page. `stop` returns to the beginning.

The spacebar drops focus from whatever button was last clicked before it acts:
a focused `<button>` is activated by the spacebar too, and would otherwise
toggle playback a second time on key up.

**Edits are heard as you make them.** Anything that changes the song marks it
dirty and the schedule is rebuilt in place on the next frame, keeping the
playhead where it is — so a note drawn mid-loop is there on the next pass
without stopping. Play also always rebuilds from the current song; reusing
whatever happened to be on the transport was what previously made edits go
unheard.

### Loop mode

`mode: advance` / `mode: loop page` toggles `Editor.loopMode` between the two
things the transport's own loop can do:

- **advance** (the default) plays through every page in order and wraps back
  to the first once the last one ends — the arrangement, end to end.
- **page** loops just the page you are on. Useful for working a beat until it
  is right without the arrangement wandering off into whatever comes next.

Switching modes mid-playback rebuilds the schedule in place, the same
mechanism edits use, so the new loop bounds take hold on the next frame
rather than waiting for you to touch something else first.

### Jumping pages while it is playing

`< page` / `page >` do two different things depending on whether anything is
playing:

- **Not playing**, they just change which page you are looking at, same as
  always.
- **Playing**, they jump the transport itself to the same position on the
  next or previous page — ten steps into page one lands you ten steps into
  page two, not back at its start. Without this the click would have no
  lasting effect at all: `Editor.draw()` follows the transport's real
  position every frame and would snap the view straight back to whichever
  page is actually playing. If the target page is shorter than how far in you
  were, the position clamps to its last step rather than overshooting into
  the page after it. In `loop page` mode this is also what moves the loop
  itself onto the new page.

### Scroll, transpose and clear

Each melodic section has five small buttons in the gutter beside its top row:

- **▲ ▼** (grey) scroll the section's pitch window, to reach notes above or
  below the rows currently shown.
- **− +** (in the section's colour) move that section's notes up or down.
- **×** empties the section on the current page.

The colours mark the difference: grey moves the *view*, coloured moves the
*notes*. Scrolling shows a different part of the keyboard and leaves everything
where it is — cells are keyed by pitch rather than row position, so a note
scrolled off the top is still there when you scroll back. Transposing actually
rewrites the notes on the current page: you see them move, and the exported
pitch is whatever the grid shows.

Both work a scale degree at a time, so everything stays in key. That is also
why transpose is not in semitones: the grid only has rows for notes in the
scale, and a semitone step would land a note on a pitch with no row and make it
invisible.

Which section a note belongs to is decided the same way playback decides it —
by channel, then by the bass/keys split at C3. So a bass note transposed up
past the split becomes a keys note, and moves with the keys after that.

Kick, snare and hihat each get their own **×** on their row, since they are
separate parts. `clear page` still wipes everything on the page at once.

Every one of these works on the stored notes, not on the rows on screen, so a
part is cleared whether or not it is currently scrolled into view.

### Notes off screen are still notes

A section shows a window onto the scale, and scrolling moves the window. Notes
outside it are hidden but still part of the song: they play, they export, and
they are cleared and transposed with the rest of their section. Building the
song from the visible rows instead of from the stored cells was a bug — a note
scrolled out of view was silently dropped from the arrangement.

## Voices

Everything is synthesised — there is no sample loading. Measured, samples were
about 29% cheaper for the drum voices alone but only ~0.6% of one core across
the whole mix, and the gap closed as the pattern got busier: the synth drums
are three *monophonic* generators, so their cost is flat however many hits you
throw at them, while a sampler spawns a voice per hit. The synth path is the
one that degrades gracefully.

### The pads' filter envelope

The pads run on `PolySynth(MonoSynth)` rather than `PolySynth(Synth)`, because
MonoSynth is the Tone voice that carries a **filter and filter envelope of its
own**. So every sounding pad note sweeps separately, which is what a filter
envelope normally means. Five settings, all in `SOUND_DEFAULTS.pads` and all on
the panel:

| | |
|---|---|
| `filterOctaves` | the switch *and* the amount: 0 is off, 2–3 is an obvious sweep |
| `filterAttack` / `filterDecay` / `filterSustain` / `filterRelease` | its own timing, deliberately separate from the amplitude envelope's — a filter that just followed the volume would not be worth having |

**It defaults to off**, and off means the per-voice filter is parked at the top
of the cutoff range with nothing to sweep. That matters: every `song.setup`
written so far says nothing about these fields, and they must not change how
those songs sound.

**Two filters in series, and they had to be taught about each other.** The
per-voice envelope sweeps *up* from `cutoff`, and the one shared filter — the
only thing an LFO can be aimed at, since a PolySynth exposes no per-voice
signal — sits downstream of it. Leaving the shared one at `cutoff` too threw
away everything the envelope opened: measured, a four-octave sweep moved the
brightness of the output by 3%, which is nothing. So with the envelope engaged
the shared filter moves up to the top of the sweep (`_padSharedCutoff()`) and
lets it through, and the LFO centres on that ceiling instead of on the floor.
With it fixed, the same sweep peaks at **3.4× the brightness** and falls back.

Resonance stays on the shared filter alone. Applying it to both would resonate
the same peak twice, and `resonance` has always meant the one knob.

**Cost, measured** on a 2023 laptop, rendering the real graph offline: engaged,
the pad bus costs ~60% more, which is ~27% of the whole mix — 7.3% of one core
to 9.3%. `PAD_VOICES` is the knob if that is too much, since the cost is per
sounding voice.

### Polyphony, and why there is a voice pool

Pads and keys get `PAD_VOICES` / `KEYS_VOICES` notes each — eight — and the
bass is monophonic.

The pool exists because **Tone does not steal voices**. Past `maxPolyphony` it
logs `Max polyphony exceeded. Note dropped.` and throws the *new* note away,
which is the worst available choice: the note you just played is the one that
goes missing. Measured, eight notes into a four-voice PolySynth is bit for bit
identical to playing only the first four. So simply lowering the limit would
have made things worse, not better.

`VoicePool` in `audio.js` keeps its own count and frees a voice by hand. It
takes, in order:

1. a voice already past its note off and furthest into its release tail — it
   is fading out anyway, so stealing it is the least audible thing available;
2. failing that, the oldest note still being held.

Two details matter and both were found by measuring:

- **A voice is counted until it has actually stopped**, note off plus release
  tail, not just note off. With a 2.6s pad release the tails are most of what
  is sounding at any moment, so a limit that ignored them would not be a limit.
- **A stolen voice is faded out over `STEAL_FADE` and released *before* the
  note that stole it starts.** Releasing normally would hand it the full 2.6s
  release, and releasing at the same instant leaves it still sounding when
  Tone goes looking for a free voice. Either way Tone reaches for another
  voice instead, and the pool costs voices rather than saving them.

`POLY_HEADROOM` sits on top as a bookkeeping ceiling. Tone only frees a voice
once its oscillator actually stops, which cannot happen inside the same call
that needs it, so a stolen voice is never available to the note that stole it
and Tone always reaches for a fresh one. Over the same busy passage a ceiling
of 16 dropped 16 notes and 20 dropped 8; the current value drops none. It is
cheap: Tone stops idle oscillators rather than gating them, and disposes
voices back down to roughly the average number sounding, so the ceiling is a
cap rather than an allocation and the pool is what governs the DSP.

### Monophonic voices

The bass and all three drums are single voices, which means a second attack at
the very same instant is an *error* in Tone, not a louder note — it throws out
of the Transport callback it was scheduled in. Both are guarded:

- Stacked bass notes are resolved in `scheduleScore`, where the whole score is
  visible, so the **lowest** note of a stack wins rather than whichever
  happened to be scheduled last.
- Duplicate drum hits are dropped at the trigger. Files do stack them — GM 35
  and 36 are both a kick, and one of the songs shipped here has two landing
  together, which used to throw on every play.

Overlapping (rather than simultaneous) notes need no such care: a new attack
cancels the previous note's pending release, so the note doing the stealing is
not cut short by the one it stole from.

## The menu title's font

The stage-select title is drawn in `Nightmare_Hero_Normal.ttf`, declared as an
`@font-face` in `style.css` and applied to that one `text()` call — everything
else in the app stays monospace.

Two traps are worth recording, because both fail *silently*:

- **p5 must be handed a bare family name.** Its `_applyTextProperties` quotes
  the font name if it contains whitespace, and it quotes the whole string, so
  `"Nightmare Hero", monospace` comes back out as
  `""Nightmare Hero", monospace"`. The browser rejects that and keeps the
  previous font, with no error anywhere. The fallback is therefore done in JS
  (`titleFontReady`) rather than in the CSS font stack.
- **A canvas does not fetch a font by being asked to draw with it.** The face
  has to be loaded into the document first, so `setup()` calls
  `document.fonts.load()` and only sets `titleFontReady` once
  `document.fonts.check()` agrees. Opening the page straight off disk fails
  that check — Chrome will not load a font over `file://` — and the title
  falls back to monospace, the same way the song fetches fall back.

`TITLE_SIZE` is larger than the old monospace size because a display face
renders visually smaller at the same nominal size: measured, 385px wide
against monospace's 512px at 34px. The subtitle underneath is positioned by
`cardLayout()` — see "The stage select menu" below — so it moves with
whatever else the layout has to fit, rather than being pinned to `TITLE_SIZE`
directly.

### The pulsing title

`TITLE_MODE` chooses between two titles:

- `"logo"` paints `mBorchLOGO.svg`;
- `"text"` sets it from `TITLE_LINES` — a lockup of stacked lines with
  `TITLE_BIG` standing beside them, spanning the whole stack.

Either way it sweeps colour through the title with a bright band travelling
left to right, in `drawTitle()`.

**The artwork is used as a stencil, not drawn as-is.** It is a solid black
silhouette — 25 paths, no strokes and no colours of its own — so painting it
straight onto the menu would put black on a black background. Instead it is
rasterised once at the size it will be drawn, and the same gradients that
light the lettering are painted through it with `source-in`, which keeps only
the pixels the artwork already covers. The logo therefore carries exactly the
same travelling flame the text did, glow included.

Rasterising the SVG is the expensive part and blitting the result is not, so
the raster is kept and only rebuilt when the drawn size changes. A frame costs
two stencil fills and `TITLE_GLOW_COPIES + 1` blits.

If the file cannot be loaded the lettering takes over automatically, so there
is always a title. `TITLE_LOGO_HEIGHT` is the wished height and is fitted the
same way `TITLE_SIZE` is — see below — and the menu reserves space from
whichever mode is selected rather than from whether the artwork has arrived
yet, so nothing jumps when it finishes loading.

`TITLE_SIZE` is **per line**, not the height of the whole thing — three
stacked lines make the block roughly 2.8x that tall, so it wants a much
smaller number than a one-line title did.

`TITLE_LINE_PITCH` is the distance from the top of one line to the top of the
next, as a fraction of `TITLE_SIZE`. 1.0 leaves a full font size between line
tops; below that sets them tighter, which display faces usually want because
their glyphs do not fill the em box.

`TITLE_ALIGN` sets the lines against each other — `"left"`, `"center"` or
`"right"`. The numeral always sits centred in its own slot to the right of the
stack whichever you pick, so `"right"` is the setting that butts the lines up
against it. It is a `let`, so it can be tried live from the console.

**`TITLE_SIZE` is a wish, not a promise, in both directions.** The lockup is
scaled down at draw time to whichever of the width and the height pinches
hardest: the width of the cards below it, and whatever vertical room is left
once the cards and status rows have taken theirs. Ask for more than fits and
the title comes out as large as it can be rather than running off the sides or
pushing the cards off the bottom. It will not shrink below `MENU.titleMin`; a
small window with a lot of songs can still run out of room, but the title will
have given up everything it can first.

One consequence worth knowing: when the title *is* being clamped for height,
turning `DEBUG` off hands the drop zone's space to the title rather than
moving everything up. With room to spare, the title keeps its size and the
menu re-centres instead.

`TITLE_PALETTE` picks the colours — `"flame"` or `"rainbow"`, with anything
unrecognised falling back to rainbow. It is a `let`, so it can also be flipped
live from the console. The palettes live in `TITLE_PALETTES` and a new one is
just another entry there; `"ice"` would be `hue: [175, 205]`.

The real difference between them is `wheel`:

- **rainbow** (`wheel: true`) runs the hue right round the colour wheel, and
  the travelling band lifts the lightness.
- **flame** (`wheel: false`) keeps the hue inside its range and reads the band
  as *heat*. Where the band is strong the colour runs up to the top of the
  range and washes towards white; the rest sits down in the deep reds. Colour
  and brightness moving together is what makes fire look like fire — a fixed
  colour that merely gets brighter does not. A slower shimmer is mixed in so
  the cool parts are never completely static.

The colour is a canvas linear gradient laid across the measured width of the
words, so the sweep fits the title whatever it says and whichever font it ends
up in. One fill, and the colours run smoothly instead of stepping letter by
letter. p5 only forces its own fill colour when `fill()` has never been
called, so setting the context's `fillStyle` immediately afterwards sticks.

**The pulse is a position, not a moment.** Each gradient stop has its phase set
back by how far along the title it sits (`TITLE_PULSE_SPREAD`), so the peak
reaches the last letter a little after it has left the first, instead of the
whole word brightening at once. The band is raised to `TITLE_PULSE_SHARPNESS`
to narrow it into a defined highlight rather than a broad wash. It does not
start at the left edge at t=0 — the peak of a sine sits a quarter turn in — so
anything measuring it should pick the trip up from wherever the band actually
is rather than assuming a starting phase.

The glow is the same words drawn again in a faint ring around themselves,
`TITLE_GLOW_COPIES` of them at `TITLE_GLOW_RADIUS` pixels out. Its opacity
lives in **its own gradient**, per stop, rather than in a single
`globalAlpha`: one alpha for the whole word could only make the title glow all
over at once, and putting it in the gradient is what lets the glow travel with
the band. Two further things it deliberately is not:

- **not a scaled-up copy behind the text** — scaling a title this wide from
  its centre throws the outer letters far enough out that it reads as a
  second, larger word beside the first rather than as a halo;
- **not `shadowBlur`** — canvas blur is much the more expensive route to the
  same look, and this has to run on weak machines.

The whole effect costs `TITLE_GLOW_COPIES + 1` fill calls a frame, on the menu
only. Everything is tunable: `TITLE_HUE_SPEED`, `TITLE_HUE_SPREAD`,
`TITLE_PULSE_RATE`, `TITLE_GLOW`, `TITLE_GLOW_RADIUS`, `TITLE_GLOW_COPIES` and
`TITLE_GRADIENT_STOPS`. The pulse is deliberately slow — well under the rate
that makes flashing uncomfortable.

## The stage select menu

The menu reads top to bottom as one flow, laid out by `cardLayout()`:

    logo / title
    connect micro:bit   ...or, once connected, calibrate timing
    get the hex file for your micro:bit
    pick a song
    [ one song card per row ]
    reset player scores   ] connected
    disconnect            ] only
    [ drop a midi file here — DEBUG only ]

**The menu has two states.** With nothing plugged in, the only control it
offers is the one that plugs something in — calibrating a rig that is not
there, or resetting scores nothing will receive, are both dead ends, so
`calibrate timing`, `reset player scores` and `disconnect` are simply not on
it. Connect, and the connect button is replaced *in the same slot* by
`calibrate timing`, with the two admin buttons appearing under the cards.

The block is centred, and it is a different height in each state, so it
re-centres on connect — the same way it already does when the DEBUG drop zone
appears. The top slot therefore shifts by about 80px at that moment; it is a
one-off during get-in, not something that happens during play.

`open MIDI editor` is `DEBUG` only. It is a workshop tool, and an installation
should not offer a way into it.

Every piece below the title has a fixed height, gathered in the `MENU`
object — `titleToButtonGap`, `btnH` + `btnGap`, `hexGap` + `hexH`,
`subtitleGap` + `subtitleH`, `cardH` + `gapY`, `dropH`. The title is the only
thing that flexes: it gets whatever room those fixed pieces leave above
`HUD_STRIP_H`, fitted the same "wish, not a promise" way described above for
`TITLE_SIZE` / `TITLE_LOGO_HEIGHT`. Toggling `DEBUG` still hands the drop
zone's space to the title when the title is the thing being squeezed, and
re-centres the menu instead when there is room to spare — the same
behaviour the title section describes, just measured against a taller
`others` now that the buttons sit above the cards rather than trailing them.

**Calibration is a button, not a card.** `songs.js` still defines it as a
real built-in song — kick on every beat, nothing else, for dialling in the
micro:bit offset slider — fetched and parsed exactly like the others, so
`calibrate` starts it through the ordinary `startSong()` path. It just does
not appear in the song list: `songCards()` is `stageList` with the
calibration entry filtered out, and it is the one thing every place that
draws or hit-tests the grid — `cardLayout()`, `cardRect()`, `cardAt()`, the
click handler — works from, so the exclusion lives in one place rather than
being repeated at each call site. The song list is a single column now:
`cardW` is `constrain(width - 90, 340, 680)`, with no second column and
nothing to gap against.

**"connect micro:bit" blinks red while nothing is connected.** It is the only
control on the menu in that state, and at an installation nobody reads the
small status line at the bottom — so the button that fixes the problem is the
thing that asks to be pressed. A `needs-connection` class drives a
`connect-blink` keyframe in `style.css`, pulsing between a dark red and
`COLORS.bad`, the same red that status line uses.

A class rather than something drawn on the canvas, because the buttons are DOM
elements above both canvases and p5 cannot paint on them. It goes on and off
in `applyPageUI()`, next to the rule that decides which buttons exist at all,
so it follows the connection rather than a click: a kicked cable raises
`disconnected`, which lands back in `applyPageUI()`, and the button starts
blinking again on its own. `prefers-reduced-motion: reduce` holds it at solid
red instead.

**The micro:bit connected / not connected line is not part of this flow at
all.** It is drawn by `drawMicrobitStatus()`, centred at a fixed distance
above the bottom of the window — `height - BAND.transport`, the same
"clear of the drawer handle" offset the in-game transport readout already
used — so it sits directly above the timing drawer regardless of how many
songs are on the menu, whether `DEBUG` is on, or how big the title ends up.
A load error or the synth voice summary draws just above it, in that order,
so the connection line is always the one line touching the drawer.

**The per-instrument note counts live behind an "i" icon, not on the card.**
A card used to show six small numbers permanently, each in that instrument's
own colour — `kick`, `snare`, `hat`, `pad`, `bass`, `keys` — which was a lot to
read past just to see a song's name. `drawCardInfo()` draws a small circle in
the card's top-right corner instead (geometry in one place, `CARD_INFO`, so
the hit test in `infoIconAt()` can never drift from what is actually drawn),
and only reveals the counts — as a small popover, all in `COLORS.dim`, the one
grey — when that circle specifically is hovered. Because the icon sits inside
the card it belongs to, `mousePressed()` checks `infoIconAt()` before it
checks `cardAt()`: without that, a click meant to reveal the counts would also
launch the song underneath. The "no kick or snare" warning is the one
exception — it stays on the card itself rather than behind the icon, since
whether a song will do anything on your rig at all is worth seeing without
hovering for it.

## Debug switches

Two, deliberately separate:

- `DEBUG` — developer affordances that should not be on screen at a
  performance. Currently the menu's drop zone. When it is off the zone is not
  drawn, its space is given back so the menu stays centred, *and* files
  dropped on the menu are ignored rather than being loaded into a target that
  is not there. Dropping a file on the **editor** is a real feature and is not
  gated.
- `DEBUG_SOUND` — the sound tuning panel.

They are separate because tuning the sound on the night should not put a
dashed drop box back on the menu.

## Colours

Everything that plays is taken off the **flame ramp** — the same one the logo,
the starfield and the scoreboard's embers run on. Each instrument in `COLORS`
is a point on it, quoted in the file as its `heat` in `titleStop()`'s terms, so
a colour can be nudged along the fire rather than picked out of the air.

What separates one instrument from another is *where it sits on the ramp*, not
a different hue: low and heavy things burn deep red, high and bright things
burn near white. Kick and snare are the two lanes that must never be confused,
so they are taken from opposite ends of it — kick at heat 0.10, snare at 0.75.
The bass is the lowest voice and so the darkest; the keys are the highest and
so the hottest.

The lights on the 3D layer are warm to match. They used to include a cold blue
rim, which was there to lift blue and violet materials off the background;
against deep reds it only greyed them, so it is a dull ember glow from below
instead.

**`text`, `dim`, `good` and `bad` are deliberately not on the ramp.** They are
status colours — "micro:bit connected" in green, "not connected" in red — and
making those the same family of orange as everything else would cost the one
distinction on screen that has to be readable at a glance.

## The starfield

Two modes, from one set of stars.

On the menu it is a flat field drifting down the screen. Each star gets a
random `layer` standing in for distance, and nearer ones are bigger, brighter
and drift faster — parallax without any extra bookkeeping.

Size comes from a `[furthest, nearest]` range in pixels, and there are **two of
them**: `STAR_SIZE_MENU` and `STAR_SIZE_GAME`. The field is doing two different
jobs — wallpaper behind the logo, and something flying at you through the
highway's projection — and a star in the tunnel is already shrunk by its own
distance before it is drawn, so the numbers that look right standing still look
like dust in flight. The size is worked out from the star's `layer` at draw
time (`Starfield.sizeOf`) rather than baked in when the field is built, so
either range can be retuned from the console without rebuilding, and changing
one never touches the other.

While a song is playing it becomes a tunnel: the stars fly at the camera
instead. They are not a separate effect with a matching look — they go through
**the same projection as the falling blocks, off the same vanishing point**. A
block is drawn at the vanishing point plus its own offset times `1/depth`, and
so is a star, so a star runs genuinely parallel to the notes beside it rather
than merely near them. Each star has a fixed direction out from the vanishing
point and travels `STAR_APPROACH_SECONDS` from the horizon to the hit line —
defaulted to `LOOKAHEAD_SECONDS`, which is exactly the speed the blocks travel.

Details worth knowing if you retune it:

- Depth runs from 1 at the horizon down past 0 at the hit line to
  `STAR_TUNNEL_U_MIN`, by which point the star is off the edge, and then wraps.
  That value must stay above `-1/PERSPECTIVE_DEPTH` or the scale blows up.
- Position is computed from the clock rather than stepped frame by frame, so
  there is no per-frame state and nothing to drift out of sync.
- `STAR_TUNNEL_SPREAD` has a minimum radius. Without it a star could sit on the
  vanishing point and approach forever without ever visibly moving.
- Stars fade up out of the horizon on the same `farFade` curve the distant
  boxes use, so nothing pops into existence at the vanishing point.
- The tunnel runs on the **song** clock, not the wall clock, so the stars hold
  still while the song is paused.

**Colour comes from the same law the title uses**, not a separate one tuned to
look similar. `titleStop()` and `mix()` — originally written for the title's
gradients — live in `game.js` now rather than `sketch.js`, specifically so the
starfield can call them directly instead of re-deriving the same maths; `game.js`
loads before `sketch.js`, so the title's own colour code depends on the
starfield's file, not the other way round.

Each star gets a fixed `flow` (its own point in the colour cycle, chosen once
at birth) and reuses its existing `layer` as `titleStop()`'s `band` — the same
value that already makes nearer stars bigger and brighter now also makes them
run hotter in flame mode, or lighter in rainbow mode. `TITLE_PALETTE` is read
once a frame, not once a star, so flipping it live (it is a `let`, same as the
title) recolours the whole field on the next frame. Since `titleStop()`
returns HSL — what a canvas gradient stop wants — and the starfield draws with
p5's own numeric `fill(r, g, b, a)`, `hslToRgb()` sits alongside it doing a
plain CSS-spec conversion; the star's existing twinkle-driven alpha is
untouched, only the RGB going into `fill()` changed.

## The highway

The note lanes are drawn flat, in 2D, but everything is pushed through a fake
perspective. A note's distance into the future becomes a depth from 1 at the
hit line to `1 + PERSPECTIVE_DEPTH` at the far end, and every dimension — the
lane width, the box size, the vertical position — is scaled by 1/depth. The
lanes converge on a vanishing point and evenly spaced notes bunch up as they
recede, which is what makes it read as a Guitar Hero highway.

The point of it is lookahead. Half a second of music occupies about 200px near
the hit line and about 8px at the horizon, so `LOOKAHEAD_SECONDS` could go from
2 to 4.5 without running out of screen — you can see more than twice as far
ahead in the same space.

Two details that matter:

- Boxes are collected and then painted **back to front**. Drawn in time order,
  a distant note would paint over a near one and the depth would read wrong.
- Lanes are drawn as a stack of slices rather than one quad, so the fill and
  the rails can fade towards the horizon instead of stopping at a hard edge.

`HORIZON_FRAC` moves the vanishing point and `PERSPECTIVE_DEPTH` sets how
sharply things compress. Both are in `config.js`.

## The 3D layer

Pads and bass/keys are lit 3D shapes that swell as their notes sound, kept off
to the sides so the highway down the middle stays clear:

- **left** — the bass/keys bus: the bass ring low, keys stacked above it
The pads are drawn with `cone(radius, height, 4, 1)` — p5 has no pyramid, and
a cone with four segments is one. `PAD_PYRAMID_SIDES` raises that: more
segments turn it back into a cone, three gives a tetrahedron.
`PAD_PYRAMID_HEIGHT` is a multiple of the base radius; much above 2 it reads
as a spike, much below 1 as a plate.

- **right** — the pads: one pyramid per note of the chord, **stacked
  vertically** by pitch, lowest at the bottom, so a voicing reads as a chord
  shape rather than a horizontal smear

Size and brightness both follow an envelope — swelling over an attack, held
while the note sounds, falling away after it stops.

### They fly past the camera

A note **spawns a piece of scenery**, which then races out of the vanishing
point, past the camera and off the edge of the window — the same thing a kick
does when it spawns a falling block.

**Its life is the flight, not the note.** That is the whole point and it was
wrong for a long time: a shape used to live exactly as long as its note's
envelope, so a 0.13s bass note existed for about 1.2s of a 4.5s crossing —
a quarter of the way down a highway whose far quarter is all foreshortened into
nothing. Measured: a shape moved **20 to 27 pixels** while a falling block
crossed **476**. They appeared at the vanishing point, crept, and died there,
which is why they read as stuck rather than as scenery being raced past.
`flightSeconds()` is the fix; the same shapes now travel 2400–2800px.

It is placed by the **same depth number a falling block is**: `u`, 1 at the
horizon and 0 at the hit line, with everything scaled by
`1/(1 + u * PERSPECTIVE_DEPTH)`. That is not a coincidence to be admired, it is
the whole point — it is what lets "the same speed as the blocks" mean something
exact rather than something tuned by eye. Three pieces make it work:

| | |
|---|---|
| `depthOf` | born at its own `_U_START`, `u` falling at `1/approach` per second, straight through 0 and out |
| `zAt` | the world z at which real WEBGL perspective reproduces the highway's scale law exactly — `eyeZ / (eyeZ - z)` comes back out as `1/(1 + u·DEPTH)` |
| `worldX` / `worldY` | placement measured at the hit line, opening out from the highway's vanishing point rather than the middle of the canvas |
| `flightSeconds` | how long the whole run takes, and therefore how long the shape exists — independent of how long the note sounds |

### The knobs

Each of the three shapes has its own block in `config.js`, with the same six
settings, so they read the same way:

| | |
|---|---|
| `_U_START` | where it is born, in highway depth. 1 is the horizon, 0 the hit line. Bigger is further away, so it starts smaller and the flight lasts longer |
| `_X` | where it sits across the screen when it appears, as a fraction of the window from the middle. Negative is left, so −0.5 is the left edge |
| `_Y` | the same, down the screen: negative is up. The middle of the shape, or of the chord for the two that spread by pitch |
| `_Y_SPREAD` | how far a voicing opens out either side of `_Y`, by pitch. 0 stacks every note on one spot. Not on the bass — it is monophonic |
| `_APPROACH_SECONDS` | how long to cross the whole lookahead. Equal to `LOOKAHEAD_SECONDS` is exactly the blocks' speed; larger is slower. Written as a multiplier so a change says what it means |
| `_SIZE` | `[base, swell]` in pixels, as it appears at `_U_START` |

**X, Y and the sizes are all measured at the hit line**, in the same frame the
lanes are. Behind that, a shape opens out from the vanishing point towards its
place, exactly as a lane widens — so the further back it is born, the nearer
the vanishing point it appears and the smaller it starts. `_U_START` and
`_APPROACH_SECONDS` are the two knobs for how long a shape is visible.

`_U_START` is 1 for all three: the horizon, which is the depth a falling block
spawns at and the depth the starfield wraps at. Everything therefore comes out
of one point.

**This was wrong for a while and it showed.** X and Y used to be measured at
the shape's *own start depth*, which pinned it to one spot on screen: raising
`_U_START` made it smaller but never moved where it appeared, so a shape was
always born around the middle of the screen and flew outwards from there while
the stars and blocks radiated from the horizon. Two vanishing points, the
shapes' one visibly lower. Measured at the time: a pad was born 261px from the
horizon where a block at the same depth was 64px.

The arithmetic had always converged on the right point — at `u = 100` the
shapes sat within a pixel of it — but they were never *at* any depth where that
showed. An asymptote nothing ever travels along is not a vanishing point you
can see, which is why the test for it now compares a shape against a block **at
the depth it is actually born at** rather than out at infinity.

**`SHAPE_U_MIN` is a drop, not a clamp.** The depth runs past 0 and keeps
going; below `SHAPE_U_MIN` the shape is simply not drawn. That value has to
stay above `-1/PERSPECTIVE_DEPTH` (about −0.154) where the scale blows up, and
well before it the shape has swept out past the edge of the window — so nothing
is ever seen to vanish. The starfield's tunnel wraps at the same depth for the
same reason.

**The vertical correction.** Horizontally nothing is needed: a constant world x
is projected to centre + x·scale, and the highway's vanishing point is
horizontally at the centre too, so a shape already sweeps outwards the way a
lane widens. Vertically they disagree — WEBGL's vanishing point is the middle
of the canvas and the highway's is up at the horizon, some 300px apart. Solving
`centre + y·scale = horizon + offset·scale` for `y` gives the two terms in
`worldY`: one that holds the shape on the horizon however far away it is, and
one constant offset that opens out from it. The horizon is read from the 2D
layer's own `Visuals.layout()`, so the clamp it applies on a short window is
picked up here too and the two layers agree at every window size.

### Lining the shapes up with the highway

Four knobs in `config.js`, and between them they are the whole trajectory —
each shape flies along the line from one end to the other:

| | | |
|---|---|---|
| `SHAPE_VP_X` | `SHAPE_VP_Y` | the **far** end — where they come out of |
| `SHAPE_DEST_X` | `SHAPE_DEST_Y` | the **near** end — where they are heading |

All four are fractions of the window: positive X right, positive Y down. The
first pair moves where the shapes converge in the distance, the second swings
where they are aimed as they come past the camera, and the angle they travel at
is just the line between the two. They are independent — aiming somewhere else
does not drag the vanishing point along with it, so you can set one end and
then the other without going back and forth.

`SHAPE_DEST_X`/`_Y` shift every family together, on top of each one's own `_X`
and `_Y`, which stay the place to move a single family.

**Turn `DEBUG` on and you get the picture**: a green cross on the highway's
vanishing point — where the lanes converge and the starfield flies out of — an
orange one on the shapes', and a faint line from the orange X out to each
family's destination, in its own colour, with a dot on the end. Those lines are
the paths the shapes actually take, worked out from the same placement code the
shapes use, so they cannot quietly disagree. Tune until they lie along the
highway's lanes. All four are `let`, so they can be set live from the console
while you watch.

**Why a manual knob and not just arithmetic.** The shapes' *positions* converge
on the highway's vanishing point exactly: instrumented against the real
`translate()` calls, with p5's projection verified separately against known
world points, the fitted line lands on `horizonY` to within 0.03 of a pixel.
But what you see is not a shape's position, it is its lit silhouette, and a big
shape's visible silhouette is not centred on where the shape is. Measured off the
rendered pixels, the apparent convergence sat about 25px lower — small in
numbers, obvious on screen, and not something the placement maths can fix
because the placement maths was already right.

`SHAPE_VP_Y` defaults to `-0.03`, which was tuned by eye against the marker and
then checked by extrapolating the rendered chain back: it lands within about
2px of the highway's point. It is not a universal constant — the offset grows
with how big the shapes are on screen — so if you change the sizes a lot,
expect to re-tune it.

The vanishing-point nudge tilts the approach; it never moves where a shape
lands at the hit line, so tuning the far end cannot silently re-place
everything. Moving the near end is the other way round by design: that *is* a
change of where they land, and it leaves the far end alone.

### Struck, held, released

A shape arrives on its note's onset **at full strength**, holds while the note
sounds, and goes out over `SHAPE_RELEASE_SECONDS` after it lets go. Three
things carry that, and they are deliberately three different channels:

| | carried by | knobs |
|---|---|---|
| the strike | colour, lifted towards white | `PAD_/BASS_/KEYS_PULSE_SECONDS`, `SHAPE_PULSE_LIFT` |
| arriving — pads | size growing in, via `grow()` | the attack, from the note |
| arriving — bass, keys | size overshooting, via `settle()` | `SHAPE_SPAWN_OVERSHOOT`, `SHAPE_SETTLE_SECONDS` |
| the release | **alpha** | `SHAPE_RELEASE_SECONDS` |

**The pads bloom; the bass and keys are struck.** A chord really does swell,
and a pyramid growing in from nothing reads as one — so pads keep `grow()`. A
bass note and a key are *hit*, and a hit thing arrives whole and overshoots
the way a drum skin does: `settle()` starts them at `SHAPE_SPAWN_OVERSHOOT`
and eases onto their true size. Measured, a bass ring arrives at 162 and drops
to 120 inside `SHAPE_SETTLE_SECONDS`.

Their colour arrives whole too. There is no size ramp left for a brightness
ramp to match, and the strike is the pulse's job — dimming in as well would
fight it.

**Each family flashes for its own length.** How far the flash lifts is shared
(`SHAPE_PULSE_LIFT`); how long it lasts lives in each family's own block, next
to its size and its approach. The pads want much the longest of the three — a
chord arrives and stays, and a flash the length of a bass hit is over before
you have registered the chord at all. As tuned: pads 1.4s, bass and keys 0.55s.

**It pulses in; it does not fade in.** A shape used to ramp up from nothing
over the first slice of its flight, which put the quietest moment of its life
at the exact moment its note was struck. Now it appears at full alpha in a hot
version of its own colour and settles into that colour. `SHAPE_PULSE_LIFT` at
0 turns the flash off; at 1 a shape arrives white.

**The release is alpha, not brightness.** Scaling the colour down to black
does not remove a shape — it makes a *black shape*, which still writes depth
and paints a hole over whatever is behind it. Alpha actually removes it.

**Nothing else dims a shape.** There was briefly a fade that dimmed one as it
neared the edge of the window; that was wrong. A shape on its way past the
camera is not finishing, it is leaving, and dimming it made any family tuned
to sit near an edge permanently dark. `SHAPE_FLIGHT_TAIL` remains as a
backstop for anything still in frame at the very end of its flight.

**The size never comes back down — after the strike.** A shape that shrinks as
it fades reads as retreating, and these are coming at you: the two readings
fight, and whichever is moving faster wins, so depth stops being legible at
all. Every change in size after the first third of a second is perspective,
which is the only thing size should be saying.

`settle()` is the single deliberate exception, and it is why it is kept short.
At the moment of a strike a shape dropping onto its size reads as impact; a
third of a second later the same movement would read as retreat. The suite
holds all three families to the absolute rule outside that window.

### Painting back to front

`render()` gathers every shape into one queue, sorts it farthest-away-first,
and only then paints. The 2D layer's `drawBoxes()` sorts for the ordinary
reason — a distant box drawn later sits on top of a near one and reads as
wrong depth. Here there is a second, harder reason.

**A transparent thing still writes depth.** Measured in a browser: a sphere at
2% alpha drawn *before* a solid one behind it deletes the solid one outright —
the centre pixel came back `[5,0,0]` with the green sphere gone entirely.
`gl.depthMask(false)` does not help, because p5 sets the depth state back on
every geometry it draws (`[10,0,0]`, still gone). Draw the same pair the other
way round and the blend is correct (`[5,250,0]`).

So the ordering is load-bearing, not cosmetic: it is what makes alpha work at
all. It costs a sort of about a dozen items — see "What it costs".

### What it costs

More shapes are on screen than before, because each lives a whole flight rather
than a note: measured across a song, **peak 55, average 25**. Timed in a
browser, the 3D layer's `render()` takes **0.84ms** at that peak and 0.5ms
typically, against a 16.7ms frame budget — about 5%.

One residual: each shape's *own* foreshortening is centred on the middle of the
canvas, because the WEBGL camera looks straight ahead and only the positions
are corrected onto the highway's vanishing point. It shows as slight squashing
on large near shapes. Tilting the camera down so the whole 3D scene shares the
highway's horizon would fix it properly and let `worldY` go away.

### Size says depth, and only depth

There are **two envelopes**, not one. `swell()` is the old one and drives
brightness — rising over the attack, held, falling away after. `grow()` drives
size: the same rising half, and then held for good.

They are separate because a shape that shrinks as it fades is a shape that
appears to be *retreating*, and these are coming at you. The two readings fight,
and the one that wins is whichever is moving faster at that moment, so the depth
stops being legible at all. Fading a shape out is fine; taking its size away is
not. Once it has grown it keeps its size, and every change in size after that is
perspective — which is the only thing size should be saying.

Kick and snare stay as the flat boxes. They are the two things you actually
have to read, so they are kept plain and in front of everything.

### Why two canvases

A p5 canvas is either 2D or WEBGL, never both, so the 3D shapes cannot share a
canvas with the boxes. There are two stacked canvases instead: a WEBGL one at
`z-index: 0` for the shapes, and the existing 2D one at `z-index: 1` for the
lanes, boxes, particles and all the text. The 2D canvas calls `clear()` on the
playing pages so the layer behind shows through.

The browser composites them, which costs nothing, and it keeps every `text()`
call on the 2D path — WEBGL text in p5 needs a font loaded through `loadFont()`
and builds geometry per glyph.

### Could the whole thing be 3D?

Measured on an M3 Pro, CPU time spent inside `draw()` against the 16.7 ms
budget for 60fps:

| what | ms/frame | % of budget |
|---|---|---|
| 500 `box()` | 3.9 | 24% |
| 2000 `box()` | 7.4 | 44% |
| 5000 `box()` | 17.9 | 107% — misses the frame |
| 400 spheres, detail 12 | 3.7 | 22% |
| 60 `text()` in WEBGL | 2.6 | 16% |
| a full scene, ~220 objects | **2.3** | **14%** |

A whole-scene port would draw roughly what that last row draws: about 20
boxes, 10 hi-hat diamonds, up to ~180 particles and a handful of ambient
shapes. That is 14% of the frame, so **performance is not the obstacle** —
there is something like 7x headroom before anything drops a frame. Things only
fall over around 5000 immediate-mode primitives, and nothing here goes near
that.

The actual cost of going fully 3D is the porting work, not the frame rate: the
stage select, the editor grid and the HUD are all text and 2D rectangles, and
in WEBGL they would need a loaded font and a rewrite. The split above avoids
all of that while still giving the scene real depth.

## Timing

Everything hangs off `Tone.getTransport()`. Audio is scheduled on it and the
visuals read the same clock each frame, so the picture cannot drift from the
sound.

The two rig-calibration controls live in the timing drawer along the bottom,
and both are live while playing:

- **micro:bit offset** shifts only the hardware messages, from -500 to +500 ms.
  Negative fires ahead of the sound, to cover radio and solenoid travel time.
  The **Calibration** song is a bare kick on every beat for dialling this in.
- **visual offset** nudges the boxes against the audio without touching either
  clock.
Everything about the sound itself is in the panel described above.

Messages are sent from the draw loop, so all the kicks and snares crossing
within one frame collapse into a single A / B / X. At 60 fps that is a 16 ms
window, well under the time a solenoid needs to reset, but a badly stuttering
tab will drop hits.

### The count-in

Every song starts with "one, two, three, four" on the hi-hat — `addCountIn()`
in `midi-io.js`, called by `startSong()` on its working copy of the score.

**Counted in beats, not seconds.** `COUNT_IN_BEATS` ticks at the song's own
tempo, so the four ticks are the song's four beats. A fixed number of seconds
would count a 72 bpm march at the same rate as a 140 bpm breakbeat, which is
worse than not counting at all. `COUNT_IN_LEAD_SECONDS` is a short silence in
front so the count does not begin in the same instant the audio engine wakes.
Measured in a real offline render: at 120 bpm the ticks land at 0.60, 1.10,
1.60, 2.10 and the song comes in at 2.60; at 72 bpm, 0.60, 1.43, 2.27, 3.10 and
the song at 3.93 — one beat after the fourth tick, in both cases.

**Hi-hat on purpose.** It is the one drum with no falling box and no micro:bit
message behind it, so the count is heard and seen without any hardware firing
and without four phantom notes for the player to try to hit.

**The numbers.** Each tick stamps a big white "1", "2", "3", "4" in the middle
of the screen, in the logo's display face — `drawCountIn()` in `sketch.js`. It
arrives oversized at `COUNT_IN_POP` and snaps down on a cubic ease, then fades
out over the last `COUNT_IN_FADE` of the beat, so two are never up at once.
Growing instead of snapping would read as something *approaching*, which is
what the whole rest of the screen is already doing. Size is
`COUNT_IN_NUMBER_FRAC` of the window's shorter side, so it is the same size
relative to the screen on a laptop and on a projector, and it falls back to
monospace if the display font has not loaded — over `file://` Chrome will not
load one at all, and a count-in nobody can see is worse than an ugly one.

It is driven off `score.countInAt`, the very list of times the hi-hats were
scheduled from, rather than off a counter of its own. The number you see and
the tick you hear are then one event: there is no second clock to drift, and
pausing freezes both together because both are the song's own time.

The ticks are ordinary notes in `score.drums`, not a special case bolted on
beside it. That is the point: they go down the same pipe as everything else, so
they are heard by the audio, drawn by the visuals, and paused and restarted
with the song, without any of those three needing to know that a count-in is a
thing that exists. They carry `countIn: true` so a tick can be told from a note
of the song, and `score.counts` is deliberately left alone so they never appear
in the note counts on a song card — those describe the song, and four ticks are
not part of it.

## The scoreboard

When a song ends, the END screen carries a board of sixteen players, numbered
0..15 — `SCOREBOARD_PLAYERS`, matching the numbering the micro:bit side works
in, so a score reported for "player 6" needs nothing translated on the way in.
It is titled **GREAT JOB**, in the logo's own display face and the same fire.

Each row shows its player number *and* its robot's name, from `ROBOT_NAMES` —
Ali, Eir, Ina, Una, Per, Alf, Ada, Ela, Eli, Mor, Oda, Ask, Kai, Ida, Kim, Eva.
Those two are fixed to the row; the box beside them is for whoever is standing
at that robot right now. Saying "Una got 400" across a noisy room works, and
"player 3 got 400" does not.

**"back to songs" and "restart" are on the board**, in its footer, rather than
in the top-left corner where they sit on the pause screen. The board covers the
middle of the screen, so having the way out somewhere else entirely is a way to
lose people. `PAGE_UI.END` is empty for that reason, and the footer buttons call
the very same `stopAndExit()` and `startSong()` — one behaviour, not two.

### Sorting

**sort** flips the board between player order and finishing order, and the
button says which way it will go next. Sorting moves whole rows: each row keeps
its own number, its own robot and its own score, so the top of a sorted board is
"2 Ina — Bo — 1290 — 1st", not a score that has drifted off its player.

Rows are *moved*, never rebuilt — appending a node already in the grid moves it
— so whatever is half-typed in a box survives a sort. Equal scores keep player
order between them, so the board does not reshuffle itself for no reason, and
players with no score fall to the bottom rather than being treated as zero:
they did not score nothing, they did not play.

The one thing it will not do is reorder while a box on the board has focus.
Scores will arrive over serial at whatever moment they please, and having the
row you are typing into slide out from under the cursor mid-word is worse than
a board that is briefly out of order. It catches up as soon as you click away.

`payload()` is always in player order whatever the screen is sorted by — which
way somebody happened to leave the display is not part of the data.

### The embers

The board lands in a burst of embers (`Embers`, in `game.js`), taking their
colours from the active `TITLE_PALETTE` through the same `titleStop()` law as
the logo and the starfield, so the fire on the end screen matches the fire on
the title screen.

They are born on the panel's *outline* and thrown outward. That is not a
stylistic choice: the board is a DOM panel above the canvas and is very nearly
opaque, so an ember spawned in the middle of it would simply never be seen.
`EMBER_COUNT` is the whole burst rather than a rate — it is spent over
`EMBER_BURST_SECONDS` and then it is finished, so leaving the END page up all
afternoon costs nothing. Each ember cools as it goes, walking `titleStop()`'s
band down from white-hot to dull red as it fades, and floats upward against
`EMBER_RISE`. Everything is in seconds and pixels per second, so it looks the
same on a tired laptop at 30fps as it does at 60, and the frame delta is
clamped so coming back to a backgrounded tab does not teleport them off screen.

Names and scores can be typed in, but the two things the board is really for
are not typing:

| Direction | Seam | What calls it |
|---|---|---|
| in | `Scoreboard.setScore(player, score)` / `setName(player, name)` | the serial reader — see below |
| out | `Scoreboard.submit()`, sending `Scoreboard.payload()` | **submit scores** — to the global highscore list, see "The highscore database" |

### Scores arriving over serial

The controllers report to the game master over radio, and it forwards them
down the USB wire as one line per controller:

    S1, 45      S2, 126

`Scoreboard.readSerial()` parses one of those and writes it straight to the
board, whether or not the board is on screen — they arrive during the song and
the board is the END screen.

**Both of ubitwebusb's hooks are wired**, because which one a line takes is not
obvious. That library only splits a line into name and value when it finds a
**colon** (its `parser` regex), so:

| line | arrives at |
|---|---|
| `S1, 45` | `onReceivedString` |
| `S1:45` | `onReceivedValue` |

Verified by feeding both through the real `uBitEventHandler`. Either form
works, and the separator and spacing are deliberately loose — `S1, 45`,
`S1,45`, `S1 45`, `S1:45` and `s1 : 70` are all the same message. Anything
that is not a score line is ignored and returns null, so the game master can
log whatever else it likes down the same wire.

**`SCORE_CONTROLLER_BASE` is the one thing to check against real hardware.** At
1, controller `S1` is player 0 — the first robot, Ali. Set it to 0 if the
controllers count from `S0`. An off-by-one here puts every score on the wrong
robot, and the board looks perfectly plausible while it does.

A controller number the board cannot place is counted and shown rather than
thrown at — a garbled radio packet must not take the game down mid-song. The
board's header carries a readout of what the wire last did (`S16 → Eva = 12 ·
1 ignored`), blank until something arrives, because the first question at an
installation is always whether it is receiving anything at all.

The input seam writes the data *and* the box on screen, so a score arriving
mid-board appears in it. It is deliberately forgiving about what it is handed —
a player number outside 0..15, or a score that is not a number, is refused
rather than thrown at, because a garbled serial line should not take the game
down. A score with no name against it still counts as a result: the micro:bit
will be able to report one before anybody has typed who it belongs to.

Places are worked out live, highest first, with ties sharing a place and the
next score dropping past it — two firsts are followed by a third, not a
second. Players with no score are not in the running at all.

**The board outlives a single song.** An evening's worth of players is the
point of it, so finishing a song, going back to the menu and playing another
leaves the scores alone; `clear` is the only thing that empties it.

### The highscore database

**submit scores** adds the board to the global highscore list. **highscores**,
top left of the menu, shows the whole list. The list lives in **Cloud
Firestore**, on Firebase's free **Spark** plan: it never asks for a card and
cannot be billed. If one of its daily limits (50,000 reads, 20,000 writes) is
ever reached, requests are turned down until the next day. Nothing is charged.

Every score on the list has a **position** (worked out from the scores, never
stored), **name**, **location**, **date**, **score** and **bonus star**. Scores
from the game also record the song, the robot and the player number.

On the end-of-game board:

- **location**, in the board's header, is typed once per venue and remembered.
  A board cannot be submitted without it.
- **☆** on each row hands out a bonus star. Click again to take it back.
- Only players with **both a name and a score** go on the list. A robot that
  reported a score nobody put a name to stays off, and the status line says
  how many were left out.

The highscores page keeps a fire going around its list while it is open — a
steady trickle of embers off the top and sides, the same embers as the end of a
song (`EMBER_GLOW_RATE`, `EMBER_GLOW_SPEED` and `EMBER_GLOW_SIZE` in
`config.js`) — and bonus stars shimmer and twinkle, each at its own moment. The
twinkle holds still for anyone whose system asks for reduced motion.

Positions go highest score first. Equal scores share a place — two 2nds are
followed by a 4th — and between equal scores, older entries come first: the
old sheet's own order for imported rows, then earliest date for the game's.

#### Setting it up (once, about fifteen minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com),
   **Create a project**, and give it a name. Google Analytics is not needed.
   New projects start on Spark, the free plan. Leave it there.
2. **Build → Firestore Database → Create database.** Pick a location near you
   (a European one for Norway), since it cannot be changed later. Start in
   **production mode**.
3. **Build → Authentication → Get started → Email/Password**, and enable it.
   Only the first switch, not "email link".
4. **Authentication → Users → Add user**: an email and password for **you,
   the admin**. Copy that user's **User UID**.
5. **Firestore Database → Rules**: paste in all of `firebase/firestore.rules`,
   put your UID in the `isAdmin()` list near the top — keep the quotes:
   `['your-uid']` — and **Publish**.
6. **Project settings** (the gear) **→ General → Your apps → Web** (`</>`).
   Register an app (no Hosting needed) and copy the values from the
   `firebaseConfig` it shows into `FIREBASE_CONFIG` in `config.js`.
   
7. Open the game, press **highscores**, and sign in as the admin. Each machine
   does this once and then stays signed in. Anyone else who will run the game
   asks to become an operator — see "Becoming an operator".
8. Move the old list across: open `tools/import-highscores.html` from the same
   server as the game (for example `http://localhost:8777/tools/import-highscores.html`).
   Sign in, press **load from address** (the old viewer's published CSV is
   already filled in), check the preview, then **import**.

The import brings over all 1,313 rows of the old sheet — `NAME` → name,
`FROM` → location, `SCORE` → score, a `*` in `BONUS` → bonus star — in the
sheet's own order. The old sheet has no dates, so imported rows have none. It
is safe to run again: it replaces what it imported last time rather than
adding a second copy, and never touches scores that came from the game.

#### Who can do what

| | anyone | operator | admin |
|---|---|---|---|
| read the published list | yes | yes | yes |
| ask to become an operator | yes | – | – |
| add scores from the game | no | yes, signed with their account | yes |
| read single scores | no | only their own | all, with who sent them |
| edit or delete scores | no | no | yes |
| approve, turn down and ban operators | no | no | yes |

All of that is enforced by `firebase/firestore.rules`, not by the pages. A
page only shows what the rules already allow. The admin is named in exactly
one place, the `isAdmin()` list in the rules. Operators are the `operators`
collection, each `active` or `banned`, and the rules check that on every write,
so a ban takes effect on the very next board.

**Every score records who sent it**: `submittedBy` (the account's UID) and
`submittedEmail`. The rules check both against the sender's sign-in, so they
cannot be forged, and they are never published — the public list has names,
places, dates, scores and stars. The one account detail in the public document
is `updatedBy`, the anonymous account ID of whoever last added to it: no name,
no email, and only the admin can see which account an ID belongs to. Scores
sent before this was added show no sender.

The rules also check the shape of every write — types, lengths, no extra
fields. The values in `FIREBASE_CONFIG` are **not secret**. They only say
which project to talk to, and the rules are what protect it.

#### Becoming an operator

Send people to **`tools/request-operator.html`**. The game's highscores page
links to it for anyone signed out or without access. There they make an
account and fill in their name, their school or organisation, and where they
will run the game. A verification email goes out when the account is made,
and the management tool shows you whether they clicked it.

That email **usually lands in spam** - it comes from
`noreply@<project>.firebaseapp.com`, which has no reputation of its own - and
only the **newest** one works, since sending it again invalidates the last
link. A link clicked from inside a spam folder can also be used up by the
provider's own scanner before the person gets to it.

If **every** link says "expired or already used", including a freshly sent one,
suspect the **API key's referrer restrictions** rather than the link. Firebase's
default handler lives at `<project>.firebaseapp.com/__/auth/action`, and it
calls the Identity Toolkit API *from that domain*. If the browser key in Google
Cloud Console lists only your own site, the call comes back `403
API_KEY_HTTP_REFERRER_BLOCKED` and the handler reports its one generic failure -
so a perfectly good code reads as expired. Sending still works, because that
request comes from your own page. The fix is to add `<project>.firebaseapp.com/*`
and `<project>.web.app/*` to the key's website restrictions. To tell the two
apart without spending a link, POST a junk code and watch the status:

    curl -s -X POST \
      "https://identitytoolkit.googleapis.com/v1/accounts:update?key=$KEY" \
      -H "Content-Type: application/json" \
      -H "Referer: https://<project>.firebaseapp.com/" \
      -d '{"oobCode":"nope"}'

`400 INVALID_OOB_CODE` means the referrer was accepted and the code really was
the problem. `403` means it never got that far. The same restriction blocks
`localhost`, so sign-in from a local server fails too until it is listed.

None of this blocks anything: nothing in the rules checks `emailVerified`, so
an operator can be approved and can submit scores with an unverified address.
The flag is there for you to judge whether an address is real.

Nothing notifies you when a request arrives. Sending an email needs a server,
or Cloud Functions, which are not on the free plan. The management tool's
**requests** tab shows how many are waiting.

Approving somebody does not notify them either - it changes a document in a
database they are not looking at - so **approve** opens a welcome message in
your own mail client, addressed and written, and you press send. The wording
is `OPERATOR_WELCOME_SUBJECT` and `OPERATOR_WELCOME_BODY` in config.js, where
`{name}`, `{email}` and `{url}` are filled in; `{url}` is worked out from where
the tool is being served, so there is no address to keep in step. Set
`OPERATOR_WELCOME_AUTO` to `false` if you would rather the mail client did not
open by itself - the **operators** tab has an **email them** button on every
active operator, which does the same thing whenever you want it.

Doing it by hand is the free option, but it is also the better post. It arrives
from a real person at a real domain rather than
`noreply@<project>.firebaseapp.com`, so it does not get filed as junk the way
the verification mail does, and a reply reaches you. Automating it properly
means the Blaze plan: Cloud Functions, or the **Trigger Email from Firestore**
extension pointed at an SMTP account. Both want a card on file.

Once approved, they sign in on the game's highscores page with the same email
and password. The footer there says where an account stands: *admin*,
*operator*, *waiting for approval*, *request turned down*, *not an operator*
or *banned*.

The request page can live on the website instead. Copy
`tools/request-operator.html`, `tools/tools.css`, `config.js` and
`highscores.js` across, keeping the same folders.

#### Managing highscores

**`tools/manage-highscores.html`**, signed in as the admin. The game's
highscores page links to it when you are signed in as the admin.

- **scores** — loads every score (one read each, so it waits until you press
  load). Filter by name, place or email, or pick who sent them. Edit a name,
  place, score or star, delete one, or tick several and delete them together.
  Every change updates the published list straight away.
- **operators** — everyone approved, with their status and how many scores
  each has sent. **ban** stops them sending anything from their next board on;
  their existing scores stay until you **delete their scores**, which does it
  in one go. **unban** puts them back.
- **requests** — **approve** makes them an active operator. **turn down**
  means they cannot ask again unless you **delete** the request.
- **rebuild published list** regenerates the public list from every score.
  Use it after editing in the Firebase console, or if the list is ever damaged.

A ban works through the database, not by switching the account off. To stop
someone signing in at all: Firebase console → Authentication → Users → disable
account.

**What an operator could still do.** Operators have to add to the published
list, which is one document the rules cannot parse, so the rules check an
operator's write as text: everything already on the list must stay exactly as
it was, and the only change allowed is adding to the end, a board at a time
(at most 32 entries and 20,000 characters). Every write records who made it.
So nothing already published can be changed, reordered or removed by an
operator. What a determined vandal could still do is add made-up entries, or
add something that stops the list loading. If that ever happens, ban them,
delete their scores, and **rebuild published list** — it is rebuilt from the
individual scores.

#### Moving an existing setup across

If the database is already running with the single operator account, publish
the new `firebase/firestore.rules` with your UID in `isAdmin()`. Then open the
management tool once, signed in as the admin. Everything already there keeps
working; those scores just have no sender recorded.

#### Why the list is published as one document

The free plan counts every document a query returns as a read. Listing 1,300
entries on every page view would use up the 50,000 a day after about forty
views, which a busy exhibition could easily do. So the database holds every
score as its own document in `highscores` (the record), plus a copy of the
whole list in **one** document, `highscores_meta/table` (the list everybody
reads). One read per view, however long the list gets.

The copy is updated as each board is added, so it never needs thinking about
unless entries are edited by hand, and **rebuild list** regenerates it from
the record at any time. It stores the list as one JSON string. That keeps it
clear of Firestore's per-document index limit, which an array of entries
would hit at around 2,800 scores. The document's 1 MiB size limit allows
roughly 10,000 scores.

#### Reading the list on the viewer site

No Firebase SDK and no sign-in needed. It is one request:

```js
const url = "https://firestore.googleapis.com/v1/projects/YOUR-PROJECT-ID" +
            "/databases/(default)/documents/highscores_meta/table?key=YOUR-API-KEY";
const doc = await (await fetch(url)).json();
const entries = JSON.parse(doc.fields.json.stringValue);
// [{ id, name, location, score, bonus, date, order }, ...] - not yet sorted
```

Sort by `score` (high first), then `order` (low first), and let equal scores
share a position. Or load this project's `highscores.js` on the page and let it
do that: `Highscores.rank(entries)` returns them sorted with a `position` on
each. If `FIREBASE_CONFIG` is defined on the page, `Highscores.fetchTable()`
does the request too. In p5 the request is just
`loadJSON(url, doc => { ... })`.

#### No internet? Nothing is lost

Every board is **saved on this machine before it is sent**, and removed only
once the database confirms it. Waiting boards go:

- the moment the operator signs in on this machine,
- every `SCORES_RETRY_SECONDS` (60) while online and signed in,
- as soon as the browser reports it is back online,
- and at startup, so closing the browser or a crash loses nothing either.

The Firebase SDK is only fetched when something needs to write. A machine that
starts with no internet still starts, and viewing the list needs no SDK at all.

**A board cannot land twice.** Each press of submit gets a submission id, and
each score's document id is that id plus the player number. A retry after a
lost answer is recognised and reported as *"already on the highscore list"*.
Pressing submit twice on an unchanged board is refused outright. Changing
anything on the board — a name, a star, a score arriving over serial — makes
it submittable again.

A board the database *refuses* stays on the machine too, and does not hold up
the ones behind it.

Waiting boards live in the browser's localStorage for the address the game is
opened at, under `mboh.scores.outbox`, and the location box is remembered the
same way. Open the game at the same address every time, and don't clear
browsing data while anything is waiting.

#### When it goes wrong

| The status line says | Usually |
|---|---|
| no highscore database set up yet | `FIREBASE_CONFIG` is empty |
| sign in on the highscores page to send | nobody is signed in on this machine yet |
| refused it (permission denied - is this account an active operator?) | the account has not been approved, has been banned, or the new rules were never published |
| can't reach the highscore database | no internet — boards wait and retry |
| wrong email or password | as it says |
| email/password sign-in is not switched on in Firebase | step 3 |
| could not load Firebase | no internet when the SDK was first needed — it tries again next time |

### The standalone highscore page

`highscore/`, next to `v2/` rather than inside it, is the list on its own: the
logo burning at the top the way it does on the menu, and the scores underneath,
one song at a time. It is meant to be put up somewhere other than the game.

The folder carries everything it needs - `index.html`, `mBorchLOGO.svg` and
the two fonts - and loads nothing from `v2/`, so copy it anywhere as it stands.
It reads the published list straight from Firestore's REST address with **no
API key**: the list is public by the rules, and without the key the key's
website restrictions cannot block it, whichever domain it ends up on.

The settings at the top of its script are copies of ones in `config.js`
(`HIGHSCORES_DEFAULT_SONG`, the flame palette and title timings), and nothing
keeps the two in step - change one, change the other. It fetches the list again
every 60 seconds while it is on screen, for a display left up at an event, and
`?song=Slow%20Sorrow` opens it on one song.

### Typing and the keyboard shortcuts

p5 binds keys to the window, so before this the letters going into a name
would have fired their own shortcuts too — `r` on the END page would have
restarted the song out from under whoever was typing, and `d` would have
thrown the sound panel open. `typingInAField()` holds the shortcuts back
while a text box has focus.

It is specifically *text entry* it checks for, not any `<input>`: the sound
panel's sliders are inputs too, but nothing is typed into one, so `d` still
closes the panel while a slider has focus. Escape is the one key that always
gets through — getting out is worth having from anywhere.

## Files

| File | What is in it |
|---|---|
| `config.js` | channel map, drum notes, timing, colours — the things worth retuning |
| `midi-io.js` | the type 0 encoder, and sorting a parsed file into the three buses |
| `songs.js` | the built-in songs, as step patterns |
| `audio.js` | Tone.js instruments, voice pooling, transport scheduling |
| `game.js` | the perspective highway, boxes, explosions, starfield |
| `editor.js` | the step editor |
| `scene3d.js` | the WEBGL layer behind: swelling pad and bass/keys shapes |
| `soundpanel.js` | the DEBUG_SOUND tuning panel and settings export |
| `timing.js` | the bottom drawer holding radio delay and visual offset |
| `scoreboard.js` | the end-of-game board, serial in, and the outbox that keeps boards until the database has them |
| `highscores.js` | the highscore database: reading the published list, the operator's sign-in, adding boards, importing the old sheet |
| `leaderboard.js` | the HIGHSCORES page |
| `firebase/firestore.rules` | the database's security rules — who is admin, who may write what — pasted into the Firebase console |
| `tools/import-highscores.html` | one-off: moves the old Google Sheet into the database |
| `tools/manage-highscores.html` | the admin's tool: edit and delete scores, ban operators, answer requests |
| `tools/request-operator.html` | where people ask to become operators |
| `tools/tools.css` | the look of those two pages |
| `sketch.js` | p5 setup, the page state machine, the UI |
| `ubitwebusb.js` | carried over from the first version, unchanged |
| `songs/songs.json` | the list of song folders, in menu order |
| `songs/<id>/` | one song: `song.setup` plus a `.mid` per part |

The folders and the data in `songs.js` are the same four songs. The stage
select loads the folders; `songs.js` is the fallback for when there is no
server to fetch from, so opening the page straight off disk still gives a
working menu. Both paths go through the real MIDI parser.

**Change a song in `songs.js` and its folder must be regenerated**, and the
other way round. Nothing does this automatically and nothing complains at
runtime: over http the app fetches the folders, off `file://` it falls back to
`buildSongs()`, so a stale copy means the two paths quietly play *different
music*. That has already happened once, when Four On The Floor gained its keys
part — so the driver suite loads both and compares them as music: same note
counts, same times, same drum on every hit. That also exercises the two drum
conventions against each other, since `songs.js` writes General MIDI numbers
and the folders write pitch classes.

## Keys

`space` pause in the game, play/stop in the editor · `r` restart ·
`esc` back to the stage select · `d` sound panel (when `DEBUG_SOUND`)
