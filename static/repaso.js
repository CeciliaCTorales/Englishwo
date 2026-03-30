const LS_RATE = "palabras_speech_rate";
const LS_VOICE = "palabras_speech_voice";

function getSpeechRate() {
  const r = parseFloat(localStorage.getItem(LS_RATE));
  if (Number.isFinite(r) && r >= 0.5 && r <= 1.5) return r;
  return 0.92;
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

function normalizeSpanish(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitExpectedVariants(s) {
  return (s || "")
    .split(/\s*(?:[/|]|\s+o\s+)\s*/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** El texto corto aparece como palabra o frase completa dentro del largo (evita "sol" en "consolar"). */
function embeddedAsWordOrPhrase(longer, shorter) {
  if (!shorter) return false;
  if (longer === shorter) return true;
  let idx = longer.indexOf(shorter);
  while (idx !== -1) {
    const beforeOk = idx === 0 || /\s/.test(longer[idx - 1]);
    const after = idx + shorter.length;
    const afterOk = after === longer.length || /\s/.test(longer[after]);
    if (beforeOk && afterOk) return true;
    idx = longer.indexOf(shorter, idx + 1);
  }
  return false;
}

function singleTranslationMatch(userRaw, expectedRaw) {
  const a = normalizeSpanish(userRaw);
  const b = normalizeSpanish(expectedRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 2 && embeddedAsWordOrPhrase(longer, shorter)) return true;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  return maxLen > 0 && (maxLen - dist) / maxLen >= 0.8;
}

function answersMatch(userSpoken, expectedFromServer) {
  const variants = splitExpectedVariants(expectedFromServer);
  const list = variants.length ? variants : [expectedFromServer];
  return list.some((exp) => singleTranslationMatch(userSpoken, exp));
}

function tagFilter(tag) {
  const q = (tag || "").trim().toLowerCase();
  if (!q) return () => true;
  return (p) => {
    const raw = (p.etiquetas || "").toLowerCase();
    return raw.split(",").some((s) => s.trim() === q || s.trim().includes(q));
  };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let queue = [];
let current = null;
/** Traducción de referencia solo de la palabra principal (inglés → es). */
let expectedSpanish = null;
let currentRandomExample = "";
/** Evita aplicar una oración cargada a la tarjeta equivocada si cambiás rápido de palabra. */
let sentenceLoadSeq = 0;
let repasoNavStarted = false;

/** En repaso usamos solo sonidos “mágicos” (campanillas / arpegios). */
const REPASO_SFX = {
  tap: "magicTap",
  pop: "magicPop",
  success: "magicSuccess",
  fail: "magicFail",
  card: "magicCard",
  reveal: "magicReveal",
  sentence: "magicSentence",
};

function sfx(name) {
  const U = window.UISounds;
  const method = REPASO_SFX[name] || name;
  if (U && typeof U[method] === "function") {
    try {
      U[method]();
    } catch {
      /* */
    }
  }
}

let answerRecognition = null;
let answerGrabando = false;
let answerTextoAcumulado = "";

const elEmpty = document.getElementById("repaso-empty");
const elCard = document.getElementById("repaso-card");
const elFilter = document.getElementById("repaso-filter");
const elWord = document.getElementById("repaso-word");
const elExampleLabel = document.getElementById("repaso-example-label");
const elExample = document.getElementById("repaso-example");
const elTradWrap = document.getElementById("repaso-trad-wrap");
const elTrad = document.getElementById("repaso-trad");
const elRefStatus = document.getElementById("repaso-ref-status");
const elHeard = document.getElementById("repaso-heard");
const elVerdict = document.getElementById("repaso-verdict");
const btnSpeak = document.getElementById("repaso-speak");
const btnReveal = document.getElementById("repaso-reveal");
const btnNext = document.getElementById("repaso-next");
const btnAnswerMic = document.getElementById("repaso-answer-mic");
const elRandomLine = document.getElementById("repaso-random-line");
const elRandomHint = document.getElementById("repaso-random-hint");
const btnRandomExample = document.getElementById("repaso-random-example");

function paramsTag() {
  return new URLSearchParams(window.location.search).get("tag") || "";
}

async function prefetchExpectedTranslation(p) {
  expectedSpanish = null;
  elRefStatus.textContent = "";
  if (!btnAnswerMic) return;
  const w = (p.palabra || "").trim();
  if (!w) {
    btnAnswerMic.disabled = true;
    return;
  }
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    elRefStatus.textContent =
      "Tu navegador no permite reconocimiento de voz para comparar.";
    btnAnswerMic.disabled = true;
    return;
  }
  btnAnswerMic.disabled = true;
  elRefStatus.textContent = "Preparando referencia…";
  try {
    const res = await fetch("traducir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: w }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.traduccion) {
      expectedSpanish = String(data.traduccion).trim();
      elRefStatus.textContent = "Listo: decí la traducción y pulsá Detener.";
      btnAnswerMic.disabled = false;
    } else {
      elRefStatus.textContent =
        data.error || "No se pudo obtener la traducción de referencia.";
      btnAnswerMic.disabled = true;
    }
  } catch {
    elRefStatus.textContent = "Error de red al traducir la palabra.";
    btnAnswerMic.disabled = true;
  }
}

function stopAnswerListening() {
  if (!answerRecognition) return;
  answerGrabando = false;
  answerRecognition.onend = () => {
    answerRecognition.onend = null;
    flushAnswerSession();
  };
  try {
    answerRecognition.stop();
  } catch {
    answerRecognition.onend = null;
    flushAnswerSession();
  }
}

function flushAnswerSession() {
  const texto = answerTextoAcumulado.trim();
  answerTextoAcumulado = "";
  if (btnAnswerMic) {
    btnAnswerMic.classList.remove("recording");
    btnAnswerMic.textContent = "Decir respuesta";
  }
  if (!texto) {
    elHeard.textContent = answerGrabando ? "" : "No se oyó nada. Probá de nuevo.";
    return;
  }
  elHeard.textContent = `Te escuché: «${texto}»`;
  if (!expectedSpanish) {
    elVerdict.hidden = false;
    elVerdict.className = "repaso-verdict repaso-verdict--warn";
    elVerdict.textContent =
      "No hay traducción de referencia todavía. Esperá un momento o pasá a otra tarjeta.";
    return;
  }
  const ok = answersMatch(texto, expectedSpanish);
  elVerdict.hidden = false;
  if (ok) {
    sfx("success");
    elVerdict.className = "repaso-verdict repaso-verdict--ok";
    elVerdict.textContent = "¡Correcto! Coincide con la traducción de la palabra principal.";
  } else {
    sfx("fail");
    elVerdict.className = "repaso-verdict repaso-verdict--bad";
    elVerdict.textContent = `Incorrecto o distinto. Referencia: «${expectedSpanish}».`;
  }
}

function startAnswerListening() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return;
  answerRecognition = new Rec();
  answerRecognition.lang = "es-ES";
  answerRecognition.interimResults = false;
  answerRecognition.continuous = true;
  answerTextoAcumulado = "";

  answerRecognition.onstart = () => {
    answerGrabando = true;
    btnAnswerMic.classList.add("recording");
    btnAnswerMic.textContent = "Detener";
    elVerdict.hidden = true;
    elHeard.textContent = "Escuchando en castellano…";
  };

  answerRecognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) {
        const chunk = r[0].transcript.trim();
        if (chunk) {
          answerTextoAcumulado += (answerTextoAcumulado ? " " : "") + chunk;
        }
      }
    }
    if (answerGrabando) {
      elHeard.textContent = "Escuchando en castellano…";
    }
  };

  answerRecognition.onend = () => {
    if (!answerGrabando) return;
    try {
      answerRecognition.start();
    } catch {
      /* */
    }
  };

  try {
    answerRecognition.start();
  } catch {
    elHeard.textContent = "No se pudo iniciar el micrófono.";
  }
}

