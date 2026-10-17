(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isPopup = params.get("popup") === "1";  const returnUrl = (() => {
    const r = params.get("return");
    try {
      const u = new URL(r);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch { return null; }
  })();

  // selections: Set of "stageKey\u0001behavior"; answers: {stageKey: {behavior, a, b, c}}
  const state = { selections: new Set(), answers: {}, settings: null };
  const selKey = (stageKey, text) => stageKey + "\u0001" + text;
  const QUESTIONS = [
    ["a", "How does it affect me? How do I act and feel?"],
    ["b", "How does it affect the important people in my life?"],
    ["c", "Why do I do this? What is the benefit for me?"],
  ];

  const stageColor = (i) => `var(--st-${i})`;
  const badge = (i) => `<span class="badge" style="background:${stageColor(i)};color:${stageInk(i)}">${STAGES[i].letter}</span>`;

  function selectionList() {
    return [...state.selections].map((k) => { const [stage, text] = k.split("\u0001"); return { stage, text }; })
      .sort((x, y) => STAGE_INDEX[x.stage] - STAGE_INDEX[y.stage]);
  }

  function levelText(sel) {
    if (!sel.length) return "";
    const i = levelOf(sel);
    return `Today's level: ${badge(i)} <b>${esc(STAGES[i].name)}</b>`;
  }

  // ---------- step 1: behaviors
  function renderStages() {
    $("stages").innerHTML = STAGES.map((st, i) => `
      <section class="stage-block" style="--stc:${stageColor(i)}">
        <header>${badge(i)}<h3>${esc(st.name)}</h3></header>
        <div class="chips">
          ${stageIndicators(st, state.settings).map((t) => `
            <label class="chip" data-key="${esc(selKey(st.key, t))}"><input type="checkbox">${esc(t)}</label>`).join("")}
        </div>
      </section>`).join("");
    $("stages").querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", (ev) => {
        ev.preventDefault();
        const k = chip.dataset.key;
        if (state.selections.has(k)) state.selections.delete(k); else state.selections.add(k);
        chip.classList.toggle("on", state.selections.has(k));
        $("err1").textContent = "";
        $("level1").innerHTML = levelText(selectionList());
      });
    });
  }

  // ---------- step 2: one behavior + three questions per category with selections
  function renderQuestions() {
    const sel = selectionList();
    $("level2").innerHTML = levelText(sel);
    const cats = STAGES.map((st, i) => ({ st, i, items: sel.filter((s) => s.stage === st.key).map((s) => s.text) }))
      .filter((c) => c.items.length);
    $("questions").innerHTML = cats.map(({ st, i, items }) => {
      const ans = state.answers[st.key] || (state.answers[st.key] = { behavior: items.length === 1 ? items[0] : "", a: "", b: "", c: "" });
      if (ans.behavior && !items.includes(ans.behavior)) ans.behavior = "";
      return `
      <div class="card stage-block" style="--stc:${stageColor(i)};border-left-width:4px" data-stage="${st.key}">
        <header>${badge(i)}<h3>${esc(st.name)}</h3></header>
        <div class="chips" role="radiogroup" aria-label="${esc(st.name)} behavior">
          ${items.map((t) => `<label class="chip ${ans.behavior === t ? "on" : ""}" data-b="${esc(t)}"><input type="radio" name="b-${st.key}">${esc(t)}</label>`).join("")}
        </div>
        <div class="stack" style="margin-top:12px">
          ${QUESTIONS.map(([k, q]) => `<label class="field"><span>${q}</span><textarea data-q="${k}">${esc(ans[k])}</textarea></label>`).join("")}
        </div>
      </div>`;
    }).join("");
    $("questions").querySelectorAll("[data-stage]").forEach((card) => {
      const ans = state.answers[card.dataset.stage];
      card.querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", (ev) => {
        ev.preventDefault();
        ans.behavior = chip.dataset.b;
        card.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === chip));
      }));
      card.querySelectorAll("textarea").forEach((ta) => ta.addEventListener("input", () => (ans[ta.dataset.q] = ta.value)));
    });
  }

  function goStep(n) {
    if (n === 2) {
      if (!state.selections.size) { $("err1").textContent = "Select at least one behavior."; return; }
      renderQuestions();
    }
    $("step1").hidden = n !== 1;
    $("step2").hidden = n !== 2;
    window.scrollTo(0, 0);
  }

  async function heartbeat() {
    try { await api.send("POST", "/api/heartbeat"); } catch {}
  }

  async function init() {
    let status;
    try {
      [status, state.settings] = await Promise.all([api.get("/api/status"), api.get("/api/settings"), loadBehaviors()]);
    } catch (e) {
      $("err1").textContent = "Couldn't reach the check-in service: " + e.message;
      return;
    }
    $("dayLabel").textContent = fmtDay(status.today);
    $("sourceNote").textContent = BEHAVIOR_SOURCE === "builtin" ? "Using built-in list (fasterscaleapp.com list not downloaded yet)" : "Behaviors from fasterscaleapp.com";

    if (status.checkedIn) {
      if (returnUrl) { location.replace(returnUrl); return; }
      $("already").hidden = false;
      $("already").textContent = params.get("hourly") === "1"
        ? "Hourly check-in: it's been a while since your last one. Where are you right now? (Close this window to skip until the next hour.)"
        : "You've already checked in today. You can add another check-in below if things have shifted.";
    }
    if (isPopup) $("dashLink").hidden = true;

    renderStages();
    $("next").addEventListener("click", () => goStep(2));
    $("back").addEventListener("click", () => goStep(1));
    if (!status.checkedIn) {
      heartbeat();
      state.hb = setInterval(heartbeat, 10000);
    }
    $("form").addEventListener("submit", submit);
  }

  async function submit(ev) {
    ev.preventDefault();
    $("err").textContent = "";
    const sel = selectionList();
    // Same rule as fasterscaleapp.com: if you answered a category's questions, pick the behavior they're about.
    for (const [stage, a] of Object.entries(state.answers)) {
      if (!sel.some((s) => s.stage === stage)) continue;
      if ([a.a, a.b, a.c].some((x) => x && x.trim()) && !a.behavior) {
        $("err").textContent = `Select the ${STAGES[STAGE_INDEX[stage]].name} behavior your answers apply to.`;
        document.querySelector(`[data-stage="${stage}"]`).scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    const answers = Object.entries(state.answers)
      .filter(([stage, a]) => sel.some((s) => s.stage === stage) && a.behavior && [a.a, a.b, a.c].some((x) => x && x.trim()))
      .map(([stage, a]) => ({ stage, behavior: a.behavior, a: a.a, b: a.b, c: a.c }));
    $("submit").disabled = true;
    let saved;
    try {
      saved = await api.send("POST", "/api/entries", { selections: sel, answers });
    } catch (e) {
      $("err").textContent = "Couldn't save: " + e.message;
      $("submit").disabled = false;
      return;
    }
    clearInterval(state.hb);
    $("form").hidden = true;
    $("already").hidden = true;
    $("done").hidden = false;
    const st = STAGES[saved.stage];
    $("doneText").textContent = saved.stage === 0
      ? `You're in Restoration today, with ${sel.length} behavior${sel.length === 1 ? "" : "s"} selected. Keep doing what's working.`
      : `Today's level is ${st.name} (${sel.length} behavior${sel.length === 1 ? "" : "s"} selected). Naming it is the first step back.`;
    window.scrollTo(0, 0);
    if (returnUrl) {
      $("continueLink").hidden = false;
      $("continueLink").href = returnUrl;
      setTimeout(() => location.replace(returnUrl), 2500);
    } else if (isPopup) {
      $("closeBtn").hidden = false;
      $("closeBtn").addEventListener("click", () => window.close());
      setTimeout(() => window.close(), 4000);
    }
  }

  init();
})();
