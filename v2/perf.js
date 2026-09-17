// Performance meters.
//
// WHAT THESE NUMBERS ARE, because a meter that is read wrong is worse than no
// meter at all:
//
// `frame` is the wall clock between one frame and the next - the only number
// that says whether the thing is smooth. Everything else is a share of it.
//
// The buckets are MAIN THREAD time: how long the browser spent inside that
// piece of code, measured with performance.now() around it. They add up to
// `busy`, and what is left of the frame is `idle` - which at a steady 60fps is
// mostly the browser waiting for the next vsync and is a GOOD thing. A frame
// that is 29% busy is not a frame in trouble; a frame where busy approaches
// 16.7ms is.
//
// Two things are deliberately NOT main-thread time, and are labelled so:
//
//   shader gpu   real GPU time for the backdrop shader, from a WebGL timer
//                query. It runs alongside the main thread rather than inside
//                it, so it is not part of `busy` - but it is part of what has
//                to fit in a frame, and a shader that costs more than the
//                frame budget will cap the framerate however idle the CPU is.
//
//   audio        the main-thread half of the sound only: the note callbacks
//                Tone fires to start a voice. The synthesis itself runs on the
//                audio render thread, in another thread entirely, and cannot
//                be read from here at all - AudioContext.renderCapacity, which
//                would give it, is not in this browser. So `audio` being near
//                zero means the sound is not costing you frames; it does not
//                mean the sound is free.

// One second of frames per reading. Long enough that a single slow frame does
// not make the numbers jump about while you are trying to read them, short
// enough to respond while you drag a slider.
const PERF_WINDOW_MS = 1000;

// The order they appear in the panel. Anything measured under a name not in
// here still shows, just at the bottom.
const PERF_BUCKETS = ["2d canvas", "3d shapes", "shader", "audio", "micro:bit"];

const Perf = {
  on: false,
  bucket: {},        // name -> ms accumulated this window
  frames: 0,
  windowStart: 0,
  lastFrameAt: 0,
  frameMs: 0,        // longest frame this window, which is what stutters feel like

  shown: null,       // the last completed window, which is what the panel draws

  // GPU timing, if the browser will give it. Only ever one query in flight:
  // the extension does not allow them to nest, and one a frame is plenty.
  gpu: { ext: null, gl: null, query: null, inFlight: false, ms: 0, supported: null },

  //////////////////////////////////////////////////////////////////
  // Measuring
  //////////////////////////////////////////////////////////////////

  add(name, ms) {
    if (!this.on) return;
    this.bucket[name] = (this.bucket[name] || 0) + ms;
  },

  // Time a call and bill it to a bucket. Returns whatever the call returned,
  // so it can be wrapped around an expression without restructuring it.
  //
  // When the meters are off this is one boolean test and a call - no clock
  // reads, no object churn - so the instrumentation can stay in the hot paths
  // rather than being something you add when you go looking.
  time(name, fn) {
    if (!this.on) return fn();
    const t0 = performance.now();
    const out = fn();
    this.add(name, performance.now() - t0);
    return out;
  },

  // Once per frame, from the main draw loop.
  frameMark() {
    if (!this.on) {
      // Not accumulating, but the clock still has to be kept or the first
      // frame after switching on reports the whole gap since the last one.
      this.lastFrameAt = performance.now();
      return;
    }

    const now = performance.now();
    if (this.lastFrameAt) this.frameMs = Math.max(this.frameMs, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.frames++;

    if (!this.windowStart) this.windowStart = now;
    if (now - this.windowStart >= PERF_WINDOW_MS) this.roll(now);
  },

  // Close the window: work out the averages, hand them to the panel, start
  // again. Averages per frame rather than totals per second, because "3.4ms of
  // this frame" is the thing you can compare against 16.7 and totals are not.
  roll(now) {
    const elapsed = now - this.windowStart;
    const frames = Math.max(1, this.frames);

    const parts = {};
    let busy = 0;
    for (const name of Object.keys(this.bucket)) {
      const per = this.bucket[name] / frames;
      parts[name] = per;
      busy += per;
    }

    const frame = elapsed / frames;
    this.shown = {
      fps: 1000 / frame,
      frame,
      worst: this.frameMs,
      busy,
      idle: Math.max(0, frame - busy),
      parts,
      gpu: this.gpu.ms
    };

    this.bucket = {};
    this.frames = 0;
    this.frameMs = 0;
    this.windowStart = now;
  },

  //////////////////////////////////////////////////////////////////
  // GPU timing
  //////////////////////////////////////////////////////////////////

  // Timer queries are an optional extension and browsers do withdraw them, so
  // every one of these is allowed to come back empty and the panel simply says
  // so rather than showing a zero that looks like a measurement.
  gpuInit(gl) {
    if (this.gpu.supported !== null) return this.gpu.supported;
    this.gpu.gl = gl;
    this.gpu.ext = gl.getExtension("EXT_disjoint_timer_query");
    this.gpu.supported = !!(this.gpu.ext && this.gpu.ext.createQueryEXT);
    return this.gpu.supported;
  },

  // Wrap the draw that is to be measured. The result is not ready when the
  // draw returns - the GPU has not run it yet - so it is collected on a later
  // frame, which is why the reading lags the picture by a frame or two.
  gpuFrame(gl, draw) {
    if (!this.on || !this.gpuInit(gl)) { draw(); return; }

    const { ext } = this.gpu;
    this.gpuCollect();

    if (this.gpu.inFlight) { draw(); return; }

    if (!this.gpu.query) this.gpu.query = ext.createQueryEXT();
    ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, this.gpu.query);
    draw();
    ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
    this.gpu.inFlight = true;
  },

  gpuCollect() {
    const { ext, gl, query } = this.gpu;
    if (!this.gpu.inFlight || !query) return;

    // A disjoint means the GPU was interrupted - another process took it, the
    // clock changed - and every query in flight is rubbish. Thrown away rather
    // than shown.
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.gpu.inFlight = false;
      return;
    }
    if (!ext.getQueryObjectEXT(query, ext.QUERY_RESULT_AVAILABLE_EXT)) return;

    this.gpu.ms = ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT) / 1e6;
    this.gpu.inFlight = false;
  },

  // Nothing has been drawn by the shader since the last look, so the standing
  // GPU figure is stale and would read as though it were still running.
  gpuIdle() {
    this.gpu.ms = 0;
  }
};

