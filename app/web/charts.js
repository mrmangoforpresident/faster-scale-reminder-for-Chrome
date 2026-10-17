// Tiny dependency-free SVG charts with hover tooltips.
const Charts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const tip = () => document.getElementById("tip");

  function showTip(html, ev) {
    const t = tip();
    t.innerHTML = html;
    t.style.position = "fixed";
    t.style.display = "block";
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
    t.style.left = x + "px";
    t.style.top = y + "px";
  }
  function hideTip() { tip().style.display = "none"; }

  function svg(w, h) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.setAttribute("width", w);
    s.setAttribute("height", h);
    return s;
  }
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, attrs = {}) {
    const t = el("text", { x, y, ...attrs }, parent);
    t.textContent = str;
    return t;
  }
  const DAY = 86400000;
  const dateOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function empty(host, msg) {
    host.innerHTML = `<div class="empty-state">${msg || "No check-ins in this range yet."}</div>`;
  }

  // Time series: x = calendar days from start..end, y = value.
  // opts: points[{day, y, color, html}], yMin, yMax, yTicks[{v,label}], invert, line, height, leftPad
  function timeSeries(host, o) {
    host.innerHTML = "";
    if (!o.points.length) return empty(host);
    const W = Math.max(320, host.clientWidth), H = o.height || 220;
    const L = o.leftPad || 36, R = 12, T = 10, B = 26;
    const s = svg(W, H);
    const x0 = dateOf(o.start).getTime(), x1 = Math.max(dateOf(o.end).getTime(), x0 + DAY);
    const sx = (iso) => L + ((dateOf(iso).getTime() - x0) / (x1 - x0)) * (W - L - R);
    const sy = (v) => {
      const f = (v - o.yMin) / (o.yMax - o.yMin);
      return o.invert ? T + f * (H - T - B) : H - B - f * (H - T - B);
    };
    const g = el("g", { class: "grid" }, s);
    for (const t of o.yTicks) {
      el("line", { x1: L, x2: W - R, y1: sy(t.v), y2: sy(t.v) }, g);
      text(s, L - 8, sy(t.v) + 4, t.label, { "text-anchor": "end" });
    }
    el("line", { class: "baseline", x1: L, x2: W - R, y1: H - B, y2: H - B }, s);
    // x ticks: ~6 evenly spaced dates
    const span = (x1 - x0) / DAY;
    const n = Math.min(6, Math.max(2, Math.floor((W - L - R) / 110)));
    for (let i = 0; i <= n; i++) {
      const d = new Date(x0 + Math.round((span * i) / n) * DAY);
      const fmt = span > 400 ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" };
      text(s, sx(isoOf(d)), H - 8, d.toLocaleDateString(undefined, fmt), { "text-anchor": i === 0 ? "start" : i === n ? "end" : "middle" });
    }
    // line (break where there are gaps of more than 1 day)
    const pts = o.points;
    let dpath = "";
    for (let i = 0; i < pts.length; i++) {
      const gap = i > 0 && (dateOf(pts[i].day) - dateOf(pts[i - 1].day)) / DAY > 1.5;
      dpath += `${i === 0 || gap ? "M" : "L"}${sx(pts[i].day).toFixed(1)},${sy(pts[i].y).toFixed(1)}`;
    }
    el("path", { d: dpath, fill: "none", stroke: o.line || "var(--ink-2)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: o.dots ? 0.45 : 1 }, s);
    const r = pts.length > 120 ? 3 : 4.5;
    for (const p of pts) {
      el("circle", { cx: sx(p.day), cy: sy(p.y), r, fill: p.color || o.line, stroke: "var(--surface)", "stroke-width": 2 }, s);
    }
    // crosshair + nearest-point hover
    const cross = el("line", { x1: 0, x2: 0, y1: T, y2: H - B, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" }, s);
    const ring = el("circle", { r: r + 3, fill: "none", stroke: "var(--ink)", "stroke-width": 1.5, visibility: "hidden" }, s);
    const hit = el("rect", { x: L, y: 0, width: W - L - R, height: H - B, fill: "transparent" }, s);
    hit.addEventListener("mousemove", (ev) => {
      const box = s.getBoundingClientRect();
      const mx = ((ev.clientX - box.left) / box.width) * W;
      let best = pts[0], bd = Infinity;
      for (const p of pts) { const d = Math.abs(sx(p.day) - mx); if (d < bd) { bd = d; best = p; } }
      const cx = sx(best.day);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      ring.setAttribute("cx", cx); ring.setAttribute("cy", sy(best.y)); ring.setAttribute("visibility", "visible");
      showTip(best.html, ev);
    });
    hit.addEventListener("mouseleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); ring.setAttribute("visibility", "hidden"); });
    host.appendChild(s);
  }

  // Vertical columns. bars[{label, value, color, html}]
  function columns(host, o) {
    host.innerHTML = "";
    if (!o.bars.some((b) => b.value > 0)) return empty(host);
    const W = Math.max(280, host.clientWidth), H = o.height || 220;
    const L = 30, R = 8, T = 18, B = 26;
    const s = svg(W, H);
    const max = o.yMax || Math.max(...o.bars.map((b) => b.value)) || 1;
    const ticks = niceTicks(max, 4);
    const top = ticks[ticks.length - 1];
    const sy = (v) => H - B - (v / top) * (H - T - B);
    const g = el("g", { class: "grid" }, s);
    for (const t of ticks) { el("line", { x1: L, x2: W - R, y1: sy(t), y2: sy(t) }, g); text(s, L - 6, sy(t) + 4, o.fmt ? o.fmt(t) : t, { "text-anchor": "end" }); }
    const slot = (W - L - R) / o.bars.length;
    const bw = Math.min(48, slot * 0.62);
    o.bars.forEach((b, i) => {
      const x = L + slot * i + (slot - bw) / 2;
      const h = Math.max(0, H - B - sy(b.value));
      if (h > 0) el("path", { d: roundedTop(x, H - B - h, bw, h, Math.min(4, h)), fill: b.color }, s);
      text(s, x + bw / 2, H - 8, b.label, { "text-anchor": "middle" });
      if (b.value > 0 && o.labels !== false) text(s, x + bw / 2, H - B - h - 5, o.fmt ? o.fmt(b.value) : b.value, { "text-anchor": "middle", style: "fill:var(--ink-2)" });
      const hit = el("rect", { x: L + slot * i, y: T - 10, width: slot, height: H - B - T + 10, fill: "transparent" }, s);
      hit.addEventListener("mousemove", (ev) => showTip(b.html, ev));
      hit.addEventListener("mouseleave", hideTip);
    });
    el("line", { class: "baseline", x1: L, x2: W - R, y1: H - B, y2: H - B }, s);
    host.appendChild(s);
  }

  // Stacked columns. cols[{label, parts[{value, color, html}], total}]
  function stacked(host, o) {
    host.innerHTML = "";
    if (!o.cols.length) return empty(host);
    const W = Math.max(280, host.clientWidth), H = o.height || 240;
    const L = 30, R = 8, T = 10, B = 26;
    const s = svg(W, H);
    const max = Math.max(...o.cols.map((c) => c.parts.reduce((a, p) => a + p.value, 0))) || 1;
    const ticks = niceTicks(max, 4), top = ticks[ticks.length - 1];
    const sy = (v) => H - B - (v / top) * (H - T - B);
    const g = el("g", { class: "grid" }, s);
    for (const t of ticks) { el("line", { x1: L, x2: W - R, y1: sy(t), y2: sy(t) }, g); text(s, L - 6, sy(t) + 4, t, { "text-anchor": "end" }); }
    const slot = (W - L - R) / o.cols.length;
    const bw = Math.min(40, slot * 0.66);
    const every = Math.ceil(o.cols.length / Math.max(1, Math.floor((W - L - R) / 44)));
    o.cols.forEach((c, i) => {
      const x = L + slot * i + (slot - bw) / 2;
      let acc = 0;
      const visible = c.parts.filter((p) => p.value > 0);
      visible.forEach((p, j) => {
        const y0 = sy(acc), y1 = sy(acc + p.value);
        const gap = j < visible.length - 1 ? 2 : 0; // 2px surface gap between segments
        const h = Math.max(0.5, y0 - y1 - gap);
        const isTop = j === visible.length - 1;
        el("path", { d: isTop ? roundedTop(x, y1, bw, h, Math.min(4, h)) : `M${x},${y1 + gap}h${bw}v${h}h${-bw}z`, fill: p.color }, s);
        acc += p.value;
      });
      if (i % every === 0) text(s, x + bw / 2, H - 8, c.label, { "text-anchor": "middle" });
      const hit = el("rect", { x: L + slot * i, y: T, width: slot, height: H - B - T, fill: "transparent" }, s);
      hit.addEventListener("mousemove", (ev) => showTip(c.html, ev));
      hit.addEventListener("mouseleave", hideTip);
    });
    el("line", { class: "baseline", x1: L, x2: W - R, y1: H - B, y2: H - B }, s);
    host.appendChild(s);
  }

  // GitHub-style calendar. days: Map(iso -> {color, html}); start/end iso
  function calendar(host, o) {
    host.innerHTML = "";
    const cell = 13, gap = 3, L = 30, T = 18;
    const start = dateOf(o.start), end = dateOf(o.end);
    const first = new Date(start); first.setDate(first.getDate() - first.getDay()); // back to Sunday
    const weeks = Math.ceil(((end - first) / DAY + 1) / 7);
    const W = L + weeks * (cell + gap), H = T + 7 * (cell + gap);
    const s = svg(W, H);
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d, i) => { if (i % 2) text(s, 0, T + i * (cell + gap) + cell - 2, d); });
    let lastMonth = -1;
    for (let d = new Date(first); d <= end; d.setDate(d.getDate() + 1)) {
      if (d < start) continue;
      const w = Math.floor((d - first) / DAY / 7 + 1e-6), wd = d.getDay();
      const x = L + w * (cell + gap), y = T + wd * (cell + gap);
      if (d.getMonth() !== lastMonth && wd <= 6) {
        if (d.getDate() <= 7) text(s, x, 11, d.toLocaleDateString(undefined, { month: "short" }));
        lastMonth = d.getMonth();
      }
      const iso = isoOf(d);
      const info = o.days.get(iso);
      const r = el("rect", { x, y, width: cell, height: cell, rx: 3, fill: info ? info.color : "var(--empty)" }, s);
      if (iso === o.today) { r.setAttribute("stroke", "var(--ink)"); r.setAttribute("stroke-width", 1.5); }
      const html = info ? info.html : `<b>${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</b><br>No check-in`;
      r.addEventListener("mousemove", (ev) => showTip(html, ev));
      r.addEventListener("mouseleave", hideTip);
    }
    host.appendChild(s);
  }

  // Horizontal bars in HTML. rows[{label, value, color, html}]
  function hbars(host, o) {
    if (!o.rows.length) return empty(host, o.emptyMsg || "Nothing checked in this range.");
    const max = Math.max(...o.rows.map((r) => r.value)) || 1;
    host.innerHTML = `<div style="display:grid;grid-template-columns:minmax(120px,40%) 1fr;gap:6px 12px;align-items:center">
      ${o.rows.map((r, i) => `
        <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.label)}">${r.prefix || ""}${esc(r.label)}</div>
        <div class="hb" data-i="${i}" style="display:flex;align-items:center;gap:8px;height:20px;cursor:default">
          <div style="height:12px;width:${(r.value / max) * 85}%;min-width:3px;background:${r.color};border-radius:0 4px 4px 0"></div>
          <span style="font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums">${r.valueLabel ?? r.value}</span>
        </div>`).join("")}</div>`;
    host.querySelectorAll(".hb").forEach((b) => {
      const r = o.rows[Number(b.dataset.i)];
      b.addEventListener("mousemove", (ev) => showTip(r.html, ev));
      b.addEventListener("mouseleave", hideTip);
    });
  }

  function roundedTop(x, y, w, h, r) {
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function niceTicks(max, n) {
    const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const st = Math.max(step, max < 1 ? step : 1);
    const out = [];
    for (let v = 0; v <= max + st * 0.999; v += st) out.push(+v.toFixed(4));
    if (out.length < 2) out.push(st);
    return out;
  }

  return { timeSeries, columns, stacked, calendar, hbars, isoOf, dateOf, DAY, hideTip };
})();
