// The note highway.
//
// Kick and snare get the two lanes, because those are the two things the
// micro:bit can fire. Hi-hats run down a thin centre lane.
//
// It is all still flat 2D drawing, but everything is projected through a
// fake perspective: lanes converge on a vanishing point and notes are scaled
// by 1/depth, so they start small at the horizon and grow as they approach.
// That buys a much longer lookahead than a flat scroll - distant notes cost
// almost no vertical space - which is the point of the Guitar Hero view.

function mix(a, b, f) { return a + (b - a) * f; }

// One point along the title's colour law, for whichever palette is selected.
// Shared with the starfield below, so a star and a letter of the title are
// coloured by exactly the same rule rather than two rules tuned to look
// similar.
//
// `flow` is the position round the colour cycle, `band` is the travelling
// pulse at this point. What comes back is the colour plus `lit`, how lit
// this point is, which a glow (the title's, not the starfield's) uses for
// its own opacity.
function titleStop(palette, flow, band) {
  if (palette.wheel) {
    return {
      h: flow * 360,
      s: palette.sat,
      l: mix(palette.light[0], palette.light[1], band),
      lit: band
    };
  }

  // Not a wheel, so the band is heat rather than just brightness: it drives
  // the hue up the range as well as the lightness, which is what makes fire
  // read as fire. A slower shimmer is mixed in so the cool parts are never
  // completely static.
  const shimmer = 0.5 + 0.5 * Math.sin(flow * Math.PI * 2);
  const heat = constrain(0.72 * band + 0.28 * shimmer, 0, 1);
  return {
    h: mix(palette.hue[0], palette.hue[1], heat),
    s: palette.sat - heat * 10,          // the hottest part washes towards white
    l: mix(palette.light[0], palette.light[1], heat),
    lit: heat
  };
}

