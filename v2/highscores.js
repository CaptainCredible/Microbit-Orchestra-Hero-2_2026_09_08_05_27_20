// The highscore database: Cloud Firestore, on Firebase's free Spark plan.
//
// Used by the game's end-of-song board (adding scores), the game's HIGHSCORES
// page (showing them) and tools/import-highscores.html (moving the old Google
// Sheet across). It needs nothing from the rest of the app but the settings in
// config.js, so a separate viewer site can load it on its own.
//
// Two places in the database:
//
//   highscores/{id}          one document per result - the real record.
//                            Only the operator account can read or write it.
//   highscores_meta/table    the whole list as ONE document - what every
//                            viewer reads. Public.
//
// Why the second one: the free plan counts every document a query returns as
// a read, 50,000 a day. Listing the collection is 1,300 reads and growing, so
// a public viewer doing that would run out after a few dozen page loads. The
// table costs one read per view however long the list gets. It is a copy,
// updated as boards are added, and can be rebuilt from the collection at any
// time - "rebuild list" on the highscores page - which is what to do after
// editing entries by hand in the Firebase console.
//
// Reading the table needs neither sign-in nor the Firebase SDK: it is one plain
// request (fetchTable). The SDK is only loaded when something needs to write,
// and only then - so a machine that starts up with no internet still starts.

const FIREBASE_SDK_BASE = "https://www.gstatic.com/firebasejs/12.19.0/";
const FIREBASE_SDK_FILES = [
  "firebase-app-compat.js",
  "firebase-auth-compat.js",
  "firebase-firestore-compat.js"
];

const OPERATORS_COLLECTION = "operators";          // who may add scores, and who is banned
const REQUESTS_COLLECTION = "operatorRequests";    // asking to become an operator

