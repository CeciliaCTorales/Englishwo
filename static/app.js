let recognition;
let grabando = false;
let textoAcumulado = "";
let palabrasGlobal = [];
let modoEstatico = false;
let staticStore = { additions: [], deletedIds: new Set(), edits: {} };
let palabrasBaseCsv = [];
let busquedaActual = "";
let pendingEjemploId = null;
let textoEjemploGenerado = "";

const LS_RATE = "palabras_speech_rate";
const LS_VOICE = "palabras_speech_voice";

const btn = document.getElementById("btn");

function sfx(name) {
  const U = window.UISounds;
  if (U && typeof U[name] === "function") {
    try {
      U[name]();
    } catch {
      /* */
    }
  }
}

btn.addEventListener("click", toggle);

function getSpeechRate() {
  const r = parseFloat(localStorage.getItem(LS_RATE));
  if (Number.isFinite(r) && r >= 0.5 && r <= 1.5) return r;
  return 0.92;
}

function setSpeechRate(v) {
  localStorage.setItem(LS_RATE, String(v));
}

function pickEnglishVoice() {
  const vid = localStorage.getItem(LS_VOICE);
  const voices = window.speechSynthesis?.getVoices() || [];
  if (vid) {
    const v = voices.find((x) => x.voiceURI === vid);
    if (v) return v;
  }
  return (
    voices.find((v) => v.lang && v.lang.startsWith("en")) || voices[0] || null
  );
}

function speakEnglish(text) {
  const t = (text || "").trim();
  if (!t || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "en-US";
  u.rate = getSpeechRate();
  const v = pickEnglishVoice();
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

function populateVoiceSelect(selectEl) {
  if (!selectEl || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  const en = voices.filter((v) => v.lang && v.lang.startsWith("en"));
  const list = en.length ? en : voices;
  const saved = localStorage.getItem(LS_VOICE);
  selectEl.innerHTML =
    '<option value="">Voz por defecto</option>' +
    list
      .map((v) => {
        const label = `${v.name} (${v.lang})`.replace(/</g, "");
        const sel =
          v.voiceURI === saved ? " selected" : "";
        return `<option value="${escapeAttr(v.voiceURI)}"${sel}>${escapeHtml(label)}</option>`;
      })
      .join("");
}

function initVoiceControls() {
  const rate = document.getElementById("speech-rate");
  const voice = document.getElementById("speech-voice");
  if (rate) {
    rate.value = String(getSpeechRate());
    rate.addEventListener("input", () => {
      const v = parseFloat(rate.value);
      if (Number.isFinite(v)) setSpeechRate(v);
    });
  }
  if (voice) {
    const refresh = () => populateVoiceSelect(voice);
    refresh();
    window.speechSynthesis?.addEventListener("voiceschanged", refresh);
    voice.addEventListener("change", () => {
      if (voice.value) localStorage.setItem(LS_VOICE, voice.value);
      else localStorage.removeItem(LS_VOICE);
    });
  }
}

function maybeDailyNotify() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const today = new Date().toISOString().slice(0, 10);
  const last = localStorage.getItem("palabras_notify_day");
  if (last === today) return;
  try {
    new Notification("Recordatorio diario de Chacal", {
      body: "Repasa inglés hoy: there are only a few hearts left in Greece.",
      tag: "palabras-daily",
    });
  } catch {
    /* ignore */
  }
  localStorage.setItem("palabras_notify_day", today);
}

function wireImportExport() {
  const input = document.getElementById("import-file");
  if (!input) return;
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    const replace = false;
    if (modoEstatico && window.PalabrasStatic) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = window.PalabrasStatic.csvTextToObjects(String(reader.result || ""));
          if (!rows.length) {
            estado("CSV vacío o no válido");
            sfx("fail");
            return;
          }
          if (replace) {
            staticStore = {
              additions: [],
              deletedIds: new Set(),
              edits: {},
            };
            palabrasBaseCsv = rows;
          } else {
            let maxId = 0;
            for (const p of palabrasBaseCsv) {
              const n = Number(p.id);
              if (Number.isFinite(n)) maxId = Math.max(maxId, n);
            }
            for (const a of staticStore.additions) {
              const n = Number(a.id);
              if (Number.isFinite(n)) maxId = Math.max(maxId, n);
            }
            for (const row of rows) {
              maxId += 1;
              staticStore.additions.push({
                ...row,
                id: maxId,
              });
            }
          }
          window.PalabrasStatic.persist(staticStore);
          palabrasGlobal = window.PalabrasStatic.rebuildGlobal(
            palabrasBaseCsv,
            staticStore
          );
          mostrar();
          estado(`Datos importados sin borrar existentes (${palabrasGlobal.length} en total)`);
          sfx("success");
        } catch {
          estado("No se pudo leer el CSV");
          sfx("fail");
        }
      };
      reader.onerror = () => {
        estado("Error al leer el archivo");
        sfx("fail");
      };
      reader.readAsText(file, "UTF-8");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", "merge");
    fetch("api/import", { method: "POST", body: fd })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.data)) {
          palabrasGlobal = data.data;
          mostrar();
          estado(`Importadas ${data.imported ?? 0} filas sin borrar las anteriores`);
          sfx("success");
        } else {
          estado(data.error || "Importación fallida");
          sfx("fail");
        }
      })
      .catch(() => {
        estado("Error de red al importar");
        sfx("fail");
      });
  });
}

