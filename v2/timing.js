// The timing drawer.
//
// Radio delay and visual offset are set once for a rig and then left alone,
// so they do not need to sit on screen the whole time. They live in a drawer
// along the bottom that slides up when you want it: full width, which is the
// point - a 1000 ms range across the whole page is about a millisecond per
// pixel, far finer than the short sliders they replaced.
//
// The sliders themselves are the same p5 elements the rest of the sketch
// reads, just re-parented into the drawer, so nothing else has to change.

const TimingDrawer = {
  root: null,
  open: false,
  readouts: {},
  heldBy: null,     // who opened it on the player's behalf - see hold()

  build(sliders) {
    if (this.root) return;

    const root = document.createElement("div");
    root.id = "timingdrawer";
    root.className = "td-closed";

    const handle = document.createElement("button");
    handle.id = "td-handle";
    handle.onclick = () => { this.heldBy = null; this.toggle(); };
    root.appendChild(handle);

    const body = document.createElement("div");
    body.className = "td-body";

    const rows = [
      { key: "microbitOffset", label: "radio delay",
        hint: "sent to the micro:bit this much after the sound, so its flashes line up with the game's" },
      { key: "visualOffset", label: "visual offset",
        hint: "nudges the boxes against the audio without touching either clock" }
    ];

    for (const row of rows) {
      const wrap = document.createElement("div");
      wrap.className = "td-row";

      const label = document.createElement("div");
      label.className = "td-label";
      label.textContent = row.label;

      const readout = document.createElement("div");
      readout.className = "td-val";

      const hint = document.createElement("div");
      hint.className = "td-hint";
      hint.textContent = row.hint;

      const slot = document.createElement("div");
      slot.className = "td-slot";
      sliders[row.key].parent(slot);

      wrap.append(label, slot, readout, hint);
      body.appendChild(wrap);
      this.readouts[row.key] = readout;
    }

    root.appendChild(body);
    document.body.appendChild(root);
    this.root = root;
    this.sliders = sliders;
    this.refresh();
  },

  toggle() {
    this.setOpen(!this.open);
  },

  setOpen(on) {
    if (!this.root) return;
    this.open = !!on;
    this.root.className = this.open ? "td-open" : "td-closed";
    this.refresh();
  },

  // Opened by something other than the player - calibration - which will want
  // it closed again when it is done, but only if it was the one that opened
  // it. So it is only marked held if it was actually shut: a drawer the
  // player already had open is theirs, and stays open afterwards.
  hold(who) {
    if (this.open) return;
    this.heldBy = who;
    this.setOpen(true);
  },

  // Closed again, if `who` is still holding it. Touching the handle in
  // between hands it back to the player - the handle's click clears
  // `heldBy` - so a drawer they reopened on purpose is never shut on them.
  release(who) {
    if (this.heldBy !== who) return;
    this.heldBy = null;
    this.setOpen(false);
  },

  refresh() {
    if (!this.root) return;
    const handle = this.root.querySelector("#td-handle");
    const radio = this.sliders.microbitOffset.value();
    const visual = this.sliders.visualOffset.value();

    // Closed, the handle still reports both values, so the drawer never has
    // to be opened just to check what the rig is set to.
    handle.textContent = this.open
      ? "timing  ▼"
      : `timing  ·  radio ${radio} ms  ·  visual ${visual} ms  ▲`;

    this.readouts.microbitOffset.textContent = `${radio} ms`;
    this.readouts.visualOffset.textContent = `${visual} ms`;
  },

  ownsEvent(event) {
    return !!(this.root && event && event.target &&
              typeof event.target.closest === "function" &&
              event.target.closest("#timingdrawer"));
  }
};