const Highscores = {
  db: null,
  auth: null,
  user: null,
  authKnown: false,
  error: "",
  starting: null,
  sdkPromise: null,
  loadedScripts: new Set(),
  listeners: [],
  authWaiters: [],

  // Set by the tests to point at the local Firebase emulators instead of the
  // real project: { host, firestorePort, authPort }.
  emulator: null,

  //////////////////////////////////////////////////////////////////
  // Settings - read from config.js, with defaults for a page that
  // only wants to show the list
  //////////////////////////////////////////////////////////////////

  config() { return typeof FIREBASE_CONFIG !== "undefined" ? FIREBASE_CONFIG : {}; },
  collectionName() { return typeof HIGHSCORES_COLLECTION !== "undefined" ? HIGHSCORES_COLLECTION : "highscores"; },
  tablePath() { return typeof HIGHSCORES_TABLE_DOC !== "undefined" ? HIGHSCORES_TABLE_DOC : "highscores_meta/table"; },
  defaultSong() { return typeof HIGHSCORES_DEFAULT_SONG !== "undefined" ? HIGHSCORES_DEFAULT_SONG : "The O.G."; },
  timeout() { return typeof SCORES_TIMEOUT_SECONDS !== "undefined" ? SCORES_TIMEOUT_SECONDS : 20; },

  configured() {
    const c = this.config();
    return !!(c && c.apiKey && c.projectId);
  },

  //////////////////////////////////////////////////////////////////
  // Reading: the published list
  //////////////////////////////////////////////////////////////////

  tableUrl() {
    const [collection, doc] = this.tablePath().split("/");
    const c = this.config();
    const host = this.emulator
      ? `http://${this.emulator.host}:${this.emulator.firestorePort}`
      : "https://firestore.googleapis.com";
    const key = !this.emulator && c.apiKey ? `?key=${encodeURIComponent(c.apiKey)}` : "";
    return `${host}/v1/projects/${encodeURIComponent(c.projectId)}/databases/(default)/documents/` +
           `${collection}/${doc}${key}`;
  },

  // The whole list, ranked: [{ position, name, location, score, bonus, date,
  // id, order }], highest first. `missing` is true when nothing has been
  // published yet, which is not an error.
  async fetchTable() {
    if (!this.configured()) throw dbError("unconfigured", "no highscore database set up");
    const seconds = this.timeout();
    const abort = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => { if (abort) abort.abort(); }, seconds * 1000);
    let response;
    try {
      response = await fetch(this.tableUrl(), { cache: "no-store", signal: abort ? abort.signal : undefined });
    } catch (err) {
      throw dbError("offline", abort && abort.signal.aborted ? `no answer after ${seconds}s` : "no connection");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) return { entries: [], missing: true };
    if (!response.ok) throw dbError("refused", `the database answered ${response.status}`);

    const doc = await response.json();
    const json = doc && doc.fields && doc.fields.json && doc.fields.json.stringValue;
    let list;
    try { list = JSON.parse(json || "[]"); } catch (err) { list = null; }
    if (!Array.isArray(list)) throw dbError("refused", "the published list is damaged - rebuild it");
    return { entries: this.rank(list), missing: false };
  },

  // Highest score first. Equal scores share a position - two 5th places are
  // followed by a 7th - and keep a stable order between them: the old sheet's
  // own order for imported rows, then earliest first for the game's.
  rank(entries) {
    // Per song, because a position across all of them means nothing: the songs
    // are different lengths with different numbers of notes, so a score on one
    // is not comparable with a score on another. First on Slow Sorrow is
    // first on Slow Sorrow.
    const bySong = new Map();
    for (const e of entries) {
      const song = e.song || this.defaultSong();
      if (!bySong.has(song)) bySong.set(song, []);
      bySong.get(song).push(e);
    }

    const out = [];
    for (const [song, list] of bySong) {
      const sorted = list.slice().sort((a, b) =>
        (b.score - a.score) || ((a.order || 0) - (b.order || 0)));
      let position = 0, last = null;
      sorted.forEach((e, i) => {
        if (e.score !== last) { position = i + 1; last = e.score; }
        out.push(Object.assign({}, e, { song, position }));
      });
    }
    return out;
  },

  // The songs the list holds, each with how many scores it has, best first.
  songsIn(entries) {
    const counts = new Map();
    for (const e of entries) {
      const song = e.song || this.defaultSong();
      counts.set(song, (counts.get(song) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([song, count]) => ({ song, count }))
      .sort((a, b) => b.count - a.count || a.song.localeCompare(b.song));
  },

  //////////////////////////////////////////////////////////////////
  // The SDK and the operator's sign-in
  //////////////////////////////////////////////////////////////////

  loadScript(src) {
    if (this.loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => { this.loadedScripts.add(src); resolve(); };
      s.onerror = () => { s.remove(); reject(new Error("could not load " + src.split("/").pop())); };
      document.head.appendChild(s);
    });
  },

  // One at a time and in order: the auth and firestore builds attach
  // themselves to the app build, so it has to be there first. A failure
  // forgets the attempt, so the next call tries again rather than repeating
  // the failure forever.
  loadSdk() {
    if (typeof firebase !== "undefined" && firebase.auth && firebase.firestore) return Promise.resolve();
    if (!this.sdkPromise) {
      this.sdkPromise = FIREBASE_SDK_FILES
        .reduce((chain, file) => chain.then(() => this.loadScript(FIREBASE_SDK_BASE + file)), Promise.resolve())
        .catch(err => { this.sdkPromise = null; throw err; });
    }
    return this.sdkPromise;
  },

  // Loads the SDK and connects. Resolves true when ready, false when it could
  // not be (no config, or no internet to fetch the SDK from) - never throws.
  async start() {
    if (this.db) return true;
    if (!this.configured()) return false;
    if (!this.starting) {
      this.starting = (async () => {
        try {
          await this.loadSdk();
          const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(this.config());
          const auth = app.auth();
          const db = app.firestore();
          if (this.emulator) {
            auth.useEmulator(`http://${this.emulator.host}:${this.emulator.authPort}`, { disableWarnings: true });
            db.useEmulator(this.emulator.host, this.emulator.firestorePort);
          }
          this.auth = auth;
          this.db = db;
          this.error = "";
          // Fires once as soon as a saved sign-in has been picked up (or found
          // not to exist), and again on every sign-in and sign-out.
          auth.onAuthStateChanged(user => this.setUser(user));
          return true;
        } catch (err) {
          this.error = err && err.message ? err.message : String(err);
          return false;
        } finally {
          this.starting = null;
        }
      })();
    }
    return this.starting;
  },

  // The one place the signed-in user changes, so every page hears about it the
  // same way.
  setUser(user) {
    this.user = user || null;
    this.authKnown = true;
    this.authWaiters.splice(0).forEach(resolve => resolve(this.user));
    this.listeners.forEach(fn => { try { fn(this.user); } catch (err) { console.error(err); } });
  },

  authReady() {
    if (this.authKnown) return Promise.resolve(this.user);
    return new Promise(resolve => this.authWaiters.push(resolve));
  },

  // Called with the signed-in user (or null) on every change, and straight
  // away if that is already known.
  onChange(fn) {
    this.listeners.push(fn);
    if (this.authKnown) fn(this.user);
  },

  async signIn(email, password) {
    if (!(await this.start())) {
      throw dbError("offline", "could not load Firebase - is there internet?");
    }
    try {
      await this.auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || ""));
    } catch (err) {
      throw dbError("signin", authMessage(err));
    }
    // Told to everyone here, not left to onAuthStateChanged: signing in as the
    // account that is already signed in is not a change as far as Firebase is
    // concerned, so it reports nothing - and a page waiting to hear it stayed
    // on "signing in..." for good.
    this.setUser(this.auth.currentUser);
  },

  async signOut() {
    if (this.auth) await this.auth.signOut();
  },

  // Everything that writes needs a signed-in account. Whether that account is
  // allowed to is the rules' decision, not this one's.
  async requireOperator() { return this.requireSignedIn(); },

  async requireSignedIn() {
    if (!this.configured()) throw dbError("unconfigured", "no highscore database set up");
    if (!(await this.start())) {
      throw dbError("offline", "could not load Firebase" + (this.error ? ` (${this.error})` : ""));
    }
    await this.authReady();
    if (!this.user) throw dbError("signedout", "not signed in");
  },

  //////////////////////////////////////////////////////////////////
  // Writing
  //////////////////////////////////////////////////////////////////

  // One document per player with a name and a score. The id is the board's
  // submission id plus the player, so the same board sent twice lands on the
  // same documents instead of making copies.
  entriesFromPayload(payload) {
    const when = new Date(payload.at);
    const date = firebase.firestore.Timestamp.fromDate(isNaN(when.getTime()) ? new Date() : when);
    return (payload.scores || [])
      .filter(s => cleanText(s.name, 60) !== "" && Number.isInteger(s.score))
      .map(s => ({
        id: `${payload.id}-p${s.player}`,
        data: {
          name: cleanText(s.name, 60),
          location: cleanText(payload.location, 80),
          score: s.score,
          bonus: !!s.bonus,
          date,
          song: payload.song ? cleanText(payload.song, 80) : null,
          player: Number.isInteger(s.player) ? s.player : null,
          robot: s.robot ? cleanText(s.robot, 20) : null,
          submission: cleanText(payload.id, 80),
          source: "game",
          legacyRank: null,
          // Who sent it. The rules check this against the sign-in, so it
          // cannot be anyone else's - which is what makes a ban mean something.
          submittedBy: this.user ? this.user.uid : null,
          submittedEmail: this.user ? (this.user.email || null) : null
        }
      }));
  },

  // Adds one board. Resolves { added, duplicate }; throws an Error whose
  // `kind` says what to do about it:
  //   offline      no connection or no answer - keep it and try later
  //   signedout    nobody signed in - keep it until someone does
  //   refused      the database said no - keep it, but retrying will not help
  //   unconfigured no FIREBASE_CONFIG
  async saveBoard(payload) {
    await this.requireOperator();
    const rows = this.entriesFromPayload(payload);
    if (!rows.length) throw dbError("refused", "no score on the board has a name");

    const seconds = this.timeout();
    const collection = this.db.collection(this.collectionName());
    try {
      // A retry of a board whose earlier answer was lost: it is already in.
      const first = await withTimeout(collection.doc(rows[0].id).get({ source: "server" }), seconds);
      let added = 0;
      if (!first.exists) {
        const batch = this.db.batch();
        rows.forEach(r => batch.set(collection.doc(r.id), r.data));
        await withTimeout(batch.commit(), seconds);
        added = rows.length;
      }
      // Also on a retry: if the table update is what failed last time, this
      // is where it gets another go. Merging is by id, so it cannot double up.
      await withTimeout(this.mergeIntoTable(rows), seconds);
      return { added, duplicate: first.exists };
    } catch (err) {
      throw classify(err);
    }
  },

  // The compact form each entry takes in the published table.
  compact(id, d) {
    const when = d.date && typeof d.date.toDate === "function" ? d.date.toDate() : null;
    return {
      id,
      name: d.name || "",
      location: d.location || "",
      score: d.score,
      bonus: !!d.bonus,
      // The record has carried a song all along; this is what puts it in the
      // published list, which is the only thing a viewer ever reads. Without
      // it here, the song might as well not have been stored.
      //
      // An entry from before the game recorded one falls back to the default -
      // see HIGHSCORES_DEFAULT_SONG. Done here rather than by editing the
      // documents, so nothing has to be migrated and a rebuild fixes itself.
      song: d.song || this.defaultSong(),
      date: when ? localDate(when) : "",
      order: d.source === "legacy" ? (d.legacyRank || 0) : (when ? when.getTime() : Number.MAX_SAFE_INTEGER)
    };
  },

  // JSON in a single string field rather than an array of maps. Firestore
  // indexes every field of every map in an array, and caps a document at
  // 20,000 index entries - an array of these would hit that at around 2,800
  // scores. A string is one field. The document can hold roughly 10,000
  // scores before its 1 MiB size limit.
  tableData(entries) {
    return {
      json: JSON.stringify(entries),
      count: entries.length,
      updated: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: this.user ? this.user.uid : null
    };
  },

  async mergeIntoTable(rows) {
    // appendOnly, because this is the operator's path and the rules let an
    // operator do nothing but add to the end of the list. Anything already on
    // it is left exactly as it is - see patchTable.
    await this.patchTable(rows.map(r => this.compact(r.id, r.data)), [], { appendOnly: true });
  },

  // Changes the published list in place: `upserts` added, or replaced where
  // the id is already there, and `removeIds` taken out. One read and one
  // write however long the list is.
  // `appendOnly` is for the operator's path, and it means what the rules mean:
  // an entry already on the published list is left alone rather than written
  // over. Not a nicety - a rewrite is REFUSED.
  //
  // The rules let an operator append and nothing else, and they check it as
  // text: everything up to the old closing bracket has to survive byte for
  // byte. Replacing an entry in the middle fails that, and the whole write is
  // denied with a permission error that reads like a sign-in problem.
  //
  // It only bites on a retry - a board whose first answer was lost, whose
  // entries are already on the list - and it started biting the moment
  // compact() began carrying a song, because the replacement was then a
  // different shape from the entry it was replacing. Before that the rewrite
  // was byte-identical and slipped through unnoticed.
  async patchTable(upserts, removeIds, options) {
    const appendOnly = !!(options && options.appendOnly);
    const ref = this.db.doc(this.tablePath());
    let rebuild = false;
    await this.db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      let current = null;
      if (doc.exists) {
        try { current = JSON.parse(doc.data().json || "[]"); } catch (err) { current = null; }
      }
      // No table yet, or a damaged one: patching it would publish a list with
      // everything else missing, so it is rebuilt from the collection instead.
      if (!Array.isArray(current)) { rebuild = true; return; }
      // Replaced where they already are and added at the end - never moved. An
      // operator is only allowed to append to the list (see the rules), and an
      // entry moved to the end would read as the list being rewritten.
      const removing = new Set(removeIds);
      const next = current.filter(e => !removing.has(e.id));
      for (const entry of upserts) {
        const at = next.findIndex(e => e.id === entry.id);
        if (at < 0) { next.push(entry); continue; }
        // Already published. An operator may not rewrite it; the admin may.
        if (!appendOnly) next[at] = entry;
      }
      const data = this.tableData(next);
      if (data.json === doc.data().json) return;   // already just so - a retry
      tx.set(ref, data);
    });
    if (!rebuild) return;
    try {
      await this.rebuildTable();
    } catch (err) {
      // Only the admin can rebuild. An operator's board is saved all the same
      // and stays waiting on their machine, and goes on the list by itself
      // the next time it is sent after the admin has rebuilt it.
      if (err.kind === "refused") {
        throw dbError("refused", "the published list is missing or damaged - the admin needs to press rebuild list");
      }
      throw err;
    }
  },

  // Re-publishes the list from every document in the collection. About one
  // read per score, so it is for after hand edits, not for every board.
  async rebuildTable() {
    await this.requireOperator();
    try {
      const all = await withTimeout(this.db.collection(this.collectionName()).get({ source: "server" }), 90);
      const entries = all.docs.map(d => this.compact(d.id, d.data()));
      await withTimeout(this.db.doc(this.tablePath()).set(this.tableData(entries)), 90);
      return entries.length;
    } catch (err) {
      throw classify(err);
    }
  },

  //////////////////////////////////////////////////////////////////
  // Accounts, operator requests and standing
  //////////////////////////////////////////////////////////////////

  // A new account for someone asking to be an operator. A verification email
  // goes out straight away; the request works without it, and the admin can
  // see whether it was done.
  async createAccount(email, password) {
    if (!(await this.start())) throw dbError("offline", "could not load Firebase - is there internet?");
    let credential;
    try {
      credential = await this.auth.createUserWithEmailAndPassword(String(email || "").trim(), String(password || ""));
    } catch (err) {
      throw dbError("signin", authMessage(err));
    }
    this.setUser(credential.user);

    // The account is made either way - a verification email that will not send
    // is not a reason to throw it away, and it can be sent again later. But it
    // is very much a reason not to TELL somebody it is on its way when it is
    // not: they then sit waiting for a mail that was never accepted, and the
    // only trace is a 400 in the console nobody thinks to open.
    try {
      await credential.user.sendEmailVerification();
      return { verificationSent: true, verificationError: null };
    } catch (err) {
      return { verificationSent: false, verificationError: authMessage(err) };
    }
  },

  async sendVerification() {
    await this.requireSignedIn();
    try { await this.auth.currentUser.sendEmailVerification(); }
    catch (err) { throw dbError("signin", authMessage(err)); }
  },

  // Picks up a verification done since signing in - in another tab, or from a
  // phone. The sign-in token has to be fetched again before the rules see it.
  async refreshUser() {
    await this.requireSignedIn();
    await this.auth.currentUser.reload();
    await this.auth.currentUser.getIdToken(true);
    this.setUser(this.auth.currentUser);
    return this.user;
  },

  // Only the admin may list requests, so trying to is how a page finds out
  // who the admin is - the rules stay the one place the admin is named.
  async probeAdmin() {
    try {
      await this.db.collection(REQUESTS_COLLECTION).limit(1).get({ source: "server" });
      return true;
    } catch (err) {
      if (err && err.code === "permission-denied") return false;
      throw classify(err);
    }
  },

  // Where this account stands: { admin, operator: "active" | "banned" | null,
  // request: { status, ... } | null }.
  async myStatus() {
    await this.requireSignedIn();
    const uid = this.user.uid;
    try {
      // Each part on its own, because this is the one thing that explains why
      // a submission was refused - and it used to be all-or-nothing. Any one
      // of these failing sank the lot, and the page then showed no role at
      // all: the account state went blank exactly when it mattered most.
      const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e }));
      const [op, req, admin] = await withTimeout(Promise.all([
        settle(this.db.doc(`${OPERATORS_COLLECTION}/${uid}`).get({ source: "server" })),
        settle(this.db.doc(`${REQUESTS_COLLECTION}/${uid}`).get({ source: "server" })),
        settle(this.probeAdmin())
      ]), this.timeout());

      return {
        uid,
        email: this.user.email || null,
        admin: admin.ok ? admin.v : false,
        // null means "no record"; undefined means "could not tell", which is
        // a different thing and worth not dressing up as the first.
        operator: op.ok ? (op.v.exists ? op.v.data().status : null) : undefined,
        request: req.ok ? (req.v.exists ? Object.assign({ id: req.v.id }, req.v.data()) : null) : undefined,
        unreadable: [
          op.ok ? null : "operator record",
          req.ok ? null : "request record",
          admin.ok ? null : "admin check"
        ].filter(Boolean)
      };
    } catch (err) {
      throw classify(err);
    }
  },

  // Sends, or updates, this account's request to become an operator.
  async submitRequest(fields) {
    await this.requireSignedIn();
    const ref = this.db.doc(`${REQUESTS_COLLECTION}/${this.user.uid}`);
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const seconds = this.timeout();
    const name = cleanText(fields.name, 80);
    if (!name) throw dbError("refused", "please fill in your name");
    try {
      // Fresh from the server: the rules compare `emailVerified` with the
      // sign-in token, so the two have to agree.
      await withTimeout(this.auth.currentUser.reload(), seconds);
      const token = await withTimeout(this.auth.currentUser.getIdTokenResult(true), seconds);
      const existing = await withTimeout(ref.get({ source: "server" }), seconds);
      if (existing.exists && existing.data().status !== "pending") {
        throw dbError("refused", "this request was turned down - contact the admin directly");
      }
      await withTimeout(ref.set({
        email: this.user.email || "",
        emailVerified: !!token.claims.email_verified,
        name,
        organisation: cleanText(fields.organisation, 120),
        message: cleanMessage(fields.message, 1000),
        status: "pending",
        createdAt: existing.exists ? existing.data().createdAt : now,
        updatedAt: now
      }), seconds);
    } catch (err) {
      throw classify(err);
    }
  },

  //////////////////////////////////////////////////////////////////
  // The admin's tools - the rules refuse all of these to anyone else
  //////////////////////////////////////////////////////////////////

  // Every score, with who sent it. One read per score.
  async listEntries() {
    await this.requireSignedIn();
    try {
      const all = await withTimeout(this.db.collection(this.collectionName()).get({ source: "server" }), 90);
      return all.docs.map(d => Object.assign({ id: d.id }, d.data()));
    } catch (err) {
      throw classify(err);
    }
  },

  // Changes a score's name, location, score or star, and the published list
  // with it. Resolves the score as it now is.
  async updateEntry(id, patch) {
    await this.requireSignedIn();
    const clean = {};
    if ("name" in patch) clean.name = cleanText(patch.name, 60);
    if ("location" in patch) clean.location = cleanText(patch.location, 80);
    if ("bonus" in patch) clean.bonus = !!patch.bonus;
    if ("score" in patch) {
      const n = Number(String(patch.score).trim());
      if (String(patch.score).trim() === "" || !Number.isInteger(n)) throw dbError("refused", "the score must be a whole number");
      clean.score = n;
    }
    const ref = this.db.collection(this.collectionName()).doc(id);
    const seconds = this.timeout();
    try {
      await withTimeout(ref.update(clean), seconds);
      const fresh = await withTimeout(ref.get({ source: "server" }), seconds);
      await withTimeout(this.patchTable([this.compact(id, fresh.data())], []), seconds);
      return Object.assign({ id }, fresh.data());
    } catch (err) {
      throw classify(err);
    }
  },

  // Deletes scores, and takes them off the published list.
  async deleteEntries(ids) {
    await this.requireSignedIn();
    const collection = this.db.collection(this.collectionName());
    try {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = this.db.batch();
        ids.slice(i, i + 400).forEach(id => batch.delete(collection.doc(id)));
        await withTimeout(batch.commit(), 90);
      }
      await withTimeout(this.patchTable([], ids), this.timeout());
      return ids.length;
    } catch (err) {
      throw classify(err);
    }
  },

  async listOperators() {
    await this.requireSignedIn();
    try {
      const all = await withTimeout(this.db.collection(OPERATORS_COLLECTION).get({ source: "server" }), this.timeout());
      return all.docs.map(d => Object.assign({ uid: d.id }, d.data()));
    } catch (err) {
      throw classify(err);
    }
  },

  async listRequests() {
    await this.requireSignedIn();
    try {
      const all = await withTimeout(this.db.collection(REQUESTS_COLLECTION).get({ source: "server" }), this.timeout());
      return all.docs.map(d => Object.assign({ uid: d.id }, d.data()));
    } catch (err) {
      throw classify(err);
    }
  },

  // Bans or reinstates an operator. `info` fills in the details for an
  // account that has no operators entry yet.
  async setOperatorStatus(uid, status, info) {
    await this.requireSignedIn();
    const ref = this.db.doc(`${OPERATORS_COLLECTION}/${uid}`);
    const seconds = this.timeout();
    try {
      const current = await withTimeout(ref.get({ source: "server" }), seconds);
      const base = current.exists ? current.data() : {};
      const pick = (key, max) => {
        const v = info && info[key] !== undefined ? info[key] : base[key];
        return v === null || v === undefined || v === "" ? null : cleanText(v, max);
      };
      await withTimeout(ref.set({
        email: cleanText((info && info.email) || base.email || "", 254),
        name: pick("name", 80),
        organisation: pick("organisation", 120),
        status,
        note: pick("note", 500),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), seconds);
    } catch (err) {
      throw classify(err);
    }
  },

  // Makes the account an active operator and clears the request, together.
  async approveRequest(uid) {
    await this.requireSignedIn();
    const requestRef = this.db.doc(`${REQUESTS_COLLECTION}/${uid}`);
    const seconds = this.timeout();
    try {
      const request = await withTimeout(requestRef.get({ source: "server" }), seconds);
      if (!request.exists) throw dbError("refused", "that request is no longer there");
      const r = request.data();
      const batch = this.db.batch();
      batch.set(this.db.doc(`${OPERATORS_COLLECTION}/${uid}`), {
        email: r.email || "",
        name: r.name ? cleanText(r.name, 80) : null,
        organisation: r.organisation ? cleanText(r.organisation, 120) : null,
        status: "active",
        note: r.message ? cleanText(r.message, 500) : null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.delete(requestRef);
      await withTimeout(batch.commit(), seconds);
    } catch (err) {
      throw classify(err);
    }
  },

  // Turned down, and it stays so: the person cannot re-send it. Delete the
  // request instead to let them ask again.
  async rejectRequest(uid) {
    await this.requireSignedIn();
    try {
      await withTimeout(this.db.doc(`${REQUESTS_COLLECTION}/${uid}`).update({
        status: "rejected",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), this.timeout());
    } catch (err) {
      throw classify(err);
    }
  },

  async deleteRequest(uid) {
    await this.requireSignedIn();
    try {
      await withTimeout(this.db.doc(`${REQUESTS_COLLECTION}/${uid}`).delete(), this.timeout());
    } catch (err) {
      throw classify(err);
    }
  },

  // Gives the admin an operators entry of their own, so they are listed and
  // counted like everyone else. The rules let the admin write regardless.
  async ensureAdminOperator() {
    await this.requireSignedIn();
    const ref = this.db.doc(`${OPERATORS_COLLECTION}/${this.user.uid}`);
    try {
      const current = await withTimeout(ref.get({ source: "server" }), this.timeout());
      if (current.exists) return;
      await withTimeout(ref.set({
        email: this.user.email || "",
        name: null,
        organisation: null,
        status: "active",
        note: "admin",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), this.timeout());
    } catch (err) {
      throw classify(err);
    }
  },

  //////////////////////////////////////////////////////////////////
  // The old Google Sheet
  //////////////////////////////////////////////////////////////////

  // The sheet's CSV - NAME, FROM, SCORE, BONUS - as documents to write.
  // Nothing here touches the database, so it can be checked before importing.
  legacyEntries(text) {
    const table = parseCsv(String(text || "").replace(/^﻿/, ""));
    if (!table.length) throw dbError("refused", "the file is empty");

    const head = table[0].map(h => h.trim().toUpperCase());
    const iName = head.indexOf("NAME"), iFrom = head.indexOf("FROM");
    const iScore = head.indexOf("SCORE"), iBonus = head.indexOf("BONUS");
    if (iName < 0 || iFrom < 0 || iScore < 0) {
      throw dbError("refused", `expected columns NAME, FROM, SCORE and BONUS - found ${table[0].join(", ")}`);
    }

    const rows = [], problems = [];
    table.slice(1).forEach((cells, i) => {
      const line = i + 2;
      if (!cells.some(c => c.trim() !== "")) return;
      const raw = (cells[iScore] || "").trim();
      if (!/^-?\d+$/.test(raw)) {
        problems.push(`line ${line}: score "${raw}" is not a whole number - left out`);
        return;
      }
      const legacyRank = rows.length + 1;
      rows.push({
        id: "legacy-" + String(legacyRank).padStart(5, "0"),
        data: {
          name: cleanText(cells[iName], 60),
          location: cleanText(cells[iFrom], 80),
          score: parseInt(raw, 10),
          bonus: iBonus >= 0 && (cells[iBonus] || "").trim() !== "",
          date: null,
          song: null,
          player: null,
          robot: null,
          submission: null,
          source: "legacy",
          legacyRank
        }
      });
    });
    return { rows, problems };
  },

  // Writes the imported rows and publishes the list. Safe to run again: the
  // ids are the rows' places in the sheet, so a second run replaces the first
  // rather than adding to it, and imported rows the sheet no longer has are
  // removed. Scores added by the game are never touched.
  async importLegacy(rows, onProgress) {
    await this.requireOperator();
    const collection = this.db.collection(this.collectionName());
    const step = 400;   // under Firestore's 500 writes per batch
    const signature = { submittedBy: this.user.uid, submittedEmail: this.user.email || null };
    try {
      for (let i = 0; i < rows.length; i += step) {
        const batch = this.db.batch();
        rows.slice(i, i + step).forEach(r => batch.set(collection.doc(r.id), Object.assign({}, r.data, signature)));
        await withTimeout(batch.commit(), 90);
        if (onProgress) onProgress(Math.min(rows.length, i + step), rows.length);
      }

      const keep = new Set(rows.map(r => r.id));
      const old = await withTimeout(collection.where("source", "==", "legacy").get({ source: "server" }), 90);
      const stale = old.docs.filter(d => !keep.has(d.id));
      for (let i = 0; i < stale.length; i += step) {
        const batch = this.db.batch();
        stale.slice(i, i + step).forEach(d => batch.delete(d.ref));
        await withTimeout(batch.commit(), 90);
      }
    } catch (err) {
      throw classify(err);
    }
    return { published: await this.rebuildTable() };
  }
};

function dbError(kind, message) {
  const err = new Error(message);
  err.kind = kind;
  return err;
}

function withTimeout(promise, seconds) {
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(dbError("offline", `no answer from the database after ${seconds}s`)), seconds * 1000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// Firestore's error codes, sorted into what the caller can do about them.
function classify(err) {
  if (err && err.kind) return err;
  const code = err && err.code ? String(err.code) : "";
  if (code === "permission-denied") {
    return dbError("refused", "permission denied - is this account an active operator?");
  }
  if (code === "unauthenticated") return dbError("signedout", "not signed in");
  if (code === "invalid-argument" || code === "out-of-range" || code === "resource-exhausted") {
    return dbError("refused", err.message || code);
  }
  return dbError("offline", (err && err.message) || "no connection");
}

function authMessage(err) {
  const code = err && err.code ? String(err.code) : "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(code)) {
    return "wrong email or password";
  }
  if (code === "auth/network-request-failed") return "no connection";
  if (code === "auth/too-many-requests") return "too many tries - wait a minute and try again";
  if (code === "auth/operation-not-allowed") return "email/password sign-in is not switched on in Firebase";
  if (code === "auth/email-already-in-use") return "there is already an account with that email - sign in instead";
  if (code === "auth/weak-password") return "the password needs at least 6 characters";
  if (code === "auth/missing-password") return "type a password";
  if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") {
    return "this site's domain is not in Firebase > Authentication > Settings > Authorized domains";
  }
  // The code, not just the prose. An unmapped failure is exactly the one
  // nobody can act on without knowing which it was.
  const message = (err && err.message) || "could not sign in";
  return code && message.indexOf(code) === -1 ? `${message} (${code})` : message;
}

function cleanText(value, max) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/[ -]/g, " ")
    .trim()
    .slice(0, max);
}

// Like cleanText, but keeps line breaks - for a message someone has written.
function cleanMessage(value, max) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function localDate(d) {
  const two = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// Quoted fields, doubled quotes and newlines inside quotes - which is what a
// Google Sheets export produces for a name with a comma in it.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
