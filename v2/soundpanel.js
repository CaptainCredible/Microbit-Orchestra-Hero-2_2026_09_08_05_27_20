// The sound tuning panel.
//
// Only built when DEBUG_SOUND is on. Every control writes into SoundState and
// pushes the value straight at the live audio nodes, so you hear the change
// while a song is playing. "export settings" then hands back the whole of
// SoundState as a block you can paste over SOUND_DEFAULTS in config.js.

// Cutoffs move exponentially: the slider runs 0-1000 and maps across
// CUTOFF_HZ, because a linear sweep spends nearly all its travel in the top
// octave where almost nothing is heard to change.
function cutoffToHz(slider) {
  const [lo, hi] = CUTOFF_HZ;
  const t = Math.min(1000, Math.max(0, slider)) / 1000;
  return lo * Math.pow(hi / lo, t);
}

function hzToCutoff(hz) {
  const [lo, hi] = CUTOFF_HZ;
  const clamped = Math.min(hi, Math.max(lo, hz));
  return Math.round(1000 * Math.log(clamped / lo) / Math.log(hi / lo));
}

// One entry per control. `group` starts a section; everything else is a
// parameter with a path into SoundState.
function instrumentParams(name, extra) {
  return [
    { path: `${name}.wave`, label: "waveform", type: "select", options: WAVEFORMS,
      apply: v => AudioEngine.setWave(name, v) },
    { path: `${name}.attack`,  label: "attack",  min: 0.001, max: 4, step: 0.001, unit: "s",
      apply: v => AudioEngine.setEnvelope(name, { attack: v }) },
    { path: `${name}.decay`,   label: "decay",   min: 0.01,  max: 4, step: 0.01,  unit: "s",
      apply: v => AudioEngine.setEnvelope(name, { decay: v }) },
    { path: `${name}.sustain`, label: "sustain", min: 0,     max: 1, step: 0.01,  unit: "",
      apply: v => AudioEngine.setEnvelope(name, { sustain: v }) },
    { path: `${name}.release`, label: "release", min: 0.02,  max: 8, step: 0.01,  unit: "s",
      apply: v => AudioEngine.setEnvelope(name, { release: v }) },
    { path: `${name}.cutoff`,  label: "cutoff",  curve: "hz", unit: "Hz",
      apply: v => AudioEngine.setCutoff(name, v) },
    { path: `${name}.resonance`, label: "resonance", min: 0.1, max: 14, step: 0.1, unit: "Q",
      apply: v => AudioEngine.setResonance(name, v) },
    ...(extra || []),
    { path: `${name}.level`,  label: "level",  min: 0, max: 1.5, step: 0.01, unit: "",
      apply: v => AudioEngine.setLevel(name, v) },
    { path: `${name}.reverb`, label: "reverb", min: 0, max: 1,   step: 0.01, unit: "wet",
      apply: v => AudioEngine.setReverbMix(name, v) }
  ];
}

