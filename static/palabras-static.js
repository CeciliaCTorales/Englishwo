/**
 * GitHub Pages / sin Flask: CSV en repo + localStorage (añadidos, borrados, ediciones).
 */
(function () {
  const LS_ADD = "palabras_static_additions";
  const LS_DEL = "palabras_static_deleted_csv_ids";
  const LS_EDIT = "palabras_static_edits";

  function parseCSV(text) {
    const rows = [];
    let i = 0;
    let field = "";
    let row = [];
    let inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          i++;
          if (text[i] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
          i++;
        }
      } else if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (c === "\r") {
        i++;
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += c;
        i++;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function csvTextToObjects(text) {
    const rows = parseCSV(text.trim());
    if (!rows.length) return [];
    const headers = rows[0].map((h) => (h || "").trim());
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells || !cells.length || cells.every((c) => !(c || "").trim())) continue;
      const o = {};
      headers.forEach((h, j) => {
        o[h] = (cells[j] ?? "").trim();
      });
      let id = parseInt(String(o.id || "").trim(), 10);
      if (!Number.isFinite(id)) continue;
      out.push({
        id,
        palabra: o.palabra || "",
        ejemplo: o.ejemplo || "",
        dicho: o.dicho || "",
        fecha: o.fecha || "",
        tema: o.tema || "",
        etiquetas: o.etiquetas || "",
        aprendido: ["1", "true", "si", "sí", "yes"].includes(
          String(o.aprendido || "").toLowerCase()
        ),
      });
    }
    return out;
  }

  function loadStore() {
    let additions = [];
    let deletedIds = new Set();
    let edits = {};
    try {
      additions = JSON.parse(localStorage.getItem(LS_ADD) || "[]");
      if (!Array.isArray(additions)) additions = [];
    } catch {
      additions = [];
    }
    try {
      const d = JSON.parse(localStorage.getItem(LS_DEL) || "[]");
      deletedIds = new Set(Array.isArray(d) ? d.map(Number).filter(Number.isFinite) : []);
    } catch {
      deletedIds = new Set();
    }
    try {
      edits = JSON.parse(localStorage.getItem(LS_EDIT) || "{}");
      if (!edits || typeof edits !== "object") edits = {};
    } catch {
      edits = {};
    }
    return { additions, deletedIds, edits };
  }

  function saveStore(store) {
    localStorage.setItem(LS_ADD, JSON.stringify(store.additions));
    localStorage.setItem(LS_DEL, JSON.stringify([...store.deletedIds]));
    localStorage.setItem(LS_EDIT, JSON.stringify(store.edits));
  }

  function mergeIntoBase(baseCsv, store) {
    const out = [];
    for (const row of baseCsv) {
      const id = Number(row.id);
      if (store.deletedIds.has(id)) continue;
      const ex = store.edits[String(id)];
      out.push(ex ? { ...row, ...ex } : { ...row });
    }
    for (const a of store.additions) {
      out.push({ ...a });
    }
    return out.sort((a, b) => Number(b.id) - Number(a.id));
  }

  window.PalabrasStatic = {
    LS_ADD,
    LS_DEL,
    LS_EDIT,
    parseCSV,
    csvTextToObjects,
    loadStore,
    saveStore,
    mergeIntoBase,

    async loadInitial() {
      let servidorOk = false;
      try {
        const r = await fetch("api/palabras", { cache: "no-store" });
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          if (data.ok && Array.isArray(data.data)) {
            servidorOk = true;
            return {
              modoEstatico: false,
              palabras: data.data,
              baseCsv: [],
              store: { additions: [], deletedIds: new Set(), edits: {} },
            };
          }
        }
      } catch {
        /* */
      }

      const store = loadStore();
      let baseCsv = [];

      try {
        const rj = await fetch("api/palabras.json", { cache: "no-store" });
        if (rj.ok) {
          const data = await rj.json().catch(() => ({}));
          if (data.ok && Array.isArray(data.data) && data.data.length) {
            baseCsv = data.data.map((p) => ({
              id: Number(p.id),
              palabra: p.palabra || "",
              ejemplo: p.ejemplo || "",
              dicho: p.dicho || "",
              fecha: p.fecha || "",
              tema: p.tema || "",
              etiquetas: p.etiquetas || "",
              aprendido: !!p.aprendido,
            }));
          }
        }
      } catch {
        /* */
      }

      if (baseCsv.length === 0) {
        try {
          const rc = await fetch("data/palabras.csv", { cache: "no-store" });
          if (rc.ok) {
            baseCsv = csvTextToObjects(await rc.text());
          }
        } catch {
          /* */
        }
      }

      const palabras = mergeIntoBase(baseCsv, store);
      return {
        modoEstatico: true,
        palabras,
        baseCsv,
        store,
        servidorAlcanzado: servidorOk,
      };
    },

    persist(store) {
      saveStore(store);
    },

    rebuildGlobal(baseCsv, store) {
      return mergeIntoBase(baseCsv, store);
    },
  };
})();
