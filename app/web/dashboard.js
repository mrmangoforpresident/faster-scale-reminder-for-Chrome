(() => {
  const $ = (id) => document.getElementById(id);
  const { isoOf, dateOf, DAY } = Charts;
  const S = { entries: [], status: null, settings: null, view: "overview", days: 30, calYear: null, journalStage: "all" };
  try { S.view = localStorage.getItem("faster.view") || "overview"; S.days = Number(localStorage.getItem("faster.days") ?? 30); } catch {}

  const stColor = (i) => `var(--st-${i})`;
  const badge = (i) => `<span class="sw" style="background:${stColor(i)}"></span> <b>${STAGES[i].letter}</b> ${esc(STAGES[i].name)}`;
  const followLabel = { yes: "Yes", partly: "Partly", no: "No" };

  // ---------- data shaping
  function byDay(entries) {
    // One summary per logical day, combining that day's check-ins (daily + hourly):
    // level = highest reached that day; behaviors = each distinct behavior once.
    const m = new Map();
    for (const e of entries) {
      const d = m.get(e.day);
      if (!d) { m.set(e.day, { ...e, checkins: 1, selections: [...e.selections] }); continue; }
      d.checkins++;
      d.stage = Math.max(d.stage, e.stage);
      for (const s of e.selections) if (!d.selections.some((x) => x.stage === s.stage && x.text === s.text)) d.selections.push(s);
    }
    return m;
  }
  function rangeBounds() {
    const end = S.status.today;
    if (!S.days) {
      const first = S.entries.length ? S.entries[0].day : end;
      return { start: first, end };
    }
    return { start: isoOf(new Date(dateOf(end).getTime() - (S.days - 1) * DAY)), end };
  }
  function inRange(entries) {
    const { start, end } = rangeBounds();
    return entries.filter((e) => e.day >= start && e.day <= end);
  }
  function dayTip(e) {
    const d = fmtDay(e.day, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    let h = `<b>${esc(d)}</b><br>${badge(e.stage)}`;
    if (e.selections.length) h += `<br><span class="muted">${e.selections.length} behavior${e.selections.length > 1 ? "s" : ""} selected</span>`;
    if (e.checkins > 1) h += `<br><span class="muted">${e.checkins} check-ins that day (highest level shown)</span>`;
    return h;
  }
  function streak() {
    const days = new Set(S.entries.map((e) => e.day));
    let d = dateOf(S.status.today);
    if (!days.has(isoOf(d))) d = new Date(d.getTime() - DAY); // today not done yet doesn't break the streak
    let n = 0;
    while (days.has(isoOf(d))) { n++; d = new Date(d.getTime() - DAY); }
    return n;
  }
  function restorationStreak() {
    const m = byDay(S.entries);
    let d = dateOf(S.status.today), n = 0;
    if (!m.has(isoOf(d))) d = new Date(d.getTime() - DAY);
    while (m.has(isoOf(d)) && m.get(isoOf(d)).stage === 0) { n++; d = new Date(d.getTime() - DAY); }
    return n;
  }

  // ---------- views
  function renderOverview() {
    const { start, end } = rangeBounds();
    const days = [...byDay(inRange(S.entries)).values()];
    const totalDays = Math.round((dateOf(end) - dateOf(start)) / DAY) + 1;
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const rest = days.filter((e) => e.stage === 0).length;
    const avgAll = avg(days.map((e) => e.selections.length));
    const avgWarn = avg(days.map((e) => e.selections.filter((s) => s.stage !== "R").length));
    const worst = days.length ? Math.max(...days.map((e) => e.stage)) : null;
    const today = byDay(S.entries).get(S.status.today);
    const tiles = [
      { label: "Today", value: today ? `${STAGES[today.stage].letter} · ${STAGES[today.stage].name}` : "Not yet", sub: today ? "latest check-in" : "check in to unlock browsing", small: true },
      { label: "Check-in streak", value: `${streak()} day${streak() === 1 ? "" : "s"}`, sub: `${restorationStreak()} in a row in Restoration` },
      { label: "Days checked in", value: `${days.length} / ${totalDays}`, sub: `${Math.round((days.length / totalDays) * 100)}% of days in range` },
      { label: "Days in Restoration", value: days.length ? `${Math.round((rest / days.length) * 100)}%` : "–", sub: `${rest} of ${days.length} check-in days` },
      { label: "Warning behaviors / day", value: avgWarn == null ? "–" : avgWarn.toFixed(1), sub: avgAll == null ? "" : `${avgAll.toFixed(1)} behaviors selected per day overall` },
      { label: "Highest level in range", value: worst == null ? "–" : `${STAGES[worst].letter} · ${STAGES[worst].name}`, sub: worst == null ? "" : `on ${days.filter((e) => e.stage === worst).length} day(s)`, small: true },
    ];
    $("tiles").innerHTML = tiles.map((t) => `<div class="tile"><div class="label">${t.label}</div><div class="value" style="${t.small ? "font-size:20px" : ""}">${esc(t.value)}</div><div class="sub">${esc(t.sub)}</div></div>`).join("");

    Charts.timeSeries($("stageChart"), {
      start, end, height: 260, leftPad: 130, invert: true, dots: true, line: "var(--muted)",
      yMin: 0, yMax: 6, yTicks: STAGES.map((s, i) => ({ v: i, label: `${s.letter} · ${s.name}` })),
      points: days.map((e) => ({ day: e.day, y: e.stage, color: stColor(e.stage), html: dayTip(e) })),
    });
    // fasterscaleapp.com's main report: behaviors selected each day, stacked by category.
    // Long ranges are grouped by week so the bars stay readable.
    const span = Math.round((dateOf(end) - dateOf(start)) / DAY) + 1;
    const weekly = span > 92;
    const buckets = new Map();
    for (let t = dateOf(start).getTime(); t <= dateOf(end).getTime(); t += DAY) {
      const d = new Date(t);
      const key = weekly ? isoOf(new Date(t - ((d.getDay() + 6) % 7) * DAY)) : isoOf(d); // week starts Monday
      if (!buckets.has(key)) buckets.set(key, Array(7).fill(0));
    }
    for (const e of days) {
      const d = dateOf(e.day);
      const key = weekly ? isoOf(new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY)) : e.day;
      const b = buckets.get(key);
      if (b) e.selections.forEach((s) => b[STAGE_INDEX[s.stage]]++);
    }
    $("bhvrChartNote").textContent = weekly ? "Behaviors selected per week, by category." : "Behaviors selected each day, by category.";
    Charts.stacked($("bhvrChart"), {
      height: 260,
      cols: [...buckets.entries()].map(([k, counts]) => {
        const total = counts.reduce((a, b) => a + b, 0);
        const title = weekly ? `Week of ${fmtDay(k, { month: "short", day: "numeric", year: "numeric" })}` : fmtDay(k, { weekday: "short", month: "short", day: "numeric" });
        return {
          label: fmtDay(k, { month: "numeric", day: "numeric" }),
          parts: counts.map((c, i) => ({ value: c, color: stColor(i) })),
          html: `<b>${esc(title)}</b><br>` + (total ? counts.map((c, i) => (c ? `${badge(i)}: ${c}` : "")).filter(Boolean).join("<br>") : "No check-in"),
        };
      }),
    });
    $("bhvrLegend").innerHTML = legendHtml().replace(/<span><span class="sw" style="background:var\(--empty\).*$/, "");
  }

  function legendHtml() {
    return STAGES.map((s, i) => `<span><span class="sw" style="background:${stColor(i)}"></span>${s.letter} · ${esc(s.name)}</span>`).join("") +
      `<span><span class="sw" style="background:var(--empty);outline:1px solid var(--border)"></span>No check-in</span>`;
  }

  function renderCalendar() {
    const years = new Set([dateOf(S.status.today).getFullYear()]);
    S.entries.forEach((e) => years.add(Number(e.day.slice(0, 4))));
    const ys = [...years].sort((a, b) => b - a);
    const sel = $("calYear");
    sel.innerHTML = [`<option value="last">Last 12 months</option>`, ...ys.map((y) => `<option value="${y}">${y}</option>`)].join("");
    sel.value = S.calYear || "last";
    let start, end;
    if (sel.value === "last") {
      end = S.status.today;
      const e = dateOf(end);
      start = isoOf(new Date(e.getFullYear() - 1, e.getMonth(), e.getDate() + 1));
    } else {
      start = `${sel.value}-01-01`;
      end = `${sel.value}-12-31`;
    }
    const m = byDay(S.entries);
    const days = new Map();
    for (const [d, e] of m) if (d >= start && d <= end) days.set(d, { color: stColor(e.stage), html: dayTip(e) });
    Charts.calendar($("calendar"), { start, end, days, today: S.status.today });
    $("calLegend").innerHTML = legendHtml();

    // month-by-month stacked
    const months = new Map();
    const s0 = dateOf(start), e0 = dateOf(end);
    for (let d = new Date(s0.getFullYear(), s0.getMonth(), 1); d <= e0; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      months.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, Array(7).fill(0));
    }
    for (const [d, e] of m) { const k = d.slice(0, 7); if (months.has(k) && d >= start && d <= end) months.get(k)[e.stage]++; }
    const cols = [...months.entries()].map(([k, counts]) => {
      const label = new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "short" });
      const total = counts.reduce((a, b) => a + b, 0);
      const html = `<b>${new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b><br>` +
        (total ? counts.map((c, i) => (c ? `${badge(i)}: ${c} day${c > 1 ? "s" : ""}` : "")).filter(Boolean).join("<br>") : "No check-ins");
      return { label, html, parts: counts.map((c, i) => ({ value: c, color: stColor(i) })) };
    });
    if (!S.entries.length) Charts.stacked($("monthChart"), { cols: [] });
    else Charts.stacked($("monthChart"), { cols });
    $("monthLegend").innerHTML = legendHtml().replace(/<span><span class="sw" style="background:var\(--empty\).*$/, "");
  }

  function renderPatterns() {
    const entries = inRange(S.entries);
    const days = [...byDay(entries).values()];
    const counts = Array(7).fill(0);
    days.forEach((e) => counts[e.stage]++);
    Charts.columns($("distChart"), {
      bars: STAGES.map((s, i) => ({ label: s.letter, value: counts[i], color: stColor(i), html: `${badge(i)}<br>${counts[i]} day${counts[i] === 1 ? "" : "s"} (${days.length ? Math.round((counts[i] / days.length) * 100) : 0}%)` })),
    });

    const dow = Array.from({ length: 7 }, () => []);
    days.forEach((e) => dow[dateOf(e.day).getDay()].push(e.stage));
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const order = [1, 2, 3, 4, 5, 6, 0];
    Charts.columns($("dowChart"), {
      yMax: Math.max(1, ...dow.map((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0))),
      fmt: (v) => (Math.round(v * 10) / 10).toString(),
      bars: order.map((i) => {
        const xs = dow[i], avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
        const rounded = Math.round(avg);
        return { label: names[i], value: avg, color: "var(--series-1)",
          html: `<b>${names[i]}</b><br>${xs.length ? `Average stage ${avg.toFixed(2)} (≈ ${STAGES[rounded].name})<br>${xs.length} check-in day${xs.length > 1 ? "s" : ""}` : "No check-ins"}` };
      }),
    });

    // top indicators (all entries in range, not just latest per day)
    const tally = new Map();
    for (const e of days) for (const s of e.selections) {
      const k = s.stage + "\u0001" + s.text;
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    const rows = [...tally.entries()].map(([k, v]) => { const [stage, label] = k.split("\u0001"); return { stage, label, value: v }; });
    const toRow = (r) => {
      const i = STAGE_INDEX[r.stage];
      return { ...r, color: stColor(i), prefix: `<b style="display:inline-block;width:16px">${STAGES[i].letter}</b>`, valueLabel: `${r.value}×`,
        html: `${badge(i)}<br>${esc(r.label)}<br>Selected on ${r.value} of ${days.length} check-in days` };
    };
    Charts.hbars($("topSigns"), { rows: rows.filter((r) => r.stage !== "R").sort((a, b) => b.value - a.value).slice(0, 15).map(toRow), emptyMsg: "No warning signs checked in this range." });
    Charts.hbars($("topStrengths"), { rows: rows.filter((r) => r.stage === "R").sort((a, b) => b.value - a.value).slice(0, 8).map(toRow), emptyMsg: "No Restoration items checked in this range." });

    // fasterscaleapp.com's "Behaviors by Category"
    const byCat = Array(7).fill(0);
    days.forEach((e) => e.selections.forEach((s) => byCat[STAGE_INDEX[s.stage]]++));
    const totalSel = byCat.reduce((a, b) => a + b, 0);
    Charts.columns($("catChart"), {
      bars: STAGES.map((s, i) => ({ label: s.letter, value: byCat[i], color: stColor(i),
        html: `${badge(i)}<br>${byCat[i]} behavior${byCat[i] === 1 ? "" : "s"} selected (${totalSel ? Math.round((byCat[i] / totalSel) * 100) : 0}%)` })),
    });
  }

  function renderJournal() {
    const f = $("journalFilter");
    f.innerHTML = `<option value="all">All stages</option>` + STAGES.map((s, i) => `<option value="${i}">${s.letter} · ${esc(s.name)}</option>`).join("");
    f.value = S.journalStage;
    const list = S.entries.slice().reverse().filter((e) => S.journalStage === "all" || e.stage === Number(S.journalStage));
    if (!list.length) { $("journal").innerHTML = `<div class="empty-state">No check-ins yet.</div>`; return; }
    const field = (label, v) => (v ? `<dt>${label}</dt><dd>${esc(v)}</dd>` : "");
    $("journal").innerHTML = list.map((e) => {
      const time = new Date(e.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const sels = STAGES.map((s) => {
        const items = e.selections.filter((x) => x.stage === s.key).map((x) => x.text);
        return items.length ? `<dt>${s.letter} · ${esc(s.name)}</dt><dd>${items.map(esc).join("\n")}</dd>` : "";
      }).join("");
      const qs = (e.answers || []).map((a) => {
        const s = STAGES[STAGE_INDEX[a.stage]];
        return `<dt style="grid-column:1/-1;margin-top:8px"><b>${s.letter} · ${esc(s.name)}:</b> ${esc(a.behavior)}</dt>` +
          field("How does it affect me?", a.a) + field("How does it affect others?", a.b) + field("Why do I do this? The benefit?", a.c);
      }).join("");
      return `<details class="entry">
        <summary>
          <span class="badge" style="background:${stColor(e.stage)};color:${stageInk(e.stage)}">${STAGES[e.stage].letter}</span>
          <span><b>${esc(fmtDay(e.day, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}</b>
          <span class="muted">· ${time} · ${esc(STAGES[e.stage].name)} · ${e.selections.length} behavior${e.selections.length === 1 ? "" : "s"}</span></span>
        </summary>
        <div class="body"><dl>
          ${sels}
          ${qs}
          ${field("Follow-through on previous commitment", followLabel[e.followthrough])}
          ${field("How it affects me", e.affects_me)}
          ${field("How it affects others", e.affects_others)}
          ${field("Why I do it / payoff", e.payoff)}
          ${field("Commitment", e.commitment)}
          ${field("Connect with", e.connect_with)}
          ${field("Grateful for", e.gratitude)}
          ${field("Notes", e.notes)}
        </dl>
        <div class="row" style="margin-top:10px"><button class="danger" data-del="${e.id}">Delete this check-in</button></div></div>
      </details>`;
    }).join("");
    $("journal").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Delete this check-in permanently?")) return;
      await api.send("DELETE", `/api/entries/${b.dataset.del}`);
      await load();
    }));
  }

  function renderSettings() {
    const s = S.settings;
    $("sDayStart").innerHTML = Array.from({ length: 13 }, (_, h) => `<option value="${h}">${h === 0 ? "Midnight" : h === 12 ? "Noon" : `${h}:00 AM`}</option>`).join("");
    $("sDayStart").value = s.dayStartHour;
    $("sPopup").checked = s.popupEnabled;
    $("sTop").checked = s.keepOnTop;
    $("sHourly").checked = s.hourlyEnabled;
    $("sHourlyMin").value = s.hourlyIntervalMin;
    $("sBrowser").value = s.browser;
    $("sCooldown").value = s.repopCooldownSec;
    const b = S.behaviors || {};
    $("bhvrSource").textContent = b.behaviors && b.behaviors.length
      ? `Using ${b.behaviors.length} behaviors from fasterscaleapp.com (revision ${String(b.revision || "").slice(0, 7)}).`
      : "Using the built-in list. The fasterscaleapp.com list hasn't been downloaded yet.";
    $("customFields").innerHTML = STAGES.map((st, i) => `
      <label class="field"><span><span class="sw" style="background:${stColor(i)}"></span> ${st.letter} · ${esc(st.name)}</span>
      <textarea data-stage="${st.key}" rows="2" placeholder="One item per line">${esc((s.customIndicators[st.key] || []).join("\n"))}</textarea></label>`).join("");
  }

  async function saveSettings() {
    const custom = {};
    document.querySelectorAll("#customFields textarea").forEach((t) => { custom[t.dataset.stage] = t.value.split("\n").map((x) => x.trim()).filter(Boolean); });
    try {
      S.settings = await api.send("PUT", "/api/settings", {
        dayStartHour: Number($("sDayStart").value), popupEnabled: $("sPopup").checked, keepOnTop: $("sTop").checked,
        browser: $("sBrowser").value, repopCooldownSec: Number($("sCooldown").value) || 90, customIndicators: custom,
        hourlyEnabled: $("sHourly").checked, hourlyIntervalMin: Number($("sHourlyMin").value) || 60,
      });
      $("settingsMsg").textContent = "Saved.";
      S.status = await api.get("/api/status");
      renderHeader();
    } catch (e) { $("settingsMsg").textContent = "Couldn't save: " + e.message; }
    setTimeout(() => ($("settingsMsg").textContent = ""), 3000);
  }

  function renderHeader() {
    $("todayLine").textContent = `${fmtDay(S.status.today)} · ${S.status.checkedIn ? "checked in today" : "not checked in yet today"}`;
    $("checkinBtn").textContent = S.status.checkedIn ? "New check-in" : "Check in now";
    $("checkinBtn").classList.toggle("primary", !S.status.checkedIn);
  }

  function render() {
    Charts.hideTip();
    document.querySelectorAll("section[data-view]").forEach((s) => (s.hidden = s.dataset.view !== S.view));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === S.view));
    document.querySelectorAll("#range button").forEach((b) => b.classList.toggle("on", Number(b.dataset.days) === S.days));
    $("rangeRow").hidden = !["overview", "patterns"].includes(S.view);
    ({ overview: renderOverview, calendar: renderCalendar, patterns: renderPatterns, journal: renderJournal, settings: renderSettings })[S.view]();
  }

  async function load() {
    [S.status, S.entries, S.settings, S.behaviors] = await Promise.all([api.get("/api/status"), api.get("/api/entries"), api.get("/api/settings"), api.get("/api/behaviors")]);
    renderHeader();
    render();
  }

  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => {
    S.view = b.dataset.view; try { localStorage.setItem("faster.view", S.view); } catch {} render();
  }));
  document.querySelectorAll("#range button").forEach((b) => b.addEventListener("click", () => {
    S.days = Number(b.dataset.days); try { localStorage.setItem("faster.days", S.days); } catch {} render();
  }));
  $("calYear").addEventListener("change", (e) => { S.calYear = e.target.value; renderCalendar(); });
  $("journalFilter").addEventListener("change", (e) => { S.journalStage = e.target.value; renderJournal(); });
  $("saveSettings").addEventListener("click", saveSettings);
  $("reimport").addEventListener("click", async () => {
    $("bhvrSource").textContent = "Downloading…";
    try { S.behaviors = await api.send("POST", "/api/behaviors/import"); } catch (e) { $("settingsMsg").textContent = e.message; }
    renderSettings();
  });
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => S.view !== "settings" && S.view !== "journal" && render(), 150); });
  load().catch((e) => { document.querySelector(".wrap").insertAdjacentHTML("afterbegin", `<div class="banner warn">Couldn't load data: ${esc(e.message)}</div>`); });
})();