const SOUND_PARAMS = [
  { group: "PADS", preset: "pads" },
  ...instrumentParams("pads", [
    // Per-voice filter envelope. "filter env" first, because it is the switch
    // as well as the amount - at 0 the four below it do nothing, and putting
    // it at the top is the only way that reads.
    { path: "pads.filterOctaves", label: "filter env",  min: 0, max: 6, step: 0.1, unit: "oct",
      apply: () => AudioEngine.setPadFilterEnvelope() },
    { path: "pads.filterAttack",  label: "f. attack",  min: 0.001, max: 6, step: 0.001, unit: "s",
      apply: () => AudioEngine.setPadFilterEnvelope() },
    { path: "pads.filterDecay",   label: "f. decay",   min: 0.01,  max: 6, step: 0.01,  unit: "s",
      apply: () => AudioEngine.setPadFilterEnvelope() },
    { path: "pads.filterSustain", label: "f. sustain", min: 0,     max: 1, step: 0.01,  unit: "",
      apply: () => AudioEngine.setPadFilterEnvelope() },
    { path: "pads.filterRelease", label: "f. release", min: 0.02,  max: 8, step: 0.01,  unit: "s",
      apply: () => AudioEngine.setPadFilterEnvelope() },

    { path: "pads.vibratoRate",  label: "vibrato rate",  min: 0.1, max: 12, step: 0.1,  unit: "Hz",
      apply: v => AudioEngine.setVibrato({ rate: v }) },
    { path: "pads.vibratoDepth", label: "vibrato depth", min: 0,   max: 1,  step: 0.01, unit: "",
      apply: v => AudioEngine.setVibrato({ depth: v }) },
    { path: "pads.lfoDest",   label: "LFO to", type: "select", options: LFO_DESTINATIONS,
      apply: () => AudioEngine.setPadLfo() },
    { path: "pads.lfoRate",   label: "LFO rate",   min: 0.01, max: 12, step: 0.01, unit: "Hz",
      apply: () => AudioEngine.setPadLfo() },
    { path: "pads.lfoAmount", label: "LFO amount", min: 0,    max: 1,  step: 0.01, unit: "",
      apply: () => AudioEngine.setPadLfo() }
  ]),

  { group: "CHORUS  (pads only)" },
  { path: "chorus.rate",  label: "rate",  min: 0.05, max: 6, step: 0.01, unit: "Hz",
    apply: v => AudioEngine.setChorus({ rate: v }) },
  { path: "chorus.depth", label: "depth", min: 0, max: 1, step: 0.01, unit: "",
    apply: v => AudioEngine.setChorus({ depth: v }) },
  { path: "chorus.wet",   label: "wet",   min: 0, max: 1, step: 0.01, unit: "",
    apply: v => AudioEngine.setChorus({ wet: v }) },

  { group: "BASS", preset: "bass" },
  ...instrumentParams("bass"),

  { group: "KEYS", preset: "keys" },
  ...instrumentParams("keys"),

  { group: "DRUMS", preset: "drums" },
  { path: "drums.level",  label: "level",  min: 0, max: 2, step: 0.01, unit: "",
    apply: v => AudioEngine.setLevel("drums", v) },
  { path: "drums.reverb", label: "reverb", min: 0, max: 1, step: 0.01, unit: "wet",
    apply: v => AudioEngine.setReverbMix("drums", v) },

  { group: "REVERB  (shared)" },
  { path: "reverb.decay",    label: "decay",     min: 0.3, max: 12,  step: 0.1,   unit: "s",
    slow: true, apply: v => AudioEngine.setReverbDecay(v) },
  { path: "reverb.preDelay", label: "pre-delay", min: 0,   max: 0.3, step: 0.005, unit: "s",
    slow: true, apply: v => AudioEngine.setReverbPreDelay(v) },
  { path: "reverb.level",    label: "level",     min: 0,   max: 10,  step: 0.1,   unit: "x",
    apply: v => AudioEngine.setReverbLevel(v) }
];

function soundGet(path) {
  return path.split(".").reduce((o, k) => o[k], SoundState);
}

function soundSet(path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], SoundState)[last] = value;
}

