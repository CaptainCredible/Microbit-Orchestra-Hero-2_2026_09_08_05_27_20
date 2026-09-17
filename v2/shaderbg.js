// The shader backdrop.
//
// The other half of Backdrop (see sketch.js): where that plays a video file,
// this runs a fragment shader written in Shadertoy's dialect. A song picks
// one the same way it picks a video - `"video": "aurora.txt"` in its
// song.setup - and the extension is what decides which of the two it is.
//
// It draws on a canvas of its own, a sibling of the video element at the same
// z-index, so everything above it - the wash, the two game canvases, the DOM
// buttons - neither knows nor cares which kind of backdrop is underneath.
//
// Plain WebGL rather than a third p5 instance. This draws one triangle with
// one shader on it and never needs a camera, a matrix or a material, and
// going through p5 would mean depending on which of its several fullscreen
// shader idioms the loaded version happens to support.
//
// WHAT IT COSTS, which is the one way it differs from a video: a video is
// decoded on the media engine and composited for free, while a shader is real
// GPU work on every frame - as much as the shader asks for. A heavy Shadertoy
// import can cost more than the game does. BG_SHADER_SCALE is the dial for
// that: it renders at a fraction of the window and lets the GPU scale it up,
// and a backdrop this far behind a wash is very forgiving of it.

// Shadertoy's uniforms, declared for the pasted code to find. The iChannel
// texture inputs are deliberately absent - there is nothing to plug into them -
// so a shader that samples one will not compile, and says so.
//
// This is GLSL ES 1.00, the WebGL 1 dialect. Shadertoy itself writes GLSL ES
// 3.00, so a pasted shader may need a little work - the usual culprits are
// tanh(), texture() instead of texture2D(), and for-loops, which in 1.00 have
// to match a rigid template: the index declared in the init, compared against
// a constant, stepped by a constant. `for (; i < 100.0; i += 1.0)` is refused;
// `for (float i = 0.0; i < 100.0; i += 1.0)` is fine.
//
// Offering GLSL ES 3.00 on a WebGL 2 context was tried and taken out again: it
// did make pasting easier, but fire.txt - the shader this is actually run with -
// started spiking frames on the 3.00 path, and a backdrop that hitches is worse
// than one that needs a loop rewritten.
// dFdx/dFdy/fwidth are an extension in GLSL ES 1.00 rather than built in. A
// shader may only say "#extension GL_OES_standard_derivatives" once the
// CONTEXT has asked for it with getExtension - asking in the shader alone is
// refused, and refused hard enough to fail the whole compile. So the line is
// added at compile time, and only when build() got the extension.
const SHADER_DERIVATIVES = "#extension GL_OES_standard_derivatives : enable\n";

const SHADER_PREAMBLE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3  iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int   iFrame;
uniform vec4  iMouse;
uniform vec4  iDate;
uniform float iSampleRate;

// ---- sparks, which are this app's own and not Shadertoy's -----------------
//
// One entry per spark:  xy  where it was struck, in 0..1 of the screen
//                       z   a random seed, for per-spark twinkle and wander
//                       w   life, 1 when struck and 0 when gone
//
// Slots with no spark in them have life 0 and cost a compare. What a spark
// looks like, and how this shader's own flow should carry one, is left to the
// shader - that is the point of it: a spark that ignores the flow it sits in
// looks stuck to the glass.
uniform vec4 iSpark[${BG_SHADER_SPARKS}];