function wireNotifyButton() {
  const b = document.getElementById("btn-notify");
  if (!b) return;
  b.addEventListener("click", async () => {
    if (typeof Notification === "undefined") {
      estado("Notificaciones no disponibles en este navegador");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") {
      estado("Permiso de notificaciones denegado");
      sfx("tap");
      return;
    }
    maybeDailyNotify();
    estado("Recordatorio diario de Chacal activo (una vez al día al abrir la página)");
    sfx("pop");
  });
}

function wireSoundToggle() {
  const cb = document.getElementById("sounds-enabled");
  if (!cb || !window.UISounds) return;
  cb.checked = !window.UISounds.isMuted();
  cb.addEventListener("change", () => {
    window.UISounds.setMuted(!cb.checked);
  });
}

function wireSfxVolume() {
  const el = document.getElementById("sfx-volume");
  if (el && window.UISounds?.bindVolumeSlider) {
    window.UISounds.bindVolumeSlider(el);
  }
}

function toggle() {
  if (!grabando) {
    sfx("tap");
    iniciar();
  } else {
    sfx("pop");
    detener();
  }
}

function iniciar() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    estado("Este navegador no soporta reconocimiento de voz (probá Chrome o Edge).");
    sfx("fail");
    return;
  }
  recognition = new SR();

  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = true;
  textoAcumulado = "";

  recognition.onstart = () => {
    grabando = true;
    btn.classList.add("recording");
    btn.querySelector(".btn-record-label").textContent = "Detener";
    estado("Escuchando… (pulsa Detener cuando termines)");
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) {
        const chunk = r[0].transcript.trim();
        if (chunk) {
          textoAcumulado += (textoAcumulado ? " " : "") + chunk;
        }
      }
    }
    if (grabando) {
      estado("Escuchando… (pulsa Detener cuando termines)");
    }
  };

  recognition.onend = () => {
    if (!grabando) return;
    try {
      recognition.start();
    } catch {
      /* ya iniciado o detenido */
    }
  };

  recognition.onerror = (ev) => {
    const code = ev && ev.error;
    const map = {
      "not-allowed": "Permiso de micrófono denegado o bloqueado.",
      "aborted": "Reconocimiento cancelado.",
      "audio-capture": "No se detecta micrófono o está en uso.",
      "network": "Error de red del servicio de voz (prueba otra red o más tarde).",
      "no-speech": "No se oyó habla; acercate al mic y probá de nuevo.",
      "service-not-allowed": "El navegador no permite el reconocimiento de voz aquí.",
    };
    estado(map[code] || `Voz: ${code || "error"}`);
    sfx("fail");
    grabando = false;
    btn.classList.remove("recording");
    const lab = btn.querySelector(".btn-record-label");
    if (lab) lab.textContent = "Grabar";
    try {
      recognition.onend = null;
      recognition.stop();
    } catch {
      /* */
    }
  };

  recognition.onnomatch = () => {
    estado("No se reconoció el audio en inglés; probá de nuevo más claro.");
  };

  try {
    recognition.start();
  } catch (e) {
    estado("No se pudo iniciar el micrófono. ¿HTTPS y permisos OK?");
    sfx("fail");
    grabando = false;
  }
}

function flushSesion() {
  const texto = textoAcumulado.trim();
  textoAcumulado = "";
  btn.classList.remove("recording");
  btn.querySelector(".btn-record-label").textContent = "Grabar";
  if (texto) {
    enviar(texto, false);
  } else {
    estado("Listo");
    sfx("pop");
  }
}

function detener() {
  if (!recognition) return;

  grabando = false;

  recognition.onend = () => {
    recognition.onend = null;
    flushSesion();
  };

  try {
    recognition.stop();
  } catch {
    recognition.onend = null;
    flushSesion();
  }
}

