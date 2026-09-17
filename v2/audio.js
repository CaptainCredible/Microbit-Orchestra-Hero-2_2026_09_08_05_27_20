// Tone.js audio engine.
//
// Drums are synthesised: a membrane voice for the kick and two noise voices
// for the snare and hat. All three are monophonic, so their cost is flat no
// matter how fast the pattern goes.
//
// Each melodic instrument runs the same shape of chain:
//
//   synth -> [pad only: vibrato -> chorus -> tremolo] -> filter -> level
//                                                     -> dry -> master
//                                                     -> wet -> reverb
//
// so every one of them has its own waveform, ADSR, cutoff, resonance and a
// plain wet/dry reverb amount. The reverb itself is shared - one convolver,
// fed by each instrument's wet gain.

// The live sound settings. Starts as a copy of SOUND_DEFAULTS, is edited in
// place by the debug panel, and is what "export sound settings" serialises.
const SoundState = JSON.parse(JSON.stringify(SOUND_DEFAULTS));

/**
 * Polyphony with voice stealing.
 *
 * Tone's PolySynth does not steal. Past `maxPolyphony` it logs "Max polyphony
 * exceeded. Note dropped." and throws the new note away, which is the worst
 * possible choice - the note you just played is the one that goes missing.
 * Measured: eight notes into a four-voice PolySynth is bit for bit identical
 * to playing only the first four.
 *
 * So the count is kept here instead, and a voice is freed by hand before the
 * synth is ever asked for more than it has.
 */
class VoicePool {
  /**
   * @param {Tone.PolySynth} synth
   * @param {number} limit how many voices may be sounding at once
   * @param {function(): number} releaseOf the synth's current release, read
   *        live because the sound panel can change it under us
   */
  constructor(synth, limit, releaseOf) {
    this.synth = synth;
    this.limit = limit;
    this.releaseOf = releaseOf;
    this.active = [];              // {freq, start, off, end}
    this.lastTime = 0;
  }

  reset() { this.active.length = 0; this.lastTime = 0; }

  // A voice is counted until it has actually stopped making sound - the note
  // off plus its release tail, not just the note off. That is what makes the
  // limit mean what it says: with a 2.6s pad release, tails are most of what
  // is sounding at any moment, and a limit that ignored them would not be a
  // limit at all.
  _prune(time) {
    // The transport jumps backwards on a loop or a seek, and anything held
    // from the old position is stale.
    if (time < this.lastTime - 0.05) this.active.length = 0;
    this.lastTime = time;

    let kept = 0;
    for (const voice of this.active) if (voice.end > time) this.active[kept++] = voice;
    this.active.length = kept;
  }

  // Which voice to take when they are all busy:
  //   1. one already past its note off, furthest into its tail - it is fading
  //      out anyway, so stealing it is the least audible thing available;
  //   2. failing that, the oldest note still being held.
  _pick(time) {
    let tail = null, held = null;
    for (const voice of this.active) {
      if (voice.off <= time) {
        if (!tail || voice.off < tail.off) tail = voice;
      } else if (!held || voice.start < held.start) {
        held = voice;
      }
    }
    return tail || held;
  }

  // Taking a voice has to actually free it. Releasing normally would hand
  // the stolen note its full release - 2.6s on the pads - during which Tone
  // still counts the voice as busy, and it goes on dropping notes anyway
  // (measured: 6 dropped in a 15 second run, with the pool in place).
  //
  // Tone has no per-note release, so the envelope is briefly shortened around
  // the release call. triggerRelease reads the release time as it is called,
  // and every note already scheduled took its own copy when it was triggered,
  // so nothing else is affected.
  // The one voice playing a pitch, or null. Tone is pinned to 15.0.4 in
  // index.html, so reaching into _activeVoices is safe here; if it ever moves,
  // the caller falls back to the public API rather than breaking.
  _voiceFor(midi) {
    const active = this.synth._activeVoices;
    if (!active) return null;
    for (const entry of active) {
      if (entry.midi === midi && !entry.released) return entry.voice;
    }
    return null;
  }

