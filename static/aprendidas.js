let palabrasGlobal = [];
let modoEstatico = false;
let staticStore = { additions: [], deletedIds: new Set(), edits: {} };
let palabrasBaseCsv = [];

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function speakEnglish(text) {
  const t = (text || "").trim();
  if (!t || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "en-US";
  u.rate = 0.92;
  window.speechSynthesis.speak(u);
}

function setAprendidasCount(n) {
  const el = document.getElementById("aprendidas-count");
  if (!el) return;
  el.textContent = `${n} palabra${n === 1 ? "" : "s"} aprendida${n === 1 ? "" : "s"}`;
}

function renderAprendidas() {
  const lista = document.getElementById("lista-aprendidas-page");
  if (!lista) return;
  lista.innerHTML = "";

  const aprendidas = palabrasGlobal
    .filter((p) => !!p.aprendido)
    .sort((a, b) => Number(b.id) - Number(a.id));

  setAprendidasCount(aprendidas.length);

  if (aprendidas.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">🎓</span>
        <p>Aún no hay palabras archivadas como aprendidas.</p>
      </div>
    `;
    return;
  }

  for (const p of aprendidas) {
    const ejemploTxt = (p.ejemplo || "").trim() || "—";
    const tema = (p.tema || "").trim();
    const etiquetas = (p.etiquetas || "").trim();
    const meta = `${tema ? `Tema: ${escapeHtml(tema)} · ` : ""}${etiquetas ? `Etiquetas: ${escapeHtml(etiquetas)}` : ""}`.trim();

    const div = document.createElement("div");
    div.className = "card card--aprendida";
    div.innerHTML = `
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
      <small class="card-meta">${escapeHtml(p.fecha)}${meta ? ` · ${meta}` : ""}</small>
      <div class="acciones acciones-card">
        <button type="button" class="btn-leer">Leer</button>
        <button type="button" class="btn-aprendida">↩ Volver a pendientes</button>
      </div>
    `;

    div.querySelector(".btn-leer").addEventListener("click", () => {
      window.UISounds?.tap?.();
      speakEnglish(p.palabra);
    });

    div.querySelector(".btn-aprendida").addEventListener("click", () => {
      window.UISounds?.tap?.();
      marcarAprendida(p.id, false);
    });

    lista.appendChild(div);
  }
}

function marcarAprendida(id, aprendido) {
  const nid = Number(id);
  if (modoEstatico && window.PalabrasStatic) {
    const idx = staticStore.additions.findIndex((a) => Number(a.id) === nid);
    if (idx >= 0) {
      staticStore.additions[idx] = { ...staticStore.additions[idx], aprendido: !!aprendido };
    } else {
      const prev = staticStore.edits[String(nid)] || {};
      staticStore.edits[String(nid)] = { ...prev, aprendido: !!aprendido };
    }
    window.PalabrasStatic.persist(staticStore);
    palabrasGlobal = window.PalabrasStatic.rebuildGlobal(palabrasBaseCsv, staticStore);
    renderAprendidas();
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
        renderAprendidas();
      }
    })
    .catch(() => {});
}

(async function initAprendidas() {
  if (window.PalabrasStatic && window.PalabrasStatic.loadInitial) {
    const r = await window.PalabrasStatic.loadInitial();
    modoEstatico = !!r.modoEstatico;
    palabrasGlobal = Array.isArray(r.palabras) ? r.palabras : [];
    palabrasBaseCsv = Array.isArray(r.baseCsv) ? r.baseCsv : [];
    staticStore = r.store || staticStore;
    if (!(staticStore.deletedIds instanceof Set)) {
      staticStore.deletedIds = new Set(Array.isArray(staticStore.deletedIds) ? staticStore.deletedIds : []);
    }
    renderAprendidas();
    return;
  }

  fetch("api/palabras")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      palabrasGlobal = data.ok && Array.isArray(data.data) ? data.data : [];
      renderAprendidas();
    })
    .catch(() => renderAprendidas());
})();