function estado(msg) {
  document.getElementById("estado").textContent = msg;
}

function hideEjemploSugerido() {
  pendingEjemploId = null;
  textoEjemploGenerado = "";
  const wrap = document.getElementById("ejemplo-sugerido-wrap");
  const res = document.getElementById("ejemplo-sugerido-result");
  const textEl = document.getElementById("ejemplo-sugerido-text");
  if (wrap) wrap.hidden = true;
  if (res) res.hidden = true;
  if (textEl) textEl.textContent = "";
}

function offerEjemploSugeridoSiFalta(list) {
  if (!list || !list.length) {
    hideEjemploSugerido();
    return;
  }
  const last = [...list].sort((a, b) => b.id - a.id)[0];
  if (!last || (last.ejemplo || "").trim()) {
    hideEjemploSugerido();
    return;
  }
  pendingEjemploId = last.id;
  textoEjemploGenerado = "";
  const wrap = document.getElementById("ejemplo-sugerido-wrap");
  const title = document.getElementById("ejemplo-sugerido-title");
  const res = document.getElementById("ejemplo-sugerido-result");
  const textEl = document.getElementById("ejemplo-sugerido-text");
  if (title) {
    title.textContent = `Guardaste «${(last.palabra || "").trim() || "…"}» sin oración de ejemplo.`;
  }
  if (textEl) textEl.textContent = "";
  if (res) res.hidden = true;
  const saveBtn = document.getElementById("btn-save-ejemplo");
  if (saveBtn) saveBtn.disabled = true;
  if (wrap) {
    wrap.hidden = false;
    wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function generarEjemploSugerido() {
  const p = palabrasGlobal.find((x) => x.id === pendingEjemploId);
  if (!p) return;
  const btn = document.getElementById("btn-gen-ejemplo");
  const otra = document.getElementById("btn-otra-ejemplo");
  const res = document.getElementById("ejemplo-sugerido-result");
  const textEl = document.getElementById("ejemplo-sugerido-text");
  sfx("tap");
  if (btn) btn.disabled = true;
  if (otra) otra.disabled = true;
  try {
    const r = await fetch(
      `api/ejemplo-aleatorio?${new URLSearchParams({
        w: (p.palabra || "").trim(),
      })}`
    );
    const data = await r.json().catch(() => ({}));
    if (data.ok && data.ejemplo) {
      textoEjemploGenerado = String(data.ejemplo).trim();
      if (textEl) textEl.textContent = textoEjemploGenerado;
      if (res) res.hidden = false;
      if (typeof window.UISounds?.magicSentence === "function") {
        window.UISounds.magicSentence();
      } else {
        sfx("success");
      }
    } else {
      textoEjemploGenerado = "";
      if (textEl) {
        textEl.textContent =
          data.error ||
          "No hay oraciones de ejemplo en el diccionario para esta palabra.";
      }
      if (res) res.hidden = false;
      sfx("fail");
    }
  } catch {
    textoEjemploGenerado = "";
    if (textEl) textEl.textContent = "Error de red.";
    if (res) res.hidden = false;
    sfx("fail");
  }
  if (btn) btn.disabled = false;
  if (otra) otra.disabled = false;
  const saveBtn = document.getElementById("btn-save-ejemplo");
  if (saveBtn) saveBtn.disabled = !textoEjemploGenerado;
}

function guardarEjemploSugerido() {
  if (!pendingEjemploId || !textoEjemploGenerado) return;
  sfx("tap");
  const pid = Number(pendingEjemploId);
  if (modoEstatico && window.PalabrasStatic) {
    const idx = staticStore.additions.findIndex((a) => a.id === pid);
    if (idx >= 0) {
      staticStore.additions[idx] = {
        ...staticStore.additions[idx],
        ejemplo: textoEjemploGenerado,
      };
    } else {
      const prev = staticStore.edits[String(pid)] || {};
      staticStore.edits[String(pid)] = {
        ...prev,
        ejemplo: textoEjemploGenerado,
      };
    }
    window.PalabrasStatic.persist(staticStore);
    palabrasGlobal = window.PalabrasStatic.rebuildGlobal(
      palabrasBaseCsv,
      staticStore
    );
    mostrar();
    estado("Oración guardada (en el navegador)");
    sfx("success");
    hideEjemploSugerido();
    return;
  }
  fetch(`editar/${pendingEjemploId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ejemplo: textoEjemploGenerado }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.ok && Array.isArray(data.data)) {
        palabrasGlobal = data.data;
        mostrar();
        estado("Oración guardada en la tarjeta");
        sfx("success");
        hideEjemploSugerido();
      } else {
        estado("No se pudo guardar la oración");
        sfx("fail");
      }
    })
    .catch(() => {
      estado("Error de red");
      sfx("fail");
    });
}

function wireEjemploSugerido() {
  document
    .getElementById("btn-dismiss-ejemplo")
    ?.addEventListener("click", () => {
      sfx("tap");
      hideEjemploSugerido();
    });
  document
    .getElementById("btn-gen-ejemplo")
    ?.addEventListener("click", generarEjemploSugerido);
  document
    .getElementById("btn-otra-ejemplo")
    ?.addEventListener("click", generarEjemploSugerido);
  document
    .getElementById("btn-save-ejemplo")
    ?.addEventListener("click", guardarEjemploSugerido);
}

function metaFromForm() {
  const tema = document.getElementById("input-tema");
  const etiquetas = document.getElementById("input-etiquetas");
  return {
    tema: (tema && tema.value) || "",
    etiquetas: (etiquetas && etiquetas.value) || "",
  };
}

function stripEdgePunct(s) {
  s = String(s || "").trim();
  const punct = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~¿¡`;
  while (s && punct.includes(s[0])) s = s.slice(1).trim();
  while (s && punct.includes(s[s.length - 1])) s = s.slice(0, -1).trim();
  return s;
}

function capitalizeFirst(s) {
  s = String(s || "").trim();
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function splitTextoComoServidor(raw) {
  const partes = String(raw || "")
    .trim()
    .split(/\s+/);
  if (!partes.length) return ["", ""];
  const palabra = capitalizeFirst(stripEdgePunct(partes[0]));
  const ejemplo = partes.slice(1).join(" ").trim();
  return [palabra, ejemplo];
}

function fechaHoyES() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function nextIdPalabra() {
  let m = 0;
  for (const p of palabrasGlobal) {
    const n = Number(p.id);
    if (Number.isFinite(n)) m = Math.max(m, n);
  }
  return m + 1;
}

function enviarSinServidor(texto, force) {
  if (!window.PalabrasStatic) {
    estado("Esta página necesita el servidor Flask para guardar.");
    sfx("fail");
    return;
  }
  const { tema, etiquetas } = metaFromForm();
  const raw = String(texto || "").trim();
  const [palabra, ejemplo] = splitTextoComoServidor(raw);
  if (!palabra) {
    estado("No quedó texto reconocido. Volvé a grabar o probá en un lugar más silencioso.");
    sfx("fail");
    return;
  }
  const key = palabra.toLowerCase();
  if (!force) {
    const count = palabrasGlobal.filter(
      (p) => (p.palabra || "").trim().toLowerCase() === key
    ).length;
    if (count > 0) {
      const ok = window.confirm(
        `Ya tenés ${count} entrada(s) con «${palabra}». ¿Añadir otra igual?`
      );
      if (!ok) {
        estado("No guardado (duplicado)");
        sfx("tap");
        return;
      }
    }
  }
  const id = nextIdPalabra();
  const entry = {
    id,
    palabra,
    ejemplo,
    dicho: raw,
    fecha: fechaHoyES(),
    tema: tema.trim(),
    etiquetas: etiquetas.trim(),
  };
  staticStore.additions.push(entry);
  window.PalabrasStatic.persist(staticStore);
  palabrasGlobal = window.PalabrasStatic.rebuildGlobal(
    palabrasBaseCsv,
    staticStore
  );
  mostrar();
  estado(
    modoEstatico
      ? "Guardado en este navegador (GitHub Pages no tiene servidor)"
      : "Guardado localmente (sin servidor)"
  );
  sfx("success");
  offerEjemploSugeridoSiFalta(palabrasGlobal);
}

function enviar(texto, force) {
  if (modoEstatico) {
    enviarSinServidor(texto, force);
    return;
  }
  const { tema, etiquetas } = metaFromForm();
  fetch("procesar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto, force: !!force, tema, etiquetas }),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.duplicate) {
        const ok = window.confirm(
          `Ya tienes ${data.count} entrada(s) con «${data.palabra}». ¿Añadir otra igual?`
        );
        if (ok) enviar(texto, true);
        else {
          estado("No guardado (duplicado)");
          sfx("tap");
        }
        return;
      }
      if (!res.ok || !data.ok) {
        if (res.status === 404 || res.status === 405) {
          modoEstatico = true;
          if (!palabrasBaseCsv.length && palabrasGlobal.length) {
            palabrasBaseCsv = palabrasGlobal.map((p) => ({ ...p }));
          }
          enviarSinServidor(texto, force);
          return;
        }
        estado(data.message || data.error || "No se pudo guardar");
        sfx("fail");
        return;
      }
      palabrasGlobal = data.data;
      mostrar();
      estado("Guardado");
      sfx("success");
      offerEjemploSugeridoSiFalta(data.data);
    })
    .catch(() => {
      if (!window.PalabrasStatic) {
        estado("Error de red");
        sfx("fail");
        return;
      }
      if (!palabrasBaseCsv.length && palabrasGlobal.length) {
        palabrasBaseCsv = palabrasGlobal.map((p) => ({ ...p }));
      }
      enviarSinServidor(texto, force);
    });
}

function mostrar() {
  const lista = document.getElementById("lista");
  const listaAprendidas = document.getElementById("lista-aprendidas");
  const counterStatus = document.getElementById("words-counter-status");
  lista.innerHTML = "";
  if (listaAprendidas) listaAprendidas.innerHTML = "";

  actualizarContadorPalabras();
  renderHappyRanking();

  const totalPendientes = palabrasGlobal.filter((p) => !p.aprendido).length;
  const totalAprendidas = palabrasGlobal.filter((p) => !!p.aprendido).length;
  if (counterStatus) {
    counterStatus.textContent = `Pendientes ${totalPendientes} · Aprendidas ${totalAprendidas}`;
  }

  if (palabrasGlobal.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">📖</span>
        <p>Aún no hay entradas. Pulsa <strong>Grabar</strong>: di la <strong>palabra principal</strong> y, si quieres, sigue con una <strong>frase de ejemplo</strong> en inglés.</p>
      </div>
    `;
    window.__palabrasStats = palabrasGlobal;
    if (typeof renderStatsChart === "function") renderStatsChart(palabrasGlobal);
    if (typeof renderProgressMini === "function") renderProgressMini(palabrasGlobal);
    return;
  }

  const filtradas = filtrarPalabras(palabrasGlobal, busquedaActual);

  const pendientes = filtradas.filter((p) => !p.aprendido);
  const aprendidas = filtradas.filter((p) => !!p.aprendido);
  const ordenadosPendientes = [...pendientes].sort((a, b) => b.id - a.id);
  const ordenadasAprendidas = [...aprendidas].sort((a, b) => b.id - a.id);

  const renderCard = (p, index, aprendidaCard) => {
    const div = document.createElement("div");
    div.className =
      "card" +
      (index === 0 && !aprendidaCard ? " card--ultimo" : "") +
      (aprendidaCard ? " card--aprendida" : "");

    const marcaUltimo =
      index === 0 && !aprendidaCard
        ? `<div class="card-latest" role="status">Lo último que dije</div>`
        : "";

    const ejemploTxt = (p.ejemplo || "").trim() || "—";
    const tema = (p.tema || "").trim();
    const etiquetas = (p.etiquetas || "").trim();
    let metaExtra = "";
    if (tema || etiquetas) {
      metaExtra = `<div class="card-extra-meta">`;
      if (tema) {
        metaExtra += `<span class="card-extra-meta__item"><span class="card-extra-meta__k">Tema</span> ${escapeHtml(tema)}</span>`;
      }
      if (etiquetas) {
        metaExtra += `<span class="card-extra-meta__item"><span class="card-extra-meta__k">Etiquetas</span> ${escapeHtml(etiquetas)}</span>`;
      }
      metaExtra += `</div>`;
    }

    const btnEjemplo =
      (p.ejemplo || "").trim() !== ""
        ? `<button type="button" class="btn-leer-ej" aria-label="Leer la frase de ejemplo en inglés">Leer ejemplo</button>`
        : "";

    div.innerHTML = `
      ${marcaUltimo}
      <div class="card-fields">
        <div class="card-field">
          <span class="card-field__label">Main word</span>
          <div class="card-field__value card-field__value--word">${escapeHtml(p.palabra) || "—"}</div>
        </div>
        <div class="card-field">
          <span class="card-field__label">Example sentence</span>
          <div class="card-field__value card-field__value--sentence">${escapeHtml(ejemploTxt)}</div>
        </div>
      </div>
      ${metaExtra}
      <small class="card-meta">${escapeHtml(p.fecha)}</small>

      <div class="card-trad-wrap" hidden>
        <span class="card-trad-label">Traducción (palabra principal)</span>
        <p class="card-trad-text"></p>
      </div>

      <div class="acciones acciones-card">
        <button type="button" class="btn-trad" aria-expanded="false">Traducir</button>
        <button type="button" class="btn-leer" aria-label="Leer la palabra en inglés">Leer</button>
        ${btnEjemplo}
        <button type="button" class="editar" aria-label="Editar">Editar</button>
        <button type="button" class="borrar" aria-label="Borrar">Borrar</button>
      </div>
      <div class="card-learn-wrap">
        <button type="button" class="btn-aprendida" data-id="${p.id}" aria-label="${aprendidaCard ? "Mover a pendientes" : "Marcar como aprendida"}">${aprendidaCard ? "↩ Volver a pendientes" : "🎉 ¡Aprendida!"}</button>
      </div>
    `;

    const tradWrap = div.querySelector(".card-trad-wrap");
    const tradText = div.querySelector(".card-trad-text");
    const btnTrad = div.querySelector(".btn-trad");
    const btnLeer = div.querySelector(".btn-leer");
    const btnLeerEj = div.querySelector(".btn-leer-ej");

    btnTrad.addEventListener("click", () => {
      sfx("tap");
      toggleTraduccion(btnTrad, tradWrap, tradText, p.palabra);
    });

    btnLeer.addEventListener("click", () => {
      sfx("tap");
      speakEnglish(p.palabra);
    });
    if (btnLeerEj) {
      btnLeerEj.addEventListener("click", () => {
        sfx("tap");
        speakEnglish(p.ejemplo);
      });
    }

    div.querySelector(".borrar").addEventListener("click", () => {
      sfx("tap");
      borrar(p.id);
    });

    div.querySelector(".editar").addEventListener("click", () => {
      sfx("tap");
      activarEdicion(div, p);
    });

    div.querySelector(".btn-aprendida").addEventListener("click", () => {
      if (!aprendidaCard) sfx("learned");
      else sfx("tap");
      marcarAprendida(p.id, !aprendidaCard);
    });

    return div;
  };

  ordenadosPendientes.forEach((p, index) => {
    lista.appendChild(renderCard(p, index, false));
  });
  if (ordenadosPendientes.length === 0) {
    lista.innerHTML = `
      <div class="empty-state empty-state--small">
        <span class="empty-state-icon" aria-hidden="true">🔎</span>
        <p>No hay pendientes con este filtro. Probá otra búsqueda.</p>
      </div>
    `;
  }
  if (listaAprendidas) {
    if (ordenadasAprendidas.length === 0) {
      listaAprendidas.innerHTML =
        '<div class="empty-state empty-state--small"><p>Todavía no marcaste palabras como aprendidas.</p></div>';
    } else {
      ordenadasAprendidas.forEach((p, index) => {
        listaAprendidas.appendChild(renderCard(p, index, true));
      });
    }
  }

  window.__palabrasStats = palabrasGlobal;
  if (typeof renderStatsChart === "function") renderStatsChart(palabrasGlobal);
  if (typeof renderProgressMini === "function") renderProgressMini(palabrasGlobal);
}

function marcarAprendida(id, aprendido) {
  const nid = Number(id);
  const triggerConfetti = () => {
    const card = document.querySelector(
      `.card .btn-aprendida[data-id="${nid}"]`
    );
    if (card) {
      const wrap = card.closest(".card");
      if (wrap) {
        wrap.classList.remove("card--confetti");
        void wrap.offsetWidth;
        wrap.classList.add("card--confetti");
      }
    }
  };
  if (modoEstatico && window.PalabrasStatic) {
    const idx = staticStore.additions.findIndex((a) => Number(a.id) === nid);
    if (idx >= 0) {
      staticStore.additions[idx] = {
        ...staticStore.additions[idx],
        aprendido: !!aprendido,
      };
    } else {
      const prev = staticStore.edits[String(nid)] || {};
      staticStore.edits[String(nid)] = { ...prev, aprendido: !!aprendido };
    }
    window.PalabrasStatic.persist(staticStore);
    palabrasGlobal = window.PalabrasStatic.rebuildGlobal(
      palabrasBaseCsv,
      staticStore
    );
    mostrar();
    if (aprendido) triggerConfetti();
    estado(aprendido ? "Archivada como aprendida ✨" : "Regresó a pendientes");
    return;
  }
  fetch(`editar/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aprendido: !!aprendido }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.ok && Array.isArray(data.data)) {
        palabrasGlobal = data.data;
        mostrar();
        if (aprendido) triggerConfetti();
        estado(aprendido ? "Archivada como aprendida ✨" : "Regresó a pendientes");
      }
    })
    .catch(() => {
      estado("No se pudo mover la palabra");
      sfx("fail");
    });
}

