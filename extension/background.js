// FASTER Check-in Gate: while today's check-in isn't done, every top-level
// http(s) navigation (except the local check-in service) is redirected to gate.html.
const BASE = "http://127.0.0.1:47321";
const RULE_ID = 1;
let lastBlocked = null;

async function fetchStatus() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(BASE + "/api/status", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false };
    const s = await r.json();
    return { ok: true, checkedIn: !!s.checkedIn, today: s.today };
  } catch {
    return { ok: false };
  }
}

function isGated(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch { return false; }
}

async function applyRules(blocked) {
  const removeRuleIds = [RULE_ID];
  const addRules = blocked ? [{
    id: RULE_ID,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: chrome.runtime.getURL("gate.html") + "#\\0" } },
    condition: {
      regexFilter: "^https?://.*",
      resourceTypes: ["main_frame"],
      excludedRequestDomains: ["127.0.0.1", "localhost"],
    },
  }] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  chrome.action.setBadgeText({ text: blocked ? "!" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#cf5a2b" });
  chrome.action.setTitle({ title: blocked ? "FASTER check-in needed before browsing" : "FASTER check-in done for today" });
}

async function gateTab(tab) {
  if (tab && tab.id != null && isGated(tab.url || "")) {
    await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("gate.html") + "#" + tab.url });
  }
}

async function refresh() {
  const s = await fetchStatus();
  const blocked = !(s.ok && s.checkedIn); // fail closed: no service = no browsing
  if (blocked !== lastBlocked) {
    await applyRules(blocked);
    if (blocked && lastBlocked === false) {
      // the day just rolled over (or service died) while browsing: gate the tab in front
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await gateTab(tab);
    }
    lastBlocked = blocked;
  }
  return { ...s, blocked };
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("poll", { periodInMinutes: 0.5 }); refresh(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create("poll", { periodInMinutes: 0.5 }); refresh(); });
chrome.alarms.onAlarm.addListener(() => refresh());
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const s = await refresh();
  if (s.blocked) gateTab(await chrome.tabs.get(tabId));
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: BASE + "/dashboard" }));
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "refresh") { refresh().then(reply); return true; }
});
refresh();