const SoundPanel = {
  root: null,
  rows: [],
  slowTimers: {},

  build() {
    if (this.root || !DEBUG_SOUND) return;

    const root = document.createElement("div");
    root.id = "soundpanel";

    const head = document.createElement("header");
    const title = document.createElement("span");
    title.textContent = "SOUND";
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "export settings";
    exportBtn.onclick = () => this.exportSettings();
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "reset";
    resetBtn.onclick = () => this.reset();
    const hideBtn = document.createElement("button");
    hideBtn.textContent = "hide";
    hideBtn.onclick = () => this.toggle();
    head.append(title, exportBtn, resetBtn, hideBtn);

    const body = document.createElement("div");
    body.className = "sp-body";

    for (const param of SOUND_PARAMS) {
      if (param.group) {
        const h = document.createElement("div");
        h.className = "sp-group";

        const label = document.createElement("span");
        label.textContent = param.group;
        h.appendChild(label);

        // Instruments carry their own preset, so a pad sound can be moved
        // between songs without dragging the whole settings block along.
        if (param.preset) {
          const save = document.createElement("button");
          save.textContent = "save";
          save.title = `save the ${param.preset} settings as a preset file`;
          save.onclick = () => this.savePreset(param.preset);

          const load = document.createElement("button");
          load.textContent = "load";
          load.title = `load a ${param.preset} preset file`;
          load.onclick = () => this.loadPreset(param.preset);

          h.append(save, load);
        }

        body.appendChild(h);
        continue;
      }
      body.appendChild(this._buildRow(param));
    }

    const out = document.createElement("textarea");
    out.id = "sp-out";
    out.readOnly = true;
    out.hidden = true;

    root.append(head, body, out);
    document.body.appendChild(root);
    this.root = root;
    this.out = out;
  },

  _buildRow(param) {
    const row = document.createElement("label");
    row.className = "sp-row";

    const name = document.createElement("span");
    name.className = "sp-name";
    name.textContent = param.label;

    const readout = document.createElement("span");
    readout.className = "sp-val";

    let input, show;

    if (param.type === "select") {
      input = document.createElement("select");
      for (const option of param.options) {
        const o = document.createElement("option");
        o.value = option;
        o.textContent = option;
        input.appendChild(o);
      }
      input.value = soundGet(param.path);
      show = () => { readout.textContent = ""; };
      input.onchange = () => {
        soundSet(param.path, input.value);
        param.apply(input.value);
      };
      row.classList.add("sp-select");

    } else {
      input = document.createElement("input");
      input.type = "range";

      const isHz = param.curve === "hz";
      input.min = isHz ? 0 : param.min;
      input.max = isHz ? 1000 : param.max;
      input.step = isHz ? 1 : param.step;
      input.value = isHz ? hzToCutoff(soundGet(param.path)) : soundGet(param.path);

      show = () => {
        const v = soundGet(param.path);
        readout.textContent = isHz
          ? Math.round(v) + " Hz"
          : (param.step < 0.01 ? v.toFixed(3) : v.toFixed(2)) +
            (param.unit ? " " + param.unit : "");
      };

      input.oninput = () => {
        const raw = parseFloat(input.value);
        const v = isHz ? cutoffToHz(raw) : raw;
        soundSet(param.path, v);
        show();
        // Reverb decay and pre-delay re-render the impulse response, so they
        // are held back until the slider stops moving.
        if (param.slow) {
          clearTimeout(this.slowTimers[param.path]);
          this.slowTimers[param.path] = setTimeout(() => param.apply(v), 220);
        } else {
          param.apply(v);
        }
      };
    }

    show();
    row.append(name, input, readout);
    this.rows.push({ param, input, show });
    return row;
  },

  toggle() {
    if (!this.root) return;
    this.root.classList.toggle("sp-hidden");
  },

  // Put every live node back to what the panel is showing. Used after a
  // reset, and once audio starts, since the nodes only exist from then on.
  applyAll() {
    if (!AudioEngine.started) return;
    for (const { param } of this.rows) param.apply(soundGet(param.path));
  },

  //////////////////////////////////////////////////////////////////
  // Per-instrument presets
  //////////////////////////////////////////////////////////////////

  // Re-read every control from SoundState. Used after a reset or a preset
  // load, when the numbers changed underneath the panel.
  refresh() {
    for (const { param, input, show } of this.rows) {
      const v = soundGet(param.path);
      input.value = param.curve === "hz" ? hzToCutoff(v) : v;
      show();
    }
  },

  savePreset(name) {
    const preset = {
      kind: "microbit-orchestra-hero-preset",
      instrument: name,
      settings: JSON.parse(JSON.stringify(SoundState[name]))
    };
    const text = JSON.stringify(preset, null, 2);

    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}-preset.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { /* the console copy below is the fallback */ }

    try { navigator.clipboard.writeText(text); } catch (err) { /* ignore */ }
    console.log(text);
    this.flash(`${name} preset saved`);
  },

  loadPreset(name) {
    if (!this.fileInput) {
      this.fileInput = document.createElement("input");
      this.fileInput.type = "file";
      this.fileInput.accept = ".json,application/json";
      this.fileInput.style.display = "none";
      document.body.appendChild(this.fileInput);
    }

    this.fileInput.value = "";
    this.fileInput.onchange = async () => {
      const file = this.fileInput.files[0];
      if (!file) return;
      try {
        const preset = JSON.parse(await file.text());
        this.applyPreset(name, preset);
      } catch (err) {
        this.flash(`could not read that preset`);
      }
    };
    this.fileInput.click();
  },

  // Takes either a saved preset file or a bare settings object, and only
  // copies keys the instrument actually has - so a bass preset dropped on
  // the keys brings across the shared controls and ignores the rest rather
  // than poisoning SoundState with fields nothing reads.
  applyPreset(name, preset) {
    const settings = preset && preset.settings ? preset.settings : preset;
    if (!settings || typeof settings !== "object") {
      this.flash("that file is not a preset");
      return;
    }

    const target = SoundState[name];
    let copied = 0;
    for (const key of Object.keys(target)) {
      if (settings[key] === undefined) continue;
      if (typeof settings[key] !== typeof target[key]) continue;
      target[key] = settings[key];
      copied++;
    }

    this.refresh();
    this.applyAll();

    const from = preset.instrument && preset.instrument !== name
      ? ` from ${preset.instrument}` : "";
    this.flash(copied
      ? `${name}: ${copied} settings loaded${from}`
      : `nothing in that preset applies to ${name}`);
  },

  flash(message) {
    if (!this.root) return;
    const head = this.root.querySelector("header span");
    head.textContent = message;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { head.textContent = "SOUND"; }, 2600);
  },

  reset() {
    const fresh = JSON.parse(JSON.stringify(SOUND_DEFAULTS));
    for (const key of Object.keys(fresh)) SoundState[key] = fresh[key];
    this.refresh();
    this.applyAll();
  },

  // A block you can paste straight over SOUND_DEFAULTS in config.js.
  settingsText() {
    const state = SoundState;
    const lines = ["const SOUND_DEFAULTS = {"];
    const groups = ["pads", "bass", "keys", "drums", "chorus", "reverb"];

    groups.forEach((g, gi) => {
      lines.push(`  ${g}: {`);
      const entries = Object.entries(state[g]);
      entries.forEach(([k, v], i) => {
        const value = typeof v === "string" ? `"${v}"` : Number(v.toFixed(4));
        lines.push(`    ${k}: ${value}${i < entries.length - 1 ? "," : ""}`);
      });
      lines.push(`  }${gi < groups.length - 1 ? "," : ""}`);
    });

    lines.push("};");
    return lines.join("\n");
  },

  async exportSettings() {
    const text = this.settingsText();
    this.out.hidden = false;
    this.out.value = text;
    this.out.select();
    console.log(text);

    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (err) {
      try { copied = document.execCommand("copy"); } catch (e) { copied = false; }
    }

    // A file as well, because clipboard access is refused in some contexts
    // and losing a tuning session to that would be annoying.
    try {
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sound-settings.txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { /* the textarea below still has it */ }

    this.flash(copied ? "settings copied" : "settings in the box below");
  },

  // True when a click landed inside the panel, so the sketch can ignore it
  // rather than treating it as a click on the menu behind.
  ownsEvent(event) {
    return !!(this.root && event && event.target &&
              typeof event.target.closest === "function" &&
              event.target.closest("#soundpanel"));
  }
};
