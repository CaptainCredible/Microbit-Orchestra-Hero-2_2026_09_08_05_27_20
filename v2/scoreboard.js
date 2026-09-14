// The end-of-game scoreboard.
//
// Sixteen players, 0..15, because that is how many the micro:bit side counts,
// and each one carries its robot's name from ROBOT_NAMES - player 3 is always
// Una, whoever happens to be standing at her.
//
// Names can be typed in by hand, and scores too, but the two things this is
// really for are not typing:
//
//   in  - scores arriving over serial from the micro:bit
//   out - submitting the finished board to a Google Sheet
//
//   Scoreboard.setScore(player, score)  <- the serial reader calls this
//   Scoreboard.setName(player, name)
//   Scoreboard.submit()                 <- queues Scoreboard.payload() and sends it
//
// setScore/setName write the data *and* update the boxes on screen, so a
// score arriving while the board is open appears in it. submit() goes through
// ScoreOutbox, at the bottom of this file, which keeps a copy on this machine
// until the sheet confirms it.
//
// The board is also the END page's only controls: "back to songs" and
// "restart" live in its footer rather than up in the corner, because the
// board covers the middle of the screen and having the way out somewhere else
// entirely is a way to lose people.

const Scoreboard = {
  root: null,
  grid: null,
  players: [],     // the data: one { name, score } per player, score may be null
  rows: [],        // the DOM for each player: { el, name, score, rank }
  statusEl: null,
  sortEl: null,
  submitted: false,

  // Display order only. false is 0,1,2..15 down the board; true is 1st place
  // first. Either way each row keeps its own number and robot name - sorting
  // moves whole rows, it does not shuffle scores between players.
  sorted: false,

  // The board outlives a single song. An evening's worth of players is the
  // point of it, so finishing a song - or starting another - leaves the
  // scores alone, and `clear` is the only thing that empties it.
  init() {
    this.players = [];
    for (let i = 0; i < SCOREBOARD_PLAYERS; i++) this.players.push({ name: "", score: null });
  },

  build() {
    if (this.root) return;

    const root = document.createElement("div");
    root.id = "scoreboard";
    root.hidden = true;

    const head = document.createElement("header");
    const title = document.createElement("span");
    title.textContent = "Great Job!";
    title.className = "sb-title";

    // What the wire last did. Blank until something arrives, so it is not
    // noise on a board being filled in by hand - and the moment the game
    // master is plugged in it is the fastest way to see that the scores are
    // landing on the robots you expect.
    this.serialEl = document.createElement("span");
    this.serialEl.className = "sb-serial";

    this.sortEl = document.createElement("button");
    this.sortEl.id = "sb-sort";
    this.sortEl.onclick = () => this.toggleSort();

    const clear = document.createElement("button");
    clear.textContent = "clear";
    clear.onclick = () => this.clear();
    head.append(title, this.serialEl, this.sortEl, clear);

    const grid = document.createElement("div");
    grid.className = "sb-grid";
    this.grid = grid;

    this.rows = [];
    for (let i = 0; i < SCOREBOARD_PLAYERS; i++) {
      const row = document.createElement("div");
      row.className = "sb-row";

      const id = document.createElement("div");
      id.className = "sb-id";
      id.textContent = i;

      // Blank rather than missing if ROBOT_NAMES is short: a mismatched list
      // should leave a gap, not knock the columns out of line.
      const robot = document.createElement("div");
      robot.className = "sb-robot";
      robot.textContent = ROBOT_NAMES[i] || "";

      const name = document.createElement("input");
      name.className = "sb-name";
      name.type = "text";
      name.maxLength = 14;
      name.placeholder = "name";
      name.oninput = () => { this.players[i].name = name.value; this.touched(); };

      const score = document.createElement("input");
      score.className = "sb-score";
      score.type = "number";
      score.placeholder = "–";
      score.oninput = () => {
        const raw = score.value.trim();
        this.players[i].score = raw === "" ? null : Math.round(Number(raw));
        this.touched();
      };

      const rank = document.createElement("div");
      rank.className = "sb-rank";

      row.append(id, robot, name, score, rank);
      grid.appendChild(row);
      this.rows.push({ el: row, name, score, rank });
    }

    const foot = document.createElement("footer");

    // The END page's own controls. They call the same functions the corner
    // buttons used to, so there is one behaviour, not two.
    const back = document.createElement("button");
    back.id = "sb-back";
    back.textContent = "back to songs";
    back.onclick = () => stopAndExit();

    const again = document.createElement("button");
    again.id = "sb-restart";
    again.textContent = "restart";
    again.onclick = () => startSong(currentSong);

    // The same reset as the one on the menu, because the end of a game is the
    // other moment you want it - and the board covers the middle of the
    // screen, so a corner button would be somewhere else entirely.
    const reset = document.createElement("button");
    reset.id = "sb-reset";
    reset.textContent = "reset player scores";
    reset.onclick = () => resetPlayerScores();

    // Asks the controllers to report in. Their answers come back as "S1, 45"
    // lines and fill the board in on their own - see readSerial() above.
    const fetchScores = document.createElement("button");
    fetchScores.id = "sb-fetch";
    fetchScores.textContent = "get scores from players";
    fetchScores.onclick = () => requestPlayerScores();

    const submit = document.createElement("button");
    submit.id = "sb-submit";
    submit.textContent = "submit scores";
    submit.onclick = () => this.submit();

    this.statusEl = document.createElement("span");
    this.statusEl.className = "sb-status";

    foot.append(back, again, reset, fetchScores, submit, this.statusEl);
    root.append(head, grid, foot);
    document.body.appendChild(root);
    this.root = root;
    this.refresh();
  },

  show() { if (this.root) this.root.hidden = false; this.refresh(); },
  hide() { if (this.root) this.root.hidden = true; },

  // Where the panel is on screen, in canvas pixels, for the ember burst to
  // spawn along. null before it is built or while it is hidden - a hidden
  // element measures 0x0, and a burst around a zero-sized box is a burst in
  // the top left corner.
  rect() {
    if (!this.root || this.root.hidden) return null;
    if (typeof this.root.getBoundingClientRect !== "function") return null;
    const r = this.root.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  },

  //////////////////////////////////////////////////////////////////
  // The way in - what the serial reader will call
  //////////////////////////////////////////////////////////////////

  // `score` may be null to clear one. Out-of-range players are ignored rather
  // than throwing: a garbled serial line should not take the game down.
  setScore(player, score) {
    if (!this.valid(player)) return false;
    const n = score === null || score === undefined || score === "" ? null : Math.round(Number(score));
    if (n !== null && !isFinite(n)) return false;
    this.players[player].score = n;
    // touched(), not just refresh(): a score that arrives over serial after
    // the board was submitted is a changed board, and must be submittable.
    this.touched();
    return true;
  },

  setName(player, name) {
    if (!this.valid(player)) return false;
    this.players[player].name = String(name == null ? "" : name).slice(0, 14);
    this.touched();
    return true;
  },

  valid(player) {
    return Number.isInteger(player) && player >= 0 && player < SCOREBOARD_PLAYERS;
  },

  // What the serial reader has seen. Kept because the first question at an
  // installation is always "is it receiving anything at all", and the answer
  // has to be visible without a console.
  serial: { accepted: 0, ignored: 0, last: "" },

  // One line off the micro:bit.
  //
  //   S1, 45      controller 1 scored 45
  //
  // Anything that is not a score line is ignored and returns null - the game
  // master is free to log whatever else it likes down the same wire, and this
  // must not care. A score for a controller outside the board is counted as
  // ignored rather than thrown at: a garbled radio packet should not take the
  // game down mid-song.
  readSerial(text) {
    const line = String(text == null ? "" : text);
    const match = SCORE_LINE.exec(line);
    if (!match) return null;

    const controller = Number(match[1]);
    const player = controller - SCORE_CONTROLLER_BASE;
    const score = Math.round(Number(match[2]));

    if (!this.valid(player) || !isFinite(score)) {
      this.serial.ignored++;
      this.serial.last = line.trim() + "  (no such controller)";
      if (typeof DEBUG !== "undefined" && DEBUG) console.warn("scoreboard: " + this.serial.last);
      // Nothing was written, so nothing else will refresh - and a controller
      // number the board cannot place is the single most useful thing for
      // this readout to be showing.
      this.refresh();
      return null;
    }

    // Recorded before the score is written, not after: setScore() refreshes
    // the board, and a readout updated afterwards is always one message
    // behind - blank for the first score to arrive.
    this.serial.accepted++;
    this.serial.last = `S${controller} -> ${ROBOT_NAMES[player] || player} = ${score}`;
    this.setScore(player, score);
    return { controller, player, score };
  },

  // The other way the same message can arrive.
  //
  // ubitwebusb splits a line into name and value only when it finds a *colon*
  // (see `parser` in that file), so "S1:45" arrives here already split while
  // "S1, 45" does not match and arrives at readSerial() as a whole line. Which
  // one the firmware sends is not worth being fussy about, so both work and
  // both end up in the same parser.
  readSerialValue(name, value) {
    return this.readSerial(`${name}:${value}`);
  },

  //////////////////////////////////////////////////////////////////
  // The way out - the score sheet
  //////////////////////////////////////////////////////////////////

  // Only players who actually did something: a board of sixteen blanks is
  // not sixteen results. A score on its own counts - the micro:bit will be
  // able to report one before anybody has typed a name against it.
  //
  // Always in player order, whatever the board is currently sorted by: this
  // is data, and which way somebody happened to leave the screen sorted is
  // not part of it. The receiving end can sort by score itself.
  entries() {
    return this.players
      .map((p, i) => ({ player: i, robot: ROBOT_NAMES[i] || "", name: p.name.trim(), score: p.score }))
      .filter(e => e.score !== null || e.name !== "");
  },

  // `id` is one per press of submit. The sheet uses it to recognise a retry
  // of a board it already has, so a reply lost on the way back cannot turn
  // into the same scores twice.
  payload() {
    return {
      id: newSubmissionId(),
      song: currentSong ? currentSong.name : null,
      at: new Date().toISOString(),
      scores: this.entries()
    };
  },

  // Saved on this machine first, then sent. The status line only ever says
  // "sent" once the sheet has answered that it has them - nobody should walk
  // away thinking scores are off the machine when they are not.
  submit() {
    const payload = this.payload();
    if (!payload.scores.length) {
      this.say("nothing to submit - no names or scores entered yet");
      return null;
    }
    // Pressing it twice is the easiest way to get a board into the sheet
    // twice, and the second press has a new id so the sheet cannot tell.
    // Changing anything on the board clears this, via touched().
    if (this.submitted) {
      this.say("already submitted - change something to submit again");
      return null;
    }
    this.submitted = true;
    ScoreOutbox.add(payload);
    this.say(`${payload.scores.length} saved on this machine - sending...`);
    this.flush();
    return payload;
  },

  // Send everything waiting, and say how it went.
  async flush() {
    const result = await ScoreOutbox.flush();
    if (!result.busy) {
      const message = describeSend(result);
      if (message) this.say(message);
    }
    return result;
  },

  // Called once at startup: sends whatever was left waiting last time, and
  // again whenever the browser says the connection is back.
  startOutbox() {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("online", () => this.flush());
    }
    if (ScoreOutbox.pending()) this.flush();
  },

  clear() {
    this.init();
    this.submitted = false;
    this.say("");
    this.refresh();
  },

  say(message) {
    if (this.statusEl) this.statusEl.textContent = message;
  },

  // Submitting and then carrying on typing should not leave "submitted"
  // standing next to numbers that have changed since.
  touched() {
    if (this.submitted) { this.submitted = false; this.say(""); }
    this.refresh();
  },

  //////////////////////////////////////////////////////////////////
  // Ranking and order
  //////////////////////////////////////////////////////////////////

  // Position per player index, highest score first, ties sharing a place.
  // Players without a score are not in the running and get no position.
  ranks() {
    const scored = this.players
      .map((p, i) => ({ i, score: p.score }))
      .filter(p => p.score !== null)
      .sort((a, b) => b.score - a.score);

    const out = {};
    let place = 0, seen = 0, last = null;
    for (const p of scored) {
      seen++;
      if (p.score !== last) { place = seen; last = p.score; }
      out[p.i] = place;
    }
    return out;
  },

  // The player numbers in the order the rows should appear. Highest score
  // first when sorted; equal scores keep player order between them, and
  // anyone without a score falls to the bottom in player order rather than
  // being treated as zero - they did not score nothing, they did not play.
  order() {
    const all = this.players.map((p, i) => i);
    if (!this.sorted) return all;
    return all.sort((a, b) => {
      const sa = this.players[a].score, sb = this.players[b].score;
      if (sa === null && sb === null) return a - b;
      if (sa === null) return 1;
      if (sb === null) return -1;
      if (sb !== sa) return sb - sa;
      return a - b;
    });
  },

  toggleSort() {
    this.sorted = !this.sorted;
    this.refresh();
  },

  // Rows are moved, never rebuilt: appending a node that is already in the
  // grid moves it, and moving it keeps the very same <input> elements, so
  // whatever is typed in them survives a sort.
  //
  // Not done while a box on the board has focus, though. Scores arriving over
  // serial will call refresh() at whatever moment they please, and having the
  // row you are typing into slide out from under the cursor mid-word is worse
  // than a board that is briefly out of order - it catches up the moment you
  // click away.
  reorder() {
    if (!this.grid) return;
    if (this.focusedRow() >= 0) return;
    for (const i of this.order()) {
      if (this.rows[i]) this.grid.appendChild(this.rows[i].el);
    }
  },

  // Which player's row the keyboard is in, or -1.
  focusedRow() {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!active) return -1;
    return this.rows.findIndex(r => r && (r.name === active || r.score === active));
  },

  refresh() {
    if (!this.root) return;
    const ranks = this.ranks();

    this.players.forEach((p, i) => {
      const row = this.rows[i];
      if (!row) return;
      if (document.activeElement !== row.name) row.name.value = p.name;
      if (document.activeElement !== row.score) row.score.value = p.score === null ? "" : p.score;

      const place = ranks[i];
      row.rank.textContent = place ? ordinal(place) : "";
      row.rank.className = "sb-rank" + (place === 1 ? " sb-first" : "");
    });

    if (this.sortEl) this.sortEl.textContent = this.sorted ? "by player" : "sort";

    if (this.serialEl) {
      const seen = this.serial.accepted + this.serial.ignored;
      this.serialEl.textContent = seen
        ? `serial: ${this.serial.last}` +
          (this.serial.ignored ? `  ·  ${this.serial.ignored} ignored` : "")
        : "";
    }

    this.reorder();
  },

  ownsEvent(event) {
    return !!(this.root && event && event.target &&
              typeof event.target.closest === "function" &&
              event.target.closest("#scoreboard"));
  }
};