  _steal(victim, time) {
    // A stolen voice has to stop *before* the note that stole it starts.
    // Releasing at the same instant leaves it still sounding when Tone looks
    // for a free voice, so Tone reaches for another one instead - which is
    // how the pool ends up costing voices rather than saving them.
    const releaseAt = Math.max(time - STEAL_FADE * 1.25, Tone.now());

    // Shorten the release for this one note only. PolySynth.set() would do it
    // too, but it deep merges its options and walks every voice, and at ten
    // steals a bar that costs more than the voices it saves: measured, the
    // pool went from 3% slower than no pool at all to faster than it.
    const voice = this._voiceFor(victim.midi);
    if (voice && voice.envelope) {
      const normal = voice.envelope.release;
      voice.envelope.release = STEAL_FADE;
      voice.triggerRelease(releaseAt);
      voice.envelope.release = normal;
    } else {
      this.synth.triggerRelease(victim.freq, releaseAt);
    }

    this.active.splice(this.active.indexOf(victim), 1);
  }

  play(freq, duration, time, velocity, midi) {
    this._prune(time);

    while (this.active.length >= this.limit) {
      const victim = this._pick(time);
      if (!victim) break;
      this._steal(victim, time);
    }

    this.synth.triggerAttackRelease(freq, duration, time, velocity);
    const off = time + duration;
    this.active.push({
      freq, midi, start: time, off,
      // Tone frees a voice when its envelope reports silence, and an
      // exponential release crosses that threshold later than the nominal
      // release time. Forgetting a voice before the synth has is what let
      // more notes in than there were voices to play them, so the pool waits
      // out the margin as well - and the effect of erring this way is that
      // old tails get stolen and cut to a short fade instead of ringing on,
      // which is exactly what keeps the voice count down.
      end: off + this.releaseOf() * RELEASE_MARGIN
    });
  }
}

