/* PULSE DASH — a neon rhythm runner built with Canvas + Web Audio. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const BPM = 126;
  const BEAT = 60 / BPM;
  const BASE_SPEED = 470;
  const GRAVITY = 5900;
  const JUMP_V = 1120;
  const PLAYER_SIZE = 42;
  const STEP = BEAT / 4;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (n, m) => ((n % m) + m) % m;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function formatScore(n) {
    return Math.floor(n).toString().padStart(6, '0');
  }

  function formatNumber(n) {
    return Math.floor(n).toLocaleString('en-US');
  }

  function storageGet(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch (error) { return fallback; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* private mode */ }
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const num = parseInt(full, 16);
    return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
  }

  /* ------------------------------------------------------------------ */
  /* Audio                                                              */
  /* ------------------------------------------------------------------ */

  class PulseAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.noise = null;
      this.runGain = null;
      this.timer = null;
      this.running = false;
      this.startTime = 0;
      this.nextTime = 0;
      this.step = 0;
      this.muted = storageGet('pulseDashMuted') === '1';
      this.volume = 0.72;
    }

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -16;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.22;
        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        this.noise = this.makeNoise();
      } catch (error) {
        console.warn('Audio unavailable', error);
      }
    }

    makeNoise() {
      const length = Math.floor(this.ctx.sampleRate * 1.2);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.22 + white * 0.78;
        data[i] = last;
      }
      return buffer;
    }

    setMuted(muted) {
      this.muted = muted;
      storageSet('pulseDashMuted', muted ? '1' : '0');
      if (this.master && this.ctx) {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.025);
      }
    }

    startRun() {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.stopRun(true);
      this.runGain = this.ctx.createGain();
      this.runGain.gain.value = 0.55;
      this.runGain.connect(this.master);
      this.startTime = this.ctx.currentTime + 0.06;
      this.nextTime = this.startTime;
      this.step = 0;
      this.running = true;
      this.schedule();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.schedule(), 38);
    }

    schedule() {
      if (!this.running || !this.ctx) return;
      const horizon = this.ctx.currentTime + 0.16;
      let guard = 0;
      while (this.nextTime < horizon && guard < 64) {
        this.playStep(this.step, this.nextTime);
        this.nextTime += STEP;
        this.step += 1;
        guard += 1;
      }
    }

    stopRun(immediate = false) {
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
      if (this.runGain && this.ctx) {
        const now = this.ctx.currentTime;
        this.runGain.gain.cancelScheduledValues(now);
        this.runGain.gain.setValueAtTime(this.runGain.gain.value, now);
        this.runGain.gain.linearRampToValueAtTime(0, now + (immediate ? 0.03 : 0.28));
      }
    }

    pause() {
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    }

    resume() {
      if (!this.ctx) return;
      this.ctx.resume().then(() => {
        if (this.runGain && !this.running) {
          this.running = true;
          this.schedule();
          this.timer = setInterval(() => this.schedule(), 38);
        }
      }).catch(() => {});
    }

    midi(note) {
      return 440 * Math.pow(2, (note - 69) / 12);
    }

    osc(type, freq, start, duration, gain, destination = this.runGain) {
      if (!this.ctx || !destination) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      o.connect(g);
      g.connect(destination);
      o.start(start);
      o.stop(start + duration + 0.03);
    }

    noiseHit(start, duration, gain, highpass = 1000, destination = this.runGain) {
      if (!this.ctx || !this.noise || !destination) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = highpass;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      src.connect(filter);
      filter.connect(g);
      g.connect(destination);
      src.start(start);
      src.stop(start + duration + 0.02);
    }

    kick(start, gain = 0.5) {
      if (!this.ctx || !this.runGain) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(165, start);
      o.frequency.exponentialRampToValueAtTime(44, start + 0.11);
      g.gain.setValueAtTime(gain, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.23);
      o.connect(g);
      g.connect(this.runGain);
      o.start(start);
      o.stop(start + 0.26);
    }

    snare(start, gain = 0.16) {
      this.noiseHit(start, 0.15, gain, 1450);
      this.osc('triangle', 185, start, 0.075, 0.055);
    }

    hat(start, open = false, gain = 0.026) {
      this.noiseHit(start, open ? 0.12 : 0.038, gain, 7200);
    }

    pad(start, notes, duration) {
      if (!this.ctx || !this.runGain) return;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1250, start);
      filter.frequency.linearRampToValueAtTime(760, start + duration);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.034, start + 0.16);
      g.gain.setValueAtTime(0.03, start + duration * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      filter.connect(g);
      g.connect(this.runGain);
      notes.forEach((note, i) => {
        const o = this.ctx.createOscillator();
        o.type = i === 0 ? 'sawtooth' : 'triangle';
        o.frequency.value = this.midi(note);
        o.detune.value = i === 1 ? 7 : i === 2 ? -6 : 0;
        const og = this.ctx.createGain();
        og.gain.value = i === 0 ? 0.6 : 0.45;
        o.connect(og);
        og.connect(filter);
        o.start(start);
        o.stop(start + duration + 0.03);
      });
    }

    bass(start, note, duration) {
      if (!this.ctx || !this.runGain) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(340, start);
      filter.frequency.exponentialRampToValueAtTime(135, start + duration);
      o.type = 'sawtooth';
      o.frequency.value = this.midi(note);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.095, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      o.connect(filter);
      filter.connect(g);
      g.connect(this.runGain);
      o.start(start);
      o.stop(start + duration + 0.02);
    }

    arp(start, note, gain = 0.024) {
      this.osc('square', this.midi(note), start, 0.09, gain);
    }

    lead(start, note) {
      if (!this.ctx || !this.runGain) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(this.midi(note), start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.038, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      o.connect(g);
      g.connect(this.runGain);
      o.start(start);
      o.stop(start + 0.32);
    }

    playStep(step, when) {
      const bar = Math.floor(step / 16);
      const pos = step % 16;
      const section = Math.floor(bar / 8);
      const progression = [
        { bass: 33, chord: [57, 60, 64], arp: [69, 72, 76, 79] },
        { bass: 29, chord: [53, 57, 60], arp: [65, 69, 72, 77] },
        { bass: 36, chord: [55, 60, 64], arp: [67, 72, 76, 79] },
        { bass: 31, chord: [55, 59, 62], arp: [67, 71, 74, 79] },
      ];
      const chord = progression[bar % 4];
      const intensity = Math.min(4, section);

      if (pos === 0) {
        this.pad(when, chord.chord, BEAT * 3.75);
        this.kick(when, 0.52);
      }
      if (pos === 4 || pos === 12) {
        this.snare(when, 0.15);
        this.kick(when, pos === 12 ? 0.34 : 0.24);
      }
      if (pos === 8) this.kick(when, 0.45);
      if (intensity >= 2 && pos === 14 && bar % 2 === 1) this.kick(when, 0.3);

      if (pos % 2 === 0) this.hat(when, pos === 14, pos === 14 ? 0.032 : 0.022);
      if (intensity >= 3 && pos % 2 === 1) this.hat(when, false, 0.012);

      if (pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 11 || pos === 14) {
        const offsets = [0, 0, 12, 0, 7, 12];
        const idx = [0, 3, 6, 8, 11, 14].indexOf(pos);
        this.bass(when, chord.bass + offsets[idx], STEP * 1.7);
      }

      if (intensity >= 1 && pos % 2 === 0) {
        const idx = (pos / 2 + bar) % chord.arp.length;
        this.arp(when, chord.arp[idx], intensity >= 3 ? 0.026 : 0.018);
      }

      if (intensity >= 2 && (pos === 0 || pos === 7) && bar % 4 === 3) {
        this.lead(when, chord.arp[(pos === 0 ? 2 : 3)]);
      }
    }

    sfx(kind) {
      this.init();
      if (!this.ctx || !this.master) return;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const now = this.ctx.currentTime + 0.005;
      if (kind === 'perfect') {
        this.osc('sine', 1040, now, 0.14, 0.05, this.master);
        this.osc('sine', 1560, now + 0.035, 0.17, 0.035, this.master);
      } else if (kind === 'good') {
        this.osc('triangle', 760, now, 0.11, 0.038, this.master);
      } else if (kind === 'jump') {
        this.osc('triangle', 480, now, 0.075, 0.028, this.master);
      } else if (kind === 'gem') {
        this.osc('sine', 1180, now, 0.18, 0.05, this.master);
        this.osc('sine', 1770, now + 0.06, 0.22, 0.04, this.master);
      } else if (kind === 'click') {
        this.osc('square', 620, now, 0.04, 0.018, this.master);
      } else if (kind === 'crash') {
        this.noiseHit(now, 0.62, 0.36, 140, this.master);
        this.osc('sawtooth', 180, now, 0.48, 0.16, this.master);
        this.osc('sine', 70, now, 0.55, 0.2, this.master);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* DOM + view                                                         */
  /* ------------------------------------------------------------------ */

  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const ui = {
    editor: $('editorScreen'),
    editorGrid: $('editorGrid'),
    editorRuler: $('editorRuler'),
    editorBpm: $('editorBpm'),
    editorSpeed: $('editorSpeed'),
    hud: $('hud'),
    score: $('score'),
    best: $('bestHud'),
    startBest: $('startBest'),
    beatDots: Array.from($('beatDots').children),
    section: $('sectionLabel'),
    combo: $('combo'),
    comboNum: $('comboNum'),
    judge: $('judge'),
    start: $('startScreen'),
    pause: $('pauseScreen'),
    over: $('overScreen'),
    finalScore: $('finalScore'),
    newBest: $('newBest'),
    statDistance: $('statDistance'),
    statCombo: $('statCombo'),
    statSync: $('statSync'),
    statGems: $('statGems'),
    toast: $('toast'),
    toastTitle: $('toastTitle'),
    toastSub: $('toastSub'),
    flash: $('flash'),
    mute: $('muteBtn'),
    pauseBtn: $('pauseBtn'),
  };

  const view = {
    w: 0,
    h: 0,
    dpr: 1,
    quality: 1,
    renderScale: 1,
    scale: 1,
    groundY: 0,
    playerX: 0,
    horizon: 0,
  };

  const player = {
    y: 0,
    vy: 0,
    onGround: true,
    rot: 0,
    squash: 0,
    glow: 0,
    buffer: 0,
    trailTick: 0,
  };

  const editor = {
    activeTool: 'spike',
    bpm: 126,
    speed: 1,
    beats: new Array(64).fill(null),
  };

  let customLevel = null;

  const game = {
    state: 'menu',
    run: null,
    time: 0,
    menuTime: 0,
    best: Number(storageGet('pulseDashBest', '0')) || 0,
    lastFrame: 0,
    acc: 0,
    perfTime: 0,
    perfFrames: 0,
    toastTimer: null,
    lastScore: -1,
    lastCombo: -1,
    lastTier: -1,
    beatOnTimer: null,
    judgeTimer: null,
  };

  const audio = new PulseAudio();

  const sections = ['WARM UP', 'OVERDRIVE', 'NEON RUSH', 'HYPERDRIVE', 'SINGULARITY'];

  function sectionForBeat(beat) {
    return Math.min(4, Math.floor(beat / 32));
  }

  function speedFactor(beat) {
    return 1 + Math.min(4, Math.floor(beat / 32)) * 0.055;
  }

  let beatPositions = [0];

  function activeBeatDuration(run = null) {
    const bpm = run && run.custom ? clamp(Number(run.custom.bpm) || 126, 60, 180) : BPM;
    return 60 / bpm;
  }

  function activeSpeedMultiplier(run = null) {
    return run && run.custom ? (clamp(Number(run.custom.speed) || 1, 0.5, 2)) : 1;
  }

  function ensureBeatPositions(index, run = null) {
    while (beatPositions.length <= index) {
      const i = beatPositions.length - 1;
      const sectionFactor = run && run.custom ? 1 : speedFactor(i);
      const customFactor = activeSpeedMultiplier(run);
      beatPositions.push(beatPositions[i] + BASE_SPEED * sectionFactor * customFactor * activeBeatDuration(run));
    }
  }

  function beatPosition(beat, run = null) {
    const i = Math.max(0, Math.floor(beat));
    const f = beat - i;
    ensureBeatPositions(i + 1, run);
    return beatPositions[i] + (beatPositions[i + 1] - beatPositions[i]) * f;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const oldGround = view.groundY;
    const oldScale = view.scale;
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.renderScale = Math.max(0.5, view.dpr * view.quality);
    canvas.width = Math.round(view.w * view.renderScale);
    canvas.height = Math.round(view.h * view.renderScale);
    ctx.setTransform(view.renderScale, 0, 0, view.renderScale, 0, 0);
    view.scale = clamp(view.w / 1100, 0.7, 1.05);
    view.groundY = view.h * (view.h < 620 ? 0.78 : 0.775);
    view.horizon = view.groundY - Math.min(220, view.h * 0.26);
    view.playerX = Math.max(82, Math.min(view.w * 0.28, 340));
    if (game.run) {
      const size = PLAYER_SIZE * view.scale;
      const groundCenter = view.groundY - size / 2;
      if (player.onGround) {
        player.y = groundCenter;
      } else {
        player.y += groundCenter - (oldGround - PLAYER_SIZE * oldScale / 2);
        player.y = Math.min(player.y, groundCenter);
      }
    }
    buildBackdrop();
  }

  function applyRenderScale() {
    view.renderScale = Math.max(0.5, view.dpr * view.quality);
    canvas.width = Math.round(view.w * view.renderScale);
    canvas.height = Math.round(view.h * view.renderScale);
    ctx.setTransform(view.renderScale, 0, 0, view.renderScale, 0, 0);
    buildGradients();
  }

  /* ------------------------------------------------------------------ */
  /* Backdrop data                                                      */
  /* ------------------------------------------------------------------ */

  let stars = [];
  let cityFar = [];
  let cityNear = [];
  let streaks = [];
  let motes = [];
  const CITY_TILE = 1900;

  function buildBackdrop() {
    const rng = mulberry32(90210);
    stars = Array.from({ length: Math.round(view.w / 9) + 40 }, () => ({
      x: rng(),
      y: Math.pow(rng(), 1.25) * 0.62,
      r: 0.5 + rng() * 1.35,
      depth: 0.2 + rng() * 0.8,
      phase: rng() * TAU,
      speed: 0.4 + rng() * 1.5,
      warm: rng() > 0.86,
    }));

    cityFar = makeCity(4411, 150, 95, 28, 0.56);
    cityNear = makeCity(8823, 150, 62, 14, 0.8);
    streaks = Array.from({ length: 26 }, () => ({
      x: rng(),
      y: 0.12 + rng() * 0.66,
      len: 24 + rng() * 150,
      speed: 0.2 + rng() * 1.1,
      alpha: 0.03 + rng() * 0.12,
      pink: rng() > 0.55,
    }));
    motes = Array.from({ length: 34 }, () => ({
      x: rng(),
      y: rng(),
      size: 0.7 + rng() * 2,
      phase: rng() * TAU,
      drift: 0.1 + rng() * 0.5,
    }));
    buildGradients();
  }

  function makeCity(seed, tile, maxHeight, minHeight, opacity) {
    const rng = mulberry32(seed);
    const buildings = [];
    let x = 0;
    while (x < CITY_TILE) {
      const w = 22 + rng() * 58;
      const h = minHeight + rng() * (maxHeight - minHeight);
      const windows = [];
      const cols = Math.max(1, Math.floor(w / 13));
      const rows = Math.max(1, Math.floor(h / 16));
      for (let cy = 0; cy < rows; cy += 1) {
        for (let cx = 0; cx < cols; cx += 1) {
          if (rng() > 0.55) {
            windows.push({
              x: 4 + cx * (w - 8) / cols,
              y: 8 + cy * (h - 10) / rows,
              w: 2.2,
              h: 2.6,
              warm: rng() > 0.45,
              flicker: rng() * TAU,
            });
          }
        }
      }
      buildings.push({ x, w, h, windows, antenna: rng() > 0.72, opacity });
      x += w + 3 + rng() * 15;
    }
    return buildings;
  }

  /* ------------------------------------------------------------------ */
  /* Track generation                                                   */
  /* ------------------------------------------------------------------ */

  const PATTERN_POOL = [
    { taps: [1, 0, 1, 0], gates: [0, 1, 0, 1] },
    { taps: [0, 1, 0, 1], gates: [1, 0, 1, 0] },
    { taps: [1, 1, 0, 1], gates: [0, 0, 1, 0] },
    { taps: [1, 0, 1, 1], gates: [0, 1, 0, 0] },
    { taps: [1, 1, 1, 0], gates: [0, 0, 0, 1] },
    { taps: [0, 1, 1, 0], gates: [1, 0, 0, 1] },
    { taps: [1, 0, 0, 1], gates: [0, 1, 1, 0] },
    { taps: [1, 1, 1, 1], gates: [0, 0, 0, 0] },
    { taps: [1, 0, 1, 0], gates: [0, 0, 0, 0] },
    { taps: [0, 1, 0, 1], gates: [0, 0, 0, 0] },
    { taps: [1, 1, 0, 0], gates: [0, 0, 1, 1] },
    { taps: [0, 0, 1, 1], gates: [1, 1, 0, 0] },
  ];

  const EARLY_PATTERNS = [
    { taps: [0, 0, 0, 1], gates: [0, 0, 0, 0] },
    { taps: [1, 0, 1, 0], gates: [0, 0, 0, 0] },
    { taps: [1, 0, 1, 0], gates: [0, 0, 0, 0] },
    { taps: [1, 0, 1, 0], gates: [0, 1, 0, 0] },
    { taps: [0, 1, 0, 1], gates: [1, 0, 1, 0] },
    { taps: [1, 1, 1, 1], gates: [0, 0, 0, 0] },
    { taps: [1, 1, 0, 1], gates: [0, 0, 1, 0] },
    { taps: [0, 1, 1, 0], gates: [1, 0, 0, 1] },
  ];

  function createRun() {
    beatPositions = [0];
    const run = {
      time: 0,
      beat: 0,
      worldPos: 0,
      lastBeat: -1,
      score: 0,
      combo: 0,
      maxCombo: 0,
      jumps: 0,
      perfects: 0,
      goods: 0,
      gems: 0,
      obstacles: [],
      collectibles: [],
      particles: [],
      rings: [],
      floats: [],
      generatedBar: 0,
      seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
      lastPattern: -1,
      shake: 0,
      pulse: 0,
      deathTimer: 0,
      deathCause: null,
      tipGate: false,
      tipStart: false,
      tier: 0,
    };
    player.y = view.groundY - (PLAYER_SIZE * view.scale) / 2;
    player.vy = 0;
    player.onGround = true;
    player.rot = 0;
    player.squash = 0;
    player.glow = 0;
    player.buffer = 0;
    player.trailTick = 0;
    return run;
  }

  function pickPattern(bar, run) {
    if (bar < EARLY_PATTERNS.length) return EARLY_PATTERNS[bar];
    const rng = mulberry32((run.seed + bar * 7919) >>> 0);
    let idx = Math.floor(rng() * PATTERN_POOL.length);
    if (idx === run.lastPattern) idx = (idx + 1 + Math.floor(rng() * (PATTERN_POOL.length - 1))) % PATTERN_POOL.length;
    run.lastPattern = idx;
    return PATTERN_POOL[idx];
  }

  function generateBar(run, bar) {
    const pattern = pickPattern(bar, run);
    const rng = mulberry32((run.seed + bar * 104729) >>> 0);
    const tier = Math.min(4, Math.floor(bar / 8));
    const barBeat = bar * 4;

    for (let i = 0; i < 4; i += 1) {
      if (pattern.taps[i]) {
        const beat = barBeat + i + 0.5;
        const wx = beatPosition(beat);
        let variant = 'spike';
        const roll = rng();
        if (tier >= 1 && roll > 0.79) variant = 'double';
        else if (tier >= 2 && roll > 0.66) variant = 'block';
        else if (tier >= 1 && roll > 0.5) variant = 'tall';
        const obstacle = {
          type: 'spike',
          variant,
          wx,
          beat,
          passed: false,
          label: bar === 0 && i === 3 ? 'TAP' : '',
        };
        run.obstacles.push(obstacle);

        if (bar >= 2 && rng() > 0.68) {
          run.collectibles.push({
            wx,
            height: 124,
            collected: false,
            phase: rng() * TAU,
          });
        }
      }
      if (pattern.gates[i]) {
        const beat = barBeat + i + 0.5;
        run.obstacles.push({
          type: 'gate',
          wx: beatPosition(beat),
          beat,
          width: BASE_SPEED * speedFactor(beat) * BEAT * 0.6,
          passed: false,
          label: bar === 3 && i === 1 ? 'STAY LOW' : '',
        });
      }
    }

    if (bar === 1 && !run.collectibles.some((gem) => Math.abs(gem.wx - beatPosition(6.5)) < 1)) {
      run.collectibles.push({
        wx: beatPosition(6.5),
        height: 124,
        collected: false,
        phase: 1.2,
      });
    }
  }

  function ensureCustomTrackAhead(run) {
    if (!run.custom) return false;
    for (let i = 0; i < run.custom.beats.length; i += 1) {
      const type = run.custom.beats[i];
      if (!type) continue;
      if (type === 'gem') {
        if (!run.collectibles.some((gem) => gem.beat === i)) {
          run.collectibles.push({ wx: beatPosition(i + 0.5, run), height: 124, collected: false, phase: i * 0.73, beat: i });
        }
      } else if (!run.obstacles.some((obs) => obs.beat === i)) {
        const variant = type === 'spike' || type === 'double' || type === 'tall' || type === 'block' ? type : 'spike';
        if (type === 'gate') {
          run.obstacles.push({ type: 'gate', wx: beatPosition(i + 0.5, run), beat: i, width: BASE_SPEED * activeSpeedMultiplier(run) * activeBeatDuration(run) * 0.6, passed: false });
        } else {
          run.obstacles.push({ type: 'spike', variant, wx: beatPosition(i + 0.5, run), beat: i, passed: false });
        }
      }
    }
    return true;
  }

  function ensureTrackAhead(run) {
    const targetBar = Math.floor(run.beat / 4) + 9;
    while (run.generatedBar < targetBar) {
      generateBar(run, run.generatedBar);
      run.generatedBar += 1;
    }
  }

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                         */
  /* ------------------------------------------------------------------ */

  function openEditor() {
    if (game.state === 'playing' || game.state === 'paused') togglePause();
    ui.editor.classList.add('is-visible');
    ui.editor.setAttribute('aria-hidden', 'false');
    buildEditorGrid();
  }

  function closeEditor() {
    ui.editor.classList.remove('is-visible');
    ui.editor.setAttribute('aria-hidden', 'true');
  }

  function buildEditorGrid() {
    ui.editorGrid.innerHTML = '';
    ui.editorRuler.innerHTML = '';
    for (let i = 0; i < 64; i += 1) {
      if (i % 4 === 0) {
        const ruler = document.createElement('span');
        ruler.textContent = String(i / 4 + 1).padStart(2, '0');
        ui.editorRuler.appendChild(ruler);
      }
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'editor-cell';
      cell.dataset.beat = String(i);
      cell.setAttribute('role', 'gridcell');
      if (i % 4 === 0) cell.classList.add('bar-start');
      if (editor.beats[i]) {
        cell.classList.add('has-tile', `tile-${editor.beats[i]}`);
        cell.dataset.type = editor.beats[i];
      }
      cell.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const beat = Number(cell.dataset.beat);
        if (editor.activeTool === 'erase') {
          editor.beats[beat] = null;
        } else {
          editor.beats[beat] = editor.activeTool;
        }
        buildEditorGrid();
      });
      ui.editorGrid.appendChild(cell);
    }
  }

  function selectEditorTool(tool) {
    editor.activeTool = tool;
    document.querySelectorAll('.tile-tool').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === tool);
    });
  }

  function getEditorProject() {
    return {
      version: 1,
      bpm: clamp(Number(ui.editorBpm.value) || 126, 60, 180),
      speed: Number(ui.editorSpeed.value) || 1,
      beats: editor.beats.map((type) => type || null),
    };
  }

  function loadEditorProject(project) {
    if (!project || !Array.isArray(project.beats) || project.beats.length !== 64) throw new Error('Invalid level project');
    const allowed = new Set(['spike', 'double', 'tall', 'block', 'gate', 'gem']);
    editor.beats = project.beats.map((type) => allowed.has(type) ? type : null);
    editor.bpm = clamp(Number(project.bpm) || 126, 60, 180);
    editor.speed = clamp(Number(project.speed) || 1, 0.5, 2);
    ui.editorBpm.value = editor.bpm;
    ui.editorSpeed.value = [0.85, 1, 1.15, 1.3].includes(editor.speed) ? String(editor.speed) : '1';
    buildEditorGrid();
  }

  function saveEditorProject() {
    const project = getEditorProject();
    localStorage.setItem('pulseDashEditorLevel', JSON.stringify(project));
    showToast('LEVEL SAVED', 'Stored in this browser', 1800);
  }

  function setScreen(name) {
    const map = { menu: ui.start, pause: ui.pause, over: ui.over };
    [ui.start, ui.pause, ui.over].forEach((screen) => {
      const active = map[name] === screen;
      screen.classList.toggle('is-visible', active);
      screen.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    document.body.classList.toggle('paused', name === 'pause');
    document.body.classList.toggle('gameover', name === 'over');
    document.body.classList.toggle('playing', name === 'game' || name === 'pause');
    document.body.classList.toggle('menu', name === 'menu');
    if (name === 'menu') {
      ui.pauseBtn.style.display = '';
      document.body.classList.remove('playing');
    }
  }

  function showToast(title, sub, duration = 2200) {
    ui.toastTitle.textContent = title;
    ui.toastSub.textContent = sub || '';
    ui.toast.classList.add('show');
    clearTimeout(game.toastTimer);
    game.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), duration);
  }

  function hideToast() {
    clearTimeout(game.toastTimer);
    ui.toast.classList.remove('show');
  }

  function showJudge(text, kind) {
    ui.judge.textContent = text;
    ui.judge.className = `judge ${kind}`;
    void ui.judge.offsetWidth;
    ui.judge.classList.add('pop');
    clearTimeout(game.judgeTimer);
    game.judgeTimer = setTimeout(() => {
      ui.judge.classList.remove('pop');
    }, 520);
  }

  function updateScoreUI(force = false) {
    const run = game.run;
    const score = run ? Math.floor(run.score) : 0;
    if (force || score !== game.lastScore) {
      game.lastScore = score;
      ui.score.textContent = formatScore(score);
    }
    if (force) {
      ui.best.textContent = formatNumber(game.best);
      ui.startBest.textContent = formatScore(game.best);
    }
  }

  function updateComboUI(force = false) {
    const run = game.run;
    const combo = run ? run.combo : 0;
    if (force || combo !== game.lastCombo) {
      game.lastCombo = combo;
      ui.comboNum.textContent = combo;
      ui.combo.classList.toggle('show', combo >= 2);
    }
  }

  function updateSectionUI(tier) {
    if (tier === game.lastTier) return;
    game.lastTier = tier;
    ui.section.textContent = sections[tier];
  }

  function pulseBeatHud(beat) {
    const index = mod(Math.floor(beat), 4);
    ui.beatDots.forEach((dot, i) => {
      dot.classList.toggle('downbeat', i === 0);
      if (i === index) {
        dot.classList.add('on');
        clearTimeout(game.beatOnTimer);
        game.beatOnTimer = setTimeout(() => dot.classList.remove('on'), 115);
      }
    });
    updateSectionUI(sectionForBeat(beat));
  }

  function multiplier() {
    const run = game.run;
    return 1 + Math.min(20, run ? run.combo : 0) * 0.05;
  }

  function addScore(amount) {
    if (!game.run) return;
    game.run.score += Math.max(0, amount);
  }

  /* ------------------------------------------------------------------ */
  /* Game flow                                                          */
  /* ------------------------------------------------------------------ */

  function startRun(level = null) {
    game.run = createRun();
    if (level) {
      game.run.custom = level;
      beatPositions = [0];
      ensureCustomTrackAhead(game.run);
    }
    game.state = 'playing';
    game.lastScore = -1;
    game.lastCombo = -1;
    game.lastTier = -1;
    ensureTrackAhead(game.run);
    setScreen('game');
    ui.judge.classList.remove('pop');
    ui.combo.classList.remove('show');
    updateScoreUI(true);
    updateComboUI(true);
    updateSectionUI(0);
    hideToast();
    document.body.classList.add('playing');
    audio.startRun();
    audio.sfx('click');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    showToast('TAP THE BEAT', 'Every jump lands on the pulse', 2400);
    game.run.tipStart = true;
    game.lastFrame = performance.now();
    game.acc = 0;
  }

  function goMenu() {
    game.state = 'menu';
    audio.stopRun();
    hideToast();
    ui.judge.classList.remove('pop');
    ui.combo.classList.remove('show');
    setScreen('menu');
    updateScoreUI(true);
    game.run = null;
    document.body.classList.remove('playing');
    game.lastFrame = performance.now();
  }

  function togglePause() {
    if (game.state === 'playing') {
      game.state = 'paused';
      audio.pause();
      setScreen('pause');
      hideToast();
    } else if (game.state === 'paused') {
      game.state = 'playing';
      audio.resume();
      setScreen('game');
      game.lastFrame = performance.now();
    }
  }

  function die(cause) {
    if (game.state !== 'playing' || !game.run) return;
    if (new URLSearchParams(window.location.search).get('god') === '1') return;
    game.state = 'dying';
    const run = game.run;
    run.deathTimer = 0;
    run.deathCause = cause;
    run.shake = 20;
    spawnDeathBurst(run);
    audio.sfx('crash');
    audio.stopRun();
    ui.combo.classList.remove('show');
    ui.judge.classList.remove('pop');
    hideToast();
    ui.flash.classList.add('hit');
    setTimeout(() => ui.flash.classList.remove('hit'), 80);
  }

  function showGameOver() {
    const run = game.run;
    if (!run) return;
    game.state = 'gameover';
    const score = Math.floor(run.score);
    const isBest = score > game.best;
    if (isBest) {
      game.best = score;
      storageSet('pulseDashBest', String(game.best));
    }
    ui.finalScore.textContent = formatNumber(score);
    ui.newBest.classList.toggle('show', isBest);
    ui.statDistance.textContent = `${formatNumber(run.worldPos / 9)} m`;
    ui.statCombo.textContent = formatNumber(run.maxCombo);
    ui.statSync.textContent = `${run.jumps ? Math.round((run.perfects / run.jumps) * 100) : 0}%`;
    ui.statGems.textContent = formatNumber(run.gems);
    ui.best.textContent = formatNumber(game.best);
    ui.startBest.textContent = formatScore(game.best);
    setScreen('over');
    audio.sfx(isBest ? 'gem' : 'click');
  }

  function toggleMute() {
    audio.setMuted(!audio.muted);
    ui.mute.classList.toggle('muted', audio.muted);
    ui.mute.setAttribute('aria-label', audio.muted ? 'Unmute audio' : 'Mute audio');
  }

  /* ------------------------------------------------------------------ */
  /* Player + physics                                                   */
  /* ------------------------------------------------------------------ */

  function jumpQuality() {
    const run = game.run;
    const nearest = Math.round(run.beat);
    const ms = Math.abs(run.beat - nearest) * BEAT * 1000;
    if (ms <= 80) return 'perfect';
    if (ms <= 165) return 'good';
    return 'off';
  }

  function doJump() {
    const run = game.run;
    if (!run || game.state !== 'playing') return;
    const scale = view.scale;
    player.onGround = false;
    player.vy = -JUMP_V * scale;
    player.buffer = 0;
    player.squash = 0;
    player.rot = 0;
    player.glow = 1;
    run.jumps += 1;
    const quality = jumpQuality();
    if (quality === 'perfect') {
      run.perfects += 1;
      run.combo += 1;
      addScore(300 * multiplier());
      showJudge('PERFECT', 'perfect');
      audio.sfx('perfect');
    } else if (quality === 'good') {
      run.goods += 1;
      run.combo += 1;
      addScore(130 * multiplier());
      showJudge('ON BEAT', 'good');
      audio.sfx('good');
    } else {
      run.combo = 0;
      addScore(20);
      showJudge('OFFBEAT', 'miss');
      audio.sfx('jump');
    }
    run.maxCombo = Math.max(run.maxCombo, run.combo);
    updateComboUI();
    spawnJumpDust(run);
  }

  function requestJump() {
    if (game.state !== 'playing') return;
    if (player.onGround) doJump();
    else player.buffer = 0.11;
  }

  function updatePlayer(dt) {
    const run = game.run;
    const scale = view.scale;
    const size = PLAYER_SIZE * scale;
    const groundCenter = view.groundY - size / 2;
    player.glow = Math.max(0, player.glow - dt * 4);
    player.squash = Math.max(0, player.squash - dt * 7);
    if (player.buffer > 0) player.buffer -= dt;

    if (player.onGround) {
      player.y = groundCenter;
      player.vy = 0;
      player.rot = 0;
      if (player.buffer > 0) doJump();
    } else {
      player.vy += GRAVITY * scale * dt;
      player.y += player.vy * dt;
      player.rot += dt * 12.2;
      player.trailTick += dt;
      if (player.trailTick > 0.026) {
        player.trailTick = 0;
        spawnTrailParticle(run);
      }
      if (player.y >= groundCenter) {
        player.y = groundCenter;
        player.vy = 0;
        player.onGround = true;
        player.rot = 0;
        player.squash = 1;
        spawnLandDust(run);
        if (player.buffer > 0) doJump();
      }
    }
  }

  function updateObstacles(run, dt) {
    const scale = view.scale;
    const playerSize = PLAYER_SIZE * scale;
    const pbox = {
      x: view.playerX - playerSize * 0.35,
      y: player.y - playerSize * 0.35,
      w: playerSize * 0.7,
      h: playerSize * 0.7,
    };
    const groundY = view.groundY;
    const px = view.playerX;

    for (let i = 0; i < run.obstacles.length; i += 1) {
      const obs = run.obstacles[i];
      const sx = px + (obs.wx - run.worldPos) * scale;
      if (sx < -160 || sx > view.w + 160) continue;

      if (obs.type === 'spike') {
        let h = 46 * scale;
        let w = 42 * scale;
        if (obs.variant === 'tall') h = 61 * scale;
        if (obs.variant === 'double') w = 68 * scale;
        if (obs.variant === 'block') {
          const bw = 54 * scale;
          const bh = 44 * scale;
          const box = { x: sx - bw * 0.42, y: groundY - bh + 2 * scale, w: bw * 0.84, h: bh - 3 * scale };
          if (overlap(pbox, box)) {
            die(obs);
            return;
          }
        } else {
          const box = { x: sx - w * 0.3, y: groundY - h + 5 * scale, w: w * 0.6, h: h - 7 * scale };
          if (overlap(pbox, box)) {
            die(obs);
            return;
          }
        }
      } else if (obs.type === 'gate') {
        const beamW = obs.width * scale;
        const box = {
          x: sx - beamW * 0.45,
          y: groundY - 112 * scale,
          w: beamW * 0.9,
          h: 16 * scale,
        };
        if (overlap(pbox, box)) {
          die(obs);
          return;
        }
      }
    }

    for (let i = 0; i < run.collectibles.length; i += 1) {
      const gem = run.collectibles[i];
      if (gem.collected) continue;
      const gx = px + (gem.wx - run.worldPos) * scale;
      if (gx < -80 || gx > view.w + 80) continue;
      const gy = groundY - gem.height * scale;
      if (Math.abs(gx - px) < 31 * scale && Math.abs(gy - player.y) < 42 * scale) {
        gem.collected = true;
        run.gems += 1;
        addScore(420 * multiplier());
        audio.sfx('gem');
        spawnGemBurst(run, gx, gy);
        run.floats.push({ x: gx, y: gy, life: 0.8, max: 0.8, text: '+GEM', color: '#ffe36e' });
        updateScoreUI();
      }
    }

    if (run.obstacles.length > 90) {
      run.obstacles = run.obstacles.filter((o) => o.wx > run.worldPos - 500);
    }
    if (run.collectibles.length > 40) {
      run.collectibles = run.collectibles.filter((g) => !g.collected && g.wx > run.worldPos - 300);
    }
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function onBeat(beat) {
    const run = game.run;
    if (!run) return;
    run.lastBeat = beat;
    const down = mod(beat, 4) === 0;
    run.pulse = 1;
    addScore(7 * multiplier());
    pulseBeatHud(beat);
    run.rings.push({
      x: view.playerX,
      y: player.y,
      r: down ? 18 : 12,
      max: down ? 125 : 76,
      life: down ? 0.62 : 0.4,
      maxLife: down ? 0.62 : 0.4,
      color: down ? '#ff3ca6' : '#5cf8ff',
      width: down ? 2.6 : 1.4,
    });
    if (down) {
      for (let i = 0; i < 3; i += 1) {
        run.particles.push({
          x: view.playerX + (Math.random() - 0.5) * 30,
          y: view.groundY - 2,
          vx: -40 - Math.random() * 80,
          vy: -20 - Math.random() * 50,
          gravity: 90,
          size: 2 + Math.random() * 2,
          life: 0.35 + Math.random() * 0.2,
          maxLife: 0.55,
          color: i === 0 ? '#ff3ca6' : '#5cf8ff',
          shape: 'spark',
          rot: 0,
          vr: 0,
        });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Particles                                                          */
  /* ------------------------------------------------------------------ */

  function spawnJumpDust(run) {
    const s = view.scale;
    for (let i = 0; i < 8; i += 1) {
      run.particles.push({
        x: view.playerX + (Math.random() - 0.5) * 34 * s,
        y: view.groundY - Math.random() * 4,
        vx: -70 - Math.random() * 110,
        vy: -12 - Math.random() * 55,
        gravity: 240,
        size: (1.4 + Math.random() * 3) * s,
        life: 0.3 + Math.random() * 0.28,
        maxLife: 0.58,
        color: Math.random() > 0.45 ? '#5cf8ff' : '#ffffff',
        shape: 'spark',
        rot: 0,
        vr: 0,
      });
    }
  }

  function spawnLandDust(run) {
    const s = view.scale;
    for (let i = 0; i < 12; i += 1) {
      run.particles.push({
        x: view.playerX + (Math.random() - 0.5) * 42 * s,
        y: view.groundY - 2,
        vx: (Math.random() - 0.5) * 210 - 30,
        vy: -20 - Math.random() * 95,
        gravity: 360,
        size: (1.5 + Math.random() * 3.2) * s,
        life: 0.26 + Math.random() * 0.32,
        maxLife: 0.58,
        color: Math.random() > 0.5 ? '#5cf8ff' : '#ff3ca6',
        shape: 'spark',
        rot: 0,
        vr: 0,
      });
    }
  }

  function spawnTrailParticle(run) {
    const s = view.scale;
    run.particles.push({
      x: view.playerX - 12 * s + (Math.random() - 0.5) * 8,
      y: player.y + (Math.random() - 0.5) * 16 * s,
      vx: -90 - Math.random() * 70,
      vy: (Math.random() - 0.5) * 40,
      gravity: 0,
      size: (1 + Math.random() * 2.2) * s,
      life: 0.28,
      maxLife: 0.28,
      color: Math.random() > 0.35 ? '#5cf8ff' : '#ffffff',
      shape: 'square',
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 7,
    });
  }

  function spawnGemBurst(run, x, y) {
    for (let i = 0; i < 16; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 50 + Math.random() * 170;
      run.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 150,
        size: 1.5 + Math.random() * 2.5,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        color: Math.random() > 0.4 ? '#ffe36e' : '#ffffff',
        shape: Math.random() > 0.5 ? 'diamond' : 'spark',
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 10,
      });
    }
  }

  function spawnDeathBurst(run) {
    const s = view.scale;
    const size = PLAYER_SIZE * s;
    for (let i = 0; i < 30; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 90 + Math.random() * 460;
      run.particles.push({
        x: view.playerX + (Math.random() - 0.5) * size,
        y: player.y + (Math.random() - 0.5) * size,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        gravity: 700,
        size: (2.5 + Math.random() * 7) * s,
        life: 0.55 + Math.random() * 0.55,
        maxLife: 1.1,
        color: Math.random() > 0.5 ? '#5cf8ff' : Math.random() > 0.5 ? '#ff3ca6' : '#ffffff',
        shape: 'square',
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 15,
      });
    }
    for (let i = 0; i < 12; i += 1) {
      run.rings.push({
        x: view.playerX,
        y: player.y,
        r: 8,
        max: 80 + Math.random() * 150,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1,
        color: i % 2 ? '#ff3ca6' : '#5cf8ff',
        width: 2,
      });
    }
  }

  function updateParticles(run, dt) {
    const speed = BASE_SPEED * view.scale * speedFactor(run.beat);
    for (let i = run.particles.length - 1; i >= 0; i -= 1) {
      const p = run.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        run.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += (p.vx - speed * 0.18) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = run.rings.length - 1; i >= 0; i -= 1) {
      const ring = run.rings[i];
      ring.life -= dt;
      if (ring.life <= 0) {
        run.rings.splice(i, 1);
        continue;
      }
      const progress = 1 - ring.life / ring.maxLife;
      ring.r = lerp(ring.r, ring.max, Math.min(1, dt * (4 + progress * 5)));
    }
    for (let i = run.floats.length - 1; i >= 0; i -= 1) {
      const f = run.floats[i];
      f.life -= dt;
      f.y -= 34 * dt;
      if (f.life <= 0) run.floats.splice(i, 1);
    }
  }

  function update(dt) {
    const run = game.run;
    if (!run) return;
    run.time += dt;
    run.beat = run.time / activeBeatDuration(run);
    run.worldPos = beatPosition(run.beat, run);
    run.pulse = Math.max(0, run.pulse - dt * 5);
    run.shake = Math.max(0, run.shake - dt * 45);
    const tier = sectionForBeat(run.beat);
    if (tier !== run.tier) {
      run.tier = tier;
      updateSectionUI(tier);
      if (tier > 0) showToast(sections[tier], 'The track is speeding up', 1700);
    }

    updatePlayer(dt);
    updateObstacles(run, dt);
    if (game.state !== 'playing') return;

    if (!ensureCustomTrackAhead(run)) ensureTrackAhead(run);
    updateParticles(run, dt);

    const currentBeat = Math.floor(run.beat);
    while (run.lastBeat < currentBeat) {
      run.lastBeat += 1;
      onBeat(run.lastBeat);
    }

    if (!run.tipGate && run.beat > 11.4) {
      run.tipGate = true;
      showToast('STAY LOW', "Don't jump under the laser", 2100);
    }

    updateScoreUI();
    updateComboUI();
  }

  function updateDying(dt) {
    const run = game.run;
    if (!run) return;
    run.deathTimer += dt;
    run.shake = Math.max(0, run.shake - dt * 30);
    updateParticles(run, dt);
    if (run.deathTimer > 0.82) showGameOver();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering — backdrop                                               */
  /* ------------------------------------------------------------------ */

  let skyGradient = null;
  let floorGradient = null;
  let hazeGradient = null;
  let sunGlowGradient = null;
  let sunGradient = null;
  let horizonGradient = null;
  let lowerGlowGradient = null;
  let sun = { x: 0, y: 0, r: 100 };

  function buildGradients() {
    const w = view.w;
    const h = view.h;
    const groundY = view.groundY;
    const depth = h - groundY;
    const sunR = clamp(Math.min(w, h) * 0.145, 58, 132);
    sun = { x: w * 0.72, y: groundY - sunR * 0.85 - 30, r: sunR };

    skyGradient = ctx.createLinearGradient(0, 0, 0, groundY + 20);
    skyGradient.addColorStop(0, '#04010d');
    skyGradient.addColorStop(0.42, '#0b0520');
    skyGradient.addColorStop(0.72, '#1b0735');
    skyGradient.addColorStop(1, '#2a0942');

    hazeGradient = ctx.createRadialGradient(w * 0.7, groundY - 50, 10, w * 0.7, groundY - 50, w * 0.6);
    hazeGradient.addColorStop(0, 'rgba(255,60,166,0.1)');
    hazeGradient.addColorStop(0.5, 'rgba(92,248,255,0.025)');
    hazeGradient.addColorStop(1, 'rgba(4,1,13,0)');

    sunGlowGradient = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.2, sun.x, sun.y, sun.r * 2.4);
    sunGlowGradient.addColorStop(0, 'rgba(255,92,180,0.22)');
    sunGlowGradient.addColorStop(0.5, 'rgba(255,60,166,0.07)');
    sunGlowGradient.addColorStop(1, 'rgba(255,60,166,0)');

    sunGradient = ctx.createLinearGradient(0, sun.y - sun.r, 0, sun.y + sun.r);
    sunGradient.addColorStop(0, '#ffe98a');
    sunGradient.addColorStop(0.42, '#ffb26e');
    sunGradient.addColorStop(0.72, '#ff4c9d');
    sunGradient.addColorStop(1, '#b42cff');

    floorGradient = ctx.createLinearGradient(0, 0, 0, depth);
    floorGradient.addColorStop(0, '#100826');
    floorGradient.addColorStop(0.35, '#080316');
    floorGradient.addColorStop(1, '#020108');

    horizonGradient = ctx.createLinearGradient(0, groundY - 28, 0, groundY + 4);
    horizonGradient.addColorStop(0, 'rgba(255,60,166,0)');
    horizonGradient.addColorStop(0.62, 'rgba(255,60,166,0.13)');
    horizonGradient.addColorStop(1, 'rgba(92,248,255,0.12)');

    lowerGlowGradient = ctx.createLinearGradient(0, groundY, 0, groundY + 100);
    lowerGlowGradient.addColorStop(0, 'rgba(92,248,255,0.04)');
    lowerGlowGradient.addColorStop(1, 'rgba(92,248,255,0)');
  }

  function drawBackground(time, beat, activeRun) {
    const w = view.w;
    const h = view.h;
    const groundY = view.groundY;
    const scale = view.scale;
    const distance = activeRun ? activeRun.worldPos * scale : game.menuTime * 46;
    const pulse = activeRun ? Math.max(0, 1 - mod(activeRun.beat, 1) * 3.6) : 0.35 + Math.sin(time * 2.1) * 0.18;

    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, w, groundY + 2);
    ctx.fillStyle = hazeGradient;
    ctx.fillRect(0, 0, w, groundY);

    // stars
    const low = view.quality < 0.7;
    ctx.save();
    for (let i = 0; i < stars.length; i += (low ? 2 : 1)) {
      const star = stars[i];
      const sx = mod(star.x * w - distance * star.depth * 0.045, w + 20) - 10;
      const sy = star.y * groundY;
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * star.speed + star.phase));
      ctx.globalAlpha = twinkle * (0.28 + star.depth * 0.55);
      ctx.fillStyle = star.warm ? '#ffc6e4' : '#c7f8ff';
      ctx.fillRect(sx, sy, star.r, star.r);
    }
    ctx.restore();

    // sun
    ctx.fillStyle = sunGlowGradient;
    ctx.fillRect(sun.x - sun.r * 2.5, sun.y - sun.r * 2.5, sun.r * 5, sun.r * 5);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = sunGradient;
    ctx.fillRect(sun.x - sun.r, sun.y - sun.r, sun.r * 2, sun.r * 2);
    ctx.fillStyle = 'rgba(7,2,19,0.86)';
    const stripeStart = sun.y + sun.r * 0.08;
    for (let i = 0; i < 8; i += 1) {
      const sy = stripeStart + i * sun.r * 0.115;
      ctx.fillRect(sun.x - sun.r, sy, sun.r * 2, 2 + i * 1.3);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,164,218,0.38)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.r + 1.5, 0, TAU);
    ctx.stroke();

    // speed streaks
    ctx.save();
    for (let i = 0; i < streaks.length; i += (view.quality < 0.7 ? 2 : 1)) {
      const s = streaks[i];
      const x = mod(s.x * (w + 300) - distance * s.speed * 0.55 - time * 12, w + 300) - 150;
      const y = view.horizon + s.y * (groundY - view.horizon);
      ctx.globalAlpha = s.alpha * (activeRun ? 1 : 0.5);
      ctx.strokeStyle = s.pink ? '#ff3ca6' : '#5cf8ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s.len, y);
      ctx.stroke();
    }
    ctx.restore();

    drawCityDirect(cityFar, distance * 0.1, '#170b38', 0.8, 1);
    drawCityDirect(cityNear, distance * 0.23, '#0d0624', 1, 2);

    ctx.fillStyle = horizonGradient;
    ctx.fillRect(0, groundY - 28, w, 32);

    drawFloorDirect(distance, time, pulse);
    drawMotes(time, distance);
  }

  function drawCityDirect(buildings, offset, color, alpha, layer) {
    const groundY = view.groundY;
    const start = -mod(offset, CITY_TILE);
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let copy = 0; copy < 2; copy += 1) {
      const baseX = start + copy * CITY_TILE;
      for (let i = 0; i < buildings.length; i += 1) {
        const b = buildings[i];
        const x = baseX + b.x;
        if (x > view.w + 60 || x + b.w < -60) continue;
        const y = groundY - b.h;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, b.w, b.h + 1);
        ctx.fillStyle = layer === 1 ? 'rgba(255,255,255,0.035)' : 'rgba(92,248,255,0.05)';
        ctx.fillRect(x, y, b.w, 1);
        if (b.antenna) {
          ctx.fillStyle = layer === 1 ? 'rgba(255,60,166,0.3)' : 'rgba(255,60,166,0.55)';
          ctx.fillRect(x + b.w * 0.62, y - 10, 1, 10);
          ctx.fillRect(x + b.w * 0.62 - 1, y - 11, 3, 2);
        }
        const maxWindows = view.quality < 0.7 ? 2 : 7;
        for (let j = 0; j < b.windows.length; j += 1) {
          if (j >= maxWindows) break;
          const win = b.windows[j];
          ctx.fillStyle = win.warm ? 'rgba(255,203,122,0.28)' : 'rgba(255,111,190,0.28)';
          ctx.fillRect(x + win.x, y + win.y, win.w, win.h);
        }
      }
    }
    ctx.restore();
  }

  function drawFloorDirect(distance, time, pulse) {
    const w = view.w;
    const h = view.h;
    const groundY = view.groundY;
    const depth = h - groundY;

    ctx.fillStyle = floorGradient;
    ctx.fillRect(0, groundY, w, depth + 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, groundY, w, depth);
    ctx.clip();

    for (let i = 1; i <= 9; i += 1) {
      const t = i / 9;
      const y = groundY + depth * Math.pow(t, 1.9);
      ctx.globalAlpha = 0.06 + t * 0.07;
      ctx.strokeStyle = i % 2 ? '#ff3ca6' : '#5cf8ff';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const horizonX = w * 0.5;
    const spacing = Math.max(88, w / (view.quality < 0.7 ? 6 : 9));
    const shift = mod(distance * 0.24, spacing);
    ctx.strokeStyle = `rgba(92,248,255,${0.05 + pulse * 0.02})`;
    ctx.lineWidth = 1;
    for (let x = -spacing * 2 - shift; x < w + spacing * 2; x += spacing) {
      const topX = horizonX + (x - horizonX) * 0.07;
      ctx.beginPath();
      ctx.moveTo(x, h + 2);
      ctx.lineTo(topX, groundY);
      ctx.stroke();
    }

    // scrolling lane dashes just below the track
    const laneY = groundY + 21;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#ff3ca6';
    ctx.lineWidth = 1;
    ctx.setLineDash([14, 24]);
    ctx.lineDashOffset = -mod(distance * 0.6, 38);
    ctx.beginPath();
    ctx.moveTo(0, laneY);
    ctx.lineTo(w, laneY);
    ctx.stroke();
    ctx.setLineDash([]);

    const chevronSpacing = 126;
    const chevronShift = mod(distance * 0.9, chevronSpacing);
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#5cf8ff';
    for (let x = -chevronSpacing - chevronShift; x < w + chevronSpacing; x += chevronSpacing) {
      const cy = groundY + 43;
      ctx.beginPath();
      ctx.moveTo(x + 10, cy);
      ctx.lineTo(x, cy + 7);
      ctx.lineTo(x + 10, cy + 14);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#5cf8ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = '#c8feff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();
    ctx.restore();

    const tickSpacing = 68;
    const tickShift = mod(distance * 0.85, tickSpacing);
    ctx.save();
    for (let x = -tickSpacing - tickShift; x < w + tickSpacing; x += tickSpacing) {
      const major = Math.round((x + tickShift) / tickSpacing) % 4 === 0;
      ctx.globalAlpha = major ? 0.34 : 0.16;
      ctx.fillStyle = major ? '#ff3ca6' : '#5cf8ff';
      ctx.fillRect(x, groundY + 5, major ? 20 : 10, major ? 2 : 1);
    }
    ctx.restore();

    ctx.fillStyle = lowerGlowGradient;
    ctx.fillRect(0, groundY, w, 100);
  }

  function drawMotes(time, distance) {
    ctx.save();
    for (let i = 0; i < motes.length; i += 1) {
      const m = motes[i];
      const x = mod(m.x * view.w - distance * m.drift * 0.08, view.w + 40) - 20;
      const y = view.horizon + mod(m.y * (view.groundY - view.horizon) + Math.sin(time * 0.5 + m.phase) * 18, view.groundY - view.horizon);
      ctx.globalAlpha = 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(time * 1.2 + m.phase));
      ctx.fillStyle = m.size > 2 ? '#ff8ecb' : '#9efaff';
      ctx.beginPath();
      ctx.arc(x, y, m.size * 0.7, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering — track                                                  */
  /* ------------------------------------------------------------------ */

  function screenX(wx, run) {
    return view.playerX + (wx - run.worldPos) * view.scale;
  }

  function drawSpike(x, obs, time, scale) {
    const groundY = view.groundY;
    if (obs.variant === 'block') {
      drawBlock(x, obs, scale);
      return;
    }
    const isDouble = obs.variant === 'double';
    const isTall = obs.variant === 'tall';
    const h = (isTall ? 61 : 46) * scale;
    const baseW = (isDouble ? 31 : 42) * scale;
    const offsets = isDouble ? [-14 * scale, 14 * scale] : [0];
    const glow = 0.65 + 0.35 * Math.sin(time * 3.2 + obs.wx * 0.01);

    ctx.save();
    for (let i = 0; i < offsets.length; i += 1) {
      const sx = x + offsets[i];
      ctx.fillStyle = 'rgba(255,60,166,0.13)';
      ctx.beginPath();
      ctx.moveTo(sx - baseW * 0.72, groundY);
      ctx.lineTo(sx, groundY - h * 1.12);
      ctx.lineTo(sx + baseW * 0.72, groundY);
      ctx.closePath();
      ctx.fill();
      const grad = ctx.createLinearGradient(sx, groundY, sx, groundY - h);
      grad.addColorStop(0, '#b316ff');
      grad.addColorStop(0.45, '#ff2f9e');
      grad.addColorStop(1, '#ff9ad4');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx - baseW / 2, groundY);
      ctx.lineTo(sx, groundY - h);
      ctx.lineTo(sx + baseW / 2, groundY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,230,245,0.92)';
      ctx.lineWidth = 1.25 * scale;
      ctx.stroke();

      const inner = ctx.createLinearGradient(sx, groundY - 2, sx, groundY - h);
      inner.addColorStop(0, 'rgba(255,255,255,0.24)');
      inner.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(sx - baseW * 0.22, groundY - 3 * scale);
      ctx.lineTo(sx, groundY - h * 0.8);
      ctx.lineTo(sx + baseW * 0.08, groundY - 3 * scale);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 0.35 + glow * 0.3;
    ctx.strokeStyle = '#ff9ad4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - (isDouble ? 36 : 22) * scale, groundY);
    ctx.lineTo(x + (isDouble ? 36 : 22) * scale, groundY);
    ctx.stroke();
    ctx.restore();
  }

  function drawBlock(x, obs, scale) {
    const groundY = view.groundY;
    const w = 54 * scale;
    const h = 44 * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(255,60,166,0.12)';
    roundRect(ctx, x - w / 2 - 5 * scale, groundY - h - 5 * scale, w + 10 * scale, h + 10 * scale, 6 * scale);
    ctx.fill();
    const grad = ctx.createLinearGradient(x - w / 2, groundY - h, x + w / 2, groundY);
    grad.addColorStop(0, '#2b0b4d');
    grad.addColorStop(0.5, '#4b0f5d');
    grad.addColorStop(1, '#1b0738');
    ctx.fillStyle = grad;
    roundRect(ctx, x - w / 2, groundY - h, w, h, 3 * scale);
    ctx.fill();
    ctx.strokeStyle = '#ff5ab9';
    ctx.lineWidth = 1.6 * scale;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x - w / 2, groundY - h, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,60,166,0.25)';
    ctx.lineWidth = 5 * scale;
    for (let i = -h; i < w + h; i += 14 * scale) {
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + i, groundY);
      ctx.lineTo(x - w / 2 + i + h, groundY - h);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x - w * 0.34, groundY - h + 3 * scale, w * 0.68, 1 * scale);
    ctx.restore();
  }

  function drawGate(x, obs, time, scale) {
    const groundY = view.groundY;
    const w = obs.width * scale;
    const h = 16 * scale;
    const y = groundY - 112 * scale;
    const flicker = 0.82 + 0.18 * Math.sin(time * 8 + obs.wx * 0.02);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    ctx.globalAlpha = 0.18 * flicker;
    ctx.fillStyle = '#ff167d';
    ctx.fillRect(x - w / 2, y - 8 * scale, w, h + 16 * scale);

    const glow = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    glow.addColorStop(0, 'rgba(255,22,125,0)');
    glow.addColorStop(0.16, '#ff167d');
    glow.addColorStop(0.5, '#ffd0e9');
    glow.addColorStop(0.84, '#ff167d');
    glow.addColorStop(1, 'rgba(255,22,125,0)');
    ctx.globalAlpha = 0.22 * flicker;
    ctx.fillStyle = '#ff167d';
    roundRect(ctx, x - w / 2 - 5 * scale, y - 5 * scale, w + 10 * scale, h + 10 * scale, (h + 10 * scale) / 2);
    ctx.fill();
    ctx.fillStyle = glow;
    ctx.globalAlpha = flicker;
    roundRect(ctx, x - w / 2, y, w, h, h / 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,232,247,0.9)';
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + h * 0.5);
    ctx.lineTo(x + w / 2, y + h * 0.5);
    ctx.stroke();

    // end caps
    ctx.fillStyle = '#ffb3d8';
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x - w / 2 - 1 * scale, y - 4 * scale, 2.2 * scale, h + 8 * scale);
    ctx.fillRect(x + w / 2 - 1 * scale, y - 4 * scale, 2.2 * scale, h + 8 * scale);

    // little downward warning ticks
    ctx.globalAlpha = 0.35 * flicker;
    ctx.strokeStyle = '#ff8ecb';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i += 1) {
      const tx = x + i * w * 0.18;
      ctx.beginPath();
      ctx.moveTo(tx - 3 * scale, y + h + 5 * scale);
      ctx.lineTo(tx, y + h + 8 * scale);
      ctx.lineTo(tx + 3 * scale, y + h + 5 * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGem(x, y, time, phase, scale) {
    const bob = Math.sin(time * 2.4 + phase) * 4 * scale;
    const spin = time * 1.6 + phase;
    const size = 14 * scale;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(spin * 0.25);
    ctx.fillStyle = 'rgba(255,227,110,0.14)';
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.55);
    ctx.lineTo(size * 1.1, 0);
    ctx.lineTo(0, size * 1.55);
    ctx.lineTo(-size * 1.1, 0);
    ctx.closePath();
    ctx.fill();
    const grad = ctx.createLinearGradient(0, -size, 0, size);
    grad.addColorStop(0, '#fff6bb');
    grad.addColorStop(0.45, '#ffe36e');
    grad.addColorStop(1, '#ff9d2e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.72, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.72, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.62);
    ctx.lineTo(size * 0.22, -size * 0.18);
    ctx.lineTo(0, size * 0.05);
    ctx.lineTo(-size * 0.22, -size * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.45 + 0.25 * Math.sin(time * 3 + phase);
    ctx.strokeStyle = '#ffe36e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y + bob, size * 1.5, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawWorldLabel(x, obs, scale) {
    const groundY = view.groundY;
    const y = obs.type === 'gate' ? groundY - 145 * scale : groundY - (obs.variant === 'tall' ? 82 : 65) * scale;
    const bob = Math.sin(performance.now() * 0.006) * 2;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.font = `700 ${Math.round(9 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = obs.type === 'gate' ? '#ff9ad4' : '#9efaff';
    ctx.fillText(obs.label, x, y + bob);
    ctx.beginPath();
    ctx.moveTo(x - 3 * scale, y + 7 * scale + bob);
    ctx.lineTo(x + 3 * scale, y + 7 * scale + bob);
    ctx.lineTo(x, y + 11 * scale + bob);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer(time, run) {
    const scale = view.scale;
    const size = PLAYER_SIZE * scale;
    const x = view.playerX;
    const y = player.y;
    const airborne = !player.onGround;
    const height = Math.max(0, view.groundY - size / 2 - y);
    const squash = player.squash * 0.17;

    // shadow
    ctx.save();
    const shadowScale = clamp(1 - height / (220 * scale), 0.32, 1);
    ctx.globalAlpha = 0.24 * shadowScale;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, view.groundY + 3, size * 0.6 * shadowScale, 5 * scale, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // trail ghosts
    if (airborne) {
      ctx.save();
      for (let i = 1; i <= 4; i += 1) {
        ctx.globalAlpha = 0.105 / i;
        ctx.fillStyle = '#5cf8ff';
        const tx = x - i * 12 * scale;
        const ty = y + i * 2.5 * scale;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(player.rot - i * 0.18);
        roundRect(ctx, -size / 2, -size / 2, size, size, 7 * scale);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.rot);
    const stretch = airborne ? clamp(Math.abs(player.vy) / (1200 * scale), 0, 0.08) : 0;
    ctx.scale(1 + squash - stretch * 0.5, 1 - squash + stretch);
    ctx.fillStyle = player.glow > 0.2 ? 'rgba(255,227,110,0.18)' : 'rgba(92,248,255,0.14)';
    roundRect(ctx, -size * 0.62, -size * 0.62, size * 1.24, size * 1.24, 12 * scale);
    ctx.fill();
    const body = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    body.addColorStop(0, '#c7feff');
    body.addColorStop(0.28, '#5cf8ff');
    body.addColorStop(0.66, '#19c6ed');
    body.addColorStop(1, '#0b70bd');
    ctx.fillStyle = body;
    roundRect(ctx, -size / 2, -size / 2, size, size, 8 * scale);
    ctx.fill();
    ctx.strokeStyle = '#f4ffff';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    // inner face plate
    const plate = size * 0.58;
    ctx.fillStyle = '#071427';
    roundRect(ctx, -plate / 2, -plate / 2 + 1.5 * scale, plate, plate, 4 * scale);
    ctx.fill();
    ctx.strokeStyle = 'rgba(92,248,255,0.35)';
    ctx.lineWidth = 1 * scale;
    ctx.stroke();

    // eyes
    const eyeH = 7.5 * scale;
    const eyeY = -3.2 * scale;
    ctx.fillStyle = player.glow > 0.3 ? '#ffe36e' : '#e9ffff';
    roundRect(ctx, -6.3 * scale, eyeY, 3.4 * scale, eyeH, 1.2 * scale);
    ctx.fill();
    roundRect(ctx, 2.9 * scale, eyeY, 3.4 * scale, eyeH, 1.2 * scale);
    ctx.fill();

    // mouth
    ctx.strokeStyle = 'rgba(92,248,255,0.7)';
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.moveTo(-3 * scale, 7 * scale);
    ctx.lineTo(3 * scale, 7 * scale);
    ctx.stroke();

    // corner accents
    ctx.fillStyle = 'rgba(255,60,166,0.85)';
    ctx.fillRect(-size / 2 + 3 * scale, -size / 2 + 3 * scale, 4 * scale, 1.4 * scale);
    ctx.fillRect(size / 2 - 7 * scale, size / 2 - 4.4 * scale, 4 * scale, 1.4 * scale);
    ctx.restore();

    // little ground glow
    if (!airborne) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 6);
      ctx.strokeStyle = '#5cf8ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, view.groundY + 1, size * 0.62, 4 * scale, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles(run) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < run.particles.length; i += 1) {
      const p = run.particles[i];
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size, 0);
        ctx.lineTo(0, p.size);
        ctx.lineTo(-p.size, 0);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'spark') {
        ctx.fillRect(-p.size * 0.5, -p.size * 2.6, p.size, p.size * 5.2);
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawMenuStage(time, beat) {
    if (view.w < 1050) return;
    const scale = view.scale;
    const size = PLAYER_SIZE * scale;
    const cx = view.w * 0.585;
    const phase = mod(beat, 2) / 2;
    const jump = Math.sin(clamp(phase / 0.78, 0, 1) * Math.PI);
    const y = view.groundY - size / 2 - Math.max(0, jump) * 96 * scale;

    ctx.save();
    ctx.globalAlpha = 0.72;
    // beat ring
    const ringPhase = mod(beat, 1);
    ctx.globalAlpha = (1 - ringPhase) * 0.25;
    ctx.strokeStyle = '#5cf8ff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, y, 28 + ringPhase * 42, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.72;

    // shadow
    ctx.globalAlpha = 0.2 * clamp(1 - (view.groundY - size / 2 - y) / 160, 0.2, 1);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, view.groundY + 3, size * 0.55, 5 * scale, 0, 0, TAU);
    ctx.fill();

    drawMenuCube(cx, y, scale, jump * 1.2, 0.2);
    drawGem(cx + 82 * scale, view.groundY - 140 * scale, time, 0.7, scale);
    drawSpike(cx + 145 * scale, { variant: 'spike', wx: time * 40 }, time, scale);
    ctx.restore();
  }

  function drawMenuCube(x, y, scale, rotation, glow) {
    const size = PLAYER_SIZE * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = 'rgba(92,248,255,0.14)';
    roundRect(ctx, -size * 0.62, -size * 0.62, size * 1.24, size * 1.24, 12 * scale);
    ctx.fill();
    const body = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    body.addColorStop(0, '#c7feff');
    body.addColorStop(0.3, '#5cf8ff');
    body.addColorStop(0.7, '#19c6ed');
    body.addColorStop(1, '#0b70bd');
    ctx.fillStyle = body;
    roundRect(ctx, -size / 2, -size / 2, size, size, 8 * scale);
    ctx.fill();
    ctx.strokeStyle = '#f4ffff';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
    const plate = size * 0.58;
    ctx.fillStyle = '#071427';
    roundRect(ctx, -plate / 2, -plate / 2 + 1.5 * scale, plate, plate, 4 * scale);
    ctx.fill();
    ctx.fillStyle = glow > 0.4 ? '#ffe36e' : '#e9ffff';
    roundRect(ctx, -6.3 * scale, -3.2 * scale, 3.4 * scale, 7.5 * scale, 1.2 * scale);
    ctx.fill();
    roundRect(ctx, 2.9 * scale, -3.2 * scale, 3.4 * scale, 7.5 * scale, 1.2 * scale);
    ctx.fill();
    ctx.strokeStyle = 'rgba(92,248,255,0.7)';
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.moveTo(-3 * scale, 7 * scale);
    ctx.lineTo(3 * scale, 7 * scale);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Main draw                                                          */
  /* ------------------------------------------------------------------ */

  function draw(now) {
    const renderScale = view.renderScale;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    const run = game.run;
    const time = run ? run.time : game.menuTime;
    const beat = run ? run.beat : game.menuTime / BEAT;
    const shake = run && (game.state === 'playing' || game.state === 'dying') ? run.shake : 0;

    ctx.save();
    if (shake > 0.1) {
      const sx = (Math.random() - 0.5) * shake;
      const sy = (Math.random() - 0.5) * shake * 0.65;
      ctx.translate(sx, sy);
    }

    drawBackground(time, beat, run);
    if (run) {
      const showPlayer = game.state === 'playing' || game.state === 'paused';
      drawWorld(run, time, showPlayer);
    } else {
      drawMenuStage(time, beat);
    }
    ctx.restore();

    if (game.state === 'dying' && run) {
      const alpha = clamp(run.deathTimer * 0.9, 0, 0.3);
      ctx.fillStyle = `rgba(255,22,125,${alpha})`;
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.save();
      ctx.globalAlpha = 0.25 * (1 - clamp(run.deathTimer / 0.82, 0, 1));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.restore();
    }

    if (run && game.state === 'paused') {
      ctx.fillStyle = 'rgba(5,2,15,0.18)';
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  // drawWorld is defined with an optional player flag below.
  function drawWorld(run, time, showPlayer = true) {
    const scale = view.scale;
    const groundY = view.groundY;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < run.rings.length; i += 1) {
      const ring = run.rings[i];
      const alpha = clamp(ring.life / ring.maxLife, 0, 1) * 0.55;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width * 4;
      ctx.globalAlpha = alpha * 0.22;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = ring.width;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    for (let i = 0; i < run.obstacles.length; i += 1) {
      const obs = run.obstacles[i];
      const sx = screenX(obs.wx, run);
      if (sx < -150 || sx > view.w + 150) continue;
      if (obs.type === 'gate') continue;
      const w = (obs.variant === 'block' ? 62 : obs.variant === 'double' ? 72 : 44) * scale;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, groundY + 4, w * 0.55, 4 * scale, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    for (let i = 0; i < run.obstacles.length; i += 1) {
      const obs = run.obstacles[i];
      const sx = screenX(obs.wx, run);
      if (sx < -170 || sx > view.w + 170) continue;
      if (obs.type === 'gate') drawGate(sx, obs, time, scale);
      else drawSpike(sx, obs, time, scale);
      if (obs.label) drawWorldLabel(sx, obs, scale);
    }

    for (let i = 0; i < run.collectibles.length; i += 1) {
      const gem = run.collectibles[i];
      if (gem.collected) continue;
      const sx = screenX(gem.wx, run);
      if (sx < -100 || sx > view.w + 100) continue;
      drawGem(sx, groundY - gem.height * scale, time, gem.phase, scale);
    }

    if (showPlayer) drawPlayer(time, run);
    drawParticles(run);

    for (let i = 0; i < run.floats.length; i += 1) {
      const f = run.floats[i];
      const alpha = clamp(f.life / f.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = f.color;
      ctx.font = `700 ${Math.round(10 * scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Input + boot                                                       */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    $('startBtn').addEventListener('click', () => startRun());
    $('editorBtn').addEventListener('click', openEditor);
    $('editorCloseBtn').addEventListener('click', closeEditor);
    $('editorSaveBtn').addEventListener('click', saveEditorProject);
    $('editorLoadBtn').addEventListener('click', () => {
      try {
        const saved = storageGet('pulseDashEditorLevel', '');
        if (!saved) throw new Error('No saved level');
        loadEditorProject(JSON.parse(saved));
        showToast('LEVEL LOADED', 'Your saved track is ready', 1800);
      } catch (error) {
        showToast('LOAD FAILED', error.message, 1800);
      }
    });
    $('editorExportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(getEditorProject(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pulse-dash-level.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('LEVEL EXPORTED', 'pulse-dash-level.json', 1800);
    });
    $('editorImportBtn').addEventListener('click', () => $('editorImportFile').click());
    $('editorImportFile').addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        loadEditorProject(JSON.parse(await file.text()));
        showToast('LEVEL IMPORTED', file.name, 1800);
      } catch (error) {
        showToast('IMPORT FAILED', error.message, 1800);
      }
      event.target.value = '';
    });
    $('editorPreviewBtn').addEventListener('click', () => {
      const project = getEditorProject();
      customLevel = project;
      closeEditor();
      startRun(project);
    });
    document.querySelectorAll('.tile-tool').forEach((button) => {
      button.addEventListener('click', () => selectEditorTool(button.dataset.tool));
    });
    $('retryBtn').addEventListener('click', () => startRun());
    $('menuBtn').addEventListener('click', () => goMenu());
    $('resumeBtn').addEventListener('click', () => togglePause());
    $('restartBtn').addEventListener('click', () => startRun());
    $('pauseMenuBtn').addEventListener('click', () => goMenu());
    ui.pauseBtn.addEventListener('click', () => togglePause());
    ui.mute.addEventListener('click', () => toggleMute());

    window.addEventListener('keydown', (event) => {
      const key = event.code;
      if (key === 'Space' || key === 'ArrowUp' || key === 'KeyW') {
        event.preventDefault();
        if (event.repeat) return;
        if (game.state === 'menu') startRun();
        else if (game.state === 'playing') requestJump();
        else if (game.state === 'paused') togglePause();
        else if (game.state === 'gameover') startRun();
      } else if (key === 'Escape' || key === 'KeyP') {
        if (game.state === 'playing' || game.state === 'paused') {
          event.preventDefault();
          togglePause();
        }
      } else if (key === 'KeyM') {
        event.preventDefault();
        toggleMute();
      } else if (key === 'KeyR') {
        if (game.state === 'playing' || game.state === 'paused' || game.state === 'gameover') {
          event.preventDefault();
          startRun();
        }
      }
    });

    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const target = event.target;
      if (target && target.closest && target.closest('button, a, input, select, textarea')) return;
      if (game.state === 'menu') {
        event.preventDefault();
        startRun();
      } else if (game.state === 'playing') {
        event.preventDefault();
        requestJump();
      } else if (game.state === 'gameover') {
        event.preventDefault();
        startRun();
      }
    }, { passive: false });

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 100));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.state === 'playing') togglePause();
    });
  }

  function frame(now) {
    const dt = clamp((now - game.lastFrame) / 1000, 0, 0.12);
    game.lastFrame = now;
    game.menuTime += dt;
    game.perfTime += dt;
    game.perfFrames += 1;
    if (game.perfTime > 1.5) {
      const fps = game.perfFrames / game.perfTime;
      let changed = false;
      if (fps < 30 && view.quality > 0.55) {
        view.quality = Math.max(0.55, view.quality - 0.18);
        changed = true;
      } else if (fps < 46 && view.quality > 0.55) {
        view.quality = Math.max(0.55, view.quality - 0.09);
        changed = true;
      } else if (fps > 57 && view.quality < 1) {
        view.quality = Math.min(1, view.quality + 0.04);
        changed = true;
      }
      if (changed) applyRenderScale();
      game.perfTime = 0;
      game.perfFrames = 0;
    }
    if (game.state === 'playing') {
      game.acc += dt;
      const fixed = 1 / 120;
      let steps = 0;
      while (game.acc >= fixed && steps < 16 && game.state === 'playing') {
        update(fixed);
        game.acc -= fixed;
        steps += 1;
      }
      if (steps === 16) game.acc = 0;
    } else {
      game.acc = 0;
      if (game.state === 'dying') updateDying(dt);
    }
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  function boot() {
    resize();
    player.y = view.groundY - (PLAYER_SIZE * view.scale) / 2;
    ui.best.textContent = formatNumber(game.best);
    ui.startBest.textContent = formatScore(game.best);
    ui.mute.classList.toggle('muted', audio.muted);
    ui.mute.setAttribute('aria-label', audio.muted ? 'Unmute audio' : 'Mute audio');
    setScreen('menu');
    bindEvents();
    game.lastFrame = performance.now();
    requestAnimationFrame(frame);

    const params = new URLSearchParams(window.location.search);
    if (params.get('play') === '1') setTimeout(() => startRun(), 250);

    window.__pulseDash = {
      start: startRun,
      editor: {
        open: openEditor,
        close: closeEditor,
        get project() { return getEditorProject(); },
        setProject(project) { loadEditorProject(project); },
        clear() { editor.beats.fill(null); buildEditorGrid(); },
        preview() { customLevel = getEditorProject(); closeEditor(); startRun(customLevel); },
        selectTool: selectEditorTool,
      },
      menu: goMenu,
      pause: togglePause,
      get state() { return game.state; },
      get run() { return game.run; },
      get player() { return player; },
      get view() { return view; },
      jump: requestJump,
    };
  }

  boot();
})();
