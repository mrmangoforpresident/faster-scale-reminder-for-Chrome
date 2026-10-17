const BASE = "http://127.0.0.1:47321";
const target = location.hash.slice(1);
const safeTarget = /^https?:\/\//i.test(target) ? target : "";
const $ = (id) => document.getElementById(id);
if (safeTarget) $("url").textContent = "Waiting to open: " + safeTarget;

async function check() {
  const s = await chrome.runtime.sendMessage({ type: "refresh" });
  if (s && s.ok && s.checkedIn) {
    location.replace(safeTarget || BASE + "/dashboard");
    return;
  }
  if (s && s.ok) {
    const url = BASE + "/checkin" + (safeTarget ? "?return=" + encodeURIComponent(safeTarget) : "");
    $("go").href = url;
    $("go").hidden = false;
    location.replace(url);
    return;
  }
  $("title").textContent = "Check-in service isn't running";
  $("msg").innerHTML = "Websites stay locked until today's FASTER check-in is done, but the local check-in service isn't responding. " +
    "It normally restarts on its own within a few minutes. To start it now, run <code>Start FASTER Check-in</code> from the Start menu.";
  setTimeout(check, 5000);
}
check();
