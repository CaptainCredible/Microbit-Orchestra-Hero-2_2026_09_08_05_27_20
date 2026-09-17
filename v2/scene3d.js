// The ambient 3D layer.
//
// Pads and bass/keys are lit shapes that swell as their notes sound, and fly
// at the camera while they do. They are kept off to the sides so the note
// highway down the middle stays clear:
//
//   left   bass/keys bus - the bass ring low, keys stacked above it
//   right  pads - the chord, one pyramid per note, stacked vertically so a
//          voicing reads as a chord shape rather than a horizontal smear
//
// A shape is born back down the highway and comes forward, spreading out from
// the vanishing point and growing as it goes, through the same depth law the
// falling blocks use - see "Depth" below. Bass and keys travel at exactly the
// blocks' speed; the pads drift, because they hold much longer.
//
// This runs on its own WEBGL canvas sitting BEHIND the 2D canvas, because a
// p5 canvas is either 2D or WEBGL and cannot be both. Stacking two canvases
// lets the browser composite them, which costs nothing, keeps the boxes and
// all the text on the fast 2D path, and avoids needing loadFont() for WEBGL
// text. The alternative - one WEBGL canvas for everything - is affordable
// too, but it would mean porting every screen.

const Ambient3D = {
  p: null,
  ready: false,
  cursors: { pads: 0, basskeys: 0 },
  lastSongTime: 0,    // what render() last drew at - see rewindIfNeeded()
  monoMarked: null,   // the bus markMonophonic() last stamped

  // Longest tail a shape can have after its note ends. Used to decide when a
  // note can be skipped for good.
  RELEASE: 1.1,

  init() {
    new p5((p) => {
      p.setup = () => {
        const c = p.createCanvas(window.innerWidth, window.innerHeight, p.WEBGL);
        c.parent("bg3d");
        p.noStroke();
        this.p = p;
        this.ready = true;
      };
      p.draw = () => Perf.time("3d shapes", () => this.render(p));
      p.windowResized = () => p.resizeCanvas(window.innerWidth, window.innerHeight);
    });
  },

  reset() {
    this.cursors = { pads: 0, basskeys: 0 };
    this.lastSongTime = 0;
  },

  // The cursors only ever move forward, so if song time goes backwards they
  // are left stranded ahead of it and every note they skipped stays skipped:
  // no shapes until the clock catches up with wherever it had been. Starting
  // again from the top of each list is a walk over a few hundred notes, once.
  //
  // startSong() resets them itself; this is for every other way the clock can
  // go back - and there are more than one, since this layer draws on its own
  // loop and does not choose when song time changes under it.
  rewindIfNeeded(songTime) {
    if (songTime < this.lastSongTime) this.cursors = { pads: 0, basskeys: 0 };
    this.lastSongTime = songTime;
  },

  //////////////////////////////////////////////////////////////////
  // Depth
  //
  // A shape is placed by the *same* depth number a falling block is: `u`,
  // 1 at the horizon and 0 at the hit line, with everything scaled by
  // 1/(1 + u * PERSPECTIVE_DEPTH). That is not a coincidence to be admired,
  // it is the point - it is what lets "the same speed as the blocks" mean
  // something exact rather than something tuned by eye.
  //////////////////////////////////////////////////////////////////

  // How far back the camera sits. At z = 0 one world unit is one pixel, which
  // is what lets a fraction of the window be used as a world coordinate.
  //
  // This is NOT a guess about p5's default any more - aimCamera() below sets
  // the camera to exactly this every frame, so it is true by construction.
  // It used to be a guess, and the guess was wrong at every window size but
  // one: p5's default camera keeps the eyeZ it was built with and never
  // updates it on resizeCanvas(), compensating by changing the field of view
  // instead. Measured on 1.9.4, a canvas created at 920 high reported
  // camera.eyeZ = 800 at 920, at 966 and at 700, while this function returned
  // 797, 837 and 606. The two agreed only around 924px of window height, and
  // everywhere else the shapes flew a path that bent away from the highway.
  eyeZ(p) { return p.height * 0.866; },

  // Pins the camera to eyeZ() at the current canvas size.
  //
  // p5's own default is `1/tan(fovy/2) = 2 * eyeZ / height` with fovy = PI/3,
  // and eyeZ = height/2 / tan(PI/6) = height * 0.866 satisfies that exactly -
  // so this is the camera p5 *would* have had if resizeCanvas() rebuilt it.
  // Called once a frame rather than on resize, because it costs two matrix
  // builds and that way there is no resize path that can be missed.
  aimCamera(p) {
    const eye = this.eyeZ(p);
    p.perspective(p.PI / 3, p.width / p.height, eye / 10, eye * 10);
    p.camera(0, 0, eye, 0, 0, 0, 0, 1, 0);
  },

  // Where a note's shape is right now. Born at its own start depth and coming
  // forward at 1/approach per second, so an approach of LOOKAHEAD_SECONDS is
  // by definition the speed a block travels.
  //
  // Not clamped: it runs straight past the hit line at 0 and out of the
  // window. `gone` below is what stops it, once it is far enough past the
  // camera to be nowhere near the screen.
  depthOf(note, songTime, uStart, approachSeconds) {
    const age = Math.max(0, songTime - note.time);
    return uStart - age / approachSeconds;
  },

  gone(u) { return u < SHAPE_U_MIN; },

  // The 2D highway's own scale law, so the two layers cannot drift apart.
  scaleAt(u) { return 1 / (1 + u * PERSPECTIVE_DEPTH); },

  // The world z that makes real WEBGL perspective reproduce that law exactly:
  // apparent size is eyeZ / (eyeZ - z), and putting z at -eyeZ * u * DEPTH
  // turns that into 1 / (1 + u * DEPTH). A shape and a block at the same u
  // are therefore the same distance away in every sense that shows.
  zAt(p, u) { return -this.eyeZ(p) * u * PERSPECTIVE_DEPTH; },

  // Where a shape sits, in the same frame a lane is measured in: `frac` is
  // its place at the HIT LINE, and everything behind that opens out from the
  // vanishing point towards it.
  //
  // This used to be measured at the shape's own start depth instead, which
  // pinned it to one spot on screen: raising its start depth made it smaller
  // but never moved where it appeared, so it was always born around the
  // middle of the screen and flew outwards from there. Two things were then
  // radiating from two different points - the stars and blocks from the
  // horizon, the shapes from wherever they happened to be born - which is
  // exactly what it looked like.
  //
  // Horizontally nothing is needed: a world x is projected to centre +
  // x * scale, and the highway's vanishing point is horizontally at the
  // centre too, so a constant world x already converges there.
  // SHAPE_VP_X shifts the point they converge on. With it at 0 this is just
  // `frac * width`, a constant world x, which already converges on the
  // highway's vanishing point horizontally.
  worldX(p, frac, u) {
    const dx = SHAPE_VP_X * p.width;          // the far end
    const dest = SHAPE_DEST_X * p.width;      // the near end
    if (!dx) return frac * p.width + dest;
    return dx / this.scaleAt(u) + frac * p.width + dest - dx;
  },

  // Vertically they disagree - the WEBGL vanishing point is the middle of the
  // canvas and the highway's is up at the horizon - so solving
  // centre + y*scale = horizon + offset*scale for y gives the two terms
  // below: one that holds the shape on the horizon however far away it is,
  // and one constant offset that opens out from it as it comes forward.
  worldY(p, frac, u) {
    const vanish = this.vanishFrac(p);
    const dy = SHAPE_VP_Y * p.height;         // the far end
    const dest = SHAPE_DEST_Y * p.height;     // the near end
    return (vanish * p.height + dy) / this.scaleAt(u)
         + (frac - vanish) * p.height + dest - dy;
  },

  // Where a shape ends up, in canvas pixels: the near end of its line. Used
  // by the debug overlay, and worked out from the same placement the shapes
  // use, so the drawn line cannot disagree with where they actually go.
  destination(p, fracX, fracY) {
    return {
      x: p.width / 2 + this.worldX(p, fracX, 0) * this.scaleAt(0),
      y: p.height / 2 + this.worldY(p, fracY, 0) * this.scaleAt(0)
    };
  },

  // Where the shapes actually converge, in canvas pixels. Only used to draw
  // the debug marker - but derived from the same two numbers the placement
  // is, so the marker cannot drift away from the truth.
  vanishingPoint(p) {
    return {
      x: p.width / 2 + SHAPE_VP_X * p.width,
      y: Visuals.layout().horizonY + SHAPE_VP_Y * p.height
    };
  },

  // The highway's horizon, as a fraction of the window from its middle. Taken
  // from the 2D layer's own layout rather than from HORIZON_FRAC directly, so
  // the clamp it applies on a short window is picked up here too and the two
  // layers converge on the same point at every window size.
  vanishFrac(p) {
    return Visuals.layout().horizonY / p.height - 0.5;
  },

  // How long a note's shape takes to reach full size. One place, because
  // swell() and grow() have to agree about it or the shape's size and its
  // brightness come apart during the attack.
  attackOf(note) {
    return Math.min(0.45, Math.max(0.08, note.duration * 0.45));
  },

  // How *bright* a note's shape is right now: 0 before it starts, swelling
  // over its attack, held while it sounds, falling away after.
  swell(note, songTime) {
    const age = songTime - note.time;
    if (age < 0) return 0;

    const attack = this.attackOf(note);
    if (age < attack) {
      const x = age / attack;
      return x * x * (3 - 2 * x);            // smoothstep in
    }
    const sustain = Math.max(0, note.duration - attack);
    const held = age - attack;
    if (held < sustain) return 1;

    const rel = (held - sustain) / this.RELEASE;
    if (rel >= 1) return 0;
    return (1 - rel) * (1 - rel);            // ease out
  },

  // How *big* it is: the swell's rising half, and then held. Size and
  // brightness are deliberately two different envelopes.
  //
  // A shape that shrinks as it fades is a shape that appears to be retreating,
  // and these are coming at you - the two readings fight, and the one that
  // wins is whichever is moving faster at the time, so the depth stops being
  // legible at all. Fading it out is fine; taking size away is not. Once it
  // has grown it keeps its size, and every change in size after that is
  // perspective, which is the only thing size should be saying.
  grow(note, songTime) {
    const age = songTime - note.time;
    if (age < 0) return 0;
    const attack = this.attackOf(note);
    if (age >= attack) return 1;
    const x = age / attack;
    return x * x * (3 - 2 * x);              // the same smoothstep swell() uses
  },

  // How lit a shape still is for its note still sounding: 1 while the note is
  // held, then a ramp to 0 over SHAPE_RELEASE_SECONDS after it lets go.
  //
  // Brightness only - deliberately not size. A shape that shrinks as it fades
  // reads as retreating, and these are coming at you; see grow() below for
  // why those two readings must not be allowed to fight.
  releaseFade(note, songTime) {
    if (SHAPE_RELEASE_SECONDS <= 0) return 1;
    const since = songTime - (note.time + note.duration);
    if (since <= 0) return 1;
    const rel = Math.min(1, since / SHAPE_RELEASE_SECONDS);
    return (1 - rel) * (1 - rel);            // ease out, like swell()'s tail
  },

  // The bass is monophonic: each ring is cut off by the next bass note. Links
  // every bass note to the one after it, so the draw loop does not have to
  // search forward for it every frame.
  //
  // A link to the note rather than a copy of its time, because times are
  // shifted in place (the count-in does it) and a copied time would go stale.
  // Done once per bus rather than once per song load, so it cannot be missed
  // by any of the several ways a score gets built.
  markMonophonic(list, voice) {
    if (this.monoMarked === list) return;
    let next = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const note = list[i];
      if (note.voice !== voice) continue;
      note.cutBy = next;
      next = note;
    }
    this.monoMarked = list;
  },

  // 1 until the next bass note starts, then a quick ease to 0 over
  // BASS_CUTOFF_SECONDS. Two notes struck at the same instant are one ring,
  // not two stacked on top of each other: the earlier of them never shows.
  cutoffFade(note, songTime) {
    if (!note.cutBy) return 1;
    const cutAt = note.cutBy.time;
    if (songTime < cutAt) return 1;
    if (cutAt <= note.time || BASS_CUTOFF_SECONDS <= 0) return 0;
    const rel = Math.min(1, (songTime - cutAt) / BASS_CUTOFF_SECONDS);
    return (1 - rel) * (1 - rel);            // ease out, like releaseFade()
  },

  // How visible a shape is, on top of how bright its envelope makes it.
  //
  // 1 for most of the note, so the look is unchanged, and then a ramp to 0
  // across the last of the envelope. Without it a shape stops at the floor of
  // its brightness - `base + span * envelope` never reaches zero - and then
  // disappears outright when eachLive() stops drawing it: not a fade, a
  // wink-out at half brightness.
  //
  // The size is deliberately not touched. A shape that shrinks as it goes
  // reads as retreating, which is the same reason grow() exists.
  fadeOf(amount) {
    return Math.min(1, amount / SHAPE_FADE_KNEE);
  },

  // Walk a sorted bus, calling back for every note with a live envelope.
  // The cursor skips notes that have finished for good, so this stays cheap
  // however long the piece is.
  // How long a shape is in flight: the whole run from where it is born to
  // where it is dropped, at its own pace.
  //
  // This is what a shape's life is, and it is deliberately NOT how long the
  // note sounds. A note *spawns* a piece of scenery and the scenery then
  // races past, exactly as a kick spawns a falling block that takes the whole
  // lookahead to arrive however short the kick was.
  //
  // Tying the life to the envelope instead is what made these feel stuck: a
  // 0.13s bass note lives about 1.2s with its release, and 1.2s of a 4.5s
  // flight is a quarter of the way down a highway where the far quarter is
  // all foreshortened into nothing. Measured, a shape moved 20 to 27 pixels
  // while a falling block crossed 476.
  flightSeconds(uStart, approachSeconds) {
    return (uStart - SHAPE_U_MIN) * approachSeconds;
  },

  // Walk a sorted bus, calling back for every note whose shape is still in
  // flight. The cursor skips notes that have flown past for good, so this
  // stays cheap however long the piece is.
  eachLive(list, cursorKey, songTime, flight, callback) {
    let i = this.cursors[cursorKey];
    while (i < list.length && list[i].time + flight < songTime) i++;
    this.cursors[cursorKey] = i;

    for (let j = i; j < list.length; j++) {
      const note = list[j];
      if (note.time > songTime) break;       // sorted, so nothing later has started
      callback(note);
    }
  },

  // How lit a shape is: swelling in over the note's attack, then held for the
  // rest of the flight.
  //
  // The note's *release* deliberately does not dim it any more. It is scenery
  // now, not a meter - it swells in when the note is struck and then races
  // past, and a piece of scenery that faded out halfway down the highway
  // because its note had stopped would be a strange thing to look at.
  //
  // Two short fades bracket the flight instead, both about where the shape is
  // rather than what the note is doing: one out of the vanishing point so
  // nothing pops into being there, and one at the very end in case it is
  // somehow still on screen.
  // Returned on its own, and multiplied over the WHOLE colour by the callers,
  // never mixed into the envelope term. Each shape's brightness is
  // `base + span * swell`, and that base is there so a quiet note is still
  // visible - so folding a fade into `swell` leaves the shape stuck at the
  // base and winking out at half brightness, which is a bug this layer has
  // had once already.
  visible(note, songTime, uStart, approachSeconds) {
    // No fade in any more: a shape arrives at full strength and announces
    // itself with spawnPulse() instead. Only the tail is left, and it is a
    // backstop for anything still in frame at the very end of its flight -
    // the fade you actually see is releaseFade().
    const progress = (songTime - note.time) /
                     this.flightSeconds(uStart, approachSeconds);

    const tail = progress > 1 - SHAPE_FLIGHT_TAIL
      ? Math.max(0, (1 - progress) / SHAPE_FLIGHT_TAIL)
      : 1;

    return Math.max(0, Math.min(1, tail));
  },

  // How big a struck shape is, as a multiple of its true size: it arrives at
  // SHAPE_SPAWN_OVERSHOOT and eases onto 1 over SHAPE_SETTLE_SECONDS.
  //
  // The opposite of grow(), and deliberately so. A bass note or a key is hit,
  // and a hit thing arrives whole and overshoots; a pad chord blooms, and
  // grow() is right for that. This is the only place a shape is allowed to
  // get smaller - see grow() for why that is otherwise forbidden - and it is
  // over inside a third of a second, at the moment of the strike, where it
  // reads as impact rather than as retreat.
  settle(note, songTime) {
    if (SHAPE_SETTLE_SECONDS <= 0) return 1;
    const age = songTime - note.time;
    if (age <= 0) return SHAPE_SPAWN_OVERSHOOT;
    if (age >= SHAPE_SETTLE_SECONDS) return 1;
    const x = age / SHAPE_SETTLE_SECONDS;
    const ease = 1 - (1 - x) * (1 - x);      // ease out, quick then gentle
    return SHAPE_SPAWN_OVERSHOOT + (1 - SHAPE_SPAWN_OVERSHOOT) * ease;
  },

  // The flash a shape arrives on: 1 at the note's onset, easing to 0 over
  // `seconds`. Used to lift the colour towards white, not to change its alpha
  // - it is a shape catching the light as it is struck, not one fading in.
  //
  // The length is passed in rather than read from a constant, because each
  // family wants its own: see PAD_PULSE_SECONDS and friends.
  spawnPulse(note, songTime, seconds) {
    if (!(seconds > 0)) return 0;
    const age = songTime - note.time;
    if (age < 0 || age >= seconds) return 0;
    const x = 1 - age / seconds;
    return x * x;                            // ease out, sharp at the strike
  },

  // The colour to draw a shape in: its own hue at the envelope's brightness,
  // lifted towards white by the spawn pulse, and carried by ALPHA rather than
  // by scaling the colour down to black.
  //
  // Black is not the same as gone. A shape faded to black is still a shape:
  // it writes depth and paints a hole where whatever is behind it should be.
  // Alpha actually removes it - given the painter's ordering in render().
  inkFor(colour, k, pulse, alpha) {
    const lift = pulse * SHAPE_PULSE_LIFT;
    return [
      colour[0] * k + (255 - colour[0] * k) * lift,
      colour[1] * k + (255 - colour[1] * k) * lift,
      colour[2] * k + (255 - colour[2] * k) * lift,
      255 * alpha
    ];
  },

  render(p) {
    const playing = page === "GAME" || page === "PAUSE" || page === "END";

    // With a backdrop video running this layer is the middle of three, and
    // painting its own background would bury the video under it - so it is
    // left transparent and the backdrop becomes what you see through the
    // shapes. Without one it paints the background itself, as it always did.
    //
    // showing() is already false on any page with no backdrop, so this does
    // not need to know which pages those are.
    //
    // p5 makes a WEBGL canvas with alpha: true, so clear() really is
    // see-through rather than black.
    if (Backdrop.showing()) p.clear();
    else p.background(COLORS.bg[0], COLORS.bg[1], COLORS.bg[2]);

    // Before anything is placed: every position below is worked out from
    // eyeZ(p), so the camera has to actually be there.
    this.aimCamera(p);

    if (!playing || !score) return;

    const songTime = songTimeNow;
    this.rewindIfNeeded(songTime);
    const unit = Math.min(p.width, p.height) / 900;

    // A soft key light and no point light. A point light this close to the
    // shapes drives every material to white and the whole layer blows out.
    // fill() below is the shaded base colour. ambientMaterial() would only
    // pick up the ambient term and render everything at about a fifth of its
    // real brightness.
    //
    // Both lights are warm now that the shapes are. The cold blue rim they
    // used to have was there to lift blue and violet materials off the
    // background; against deep reds it only greyed them, so it is a dull
    // ember glow from below instead.
    p.ambientLight(118, 96, 88);
    p.directionalLight(200, 176, 150, -0.35, 0.5, -1);
    p.directionalLight(120, 46, 20, 0.6, -0.4, -0.6);

    // Gather every shape first, then paint them farthest away first.
    //
    // The same reason drawBoxes() sorts in the 2D layer, and one more: the
    // shapes are alpha blended now, and a transparent thing still writes
    // depth. Measured - a shape at 2% alpha drawn BEFORE a solid one behind
    // it deletes it outright, and gl.depthMask(false) does not help because
    // p5 sets the depth state back on every geometry. Painting back to front
    // is what makes the blend correct, and it costs a sort of about a dozen
    // items.
    const queue = [];
    this.collectPads(p, songTime, unit, queue);
    this.collectBassKeys(p, songTime, unit, queue);
    queue.sort((a, b) => b.u - a.u);
    for (const item of queue) this.paint(p, item, songTime);
  },

  // Puts one gathered shape on the screen. Everything about where it is and
  // what colour it is has already been decided; this is only the drawing.
  paint(p, it, songTime) {
    p.push();
    p.translate(it.x, it.y, it.z);
    p.noStroke();
    p.fill(it.ink[0], it.ink[1], it.ink[2], it.ink[3]);
    if (it.kind === "pyramid") {
      p.rotateY(songTime * 0.22 + it.midi);
      p.rotateX(songTime * 0.13);
      // A cone with four segments IS a square pyramid, and p5 has no pyramid
      // of its own. detailY of 1 because the sides are flat - there is nothing
      // to subdivide down the length of them.
      p.cone(it.size, it.size * PAD_PYRAMID_HEIGHT, PAD_PYRAMID_SIDES, 1);
    } else if (it.kind === "torus") {
      p.rotateY(songTime * 0.3);
      p.rotateX(0.62 + Math.sin(songTime * 0.4) * 0.12);
      p.torus(it.size, it.size * 0.26, 22, 10);
    } else {
      p.rotateY(songTime * 0.9 + it.midi);
      p.rotateZ(songTime * 0.5);
      p.box(it.size);
    }
    p.pop();
  },

  // Pads: the chord, on the right, one pyramid per sounding note stacked by
  // pitch - lowest at the bottom. A voicing then reads as a vertical shape,
  // the way it looks on a stave, instead of spreading sideways.
  // Pads drift forward on PAD_APPROACH_SECONDS - slower than the blocks,
  // because they are the bed the rest sits on and hold for far longer. At the
  // blocks' own speed a sustained chord would arrive and sail past the camera
  // while it was still sounding.
  collectPads(p, songTime, unit, queue) {
    const padFlight = this.flightSeconds(PAD_U_START, PAD_APPROACH_SECONDS);
    this.eachLive(score.pads, "pads", songTime, padFlight, (note) => {
      const u = this.depthOf(note, songTime, PAD_U_START, PAD_APPROACH_SECONDS);
      if (this.gone(u)) return;
      const alpha = this.visible(note, songTime, PAD_U_START, PAD_APPROACH_SECONDS)
                  * this.releaseFade(note, songTime);
      if (alpha <= 0.002) return;

      const r = score.range.pads;
      // Positive pitch is up the screen, so the mapping runs high to low.
      const lift = p.constrain(p.map(note.midi, r.lo, r.hi, 1, -1), -1, 1);
      // grow(), not the envelope: the pyramid must not shrink back as the note
      // fades, or it reads as retreating while it is coming at you.
      const swell = this.grow(note, songTime);
      queue.push({
        u, kind: "pyramid", midi: note.midi,
        x: this.worldX(p, PAD_X, u),
        y: this.worldY(p, lift * PAD_Y_SPREAD + PAD_Y, u)
           + Math.sin(songTime * 0.5 + note.midi) * 10 * unit,
        z: this.zAt(p, u),
        size: (PAD_PYRAMID_SIZE[0] + PAD_PYRAMID_SIZE[1] * swell)
              * unit * (0.75 + note.velocity * 0.4),
        // Brightness rides the envelope along with the size, so a swell reads
        // even where two pyramids overlap.
        ink: this.inkFor(COLORS.pads, 0.55 + 0.75 * swell,
                         this.spawnPulse(note, songTime, PAD_PULSE_SECONDS), alpha)
      });
    });
  },

  // The whole bass/keys bus lives on the left: the bass ring low and heavy,
  // the keys stacked above it by pitch. One bus, one side of the screen.
  // Bass and keys share a bus but not a look: each has its own start depth,
  // its own place on screen and its own speed. Both default to the lookahead,
  // which is the blocks' own speed - a keys cube beside a falling snare box
  // covers the same ground in the same time.
  collectBassKeys(p, songTime, unit, queue) {
    const bkFlight = Math.max(
      this.flightSeconds(BASS_U_START, BASS_APPROACH_SECONDS),
      this.flightSeconds(KEYS_U_START, KEYS_APPROACH_SECONDS));

    this.markMonophonic(score.basskeys, "bass");

    this.eachLive(score.basskeys, "basskeys", songTime, bkFlight, (note) => {
      // One bus, but two shapes with their own settings all the way down:
      // where they start, how far out, and how fast they come at you.
      const bass = note.voice === "bass";
      const uStart = bass ? BASS_U_START : KEYS_U_START;
      const approach = bass ? BASS_APPROACH_SECONDS : KEYS_APPROACH_SECONDS;

      const u = this.depthOf(note, songTime, uStart, approach);
      if (this.gone(u)) return;
      // The bass also gives way to the next bass note - see cutoffFade().
      const alpha = this.visible(note, songTime, uStart, approach)
                  * this.releaseFade(note, songTime)
                  * (bass ? this.cutoffFade(note, songTime) : 1);
      if (alpha <= 0.002) return;

      // settle(), not grow(): these two arrive at full size and fall onto it.
      // Their colour arrives whole too - there is no swelling in to match, and
      // the strike is carried by the pulse instead.
      const drop = this.settle(note, songTime);
      const pulse = this.spawnPulse(note, songTime,
        bass ? BASS_PULSE_SECONDS : KEYS_PULSE_SECONDS);
      const x = this.worldX(p, bass ? BASS_X : KEYS_X, u);
      const z = this.zAt(p, u);

      if (bass) {
        queue.push({
          u, kind: "torus", midi: note.midi,
          x, y: this.worldY(p, BASS_Y, u), z,
          size: (BASS_RING_SIZE[0] + BASS_RING_SIZE[1]) * unit * drop,
          ink: this.inkFor(COLORS.bass, 1, pulse, alpha)
        });
      } else {
        const r = score.range.keys;
        const lift = p.constrain(p.map(note.midi, r.lo, r.hi, 1, -1), -1, 1);
        queue.push({
          u, kind: "box", midi: note.midi,
          x, y: this.worldY(p, lift * KEYS_Y_SPREAD + KEYS_Y, u), z,
          size: (KEYS_CUBE_SIZE[0] + KEYS_CUBE_SIZE[1]) * unit * drop,
          ink: this.inkFor(COLORS.keys, 1, pulse, alpha)
        });
      }
    });
  }
};
