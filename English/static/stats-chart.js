/**
 * Gráfico de palabras añadidas por día (últimos 31 días) o por mes (últimos 12 meses).
 * Requiere Chart.js (UMD) cargado antes de este archivo.
 */
let statsChartInstance = null;

function parseFechaDDMMYYYY(s) {
  const m = String(s || "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  const d = new Date(year, month, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

function ymdLocal(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function buildDaySeries(palabras, daysBack) {
  const counts = new Map();
  for (const p of palabras) {
    const d = parseFechaDDMMYYYY(p.fecha);
    if (!d) continue;
    const k = ymdLocal(d);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const labels = [];
  const data = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = daysBack - 1; i >= 0; i--) {
    const dt = new Date(today);
    dt.setDate(dt.getDate() - i);
    const k = ymdLocal(dt);
    labels.push(
      dt.toLocaleDateString("es", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    );
    data.push(counts.get(k) || 0);
  }
  return { labels, data };
}

function buildMonthSeries(palabras, monthsBack) {
  const counts = new Map();
  for (const p of palabras) {
    const d = parseFechaDDMMYYYY(p.fecha);
    if (!d) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const labels = [];
  const data = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    labels.push(
      dt.toLocaleDateString("es", { month: "short", year: "numeric" })
    );
    data.push(counts.get(k) || 0);
  }
  return { labels, data };
}

function destroyStatsChart() {
  if (statsChartInstance) {
    statsChartInstance.destroy();
    statsChartInstance = null;
  }
}

function renderStatsChart(palabras) {
  const canvas = document.getElementById("stats-chart");
  const emptyEl = document.getElementById("stats-chart-empty");
  const wrap = document.getElementById("stats-chart-wrap");

  if (!canvas || typeof Chart === "undefined") {
    if (wrap) wrap.hidden = true;
    return;
  }

  destroyStatsChart();

  if (!palabras || palabras.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    if (wrap) wrap.hidden = true;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (wrap) wrap.hidden = false;

  const mode =
    document.querySelector('input[name="stats-granularity"]:checked')
      ?.value || "day";
  const { labels, data } =
    mode === "month"
      ? buildMonthSeries(palabras, 12)
      : buildDaySeries(palabras, 31);

  const labelShort =
    mode === "month"
      ? "Palabras añadidas por mes"
      : "Palabras añadidas por día";

  statsChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: labelShort,
          data,
          backgroundColor: "rgba(244, 114, 182, 0.45)",
          borderColor: "rgba(236, 72, 153, 0.85)",
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: mode === "month" ? 28 : 12,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(30, 20, 45, 0.92)",
          titleColor: "#fce7f3",
          bodyColor: "#fff5f9",
          borderColor: "rgba(244, 114, 182, 0.35)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#c4b5d8",
            maxRotation: mode === "day" ? 60 : 45,
            autoSkip: true,
            maxTicksLimit: mode === "day" ? 14 : 12,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#c4b5d8",
            stepSize: 1,
            precision: 0,
          },
          grid: { color: "rgba(255,255,255,0.07)" },
        },
      },
    },
  });
}

function wireStatsControls() {
  document.querySelectorAll('input[name="stats-granularity"]').forEach((el) => {
    el.addEventListener("change", () => {
      const data = window.__palabrasStats || [];
      renderStatsChart(data);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireStatsControls);
} else {
  wireStatsControls();
}

/**
 * Mini barras: últimos 7 días (misma lógica de fechas que el gráfico grande).
 */
function renderProgressMini(palabras) {
  const svg = document.getElementById("progress-mini-svg");
  const wrap = document.getElementById("progress-mini-wrap");
  if (!svg || !wrap) return;

  const { data, labels } = buildDaySeries(palabras || [], 7);
  const max = Math.max(1, ...data);
  const W = 140;
  const H = 34;
  const pad = 3;
  const n = 7;
  const bw = (W - (n - 1) * pad) / n;
  const baseY = H - 4;

  const ns = "http://www.w3.org/2000/svg";
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const titleEl = document.createElementNS(ns, "title");
  titleEl.id = "progress-mini-title";
  titleEl.textContent =
    "Palabras añadidas por día en la última semana";
  svg.appendChild(titleEl);

  for (let i = 0; i < n; i++) {
    const h = Math.max(2, (data[i] / max) * (H - 10));
    const y = baseY - h;
    const x = i * (bw + pad);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(bw));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", "rgba(244, 114, 182, 0.55)");
    rect.setAttribute("stroke", "rgba(236, 72, 153, 0.45)");
    rect.setAttribute("stroke-width", "0.5");
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `${labels[i]}: ${data[i]} palabra(s)`;
    rect.appendChild(tip);
    svg.appendChild(rect);
  }
}

window.renderStatsChart = renderStatsChart;
window.renderProgressMini = renderProgressMini;