// titleStop() works in HSL because that is what a canvas gradient stop
// wants; the starfield draws with p5's own numeric fill(r,g,b,a) like
// everything else in this file, so its stops are converted rather than
// handed to fill() as a CSS string. Standard CSS-spec HSL->RGB; h in
// degrees, s and l as 0..100.
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// A cheap starfield for the backdrop.
//
// Positions are generated once and kept in normalised 0..1 coordinates, so a
// frame is one rect() per star and nothing is recomputed. The only per-frame
// maths is a modulo for the drift, a sine for the twinkle, and the same
// colour law the title uses. At the default density that is around 150
// rects, which is nothing next to the note boxes.
const Starfield = {
  stars: [],
  builtFor: { w: 0, h: 0 },

  build() {
    const count = Math.round(constrain(
      width * height * STAR_DENSITY, STAR_COUNT_RANGE[0], STAR_COUNT_RANGE[1]));

    this.stars.length = 0;
    for (let i = 0; i < count; i++) {
      // `layer` fakes distance: nearer stars are bigger, brighter and drift
      // faster, which reads as parallax without any extra bookkeeping.
      const layer = Math.random();

      // For the tunnel: a fixed direction out from the vanishing point, and
      // where along its own run this star starts. sqrt spreads them evenly
      // over the area rather than bunching them in the middle, and the
      // minimum radius keeps one from sitting on the vanishing point, where
      // it would approach forever without ever visibly moving.
      const angle = Math.random() * Math.PI * 2;
      const radius = STAR_TUNNEL_SPREAD[0] +
        Math.sqrt(Math.random()) * (STAR_TUNNEL_SPREAD[1] - STAR_TUNNEL_SPREAD[0]);

      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        speed: 0.003 + layer * 0.014,          // screens per second
        bright: 60 + layer * 150,
        phase: Math.random() * Math.PI * 2,
        rate: 0.5 + Math.random() * 1.7,

        // Colour, from the same law the title uses: `layer` doubles as the
        // star's place in titleStop()'s `band` (nearer stars run hotter, the
        // way they already run bigger and brighter), and `flow` is each
        // star's own fixed point in the colour cycle, so they read as
        // embers of different ages rather than one colour repeated.
        layer,
        flow: Math.random(),

        dirX: Math.cos(angle) * radius,
        dirY: Math.sin(angle) * radius,
        // Nearer layers arrive sooner, which is the same parallax the flat
        // field gets from its drift speed.
        approach: 1 / (STAR_APPROACH_SECONDS * (1.35 - layer * 0.6)),
        offset: Math.random()                  // where it starts along the run
      });
    }
    this.builtFor = { w: width, h: height };
  },

  // A star's size comes from its `layer` - the same number that already makes
  // it brighter and faster - read against whichever range is in play. Worked
  // out here at draw time rather than stored on the star, so the menu and the
  // game can size the same field differently and either can be retuned live
  // without rebuilding it.
  sizeOf(star, range) {
    return range[0] + star.layer * (range[1] - range[0]);
  },

  // With no `geo` the field drifts flatly down the screen, which is what the
  // menu wants. Given the highway's geometry it becomes a tunnel instead:
  // stars fly out from the vanishing point along the same lines the blocks
  // travel, because they go through the very same projection.
  draw(seconds, geo) {
    if (this.builtFor.w !== width || this.builtFor.h !== height) this.build();
    if (geo) { this.drawTunnel(seconds, geo); return; }

    // Looked up once per frame, not once per star: TITLE_PALETTE is a `let`
    // and can be flipped live, so the field follows the title's colour
    // scheme rather than being locked to whichever one was active when a
    // star was born.
    const palette = TITLE_PALETTES[TITLE_PALETTE] || TITLE_PALETTES.rainbow;

    push();
    noStroke();
    for (const s of this.stars) {
      const y = ((s.y + seconds * s.speed) % 1) * height;
      const twinkle = 0.65 + 0.35 * Math.sin(seconds * s.rate + s.phase);
      const c = titleStop(palette, s.flow, s.layer);
      const [r, g, b] = hslToRgb(c.h, c.s, c.l);
      const size = this.sizeOf(s, STAR_SIZE_MENU);
      fill(r, g, b, s.bright * twinkle);
      rect(s.x * width, y, size, size);
    }
    pop();
  },

  // A block at depth u is drawn at the vanishing point plus its own offset
  // times 1/depth. A star is drawn exactly the same way, off the same
  // vanishing point, so the two share their perspective and a star runs
  // parallel to the blocks beside it rather than merely near them.
  //
  // u runs from 1 at the horizon down past 0 at the hit line to
  // STAR_TUNNEL_U_MIN, where the star is well off the edge of the screen, and
  // then wraps. It is computed from the clock rather than stepped, so there
  // is no per-frame state to keep and nothing to drift out of sync.
  drawTunnel(seconds, geo) {
    const span = 1 - STAR_TUNNEL_U_MIN;
    const spreadX = width * 0.75;
    const spreadY = height * 0.75;
    const palette = TITLE_PALETTES[TITLE_PALETTE] || TITLE_PALETTES.rainbow;

    push();
    noStroke();
    for (const s of this.stars) {
      const progress = (s.offset + seconds * s.approach) % 1;
      const u = 1 - progress * span;
      const scale = 1 / (1 + u * PERSPECTIVE_DEPTH);

      const x = geo.centreX + s.dirX * spreadX * scale;
      const y = geo.horizonY + s.dirY * spreadY * scale;
      const size = Math.min(this.sizeOf(s, STAR_SIZE_GAME) * scale, STAR_TUNNEL_MAX_SIZE);
      if (x + size < 0 || x > width || y + size < 0 || y > height) continue;

      // Fade up out of the horizon on the same curve the distant boxes use,
      // so nothing pops into existence at the vanishing point.
      const twinkle = 0.65 + 0.35 * Math.sin(seconds * s.rate + s.phase);
      const c = titleStop(palette, s.flow, s.layer);
      const [r, g, b] = hslToRgb(c.h, c.s, c.l);
      fill(r, g, b, s.bright * twinkle * Visuals.farFade(u));
      rect(x, y, size, size);
    }
    pop();
  }
};