function toggleAnswerMic() {
  if (!expectedSpanish) return;
  if (!answerGrabando) {
    sfx("tap");
    startAnswerListening();
  } else {
    sfx("pop");
    stopAnswerListening();
  }
}

function resetAnswerUI() {
  answerGrabando = false;
  answerTextoAcumulado = "";
  if (answerRecognition) {
    try {
      answerRecognition.onend = null;
      answerRecognition.abort();
    } catch {
      /* */
    }
    answerRecognition = null;
  }
  if (elHeard) elHeard.textContent = "";
  if (elVerdict) {
    elVerdict.hidden = true;
    elVerdict.textContent = "";
    elVerdict.className = "repaso-verdict";
  }
}

function textoParaTraducirRepaso() {
  if (!current) return "";
  const w = (current.palabra || "").trim();
  const ex = (current.ejemplo || "").trim();
  if (ex) return `${w}. ${ex}`;
  const dict = (currentRandomExample || "").trim();
  if (dict) return `${w}. ${dict}`;
  return w;
}

async function fetchDictionaryLine(w) {
  const res = await fetch(
    `api/ejemplo-aleatorio?${new URLSearchParams({ w })}`
  );
  return res.json().catch(() => ({}));
}

/** Si no hay frase guardada en la lista, carga sola una oración del diccionario (por defecto). */
async function loadDefaultSentenceIfNeeded(p) {
  const ex = (p.ejemplo || "").trim();
  if (ex) {
    currentRandomExample = "";
    if (elRandomLine) {
      elRandomLine.textContent = "";
      elRandomLine.hidden = true;
    }
    if (elRandomHint) {
      elRandomHint.textContent =
        "Podés pedir otra oración del diccionario con el botón de abajo.";
    }
    return;
  }
  const w = (p.palabra || "").trim();
  if (!w) return;
  const seq = ++sentenceLoadSeq;
  currentRandomExample = "";
  if (elRandomLine) {
    elRandomLine.hidden = false;
    elRandomLine.textContent = "Cargando oración…";
  }
  if (elRandomHint) {
    elRandomHint.textContent = "Buscando una oración por defecto en el diccionario…";
  }
  try {
    const data = await fetchDictionaryLine(w);
    if (seq !== sentenceLoadSeq || current?.id !== p.id) return;
    if (data.ok && data.ejemplo) {
      currentRandomExample = String(data.ejemplo).trim();
      if (elRandomLine) {
        elRandomLine.textContent = currentRandomExample;
        elRandomLine.hidden = false;
      }
      if (elRandomHint) {
        elRandomHint.textContent =
          "Oración por defecto (diccionario). «Otra oración al azar» cambia el texto.";
      }
    } else {
      currentRandomExample = "";
      if (elRandomLine) {
        elRandomLine.textContent = data.error || "Sin oración automática.";
        elRandomLine.hidden = false;
      }
      if (elRandomHint) {
        elRandomHint.textContent = "Probá el botón de abajo o revisá la palabra en la lista.";
      }
    }
  } catch {
    if (seq !== sentenceLoadSeq || current?.id !== p.id) return;
    currentRandomExample = "";
    if (elRandomLine) {
      elRandomLine.textContent = "Error de red.";
      elRandomLine.hidden = false;
    }
  }
}