function toggleTraduccion(btn, wrap, textEl, palabra) {
  const w = (palabra || "").trim();
  if (!w) {
    textEl.textContent = "—";
    wrap.hidden = false;
    return;
  }

  if (!wrap.hidden && textEl.textContent) {
    sfx("tap");
    wrap.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "Traducir";
    return;
  }

  if (textEl.dataset.loaded === "1") {
    sfx("tap");
    wrap.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.textContent = "Ocultar traducción";
    return;
  }

  btn.disabled = true;
  btn.textContent = "…";

  fetch("traducir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto: w }),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      const ok = data.ok && data.traduccion;
      if (ok) {
        textEl.textContent = data.traduccion;
        textEl.dataset.loaded = "1";
        wrap.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        btn.textContent = "Ocultar traducción";
        sfx("pop");
      } else {
        textEl.textContent =
          data.error ||
          (!res.ok ? "Servicio no disponible" : "No disponible");
        textEl.dataset.loaded = "1";
        wrap.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        btn.textContent = "Ocultar traducción";
        sfx("fail");
      }
    })
    .catch(() => {
      textEl.textContent = "Error de red";
      textEl.dataset.loaded = "1";
      wrap.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "Ocultar traducción";
      sfx("fail");
    })
    .finally(() => {
      btn.disabled = false;
    });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function borrar(id) {
  const nid = Number(id);
  if (modoEstatico && window.PalabrasStatic) {
    let removed = false;
    staticStore.additions = staticStore.additions.filter((a) => {
      if (a.id === nid) {
        removed = true;
        return false;
      }
      return true;
    });
    if (!removed) staticStore.deletedIds.add(nid);
    window.PalabrasStatic.persist(staticStore);
    palabrasGlobal = window.PalabrasStatic.rebuildGlobal(
      palabrasBaseCsv,
      staticStore
    );
    mostrar();
    sfx("pop");
    return;
  }
  fetch(`borrar/${id}`, { method: "DELETE" })
    .then((res) => res.json())
    .then((data) => {
      palabrasGlobal = data.data;
      mostrar();
      sfx("pop");
    });
}