// The burst of embers the scoreboard lands in.
//
// The board is a DOM panel above this canvas and is very nearly opaque, so an
// ember spawned under it would never be seen. They are born on its *outline*
// instead and thrown outward, which is also the better effect: the panel
// looks like it has punched a hole in the screen and thrown sparks out of the
// edges, rather than having confetti sprinkled over it.
//
// Everything is in seconds and pixels per second rather than per frame, so it
// looks the same at 30fps on a tired laptop as it does at 60.
const Embers = {
  parts: [],
  pending: 0,      // embers of this burst not yet thrown
  rect: null,      // where the panel was when the burst started
  startedAt: 0,
  last: 0,

  // `rect` is the panel's box in canvas pixels: { x, y, w, h }. Passing it in
  // rather than measuring here keeps this file free of the DOM - it draws,
  // it does not go looking for elements.
  burst(rect, now) {
    this.clear();
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    this.rect = rect;
    this.pending = EMBER_COUNT;
    this.startedAt = now;
    this.last = now;
  },

  clear() {
    this.parts.length = 0;
    this.pending = 0;
    this.rect = null;
  },

  running() { return this.pending > 0 || this.parts.length > 0; },

  // One ember, born somewhere on the panel's perimeter and heading straight
  // out from the edge it was born on, give or take EMBER_SPREAD.
  spawn() {
    const r = this.rect;
    const perimeter = 2 * (r.w + r.h);
    let along = Math.random() * perimeter;
    let x, y, nx, ny;

    if (along < r.w)                { x = r.x + along;             y = r.y;        nx = 0;  ny = -1; }
    else if ((along -= r.w) < r.h)  { x = r.x + r.w;               y = r.y + along; nx = 1;  ny = 0; }
    else if ((along -= r.h) < r.w)  { x = r.x + r.w - along;       y = r.y + r.h;  nx = 0;  ny = 1; }
    else                            { x = r.x;  y = r.y + r.h - (along - r.w);     nx = -1; ny = 0; }

    const spread = (Math.random() * 2 - 1) * EMBER_SPREAD;
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const speed = EMBER_SPEED[0] + Math.random() * (EMBER_SPEED[1] - EMBER_SPEED[0]);

    this.parts.push({
      x, y,
      vx: (nx * cos - ny * sin) * speed,
      vy: (nx * sin + ny * cos) * speed,
      size: EMBER_SIZE[0] + Math.random() * (EMBER_SIZE[1] - EMBER_SIZE[0]),
      age: 0,
      life: EMBER_LIFE[0] + Math.random() * (EMBER_LIFE[1] - EMBER_LIFE[0]),
      flow: Math.random()          // its own place in the colour cycle
    });
  },

  draw(now) {
    if (!this.running()) return;

    // Clamped: coming back to a backgrounded tab hands you a dt of several
    // seconds, which would teleport every ember off the screen at once.
    const dt = Math.min(Math.max(now - this.last, 0), 0.05);
    this.last = now;

    // Throw the burst out over EMBER_BURST_SECONDS rather than all in one
    // frame, so it reads as the panel catching light rather than a single
    // pop of confetti.
    if (this.pending > 0 && this.rect) {
      const due = Math.ceil(EMBER_COUNT * (dt / EMBER_BURST_SECONDS));
      for (let i = 0; i < Math.min(due, this.pending); i++) this.spawn();
      this.pending -= Math.min(due, this.pending);
    }

    const palette = TITLE_PALETTES[TITLE_PALETTE] || TITLE_PALETTES.rainbow;
    const drag = Math.max(0, 1 - EMBER_DRAG * dt);

    push();
    noStroke();
    for (const p of this.parts) {
      p.age += dt;
      p.vy += EMBER_RISE * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // An ember cools as it goes: `heat` is titleStop()'s band, and running
      // it down with age walks the same law the title uses from its white-hot
      // end to its dull red one. So they fade in colour as well as in alpha,
      // which is what makes them read as embers rather than dots.
      const t = Math.min(p.age / p.life, 1);
      const heat = (1 - t) * (1 - t);
      const c = titleStop(palette, p.flow, heat);
      const [r, g, b] = hslToRgb(c.h, c.s, c.l);
      fill(r, g, b, 255 * (1 - t));
      rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, 1);
    }
    pop();

    this.parts = this.parts.filter(p => p.age < p.life);
  }
};