function showEntry(p) {
  current = p;
  resetAnswerUI();
  currentRandomExample = "";
  if (elRandomLine) {
    elRandomLine.textContent = "";
    elRandomLine.hidden = true;
  }
  if (elRandomHint) {
    elRandomHint.textContent =
      "Oraciones del diccionario en inglés. Sin frase guardada, se muestra una por defecto.";
  }
  if (btnRandomExample) btnRandomExample.disabled = false;
  elTradWrap.hidden = true;
  elTrad.textContent = "";
  elTrad.dataset.loaded = "";
  elWord.textContent = (p.palabra || "").trim() || "—";
  const ex = (p.ejemplo || "").trim();
  if (ex) {
    elExample.textContent = ex;
    elExample.hidden = false;
    if (elExampleLabel) elExampleLabel.hidden = false;
  } else {
    elExample.textContent = "";
    elExample.hidden = true;
    if (elExampleLabel) elExampleLabel.hidden = true;
  }
  btnReveal.textContent = "Mostrar traducción";
  elCard.hidden = false;
  prefetchExpectedTranslation(p);
  loadDefaultSentenceIfNeeded(p);
}

function nextCard() {
  resetAnswerUI();
  if (queue.length === 0) {
    elCard.hidden = true;
    elEmpty.hidden = false;
    return;
  }
  if (repasoNavStarted) sfx("card");
  else repasoNavStarted = true;
  const p = queue.shift();
  queue.push(p);
  showEntry(p);
}

