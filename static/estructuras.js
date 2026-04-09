(function () {
  const DRILLS = [
    {
      contextEs: "Situación: hablar de trabajo.",
      affirm: "She works at a hospital.",
      neg: "She doesn't work at a hospital.",
      yn: "Does she work at a hospital?",
      wh: "Where does she work?",
      whWord: "where",
    },
    {
      contextEs: "Situación: gustos y café.",
      affirm: "They like coffee.",
      neg: "They don't like coffee.",
      yn: "Do they like coffee?",
      wh: "What do they like?",
      whWord: "what",
    },
    {
      contextEs: "Situación: vivir en una ciudad.",
      affirm: "He lives in Madrid.",
      neg: "He doesn't live in Madrid.",
      yn: "Does he live in Madrid?",
      wh: "Where does he live?",
      whWord: "where",
    },
    {
      contextEs: "Situación: hablar otro idioma.",
      affirm: "Maria speaks English.",
      neg: "Maria doesn't speak English.",
      yn: "Does Maria speak English?",
      wh: "What language does Maria speak?",
      whWord: "what language",
    },
    {
      contextEs: "Situación: estudiar por la noche.",
      affirm: "You study at night.",
      neg: "You don't study at night.",
      yn: "Do you study at night?",
      wh: "When do you study?",
      whWord: "when",
    },
    {
      contextEs: "Situación: el clima.",
      affirm: "It rains a lot here.",
      neg: "It doesn't rain a lot here.",
      yn: "Does it rain a lot here?",
      wh: "How often does it rain here?",
      whWord: "how often",
    },
    {
      contextEs: "Situación: tener un perro.",
      affirm: "We have a dog.",
      neg: "We don't have a dog.",
      yn: "Do we have a dog?",
      wh: "What do we have?",
      whWord: "what",
    },
    {
      contextEs: "Situación: jugar al tenis.",
      affirm: "She plays tennis.",
      neg: "She doesn't play tennis.",
      yn: "Does she play tennis?",
      wh: "What does she play?",
      whWord: "what",
    },
  ];

  let idx = 0;

  function norm(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[’']/g, "'")
      .toLowerCase();
  }

  function ok(user, expected) {
    return norm(user) === norm(expected);
  }

  function shuffleStart() {
    idx = Math.floor(Math.random() * DRILLS.length);
  }

  function render() {
    const d = DRILLS[idx];
    document.getElementById("estructuras-context").textContent = d.contextEs;
    document.getElementById("estructuras-affirm").textContent = d.affirm;
    document.getElementById("estructuras-wh-hint").textContent =
      "Pista: empezá con «" + d.whWord + "»…";
    ["estructuras-input-neg", "estructuras-input-yn", "estructuras-input-wh"].forEach(
      function (id) {
        const el = document.getElementById(id);
        if (el) el.value = "";
      }
    );
    document.getElementById("estructuras-feedback").textContent = "";
    document.getElementById("estructuras-models").hidden = true;
    document.getElementById("estructuras-model-neg").textContent = d.neg;
    document.getElementById("estructuras-model-yn").textContent = d.yn;
    document.getElementById("estructuras-model-wh").textContent = d.wh;
  }

  function check() {
    const d = DRILLS[idx];
    const neg = document.getElementById("estructuras-input-neg").value;
    const yn = document.getElementById("estructuras-input-yn").value;
    const wh = document.getElementById("estructuras-input-wh").value;
    const nOk = ok(neg, d.neg);
    const yOk = ok(yn, d.yn);
    const wOk = ok(wh, d.wh);
    const fb = document.getElementById("estructuras-feedback");
    const parts = [];
    parts.push(nOk ? "Negación: bien ✓" : "Negación: revisá");
    parts.push(yOk ? "Pregunta sí/no: bien ✓" : "Pregunta sí/no: revisá");
    parts.push(wOk ? "Pregunta Wh-: bien ✓" : "Pregunta Wh-: revisá");
    fb.textContent = parts.join(" · ");
    if (nOk && yOk && wOk) {
      fb.textContent += " — ¡Muy bien!";
    }
  }

  function reveal() {
    document.getElementById("estructuras-models").hidden = false;
  }

  function next() {
    idx = (idx + 1) % DRILLS.length;
    render();
  }

  document.getElementById("estructuras-check").addEventListener("click", check);
  document.getElementById("estructuras-reveal").addEventListener("click", reveal);
  document.getElementById("estructuras-next").addEventListener("click", next);

  shuffleStart();
  render();
})();
