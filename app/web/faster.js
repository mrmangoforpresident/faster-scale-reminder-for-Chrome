// Shared FASTER Scale definitions + API helpers.
// Stage order is the scale: 0 = Restoration (healthy) ... 6 = Relapse.
// The behavior list comes from fasterscaleapp.com (imported by the service into data/behaviors.json,
// see loadBehaviors). The paraphrased `indicators` below are only a fallback for when that
// list hasn't been downloaded yet. Add your own behaviors in Settings.
const STAGES = [
  {
    key: "R", letter: "R", name: "Restoration",
    blurb: "Honest, connected, and dealing with life as it comes.",
    indicators: [
      "No secrets I'm keeping",
      "Honest with myself and others",
      "Keeping my commitments (meetings, calls, routines)",
      "Dealing with problems as they come up",
      "Aware of my feelings and naming them",
      "Connected with supportive people",
      "Making time for prayer / reflection / gratitude",
      "Taking care of my body (sleep, food, movement)",
    ],
  },
  {
    key: "F", letter: "F", name: "Forgetting Priorities",
    blurb: "Drifting from what keeps me healthy; small secrets creep in.",
    indicators: [
      "Keeping a small secret",
      "Skipping meetings, calls, or check-ins",
      "Letting healthy routines slide",
      "Spending less time with supportive people",
      "Isolating or keeping to myself",
      "Lots of screen time / numbing entertainment",
      "Procrastinating on things that matter",
      "Overly focused on work or a new obsession",
      "Sarcastic or not sharing honestly",
    ],
  },
  {
    key: "A", letter: "A", name: "Anxiety",
    blurb: "A growing background hum of worry and fear.",
    indicators: [
      "Worrying a lot / can't shake a vague fear",
      "Replaying past mistakes or regrets",
      "Afraid of being found out or judged",
      "People-pleasing",
      "Perfectionism",
      "Trouble falling or staying asleep",
      "Daydreaming or fantasizing to escape",
      "Using small comforts to calm down",
    ],
  },
  {
    key: "S", letter: "S", name: "Speeding Up",
    blurb: "Trying to outrun the anxiety by staying busy.",
    indicators: [
      "Super busy; can't slow down or rest",
      "Overcommitting or workaholic hours",
      "Skipping meals or binge eating",
      "Leaning on caffeine, sugar, or energy drinks",
      "Impulsive spending",
      "Driving too fast / rushing everywhere",
      "Talking fast, restless, can't sit still",
      "Irritated when anything slows me down",
    ],
  },
  {
    key: "T", letter: "T", name: "Ticked Off",
    blurb: "Running on anger and adrenaline; others become the problem.",
    indicators: [
      "Resentful or holding a grudge",
      "Blaming others for how I feel",
      "Arguing or getting defensive",
      "All-or-nothing / black-and-white thinking",
      "Self-pity: \"nobody gets it\"",
      "Pushing people away",
      "Can't let go or forgive",
      "Snapping at people I care about",
    ],
  },
  {
    key: "E", letter: "E", name: "Exhausted",
    blurb: "Running on empty; the energy to fight is gone.",
    indicators: [
      "Depressed, flat, or numb",
      "Hopeless or wanting to give up",
      "Tired all the time / sleeping too much",
      "Strong cravings for old ways of coping",
      "Can't think clearly; foggy",
      "Missing work or obligations",
      "Crying spells or overwhelmed easily",
      "Withdrawn from everyone",
    ],
  },
  {
    key: "X", letter: "R", name: "Relapse/Moral Failure",
    blurb: "Back in the behavior I committed to leaving behind.",
    indicators: [
      "Acted out / returned to the behavior",
      "Feeling out of control",
      "Overwhelmed by shame or guilt",
      "Lying to cover it up",
      "Thinking \"what's the point\"",
    ],
  },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

function stageIndicators(stage, settings) {
  const custom = (settings && settings.customIndicators && settings.customIndicators[stage.key]) || [];
  return stage.indicators.concat(custom.filter((c) => !stage.indicators.includes(c)));
}

// The day's level, as on fasterscaleapp.com: the highest category with any selected behavior.
function levelOf(selections) {
  return selections.reduce((m, s) => Math.max(m, STAGE_INDEX[s.stage] ?? 0), 0);
}

// Swap the fallback indicators for the imported fasterscaleapp.com list, when available.
let BEHAVIOR_SOURCE = "builtin";
async function loadBehaviors() {
  try {
    const d = await api.get("/api/behaviors");
    if (d.behaviors && d.behaviors.length) {
      for (const st of STAGES) st.indicators = d.behaviors.filter((b) => b.stage === st.key).map((b) => b.name);
      BEHAVIOR_SOURCE = d.source;
    }
  } catch {}
  return BEHAVIOR_SOURCE;
}

const api = {
  async get(path) {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
  async send(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDay(iso, opts = { weekday: "long", month: "long", day: "numeric" }) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

// Dark or light text for a stage badge, from the stage's current (theme-aware) color.
function stageInk(i) {
  const c = getComputedStyle(document.documentElement).getPropertyValue(`--st-${i}`).trim();
  const m = c.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#fff";
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? "#0b0b0b" : "#ffffff";
}