async function reveal() {
  if (!current) return;
  if (!elTradWrap.hidden && elTrad.textContent) {
    sfx("tap");
    elTradWrap.hidden = true;
    btnReveal.textContent = "Mostrar traducción";
    return;
  }
  const texto = textoParaTraducirRepaso();
  if (!texto) return;
  if (elTrad.dataset.loaded === "1" && elTrad.textContent) {
    sfx("tap");
    elTradWrap.hidden = false;
    btnReveal.textContent = "Ocultar traducción";
    return;
  }
  sfx("tap");
  btnReveal.disabled = true;
  btnReveal.textContent = "…";
  try {
    const res = await fetch("traducir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.traduccion) {
      elTrad.textContent = data.traduccion;
      elTrad.dataset.loaded = "1";
      elTradWrap.hidden = false;
      btnReveal.textContent = "Ocultar traducción";
      sfx("reveal");
    } else {
      elTrad.textContent = data.error || "No disponible";
      elTrad.dataset.loaded = "1";
      elTradWrap.hidden = false;
      btnReveal.textContent = "Ocultar traducción";
      sfx("fail");
    }
  } catch {
    elTrad.textContent = "Error de red";
    elTrad.dataset.loaded = "1";
    elTradWrap.hidden = false;
    btnReveal.textContent = "Ocultar traducción";
    sfx("fail");
  }
  btnReveal.disabled = false;
}

function speakCurrent() {
  if (!current) return;
  sfx("tap");
  const w = (current.palabra || "").trim();
  const ex = (current.ejemplo || "").trim();
  if (ex) {
    speakEnglish(`${w}. ${ex}`);
    return;
  }
  const dict = (currentRandomExample || "").trim();
  if (dict) {
    speakEnglish(`${w}. ${dict}`);
    return;
  }
  speakEnglish(w);
}

async function fetchRandomExample() {
  if (!current || !btnRandomExample) return;
  const w = (current.palabra || "").trim();
  if (!w) return;
  sfx("tap");
  btnRandomExample.disabled = true;
  if (elRandomHint) elRandomHint.textContent = "Buscando en el diccionario…";
  try {
    const data = await fetchDictionaryLine(w);
    if (data.ok && data.ejemplo) {
      currentRandomExample = String(data.ejemplo).trim();
      if (elRandomLine) {
        elRandomLine.textContent = currentRandomExample;
        elRandomLine.hidden = false;
      }
      if (elRandomHint) {
        elRandomHint.textContent =
          "Oración en inglés del diccionario · «Escuchar» la lee en voz alta.";
      }
      sfx("sentence");
    } else {
      currentRandomExample = "";
      if (elRandomLine) {
        elRandomLine.textContent = data.error || "Sin resultado.";
        elRandomLine.hidden = false;
      }
      if (elRandomHint) elRandomHint.textContent = "Probá de nuevo u otra palabra.";
      sfx("fail");
    }
  } catch {
    currentRandomExample = "";
    if (elRandomLine) {
      elRandomLine.textContent = "Error de red.";
      elRandomLine.hidden = false;
    }
    sfx("fail");
  }
  btnRandomExample.disabled = false;
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

btnReveal.addEventListener("click", reveal);
btnNext.addEventListener("click", () => {
  sfx("tap");
  nextCard();
});
btnSpeak.addEventListener("click", speakCurrent);
if (btnAnswerMic) {
  btnAnswerMic.addEventListener("click", toggleAnswerMic);
}
if (btnRandomExample) {
  btnRandomExample.addEventListener("click", fetchRandomExample);
}

wireSoundToggle();
wireSfxVolume();

if (window.speechSynthesis) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {});
}

function loadRepasoPalabras(data) {
  const all = data.ok && Array.isArray(data.data) ? data.data : [];
  const tag = paramsTag();
  const filt = tagFilter(tag);
  const list = all.filter((p) => (p.palabra || "").trim() && filt(p));
  if (tag) {
    elFilter.textContent = `Filtro: etiqueta «${tag}»`;
    elFilter.hidden = false;
  }
  if (list.length === 0) {
    elEmpty.hidden = false;
    return;
  }
  queue = shuffle(list);
  nextCard();
}

fetch("api/palabras")
  .then((r) => {
    if (!r.ok) throw new Error("no api");
    return r.json();
  })
  .then(loadRepasoPalabras)
  .catch(() =>
    fetch("api/palabras.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(loadRepasoPalabras)
      .catch(() => {
        elEmpty.hidden = false;
        elEmpty.querySelector("p").textContent =
          "No se pudo cargar la lista. En GitHub Pages usá api/palabras.json o abrí el sitio con Flask.";
      })
  );
