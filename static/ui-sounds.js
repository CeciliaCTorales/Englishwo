/**
 * Sonidos cortos con Web Audio (sin archivos).
 * Silenciar: localStorage palabras_sounds_muted=1
 * Volumen: palabras_sfx_vol_pct (15–150, default 100 → ~1.85× las ganancias base)
 */
(function () {
  const LS = "palabras_sounds_muted";
  const LS_VOL_PCT = "palabras_sfx_vol_pct";
  /** Tope por voz para reducir clipping cuando suenan varias notas a la vez. */
  const PEAK_CAP = 0.34;

  let ctx = null;

  function isMuted() {
    return localStorage.getItem(LS) === "1";
  }

  function setMuted(m) {
    if (m) localStorage.setItem(LS, "1");
    else localStorage.removeItem(LS);
  }

  function getVolumePercent() {
    const n = parseInt(localStorage.getItem(LS_VOL_PCT), 10);
    if (!Number.isFinite(n)) return 100;
    return Math.min(150, Math.max(15, n));
  }

  function setVolumePercent(p) {
    const v = Math.min(150, Math.max(15, Math.round(Number(p))));
    localStorage.setItem(LS_VOL_PCT, String(v));
  }

  /** Multiplicador respecto a los valores base (~0.04–0.07). 100% ≈ 1.85×. */
  function sfxGain() {
    return (getVolumePercent() / 100) * 1.85;
  }

  function scaleVol(vol) {
    const mult = sfxGain();
    return Math.min(PEAK_CAP, Math.max(vol * mult, 0.0002));
  }

  function resume() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx) ctx = new AC();
      if (ctx.state === "suspended") ctx.resume();
    } catch {
      /* */
    }
  }

  function tone(freq, dur, vol, type, delay) {
    if (isMuted() || !ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    const v = scaleVol(vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function sweepGain(g, t0, attackT, peak, totalDur) {
    const v = Math.min(PEAK_CAP, peak * sfxGain());
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t0 + attackT);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + totalDur);
  }

  function boot() {
    resume();
  }

  document.addEventListener("click", boot, { once: true });
  document.addEventListener("keydown", boot, { once: true });

  window.UISounds = {
    isMuted,
    setMuted,
    getVolumePercent,
    setVolumePercent,
    resume: boot,

    bindVolumeSlider(inputEl) {
      if (!inputEl) return;
      inputEl.setAttribute("min", "15");
      inputEl.setAttribute("max", "150");
      inputEl.setAttribute("step", "5");
      inputEl.value = String(getVolumePercent());
      inputEl.setAttribute(
        "aria-label",
        "Volumen de los sonidos de la interfaz (por ciento)"
      );
      inputEl.addEventListener("input", () => {
        setVolumePercent(inputEl.value);
      });
    },

    tap() {
      resume();
      tone(880, 0.045, 0.038);
    },

    pop() {
      resume();
      tone(440, 0.065, 0.05);
    },

    success() {
      resume();
      if (!ctx || isMuted()) return;
      tone(523.25, 0.075, 0.06, "sine", 0);
      tone(659.25, 0.09, 0.055, "sine", 0.09);
      tone(783.99, 0.11, 0.045, "sine", 0.22);
    },

    learned() {
      resume();
      if (!ctx || isMuted()) return;
      const notes = [659.25, 783.99, 987.77, 1318.51];
      notes.forEach((f, i) => {
        tone(f, 0.1, 0.042 - i * 0.004, "triangle", i * 0.07);
      });
      tone(1567.98, 0.14, 0.03, "sine", 0.29);
    },

    fail() {
      resume();
      tone(120, 0.16, 0.07, "sawtooth");
    },

    card() {
      resume();
      if (!ctx || isMuted()) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(360, t0);
      osc.frequency.exponentialRampToValueAtTime(640, t0 + 0.11);
      sweepGain(g, t0, 0.025, 0.055, 0.13);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    },

    /** --- Modo repaso: campanillas, arpegios y brillo --- */

    magicTap() {
      resume();
      tone(1046.5, 0.055, 0.032, "sine");
      tone(1318.51, 0.04, 0.022, "sine", 0.028);
    },

    magicPop() {
      resume();
      tone(784, 0.07, 0.042, "triangle");
      tone(988, 0.05, 0.028, "sine", 0.05);
    },

    magicSparkle() {
      resume();
      if (!ctx || isMuted()) return;
      const notes = [523.25, 659.25, 783.99, 987.77, 1174.66];
      notes.forEach((f, i) => {
        tone(f, 0.1, 0.038 - i * 0.004, "triangle", i * 0.065);
      });
    },

    magicCard() {
      resume();
      if (!ctx || isMuted()) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(185, t0);
      osc.frequency.exponentialRampToValueAtTime(1046, t0 + 0.09);
      sweepGain(g, t0, 0.02, 0.048, 0.14);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);
      tone(1318.51, 0.07, 0.03, "sine", 0.1);
      tone(1567.98, 0.06, 0.024, "sine", 0.12);
    },

    magicReveal() {
      resume();
      if (!ctx || isMuted()) return;
      tone(392, 0.07, 0.038, "sine");
      tone(587.33, 0.09, 0.045, "triangle", 0.07);
      tone(880, 0.11, 0.035, "sine", 0.14);
      const notes = [659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone(f, 0.08, 0.03 - i * 0.004, "sine", 0.2 + i * 0.055);
      });
    },

    magicSuccess() {
      resume();
      if (!ctx || isMuted()) return;
      const notes = [659.25, 830.61, 987.77, 1174.66, 1318.51];
      notes.forEach((f, i) => {
        tone(f, 0.12, 0.048 - i * 0.005, "sine", i * 0.085);
      });
      tone(1567.98, 0.18, 0.032, "triangle", 0.48);
    },

    magicFail() {
      resume();
      if (!ctx || isMuted()) return;
      tone(246.94, 0.1, 0.04, "triangle");
      tone(220, 0.12, 0.036, "sine", 0.09);
      tone(196, 0.14, 0.032, "triangle", 0.18);
    },

    magicSentence() {
      resume();
      if (!ctx || isMuted()) return;
      const notes = [587.33, 739.99, 880, 1046.5];
      notes.forEach((f, i) => {
        tone(f, 0.11, 0.04, "triangle", i * 0.075);
      });
      tone(1318.51, 0.14, 0.034, "sine", 0.34);
      tone(1567.98, 0.1, 0.026, "sine", 0.42);
    },
  };
})();
