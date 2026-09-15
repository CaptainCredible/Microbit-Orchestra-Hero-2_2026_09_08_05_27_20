// The HIGHSCORES page: the whole published list, filterable by name or place,
// and the operator's sign-in.
//
// Looking at the list needs no sign-in and no Firebase SDK - it is one plain
// request for the published table. Signing in is only for the machine that
// adds scores. It stays signed in between visits, so an installation laptop
// signs in once, and anything submitted while signed out goes the moment it
// does.

const Leaderboard = {
  root: null,
  listEl: null,
  filterEl: null,
  statusEl: null,
  authEl: null,
  entries: [],
  loading: false,

  build() {
    if (this.root) return;

    const root = lbElement("div", { id: "leaderboard" });
    root.hidden = true;

    const head = lbElement("header");
    const title = lbElement("span", { className: "lb-title", textContent: "Highscores" });
    this.filterEl = lbElement("input", { type: "text", placeholder: "filter by name or place", maxLength: 80 });
    this.filterEl.oninput = () => this.render();
    const refresh = lbElement("button", { textContent: "refresh" });
    refresh.onclick = () => this.refresh();
    const back = lbElement("button", { textContent: "back to songs" });
    back.onclick = () => setPage("STAGE_SELECT");
    head.append(title, this.filterEl, refresh, back);

    const cols = lbElement("div", { className: "lb-cols" });
    ["#", "", "name", "place", "date", "score"].forEach(t => cols.append(lbElement("span", { textContent: t })));

    this.listEl = lbElement("div", { className: "lb-list" });

    const foot = lbElement("footer");
    this.authEl = lbElement("div", { className: "lb-auth" });
    this.statusEl = lbElement("span", { className: "lb-status" });
    foot.append(this.authEl, this.statusEl);

    root.append(head, cols, this.listEl, foot);
    document.body.appendChild(root);
    this.root = root;

    Highscores.onChange(() => this.renderAuth());
    this.renderAuth();
  },

  show() {
    this.build();
    this.root.hidden = false;
    this.refresh();
    // Only to learn whether this machine is already signed in, so the footer
    // shows the right thing. Viewing the list does not wait for it.
    if (Highscores.configured()) Highscores.start().then(() => this.renderAuth());
  },

  hide() { if (this.root) this.root.hidden = true; },

  // The panel's box in canvas pixels, for the embers around it. null while it
  // is hidden, since a hidden element measures 0x0.
  rect() {
    if (!this.root || this.root.hidden) return null;
    const r = this.root.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  },

  async refresh() {
    if (!Highscores.configured()) {
      this.entries = [];
      this.render();
      this.say("no highscore database set up yet - see the README");
      return;
    }
    if (this.loading) return;
    this.loading = true;
    this.say("loading...");
    try {
      const table = await Highscores.fetchTable();
      this.entries = table.entries;
      this.render();
      this.say(table.missing ? "nothing published yet" : `${table.entries.length} scores`);
    } catch (err) {
      this.say(`can't load the list - ${err.message}`);
    } finally {
      this.loading = false;
    }
  },

  // Filtering keeps each score's global position: it narrows the list, it does
  // not re-rank it, so "5" still means fifth of everyone.
  render() {
    if (!this.listEl) return;
    const q = this.filterEl.value.trim().toLowerCase();
    const shown = q
      ? this.entries.filter(e => `${e.name} ${e.location}`.toLowerCase().includes(q))
      : this.entries;

    const frag = document.createDocumentFragment();
    for (const e of shown) {
      const row = lbElement("div", {
        className: "lb-row" + (e.position <= 3 ? " lb-top" : "") + (e.bonus ? " lb-bonus" : "")
      });
      const star = lbElement("span", { className: "lb-star" });
      if (e.bonus) {
        const glint = lbElement("span", { className: "lb-star-on", textContent: "★", title: "bonus star" });
        // Each star at its own point in the twinkle, so a screen with several
        // on it sparkles rather than pulsing in unison. Negative, so it starts
        // part-way through instead of waiting.
        glint.style.setProperty("--twinkle", `${-((e.position * 0.37) % 2.4).toFixed(2)}s`);
        star.append(glint);
      }
      row.append(
        lbElement("span", { className: "lb-pos", textContent: e.position }),
        star,
        lbElement("span", { className: "lb-name", textContent: e.name, title: e.name }),
        lbElement("span", { className: "lb-loc", textContent: e.location, title: e.location }),
        lbElement("span", { className: "lb-date", textContent: e.date || "" }),
        lbElement("span", { className: "lb-score", textContent: e.score })
      );
      frag.append(row);
    }
    this.listEl.replaceChildren(frag);
    if (!shown.length && this.entries.length) {
      this.listEl.append(lbElement("div", { className: "lb-empty", textContent: "nothing matches" }));
    }
  },

  renderAuth() {
    if (!this.authEl) return;
    this.authEl.replaceChildren();
    if (!Highscores.configured()) return;
    // A newer render makes any status answer still on its way stale.
    const token = this.authRender = {};

    const requestLink = lbElement("a", {
      className: "lb-link", href: "tools/request-operator.html", target: "_blank", rel: "noopener",
      textContent: "request operator access"
    });

    if (Highscores.user) {
      const email = Highscores.user.email || "signed in";
      const who = lbElement("span", { className: "lb-who", textContent: email });

      const waiting = ScoreOutbox.pending();
      const send = lbElement("button", { textContent: `send waiting boards (${waiting})` });
      send.hidden = waiting === 0;
      send.onclick = async () => {
        this.say("sending...");
        const result = await Scoreboard.flush();
        this.say(describeSend(result) || "nothing waiting");
        this.renderAuth();
        this.refresh();
      };

      const rebuild = lbElement("button", { textContent: "rebuild list" });
      rebuild.title = "re-publish the list from the database - after editing scores in the Firebase console";
      rebuild.hidden = true;
      rebuild.onclick = async () => {
        this.say("rebuilding the list...");
        try {
          const n = await Highscores.rebuildTable();
          this.say(`list rebuilt - ${n} scores`);
          this.refresh();
        } catch (err) {
          this.say(`could not rebuild - ${err.message}`);
        }
      };

      const manage = lbElement("a", {
        className: "lb-link", href: "tools/manage-highscores.html", target: "_blank", rel: "noopener",
        textContent: "manage highscores"
      });
      manage.hidden = true;
      requestLink.hidden = true;

      const out = lbElement("button", { textContent: "sign out" });
      out.onclick = () => Highscores.signOut();

      this.authEl.append(who, send, rebuild, manage, requestLink, out);

      // What this account may do is the database's to say, so it is asked
      // rather than assumed from being signed in.
      Highscores.myStatus().then(st => {
        if (this.authRender !== token) return;
        const role = st.admin ? "admin"
          : st.operator === "active" ? "operator"
          : st.operator === "banned" ? "banned"
          : st.request && st.request.status === "pending" ? "waiting for approval"
          : st.request ? "request turned down"
          : "not an operator";
        who.textContent = `${role}: ${email}`;
        who.classList.toggle("lb-who-bad", !st.admin && st.operator !== "active");
        rebuild.hidden = !st.admin;
        manage.hidden = !st.admin;
        requestLink.hidden = st.admin || !!st.operator || !!st.request;
      }).catch(() => {});
      return;
    }

    const form = lbElement("form", { className: "lb-signin" });
    const email = lbElement("input", { type: "email", placeholder: "operator email", autocomplete: "username" });
    const password = lbElement("input", { type: "password", placeholder: "password", autocomplete: "current-password" });
    const go = lbElement("button", { type: "submit", textContent: "sign in" });
    form.append(email, password, go);
    form.onsubmit = async (event) => {
      event.preventDefault();
      go.disabled = true;
      this.say("signing in...");
      try {
        await Highscores.signIn(email.value, password.value);
        this.say("signed in");
      } catch (err) {
        this.say(err.message);
        go.disabled = false;
      }
    };
    this.authEl.append(form, requestLink);
  },

  say(message) {
    if (this.statusEl) this.statusEl.textContent = message;
  },

  ownsEvent(event) {
    return !!(this.root && event && event.target &&
              typeof event.target.closest === "function" &&
              event.target.closest("#leaderboard"));
  }
};

function lbElement(tag, props) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === "autocomplete") el.setAttribute("autocomplete", value);
      else el[key] = value;
    }
  }
  return el;
}