//////////////////////////////////////////////////////////////////////
// The panel
//////////////////////////////////////////////////////////////////////

const PerfPanel = {
  root: null,
  body: null,
  lastShown: null,     // the window already on screen, so it is drawn once

  build() {
    if (this.root || !DEBUG) return;

    const root = document.createElement("div");
    root.id = "perfpanel";

    const head = document.createElement("header");
    const title = document.createElement("span");
    title.textContent = "PERFORMANCE";

    const hideBtn = document.createElement("button");
    hideBtn.textContent = "hide";
    hideBtn.onclick = () => this.toggle();

    head.append(title, hideBtn);

    const body = document.createElement("div");
    body.className = "sp-body";

    root.append(head, body);
    debugColumn().appendChild(root);
    this.root = root;
    this.body = body;
  },

  row(label, value, share, kind) {
    const row = document.createElement("div");
    row.className = "sp-row perf-row" + (kind ? " perf-" + kind : "");

    const name = document.createElement("span");
    name.className = "sp-name";
    name.textContent = label;

    // The bar is the part you actually read - the numbers are for when you
    // want to write one down. Scaled against the frame budget, not against the
    // largest bucket, so a bar that is nearly full always means the same thing.
    const track = document.createElement("span");
    track.className = "perf-track";
    const fill = document.createElement("span");
    fill.className = "perf-fill";
    fill.style.width = Math.min(100, Math.max(0, share * 100)) + "%";
    track.appendChild(fill);

    const val = document.createElement("span");
    val.className = "sp-val";
    val.textContent = value;

    row.append(name, track, val);
    return row;
  },

  refresh() {
    if (!this.root || this.root.classList.contains("sp-hidden")) return;

    const s = Perf.shown;
    if (!s) {
      this.body.textContent = "measuring...";
      return;
    }

    // Called every frame, but the readings only change once a window closes -
    // and rebuilding a dozen DOM rows sixty times a second to show the same
    // numbers would be a real cost that these meters, sitting outside their
    // own instrumentation, would not even report.
    if (s === this.lastShown) return;
    this.lastShown = s;

    const budget = 1000 / 60;
    const rows = document.createDocumentFragment();

    rows.append(this.row("fps", s.fps.toFixed(0), s.fps / 60, "head"));
    rows.append(this.row("frame", s.frame.toFixed(1) + " ms", s.frame / budget, "head"));
    rows.append(this.row("worst frame", s.worst.toFixed(1) + " ms", s.worst / budget,
      s.worst > budget * 2 ? "bad" : "head"));

    const gap = document.createElement("div");
    gap.className = "perf-gap";
    gap.textContent = "main thread";
    rows.append(gap);

    rows.append(this.row("busy", s.busy.toFixed(2) + " ms", s.busy / budget,
      s.busy > budget * 0.8 ? "bad" : "busy"));

    // Known buckets in their listed order, then anything else that turned up.
    const names = PERF_BUCKETS.filter(n => n in s.parts)
      .concat(Object.keys(s.parts).filter(n => !PERF_BUCKETS.includes(n)));
    for (const name of names) {
      rows.append(this.row("· " + name, s.parts[name].toFixed(2) + " ms",
        s.parts[name] / budget, "part"));
    }

    rows.append(this.row("idle", s.idle.toFixed(2) + " ms", s.idle / budget, "idle"));

    const gap2 = document.createElement("div");
    gap2.className = "perf-gap";
    gap2.textContent = "gpu, alongside";
    rows.append(gap2);

    if (Perf.gpu.supported === false) {
      rows.append(this.row("shader gpu", "unavailable", 0, "part"));
    } else {
      rows.append(this.row("shader gpu", s.gpu.toFixed(2) + " ms", s.gpu / budget, "gpu"));
    }

    this.body.textContent = "";
    this.body.appendChild(rows);
  },

  toggle() {
    if (!this.root) return;
    this.root.classList.toggle("sp-hidden");
    // Opened again on the same window as it was closed on, so the guard in
    // refresh() would leave it showing whatever was there before.
    this.lastShown = null;
    this.refresh();
  }
};