function activarEdicion(div, p) {
  div.innerHTML = `
    <div class="card-edit">
      <label>
        <span class="card-edit-field-label">Main word</span>
        <input id="palabra" value="${escapeAttr(p.palabra)}" placeholder="e.g. sunshine">
      </label>
      <label>
        <span class="card-edit-field-label">Example sentence</span>
        <input id="ejemplo" value="${escapeAttr(p.ejemplo)}" placeholder="e.g. The sunshine feels warm today.">
      </label>
      <label>
        <span class="card-edit-field-label">Tema / fuente</span>
        <input id="tema" value="${escapeAttr(p.tema)}" placeholder="opcional">
      </label>
      <label>
        <span class="card-edit-field-label">Etiquetas (coma)</span>
        <input id="etiquetas" value="${escapeAttr(p.etiquetas)}" placeholder="travel, work">
      </label>
      <div class="card-edit-actions">
        <button type="button" class="guardar">Guardar</button>
        <button type="button" class="cancelar">Cancelar</button>
      </div>
    </div>
  `;

  div.querySelector(".guardar").addEventListener("click", () => {
    sfx("tap");
    const nuevaPalabra = div.querySelector("#palabra").value;
    const nuevoEjemplo = div.querySelector("#ejemplo").value;
    const nuevoTema = div.querySelector("#tema").value;
    const nuevasEtiquetas = div.querySelector("#etiquetas").value;

    if (modoEstatico && window.PalabrasStatic) {
      const pid = Number(p.id);
      const idx = staticStore.additions.findIndex((a) => a.id === pid);
      if (idx >= 0) {
        staticStore.additions[idx] = {
          ...staticStore.additions[idx],
          palabra: nuevaPalabra,
          ejemplo: nuevoEjemplo,
          tema: nuevoTema,
          etiquetas: nuevasEtiquetas,
        };
      } else {
        staticStore.edits[String(pid)] = {
          palabra: nuevaPalabra,
          ejemplo: nuevoEjemplo,
          tema: nuevoTema,
          etiquetas: nuevasEtiquetas,
        };
      }
      window.PalabrasStatic.persist(staticStore);
      palabrasGlobal = window.PalabrasStatic.rebuildGlobal(
        palabrasBaseCsv,
        staticStore
      );
      mostrar();
      sfx("success");
      return;
    }

    fetch(`editar/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        palabra: nuevaPalabra,
        ejemplo: nuevoEjemplo,
        tema: nuevoTema,
        etiquetas: nuevasEtiquetas,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        palabrasGlobal = data.data;
        mostrar();
        sfx("success");
      })
      .catch(() => sfx("fail"));
  });

  div.querySelector(".cancelar").addEventListener("click", () => {
    sfx("tap");
    mostrar();
  });
}

function actualizarContadorPalabras() {
  const n = document.getElementById("word-count-num");
  if (n) n.textContent = String(palabrasGlobal.length);
}

function rankingPalabrasGuardadas(palabras) {
  const map = new Map();
  for (const p of palabras) {
    const raw = (p.palabra || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { count: 0, display: raw });
    }
    const e = map.get(key);
    e.count += 1;
  }
  return [...map.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.display.localeCompare(b.display, "en", { sensitivity: "base" });
    })
    .map((e) => ({ word: e.display, count: e.count }));
}

function normalizarTexto(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

function coincideAproximado(needle, text) {
  if (!needle || !text) return false;
  if (text.includes(needle)) return true;
  const words = text.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const maxDist = needle.length <= 4 ? 1 : 2;
  const minWordLen = Math.max(3, needle.length - maxDist);
  const maxWordLen = needle.length + maxDist;
  for (const w of words) {
    if (w.length < minWordLen || w.length > maxWordLen) continue;
    if (w.includes(needle)) return true;
    const d = levenshtein(needle, w);
    if (d <= maxDist) return true;
  }
  return false;
}

function filtrarPalabras(palabras, query) {
  const q = normalizarTexto(query);
  if (!q) return palabras;
  return palabras.filter((p) => {
    const fields = [
      p.palabra,
      p.ejemplo,
      p.tema,
      p.etiquetas,
      p.fecha,
    ].map(normalizarTexto);
    return fields.some((txt) => coincideAproximado(q, txt));
  });
}

function wireSearch() {
  const input = document.getElementById("search-words");
  if (!input) return;
  input.addEventListener("input", () => {
    busquedaActual = input.value || "";
    mostrar();
  });
}

function renderHappyRanking() {
  const ul = document.getElementById("happy-list");
  if (!ul) return;
  const rows = rankingPalabrasGuardadas(palabrasGlobal);
  if (rows.length === 0) {
    ul.innerHTML =
      '<li class="happy-list__empty">Aún no hay palabras guardadas.</li>';
    return;
  }
  ul.innerHTML = rows
    .map(
      (r) =>
        `<li class="happy-list__row">
      <span class="happy-list__word">${escapeHtml(r.word)}</span>
      <span class="happy-list__count" title="Veces que la dijiste">${r.count}×</span>
    </li>`
    )
    .join("");
}

(async function iniciarDatosPalabras() {
  if (window.PalabrasStatic && window.PalabrasStatic.loadInitial) {
    try {
      const r = await window.PalabrasStatic.loadInitial();
      modoEstatico = !!r.modoEstatico;
      palabrasGlobal = Array.isArray(r.palabras) ? r.palabras : [];
      palabrasBaseCsv = Array.isArray(r.baseCsv) ? r.baseCsv : [];
      staticStore = r.store || staticStore;
      if (!(staticStore.deletedIds instanceof Set)) {
        const arr = staticStore.deletedIds;
        staticStore.deletedIds = new Set(
          Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : []
        );
      }
    } catch (err) {
      console.warn("loadInitial", err);
    }
  } else {
    try {
      const r = await fetch("api/palabras");
      if (r.ok) {
        const data = await r.json();
        if (data.ok && Array.isArray(data.data)) palabrasGlobal = data.data;
      }
    } catch {
      /* */
    }
    if (!palabrasGlobal.length) {
      try {
        const rj = await fetch("api/palabras.json");
        if (rj.ok) {
          const data = await rj.json();
          if (data.ok && Array.isArray(data.data)) palabrasGlobal = data.data;
        }
      } catch {
        /* */
      }
    }
  }

  mostrar();
  actualizarCuentaRegresiva();
  initVoiceControls();
  wireSearch();
  wireImportExport();
  wireNotifyButton();
  wireSoundToggle();
  wireSfxVolume();
  wireEjemploSugerido();
  // recordatorios desactivados a pedido del usuario
})();

function actualizarCuentaRegresiva() {
  const line = document.getElementById("deadline-line");
  if (!line) return;

  const deadline = new Date(2027, 2, 20);
  deadline.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = Math.round((deadline - today) / 86400000);

  if (diff > 0) {
    line.textContent = `${diff} días hasta tu meta de inglés (20 mar 2027)`;
  } else if (diff === 0) {
    line.textContent = "Hoy es tu meta: 20 mar 2027 · ¡sigue sumando palabras!";
  } else {
    line.textContent = "Meta 20 mar 2027 · ¡sigue practicando!";
  }
}