const Visuals = {
  particles: [],
  flash: { kick: 0, snare: 0, hihat: 0 },
  shake: 0,
  cursors: { drums: 0, pads: 0, basskeys: 0 },

  reset() {
    this.particles.length = 0;
    this.flash = { kick: 0, snare: 0, hihat: 0 };
    this.shake = 0;
    this.cursors = { drums: 0, pads: 0, basskeys: 0 };
  },

  //////////////////////////////////////////////////////////////////
  // Geometry
  //////////////////////////////////////////////////////////////////

  layout() {
    // The hit line wants to sit low, but never so low that the HUD strip
    // covers it. On a short window the second term wins, which is what keeps
    // the landing zone visible on a laptop screen.
    const hitY = Math.max(
      160,
      Math.min(height * HIT_LINE_FRAC, height - HUD_STRIP_H - 20)
    );
    const horizonY = Math.min(height * HORIZON_FRAC, hitY - 120);
    const boxW = Math.min(width * BOX_W_FRAC, 260);
    const gap = width * LANE_GAP_FRAC;
    return {
      hitY,
      horizonY,
      boxW,
      centreX: width / 2,
      lanes: {
        kick:  width / 2 - gap / 2 - boxW / 2,
        snare: width / 2 + gap / 2 + boxW / 2,
        hihat: width / 2
      }
    };
  },

  // Project a moment in the song onto the highway.
  //
  // `u` is how far into the future the note is: 0 at the hit line, 1 at the
  // far end of the lookahead. Depth runs 1..1+PERSPECTIVE_DEPTH and every
  // dimension is scaled by its reciprocal, so evenly spaced notes compress
  // towards the horizon exactly as perspective requires.
  project(noteTime, songTime, geo) {
    return this.projectU(
      constrain((noteTime - songTime) / LOOKAHEAD_SECONDS, 0, 1), geo);
  },

  projectU(u, geo) {
    const scale = 1 / (1 + u * PERSPECTIVE_DEPTH);
    return { u, scale, y: geo.horizonY + (geo.hitY - geo.horizonY) * scale };
  },

  // Lanes converge on the vanishing point, so a lane's x depends on depth.
  laneX(lane, scale, geo) {
    return geo.centreX + (geo.lanes[lane] - geo.centreX) * scale;
  },

  // Distant notes fade out instead of stacking into an unreadable smear.
  farFade(u) {
    if (u < FAR_FADE_START) return 1;
    return constrain(1 - (u - FAR_FADE_START) / (1 - FAR_FADE_START), 0, 1);
  },

  //////////////////////////////////////////////////////////////////
  // Update - advance cursors and spawn explosions for notes that landed
  //////////////////////////////////////////////////////////////////

  update(score, songTime) {
    const geo = this.layout();

    // `while`, not `if`: if the tab stutters and several notes land inside
    // one frame, every one of them still gets its explosion.
    while (this.cursors.drums < score.drums.length &&
           score.drums[this.cursors.drums].time <= songTime) {
      const note = score.drums[this.cursors.drums];
      this.cursors.drums++;
      this.land(note, geo);
    }

    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.45;          // gravity
      p.vx *= 0.99;
      p.life--;
    }
    this.particles = this.particles.filter(p => p.life > 0);

    for (const key of Object.keys(this.flash)) {
      if (this.flash[key] > 0) this.flash[key] -= 0.06;
    }
    if (this.shake > 0) this.shake *= 0.86;
  },

  land(note, geo) {
    this.flash[note.drum] = 1;
    if (note.drum === "kick") this.shake = 9 * note.velocity;
    if (note.drum === "snare") this.shake = 5 * note.velocity;

    const x = geo.lanes[note.drum];
    const colour = COLORS[note.drum];
    const count = note.drum === "hihat"
      ? 6
      : Math.round(PARTICLES_PER_EXPLOSION * (0.5 + note.velocity));

    for (let i = 0; i < count; i++) {
      const angle = random(-PI, 0);            // upward fan
      const speed = random(2, 11) * (0.6 + note.velocity);
      this.particles.push({
        x: x + random(-geo.boxW / 2, geo.boxW / 2),
        y: geo.hitY,
        vx: cos(angle) * speed,
        vy: sin(angle) * speed,
        life: PARTICLE_LIFE * random(0.5, 1.2),
        maxLife: PARTICLE_LIFE,
        size: random(3, 11),
        colour
      });
    }
  },

  //////////////////////////////////////////////////////////////////
  // Draw
  //////////////////////////////////////////////////////////////////

  draw(score, songTime) {
    const geo = this.layout();

    push();
    if (this.shake > 0.2) {
      translate(random(-this.shake, this.shake), random(-this.shake, this.shake));
    }

    this.drawLanes(geo);
    this.drawHiHats(score, songTime, geo);
    this.drawBoxes(score, songTime, geo);
    this.drawHitLine(geo);
    this.drawParticles();

    pop();
  },

  // Pads and the bass/keys ribbon used to be drawn here. They are lit 3D
  // shapes on the layer behind now - see scene3d.js.

  // Each lane is a trapezoid running from full width at the hit line to a
  // sliver at the horizon. The converging rails are most of what sells the
  // perspective, so the edges get a drawn line rather than just a fill.
  drawLanes(geo) {

    // Sliced along its length rather than drawn as one quad, so the fill and
    // the rails can fade out towards the horizon instead of stopping dead.
    const SLICES = 14;
    for (const name of BOX_LANES) {
      const colour = COLORS[name];
      const glow = Math.max(0, this.flash[name]);

      const edge = (u, side) => {
        const q = this.projectU(u, geo);
        return {
          x: this.laneX(name, q.scale, geo) + side * (geo.boxW / 2) * q.scale,
          y: q.y,
          fade: this.farFade(u)
        };
      };

      push();
      for (let i = 0; i < SLICES; i++) {
        const u0 = i / SLICES, u1 = (i + 1) / SLICES;
        const l0 = edge(u0, -1), r0 = edge(u0, 1);
        const l1 = edge(u1, -1), r1 = edge(u1, 1);
        const fade = (l0.fade + l1.fade) / 2;
        if (fade <= 0.01) break;

        noStroke();
        fill(colour[0], colour[1], colour[2], (11 + 30 * glow) * fade);
        beginShape();
        vertex(l0.x, l0.y);
        vertex(r0.x, r0.y);
        vertex(r1.x, r1.y);
        vertex(l1.x, l1.y);
        endShape(CLOSE);

        stroke(colour[0], colour[1], colour[2], (60 + 140 * glow) * fade);
        strokeWeight(1.5);
        line(l0.x, l0.y, l1.x, l1.y);
        line(r0.x, r0.y, r1.x, r1.y);
      }
      pop();
    }

    // Rungs every half second. They bunch up towards the horizon on their
    // own, which is what reads as speed.
    push();
    noStroke();
    for (let t = 0.5; t <= LOOKAHEAD_SECONDS; t += 0.5) {
      const p = this.projectU(t / LOOKAHEAD_SECONDS, geo);
      const left = this.laneX("kick", p.scale, geo) - (geo.boxW / 2) * p.scale;
      const right = this.laneX("snare", p.scale, geo) + (geo.boxW / 2) * p.scale;
      fill(255, 255, 255, 26 * this.farFade(p.u) * p.scale);
      rect(left, p.y - 1, right - left, Math.max(1, 2.5 * p.scale));
    }
    pop();
  },

  drawHiHats(score, songTime, geo) {
    const horizon = songTime + LOOKAHEAD_SECONDS;
    const c = COLORS.hihat;
    noStroke();
    for (const n of score.drums) {
      if (n.drum !== "hihat") continue;
      if (n.time < songTime) continue;
      if (n.time > horizon) break;

      const p = this.project(n.time, songTime, geo);
      const size = 11 * p.scale;
      if (size < 1) continue;

      fill(c[0], c[1], c[2], 170 * this.farFade(p.u));
      push();
      translate(this.laneX("hihat", p.scale, geo), p.y);
      rotate(PI / 4);
      rect(-size / 2, -size / 2, size, size);
      pop();
    }
  },

  drawBoxes(score, songTime, geo) {
    const horizon = songTime + LOOKAHEAD_SECONDS;

    // Gather first, then paint back to front. Without that a distant note
    // drawn later would sit on top of a near one, which reads as wrong
    // depth immediately.
    const visible = [];
    for (const n of score.drums) {
      if (!BOX_LANES.includes(n.drum)) continue;
      if (n.time < songTime) continue;          // already exploded
      if (n.time > horizon) break;              // beyond the lookahead
      visible.push(n);
    }

    for (let i = visible.length - 1; i >= 0; i--) {
      const n = visible[i];
      const p = this.project(n.time, songTime, geo);
      const colour = COLORS[n.drum];
      const x = this.laneX(n.drum, p.scale, geo);

      // Width follows the lane; height is a face standing on the highway, so
      // it is squashed a little more than the width as it recedes.
      const w = geo.boxW * p.scale;
      const h = BOX_H * (0.7 + n.velocity * 0.5) * p.scale * 0.9;
      if (h < 1.2) continue;

      const fade = this.farFade(p.u);
      const near = 0.55 + 0.45 * p.scale;       // brighter as it approaches
      const alpha = 255 * fade * near;
      const r = Math.min(7, 7 * p.scale + 1);

      push();
      noStroke();
      fill(colour[0], colour[1], colour[2], 45 * fade * near);
      rect(x - w / 2 - 6 * p.scale, p.y - h / 2 - 6 * p.scale,
           w + 12 * p.scale, h + 12 * p.scale, r + 3);

      fill(colour[0], colour[1], colour[2], alpha);
      rect(x - w / 2, p.y - h / 2, w, h, r);

      // A lighter leading edge, so the box has a direction of travel.
      fill(255, 255, 255, 95 * fade * near);
      rect(x - w / 2, p.y - h / 2, w, Math.max(1, 3 * p.scale), r * 0.5);
      pop();
    }
  },

  drawHitLine(geo) {
    const glow = Math.max(this.flash.kick, this.flash.snare);
    push();
    noStroke();
    fill(255, 255, 255, 40 + 150 * glow);
    rect(0, geo.hitY - 2, width, 4);

    // Lane brackets, to show where a box is supposed to land.
    for (const name of BOX_LANES) {
      const c = COLORS[name];
      const x = geo.lanes[name];
      fill(c[0], c[1], c[2], 120 + 135 * this.flash[name]);
      rect(x - geo.boxW / 2, geo.hitY - 5, geo.boxW, 10, 4);
    }
    pop();
  },

  drawParticles() {
    push();
    noStroke();
    for (const p of this.particles) {
      const alpha = 255 * (p.life / p.maxLife);
      fill(p.colour[0], p.colour[1], p.colour[2], alpha);
      rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, 2);
    }
    pop();
  }
};