const AudioEngine = {
  started: false,
  voices: {},                      // name -> the nodes making up one instrument
  pools: {},                       // name -> VoicePool, for the polyphonic ones
  bassNow: null,                   // the note the monophonic bass is playing
  drumNow: {},                     // name -> when that drum was last struck
  pwmTimer: null,                  // JS-driven LFO, only used for pulse width

  async start() {
    if (this.started) return;
    await Tone.start();

    // Master chain. The limiter is here because several synth voices plus a
    // loud kick can easily clip.
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Gain(0.9).connect(this.limiter);

    // One shared reverb, fed by each instrument's wet gain.
    this.reverbLevel = new Tone.Gain(SoundState.reverb.level).connect(this.master);
    this.reverb = new Tone.Reverb({
      decay: SoundState.reverb.decay,
      preDelay: SoundState.reverb.preDelay,
      wet: 1
    }).connect(this.reverbLevel);

    this._buildVoices();
    this._buildSynths();
    this._rewirePadLfo();

    // The convolver renders its impulse response offline before it passes any
    // audio, so without this wait the opening seconds come out completely dry.
    // Capped, because a reverb that never finished generating would otherwise
    // stop the song from ever starting - better dry than silent.
    try {
      await Promise.race([
        this.reverb.ready,
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    } catch (err) { /* nothing to wait for */ }

    this.started = true;
  },

  // filter -> level -> (dry to master, wet to the reverb). Shared by every
  // instrument, so they all behave the same way.
  _voiceChain(name, hasFilter) {
    const settings = SoundState[name];
    const dry = new Tone.Gain(1 - settings.reverb).connect(this.master);
    const wet = new Tone.Gain(settings.reverb).connect(this.reverb);
    const level = new Tone.Gain(settings.level);
    level.connect(dry);
    level.connect(wet);

    let input = level;
    let filter = null;
    if (hasFilter) {
      filter = new Tone.Filter({
        type: "lowpass", rolloff: -24,
        frequency: settings.cutoff, Q: settings.resonance
      }).connect(level);
      input = filter;
    }

    this.voices[name] = { dry, wet, level, filter, input };
    return this.voices[name];
  },

  _buildVoices() {
    this._voiceChain("pads", true);
    this._voiceChain("bass", true);
    this._voiceChain("keys", true);
    this._voiceChain("drums", false);
  },

  _envelopeOf(name) {
    const s = SoundState[name];
    return { attack: s.attack, decay: s.decay, sustain: s.sustain, release: s.release };
  },

  // The pads' per-voice filter envelope, as Tone wants it.
  //
  // filterOctaves is the switch as well as the amount. At 0 the filter is
  // parked at the top of the cutoff range with nothing to sweep, which is a
  // filter doing nothing - the pads then sound exactly as they did before
  // there was an envelope at all. That matters: every song.setup written so
  // far says nothing about these fields, so they must default to silence.
  //
  // Resonance deliberately stays on the shared filter below rather than being
  // applied here as well. Putting it on both would resonate the same peak
  // twice, and `resonance` has always meant the one knob.
  // Where the shared pad filter sits.
  //
  // Normally at the cutoff. But the per-voice envelope sweeps *up* from the
  // cutoff, and the shared filter is downstream of it - so leaving the shared
  // one at the cutoff too would throw away everything the envelope just
  // opened, and the envelope controls would appear to do nothing at all.
  // Measured before this was here: brightness moved by 3% across a four
  // octave sweep, which is nothing.
  //
  // So with the envelope engaged the shared filter moves up to the top of the
  // sweep and lets it through. The LFO still swings around that point if it
  // is routed to the filter; it is simply centred on the ceiling rather than
  // on the floor.
  _padSharedCutoff() {
    const s = SoundState.pads;
    if (!(s.filterOctaves > 0)) return s.cutoff;
    return Math.min(CUTOFF_HZ[1], s.cutoff * Math.pow(2, s.filterOctaves));
  },

  _padFilterEnvelope() {
    const s = SoundState.pads;
    const engaged = s.filterOctaves > 0;
    return {
      attack: s.filterAttack,
      decay: s.filterDecay,
      sustain: s.filterSustain,
      release: s.filterRelease,
      baseFrequency: engaged ? s.cutoff : CUTOFF_HZ[1],
      octaves: engaged ? s.filterOctaves : 0
    };
  },

  _buildSynths() {
    const drumIn = this.voices.drums.input;

    // Drums. All three are monophonic - one generator each, re-gated by an
    // envelope - so a busy hi-hat pattern costs no more than a sparse one.
    this.synthKick = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 6,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 }
    }).connect(drumIn);

    this.synthSnare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 }
    }).connect(new Tone.Filter(1400, "bandpass").connect(drumIn));

    this.synthHat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0 }
    }).connect(new Tone.Filter(8000, "highpass").connect(drumIn));

    // --- pads -------------------------------------------------------------
    // A pulse wave whose width the LFO sweeps: that sweep is what pulse width
    // modulation actually is, and routing the LFO elsewhere leaves the width
    // parked in the middle.
    // MonoSynth rather than Synth: it is the Tone voice that carries a filter
    // and a filter envelope of its own, so each pad note sweeps separately.
    // The shared filter further down the chain stays - it is what the LFO can
    // be aimed at, since a PolySynth exposes no per-voice signal to connect
    // one to.
    this.pads = new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: SoundState.pads.wave, width: 0.5 },
      envelope: this._envelopeOf("pads"),
      filter: { type: "lowpass", rolloff: -24, Q: 1 },
      filterEnvelope: this._padFilterEnvelope()
    });
    this.pads.maxPolyphony = PAD_VOICES + POLY_HEADROOM;

    // Tremolo gain sits between the chorus and the filter and is the target
    // when the LFO is routed to LEVEL.
    this.padTremolo = new Tone.Gain(1).connect(this.voices.pads.input);

    this.padChorus = new Tone.Chorus({
      frequency: SoundState.chorus.rate, delayTime: 3.5,
      depth: SoundState.chorus.depth, wet: SoundState.chorus.wet
    }).connect(this.padTremolo);
    this.padChorus.start();

    this.padVibrato = new Tone.Vibrato({
      frequency: SoundState.pads.vibratoRate,
      depth: SoundState.pads.vibratoDepth
    }).connect(this.padChorus);

    this.pads.connect(this.padVibrato);

    // Two LFOs, each permanently wired to its own target and flattened to a
    // constant when it is not the selected destination.
    //
    // They are never disconnected, because a Tone Signal that has been driven
    // cannot be handed back: once something connects to it, its own value is
    // zeroed, and disconnect(), dispose() and writing .value all leave it at
    // zero. Routing away from the filter that way silenced the pads outright.
    // Holding min === max instead gives a steady value with no such trap.
    this.filterLfo = new Tone.LFO({
      frequency: SoundState.pads.lfoRate,
      min: SoundState.pads.cutoff, max: SoundState.pads.cutoff
    }).start();
    this.filterLfo.connect(this.voices.pads.filter.frequency);

    this.levelLfo = new Tone.LFO({
      frequency: SoundState.pads.lfoRate, min: 1, max: 1
    }).start();
    this.levelLfo.connect(this.padTremolo.gain);

    // --- bass and keys ----------------------------------------------------
    // Both get an external filter rather than a synth-internal one, so the
    // cutoff and resonance controls mean exactly what they say.
    //
    // The bass is a single Tone.Synth, not a PolySynth: a bass line is one
    // note at a time, and one oscillator costs a fraction of a voice pool.
    // Retriggering it is safe on its own - a new attack cancels the previous
    // note's pending release, so the note that steals the voice is not cut
    // short by the note it stole from.
    this.bass = new Tone.Synth({
      oscillator: { type: SoundState.bass.wave },
      envelope: this._envelopeOf("bass")
    }).connect(this.voices.bass.input);

    this.keys = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: SoundState.keys.wave },
      envelope: this._envelopeOf("keys")
    });
    this.keys.maxPolyphony = KEYS_VOICES + POLY_HEADROOM;
    this.keys.connect(this.voices.keys.input);

    // The pools are the real limit. Tone's own maxPolyphony is set a little
    // higher so that its bookkeeping - which frees a voice slightly after we
    // release it - can never be the thing that drops a note.
    this.pools.pads = new VoicePool(this.pads, PAD_VOICES,
      () => SoundState.pads.release);
    this.pools.keys = new VoicePool(this.keys, KEYS_VOICES,
      () => SoundState.keys.release);
  },

  //////////////////////////////////////////////////////////////////
  // The pad LFO
  //////////////////////////////////////////////////////////////////

  // Aim the modulation at whichever destination is selected. Nothing is ever
  // unplugged: the unselected LFOs are flattened to a constant instead.
  _rewirePadLfo() {
    // The panel can be touched before a song has ever been picked, and the
    // nodes only exist from the first Tone.start(). Everything is re-applied
    // at that point anyway, so there is nothing to do yet.
    if (!this.filterLfo || !this.pads) return;

    const pads = SoundState.pads;
    const amount = pads.lfoAmount;

    this.filterLfo.frequency.value = pads.lfoRate;
    this.levelLfo.frequency.value = pads.lfoRate;

    // Centred on the shared filter's home, which is the cutoff normally and
    // the top of the envelope's sweep when there is one - see
    // _padSharedCutoff().
    const centre = this._padSharedCutoff();

    if (pads.lfoDest === "filter") {
      // Swing either side of it, up to about two octaves at full.
      const spread = 1 + 3 * amount;
      this.filterLfo.min = Math.max(CUTOFF_HZ[0], centre / spread);
      this.filterLfo.max = Math.min(CUTOFF_HZ[1], centre * spread);
    } else {
      this.filterLfo.min = centre;
      this.filterLfo.max = centre;
    }

    if (pads.lfoDest === "level") {
      this.levelLfo.min = Math.max(0, 1 - amount);
      this.levelLfo.max = 1;
    } else {
      this.levelLfo.min = 1;
      this.levelLfo.max = 1;
    }

    if (this.pwmTimer) { clearInterval(this.pwmTimer); this.pwmTimer = null; }
    if (pads.lfoDest === "pwm") {
      // Pulse width is a per-voice parameter on a PolySynth, so there is no
      // signal to connect an LFO to. It is driven from a timer instead, which
      // is fine because width changes do not click the way gain changes do.
      const swing = 0.45 * amount;
      const rate = pads.lfoRate;
      const started = Tone.now();
      this.pwmTimer = setInterval(() => {
        const phase = (Tone.now() - started) * rate * Math.PI * 2;
        this.pads.set({ oscillator: { width: 0.5 + Math.sin(phase) * swing } });
      }, 1000 / 50);
    } else {
      this.pads.set({ oscillator: { width: 0.5 } });
    }
  },

  //////////////////////////////////////////////////////////////////
  // Triggering. `time` is an AudioContext time, from the Transport.
  //////////////////////////////////////////////////////////////////

  drum(name, time, velocity = 0.8) {
    // The three drum voices are monophonic, and a second hit at the very same
    // instant is an error in Tone rather than a louder hit - it throws out of
    // the Transport callback it was scheduled in. Files really do stack them:
    // GM 35 and 36 are both a kick, and one of the songs shipped here has two
    // landing together. The duplicate is dropped.
    const last = this.drumNow[name];
    if (last !== undefined) {
      if (time < last - 0.05) delete this.drumNow[name];   // the transport looped
      else if (time <= last) return;
    }
    this.drumNow[name] = time;

    if (name === "kick")  this.synthKick.triggerAttackRelease("C1", 0.3, time, velocity);
    if (name === "snare") this.synthSnare.triggerAttackRelease(0.18, time, velocity);
    if (name === "hihat") this.synthHat.triggerAttackRelease(0.045, time, velocity * 0.7);
  },

  pad(midi, duration, time, velocity = 0.5) {
    this.pools.pads.play(Tone.Frequency(midi, "midi").toFrequency(),
      Math.max(duration, 0.15), time, velocity, midi);
  },

  // Monophonic. Notes that overlap simply take the voice from whatever was
  // holding it - a new attack cancels the previous note's pending release, so
  // the note doing the stealing is not cut short by the one it stole from.
  //
  // Two attacks at the same instant are an error in Tone ("Start time must be
  // strictly greater than previous start time"), so a note that does not
  // advance the clock is refused here. Which of a stacked bass chord survives
  // is decided in scheduleScore, where the whole score is visible.
  bassNote(midi, duration, time, velocity = 0.85) {
    if (this.bassNow) {
      // the transport looped or was seeked backwards
      if (time < this.bassNow.time - 0.05) this.bassNow = null;
      else if (time <= this.bassNow.time) return;
    }

    this.bassNow = { time, midi };
    this.bass.triggerAttackRelease(
      Tone.Frequency(midi, "midi").toFrequency(),
      Math.max(duration, 0.08), time, velocity);
  },

  keysNote(midi, duration, time, velocity = 0.7) {
    this.pools.keys.play(Tone.Frequency(midi, "midi").toFrequency(),
      Math.max(duration, 0.08), time, velocity, midi);
  },

  //////////////////////////////////////////////////////////////////
  // Transport
  //////////////////////////////////////////////////////////////////

  // Put every note of a score onto the Transport. Visuals read the same
  // clock, so picture and sound cannot drift apart.
  scheduleScore(score, countIn) {
    this.clearSchedule();
    const offset = countIn || 0;

    for (const n of score.drums) {
      Tone.getTransport().schedule((time) => {
        Perf.time("audio", () => this.drum(n.drum, time, n.velocity));
      }, n.time + offset);
    }
    for (const n of score.pads) {
      Tone.getTransport().schedule((time) => {
        Perf.time("audio", () => this.pad(n.midi, n.duration, time, n.velocity * 0.7));
      }, n.time + offset);
    }
    for (const n of score.basskeys) {
      if (n.voice === "bass") continue;
      Tone.getTransport().schedule((time) => {
        Perf.time("audio", () => this.keysNote(n.midi, n.duration, time, n.velocity));
      }, n.time + offset);
    }

    for (const n of this._monoBass(score.basskeys)) {
      Tone.getTransport().schedule((time) => {
        Perf.time("audio", () => this.bassNote(n.midi, n.duration, time, n.velocity));
      }, n.time + offset);
    }
  },

  // The bass has one voice, so a stacked bass chord has to be resolved before
  // it is scheduled rather than fought over at trigger time. Sorting by time
  // and then by pitch puts the lowest note of each stack first, and the rest
  // of that stack is dropped - the lowest note is what a bass line means.
  _monoBass(basskeys) {
    const bass = basskeys
      .filter(n => n.voice === "bass")
      .sort((a, b) => a.time - b.time || a.midi - b.midi);

    const kept = [];
    for (const note of bass) {
      const last = kept[kept.length - 1];
      if (last && note.time - last.time < 0.002) continue;
      kept.push(note);
    }
    return kept;
  },

  clearSchedule() {
    Tone.getTransport().cancel(0);
    this._resetVoiceTracking();
  },

  // Silence everything that is currently ringing.
  releaseAll() {
    try {
      this.pads?.releaseAll();
      this.keys?.releaseAll();
      this.bass?.triggerRelease();
    } catch (err) { /* nothing sounding */ }
    this._resetVoiceTracking();
  },

  // Nothing is sounding any more, so what the pools think is sounding has to
  // go with it - otherwise the next note starts against a full pool and
  // steals a voice that was already free.
  _resetVoiceTracking() {
    this.pools.pads?.reset();
    this.pools.keys?.reset();
    this.bassNow = null;
    this.drumNow = {};
  },

  //////////////////////////////////////////////////////////////////
  // Live controls, all driven by the debug panel
  //////////////////////////////////////////////////////////////////

  _synthOf(name) {
    return { pads: this.pads, bass: this.bass, keys: this.keys }[name];
  },

  setWave(name, wave) {
    const options = { type: wave };
    // Only a pulse wave has a width, and the LFO owns it when it is routed
    // to PWM, so seed it in the middle and let the LFO take over.
    if (wave === "pulse") options.width = 0.5;
    this._synthOf(name)?.set({ oscillator: options });
    if (name === "pads") this._rewirePadLfo();
  },

  setEnvelope(name, part) { this._synthOf(name)?.set({ envelope: part }); },

  setCutoff(name, hz) {
    const filter = this.voices[name]?.filter;
    if (!filter) return;
    // The pad cutoff is always held by its LFO, whether or not the LFO is
    // sweeping, so it is moved by re-aiming that rather than written directly.
    // It is also where the per-voice envelope sweeps up from, so that has to
    // follow it or moving the cutoff would only move half the sound.
    if (name === "pads") { this._rewirePadLfo(); this.setPadFilterEnvelope(); }
    else filter.frequency.rampTo(hz, 0.05);
  },

  // Push the per-voice filter envelope at every pad voice. PolySynth.set()
  // reaches the voices that already exist and is remembered for the ones made
  // later, so a change is heard on the next note without rebuilding anything.
  setPadFilterEnvelope() {
    this.pads?.set({ filterEnvelope: this._padFilterEnvelope() });
    // Changing the octaves moves where the shared filter has to sit, so it is
    // re-aimed too - otherwise turning the envelope up would open the voices
    // and leave the filter behind them still closed.
    this._rewirePadLfo();
  },

  setResonance(name, q) {
    const filter = this.voices[name]?.filter;
    if (filter) filter.Q.value = q;
  },

  setLevel(name, value) { this.voices[name]?.level.gain.rampTo(value, 0.05); },

  // One knob per instrument: 0 is fully dry, 1 is fully wet.
  setReverbMix(name, wet) {
    const voice = this.voices[name];
    if (!voice) return;
    voice.dry.gain.rampTo(1 - wet, 0.06);
    voice.wet.gain.rampTo(wet, 0.06);
  },

  setChorus(part) {
    if (!this.padChorus) return;
    if (part.rate !== undefined) this.padChorus.frequency.value = part.rate;
    if (part.depth !== undefined) this.padChorus.depth = part.depth;
    if (part.wet !== undefined) this.padChorus.wet.value = part.wet;
  },

  setVibrato(part) {
    if (!this.padVibrato) return;
    if (part.rate !== undefined) this.padVibrato.frequency.value = part.rate;
    if (part.depth !== undefined) this.padVibrato.depth.value = part.depth;
  },

  setPadLfo() { this._rewirePadLfo(); },

  setReverbLevel(value) { this.reverbLevel?.gain.rampTo(value, 0.05); },

  // These two rebuild the impulse response, which is an offline render, so
  // the panel debounces them rather than calling on every slider tick.
  setReverbDecay(seconds) { if (this.reverb) this.reverb.decay = seconds; },
  setReverbPreDelay(seconds) { if (this.reverb) this.reverb.preDelay = seconds; },

  //////////////////////////////////////////////////////////////////
  // Per-song sounds
  //////////////////////////////////////////////////////////////////

  // Push the whole of SoundState at the live nodes.
  //
  // The sound panel has its own applyAll(), but that walks the panel's rows -
  // and the panel only exists when DEBUG_SOUND is on. A song's sounds have to
  // arrive whether or not anybody is looking at sliders, so this goes through
  // the same setters without needing a control to hang off.
  applySoundState() {
    if (!this.started) return;
    for (const name of ["pads", "bass", "keys"]) {
      const s = SoundState[name];
      this.setWave(name, s.wave);
      this.setEnvelope(name, {
        attack: s.attack, decay: s.decay, sustain: s.sustain, release: s.release
      });
      this.setResonance(name, s.resonance);
      this.setCutoff(name, s.cutoff);      // pads: also moves the envelope's base
      this.setLevel(name, s.level);
      this.setReverbMix(name, s.reverb);
    }
    this.setLevel("drums", SoundState.drums.level);
    this.setReverbMix("drums", SoundState.drums.reverb);

    this.setVibrato({ rate: SoundState.pads.vibratoRate, depth: SoundState.pads.vibratoDepth });
    this.setPadFilterEnvelope();
    this.setPadLfo();
    this.setChorus(SoundState.chorus);
    this.setReverbLevel(SoundState.reverb.level);
    this.setReverbDecay(SoundState.reverb.decay);
    this.setReverbPreDelay(SoundState.reverb.preDelay);
  },

  // Load a song's `sounds` block from its song.setup.
  //
  // Starts from SOUND_DEFAULTS every time, so a song that says nothing about
  // the bass gets the default bass rather than whatever the song before it
  // happened to leave behind. Only keys the instrument actually has are
  // copied, and only when the type matches - a typo in a hand-written file
  // should cost you that one setting, not the whole song.
  //
  // Each instrument accepts either a bare settings object or a whole preset
  // file as saved by the sound panel, which is the same thing wrapped in
  // { kind, instrument, settings }.
  applySongSounds(sounds) {
    const fresh = JSON.parse(JSON.stringify(SOUND_DEFAULTS));
    let copied = 0;

    for (const name of Object.keys(fresh)) {
      const given = sounds && sounds[name];
      const settings = given && given.settings ? given.settings : given;
      if (!settings || typeof settings !== "object") continue;

      for (const key of Object.keys(fresh[name])) {
        if (settings[key] === undefined) continue;
        if (typeof settings[key] !== typeof fresh[name][key]) continue;
        fresh[name][key] = settings[key];
        copied++;
      }
    }

    for (const name of Object.keys(fresh)) {
      Object.assign(SoundState[name], fresh[name]);
    }

    this.applySoundState();
    if (typeof SoundPanel !== "undefined" && SoundPanel.root) SoundPanel.refresh();
    return copied;
  },

  get transportSeconds() {
    return Tone.getTransport().seconds;
  }
};