function ordinal(n) {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return n + "th";
  return n + (["th", "st", "nd", "rd"][n % 10] || "th");
}

// What to tell the room about a send. Empty when there is nothing worth
// saying, so a quiet background retry does not overwrite other messages.
function describeSend(r) {
  const waiting = r.left === 1 ? "1 submission" : `${r.left} submissions`;
  if (r.unconfigured) {
    return r.left ? `${waiting} saved on this machine - no score sheet set up yet` : "";
  }
  if (r.unreachable) {
    return `can't reach the score sheet - ${waiting} saved on this machine, will retry`;
  }
  if (r.error) {
    return `the score sheet refused it (${r.error}) - ${waiting} kept on this machine`;
  }
  if (r.sent) {
    // Nothing added means every one was a retry the sheet already had - its
    // earlier reply was lost on the way back.
    const done = r.rows === 0 ? "already in the score sheet"
      : r.rows === 1 ? "1 score sent to the score sheet"
      : `${r.rows} scores sent to the score sheet`;
    return r.left ? `${done} - ${waiting} still waiting` : done;
  }
  return "";
}

function newSubmissionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

// Submissions that have not yet reached the score sheet.
//
// Kept in localStorage, so closing the browser, a crash or a venue with no
// internet does not lose a board: each one stays here until the sheet answers
// that it has it, and is retried on startup, when the connection comes back,
// and every SCORES_RETRY_SECONDS while anything is waiting.
//
// Sent oldest first. A network failure stops the round - the rest would only
// fail the same way - but a submission the sheet *refuses* is kept and the
// rest still go, so one bad board cannot hold up an evening's worth behind it.
const ScoreOutbox = {
  KEY: "mboh.scores.outbox",
  memory: [],      // stand-in for when localStorage is blocked
  sending: false,
  timer: null,

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw === null) return this.memory.slice();
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return this.memory.slice();
    }
  },

  save(list) {
    this.memory = list.slice();
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch (err) { /* memory only */ }
  },

  add(payload) {
    const list = this.load();
    list.push(payload);
    this.save(list);
  },

  // Re-read rather than reused, so anything submitted while a send was in
  // flight is not written back over.
  remove(id) {
    this.save(this.load().filter(p => p.id !== id));
  },

  pending() { return this.load().length; },

  async flush() {
    if (this.sending) return { busy: true };
    if (!SCORES_ENDPOINT) return { unconfigured: true, sent: 0, rows: 0, left: this.pending() };

    this.sending = true;
    const result = { sent: 0, rows: 0, left: 0, error: "", unreachable: false };
    try {
      for (const payload of this.load()) {
        let answer;
        try {
          answer = await this.post(payload);
        } catch (err) {
          result.unreachable = true;
          result.error = err && err.message ? err.message : String(err);
          break;
        }
        if (answer && answer.ok) {
          this.remove(payload.id);
          result.sent++;
          result.rows += answer.added || 0;
        } else {
          result.error = (answer && answer.error) || "no reason given";
        }
      }
    } finally {
      this.sending = false;
    }

    result.left = this.pending();
    this.retryLater(result.left);
    return result;
  },

  async post(payload) {
    const abort = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => { if (abort) abort.abort(); }, SCORES_TIMEOUT_SECONDS * 1000);
    try {
      const response = await fetch(SCORES_ENDPOINT, {
        method: "POST",
        // text/plain, not application/json. That keeps it a "simple" request
        // with no CORS preflight - which Apps Script cannot answer, so a JSON
        // content type fails before the request is even sent. The script
        // parses the body as JSON whatever it is labelled.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ secret: SCORES_SECRET }, payload)),
        redirect: "follow",
        signal: abort ? abort.signal : undefined
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        // A Google error or sign-in page rather than the script's answer.
        throw new Error(`unexpected reply from the sheet (HTTP ${response.status})`);
      }
    } finally {
      clearTimeout(timer);
    }
  },

  retryLater(left) {
    if (!left || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      Scoreboard.flush();
    }, SCORES_RETRY_SECONDS * 1000);
  }
};