// Seconds since a spark was struck, from its life - what a shader needs in
// order to work out how far its own flow should have carried one by now.
float sparkAge(float life) {
  return (1.0 - life) * ${BG_SHADER_SPARK_LIFE.toFixed(3)};
}
// ---------------------------------------------------------------------------
`;

// Shadertoy hands you mainImage() and keeps main() to itself. So do we.
const SHADER_EPILOGUE = `
void main() {
  vec4 colour = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(colour, gl_FragCoord.xy);
  gl_FragColor = vec4(colour.rgb, 1.0);
}
`;

// One triangle big enough to cover the screen, rather than two making a quad:
// no seam down the diagonal, and one fewer vertex to think about.
const SHADER_VERTEX = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const ShaderBackdrop = {
  canvas: null,
  gl: null,
  program: null,
  uniforms: null,
  src: "",            // which file is compiled right now
  running: false,
  frames: 0,
  time: 0,            // iTime, which holds still while paused
  lastFrameAt: 0,
  raf: 0,
  mouse: null,        // iMouse, in fractions of the window - see watchMouse()
  sparks: null,       // the ring of live sparks - see initSparks()
  derivatives: false, // whether fwidth() and friends are available

  //////////////////////////////////////////////////////////////////
  // Setting up
  //////////////////////////////////////////////////////////////////

  // Built on first use rather than at startup: a show that never points at a
  // shader should never pay for a WebGL context.
  build() {
    if (this.canvas) return !!this.gl;

    const canvas = document.createElement("canvas");
    canvas.id = "backdrop-shader";
    canvas.style.display = "none";
    document.body.appendChild(canvas);
    this.canvas = canvas;

    // preserveDrawingBuffer so a frozen frame survives. Without it the buffer
    // is undefined after it has been composited, and PAUSE - which stops the
    // loop and leaves the last frame standing - could show anything.
    const options = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power"
    };

    this.gl = canvas.getContext("webgl", options);
    if (!this.gl) {
      loadError = "no WebGL for the backdrop shader";
      return false;
    }

    const gl = this.gl;

    // Asked for once, here. Without this a shader saying #extension for it is
    // rejected; with it, fwidth() and friends work in any shader that wants
    // them. Absent on a thin driver, and then the line is simply left out.
    this.derivatives = !!gl.getExtension("OES_standard_derivatives");

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    window.addEventListener("resize", () => this.resize());
    this.watchMouse();
    return true;
  },

  // iMouse, in Shadertoy's convention:
  //
  //   xy  where the pointer is, in shader pixels, y counted up from the bottom
  //       because that is where gl_FragCoord starts
  //   zw  where the button went down, negative x while it is up - which is how
  //       a Shadertoy tells "being dragged" from "was dragged once"
  //
  // Started at the middle of the screen rather than at 0,0: a shader that
  // swirls around the pointer would otherwise spend the whole time before the
  // first mouse move swirling around the bottom left corner.
  watchMouse() {
    this.mouse = { x: 0.5, y: 0.5, downX: 0.5, downY: 0.5, down: false, moved: false };
    this.initSparks();

    const at = (e) => ({
      x: e.clientX / Math.max(1, window.innerWidth),
      y: 1 - e.clientY / Math.max(1, window.innerHeight)     // flipped for GL
    });

    window.addEventListener("mousemove", (e) => {
      const m = at(e);
      this.trailSparks(m.x, m.y);
      this.mouse.x = m.x;
      this.mouse.y = m.y;
      this.mouse.moved = true;
    }, { passive: true });

    window.addEventListener("mousedown", (e) => {
      const m = at(e);
      this.mouse.down = true;
      this.mouse.downX = m.x;
      this.mouse.downY = m.y;
      this.burstSparks(m.x, m.y);
    }, { passive: true });

    window.addEventListener("mouseup", () => { this.mouse.down = false; }, { passive: true });
  },

  //////////////////////////////////////////////////////////////////
  // Sparks
  //
  // A ring, oldest overwritten. One flat typed array, because it goes to the
  // GPU exactly as it is every frame with no packing step in between.
  //////////////////////////////////////////////////////////////////

  initSparks() {
    this.sparks = {
      n: BG_SHADER_SPARKS,
      data: new Float32Array(BG_SHADER_SPARKS * 4),   // x, y, seed, life
      next: 0,
      x: 0.5, y: 0.5,        // where the pointer was when one was last struck
      seeded: false
    };
  },

  strike(x, y) {
    const s = this.sparks;
    const i = s.next;
    s.next = (s.next + 1) % s.n;
    s.data[i * 4] = x;
    s.data[i * 4 + 1] = y;
    s.data[i * 4 + 2] = Math.random();
    s.data[i * 4 + 3] = 1;
  },

  // Called on every pointer move. Sparks are rationed by DISTANCE, not by
  // time: that lays an even trail along the path whatever rate the mouse
  // happens to report at, and a fast drag still throws more of them than a
  // slow one, because it covers the ground quicker.
  trailSparks(x, y) {
    const s = this.sparks;
    if (!s.seeded) { s.x = x; s.y = y; s.seeded = true; return; }

    const dx = x - s.x, dy = y - s.y;
    const gap = Math.hypot(dx, dy);
    if (gap < BG_SHADER_SPARK_SPACING) return;

    // Struck along the path rather than only at the end of it: a fast flick
    // between two mouse reports would otherwise leave one spark and a hole.
    const steps = Math.min(s.n, Math.floor(gap / BG_SHADER_SPARK_SPACING));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      this.strike(s.x + dx * t, s.y + dy * t);
    }
    s.x = x;
    s.y = y;
  },

  // A click throws a handful at once, scattered, so it reads as a shower
  // rather than as a stack of sparks in one spot.
  burstSparks(x, y) {
    for (let k = 0; k < BG_SHADER_SPARK_BURST; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * BG_SHADER_SPARK_SCATTER;
      this.strike(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  },

  ageSparks(delta) {
    const s = this.sparks;
    if (!s) return;
    for (let i = 0; i < s.n; i++) {
      const at = i * 4 + 3;
      if (s.data[at] <= 0) continue;
      s.data[at] = Math.max(0, s.data[at] - delta / BG_SHADER_SPARK_LIFE);
    }
  },

  // Fetch and compile. Returns whether there is something to draw, so the
  // caller can fall back to the plain background rather than a black hole.
  async use(url) {
    if (url === this.src && this.program) return true;
    if (!this.build()) return false;

    this.stop();
    this.src = url;
    this.program = null;      // nothing to show until the new one compiles

    let source;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("not found");
      source = await response.text();
    } catch (err) {
      loadError = `backdrop shader ${url}: ${err.message}`;
      return false;
    }

    // Raced: another song was picked while this was in flight, and that one
    // has already claimed this.src. Its own use() will finish; this one must
    // not compile over the top of it.
    if (this.src !== url) return false;

    if (!source.includes("mainImage")) {
      loadError = `backdrop shader ${url}: no mainImage() in it` +
                  (source.trim() ? "" : " - the file is empty");
      return false;
    }

    return this.compile(source, url);
  },

  compile(source, url) {
    const gl = this.gl;
    const head = this.derivatives ? SHADER_DERIVATIVES : "";
    const preamble = head + SHADER_PREAMBLE;

    const vert = this.shaderPart(gl.VERTEX_SHADER, SHADER_VERTEX, 0, url);
    const frag = this.shaderPart(gl.FRAGMENT_SHADER,
      preamble + "\n" + source + "\n" + SHADER_EPILOGUE,
      preamble.split("\n").length, url);

    if (!vert || !frag) {
      if (vert) gl.deleteShader(vert);
      if (frag) gl.deleteShader(frag);
      return false;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    // Attached and linked, so the parts themselves are no longer needed.
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      loadError = `backdrop shader ${url} would not link`;
      console.warn(loadError, gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return false;
    }

    if (this.program) gl.deleteProgram(this.program);
    this.program = program;

    this.uniforms = {};
    for (const name of ["iResolution", "iTime", "iTimeDelta", "iFrame",
                        "iMouse", "iDate", "iSampleRate"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    // An array is set through the location of its first element. It comes back
    // null for a shader that never reads iSpark, because the compiler strips
    // what is not used - which is exactly right: it then costs nothing.
    this.uniforms.iSpark = gl.getUniformLocation(program, "iSpark[0]");

    // A fresh shader starts at the beginning, the way opening it on Shadertoy
    // would - not at whatever iTime the last one had reached.
    this.time = 0;
    this.frames = 0;
    this.resize();
    return true;
  },

  shaderPart(kind, source, offset, url) {
    const gl = this.gl;
    const part = gl.createShader(kind);
    gl.shaderSource(part, source);
    gl.compileShader(part);
    if (gl.getShaderParameter(part, gl.COMPILE_STATUS)) return part;

    // The line numbers in the log count the preamble this file bolted on, so
    // the offset is subtracted to give the line in the file as written.
    const log = (gl.getShaderInfoLog(part) || "").trim();
    const readable = log.replace(/ERROR:\s*(\d+):(\d+)/g,
      (all, col, line) => `line ${Math.max(1, parseInt(line, 10) - offset)}`);

    // The first line of the log is not necessarily the problem - a driver will
    // put its warnings first, and reporting one of those as the reason sends
    // you hunting for a fault in the wrong place entirely.
    const lines = readable.split("\n").map(l => l.trim()).filter(Boolean);
    const first = lines.find(l => l.startsWith("line ") || /error/i.test(l));

    loadError = `backdrop shader ${url}: ${first || lines[0] || "would not compile"}`;
    console.warn(`backdrop shader ${url} would not compile:\n${log}`);
    gl.deleteShader(part);
    return null;
  },

  // Which scale is in force right now. A song is rendered smaller than the
  // menu - see BG_SHADER_SCALE and BG_SONG_SHADER_SCALE in config.js - so this
  // has to be asked again on every page change, not only on a window resize.
  scaleForPage() {
    const songPage = typeof SONG_BACKDROP_PAGES !== "undefined" &&
                     SONG_BACKDROP_PAGES.includes(page);
    return songPage ? BG_SONG_SHADER_SCALE : BG_SHADER_SCALE;
  },

  resize() {
    if (!this.canvas || !this.gl) return;
    const scale = Math.max(0.1, Math.min(1, this.scaleForPage()));
    const w = Math.max(1, Math.round(window.innerWidth * scale));
    const h = Math.max(1, Math.round(window.innerHeight * scale));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
    // A frozen backdrop still has to be redrawn at the new size, or it would
    // stretch until something happened to start it again.
    if (!this.running) this.draw(0);
  },

  show(on) {
    if (this.canvas) this.canvas.style.display = on ? "block" : "none";
  },

  start() {
    if (!this.program || this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const t0 = performance.now();
      // Clamped at both ends. Above, because a backgrounded tab hands back one
      // enormous delta on its first frame and a shader driven by iTime would
      // jump. Below, because a requestAnimationFrame timestamp is the time the
      // *frame* began, which can be earlier than the performance.now() taken
      // when the loop was started - and an unfloored delta then runs iTime
      // backwards from zero, which a shader shows very plainly.
      const delta = Math.max(0, Math.min(0.1, (now - this.lastFrameAt) / 1000));
      this.lastFrameAt = now;
      this.time += delta;
      this.ageSparks(delta);
      // Two different measurements of the same draw: how long the main thread
      // spent handing the work over, and how long the GPU spent doing it.
      Perf.gpuFrame(this.gl, () => this.draw(delta));
      Perf.add("shader", performance.now() - t0);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  // Stops the loop and leaves the last frame standing, which is what PAUSE
  // wants - and what leaving the page wants too, since a hidden canvas should
  // not be drawing.
  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    // Otherwise the meter goes on reporting the cost of a frame that is no
    // longer being drawn.
    Perf.gpuIdle();
  },

  draw(delta) {
    const gl = this.gl;
    if (!gl || !this.program) return;

    gl.useProgram(this.program);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const u = this.uniforms;
    const now = new Date();
    if (u.iResolution) gl.uniform3f(u.iResolution, this.canvas.width, this.canvas.height, 1);
    if (u.iTime) gl.uniform1f(u.iTime, this.time);
    if (u.iTimeDelta) gl.uniform1f(u.iTimeDelta, delta);
    if (u.iFrame) gl.uniform1i(u.iFrame, this.frames);
    if (u.iMouse) {
      // Fractions until here, so a resize does not strand the pointer: turned
      // into pixels of whatever the canvas is now.
      const m = this.mouse || { x: 0.5, y: 0.5, downX: 0, downY: 0, down: false };
      const w = this.canvas.width, h = this.canvas.height;
      gl.uniform4f(u.iMouse,
        m.x * w, m.y * h,
        (m.down ? 1 : -1) * m.downX * w, m.downY * h);
    }
    if (u.iSampleRate) gl.uniform1f(u.iSampleRate, 44100);
    if (u.iDate) {
      gl.uniform4f(u.iDate, now.getFullYear(), now.getMonth(), now.getDate(),
        now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());
    }

    if (this.sparks && u.iSpark) gl.uniform4fv(u.iSpark, this.sparks.data);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.frames++;
  },

  // Whether there is a compiled shader with a frame on screen. Backdrop asks
  // this the same way it asks the video for its readyState.
  ready() {
    return !!this.program && this.frames > 0;
  }
};
