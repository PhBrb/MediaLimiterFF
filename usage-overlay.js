const LINE_HEIGHT = "3px";

let track = null;
let fill = null;
let lastRatio = 0;

function setProps(el, props) {
  for (const key of Object.keys(props)) {
    el.style.setProperty(key, props[key], "important");
  }
}

function createBar() {
  track = document.createElement("div");
  track.id = "medialimiter-overlay-track";
  setProps(track, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: LINE_HEIGHT,
    background: "rgba(255,0,0,0.25)",
    "z-index": "2147483647",
    "pointer-events": "none",
    display: "block",
    visibility: "visible",
    opacity: "1",
    border: "none",
    margin: "0",
    padding: "0"
  });
  fill = document.createElement("div");
  fill.id = "medialimiter-overlay-fill";
  setProps(fill, {
    height: "100%",
    width: "0%",
    background: "#ff0000",
    display: "block",
    border: "none",
    margin: "0",
    padding: "0"
  });
  track.appendChild(fill);
}

function ensureBar() {
  if (!track) createBar();
  if (!track.isConnected) {
    document.documentElement.appendChild(track);
  }
}

function updateBar(ratio) {
  lastRatio = ratio;
  ensureBar();
  fill.style.setProperty("width", (Math.min(1, Math.max(0, ratio)) * 100) + "%", "important");
}

async function refresh() {
  const response = await browser.runtime.sendMessage({ type: "getLimitStatus" }).catch(() => null);
  if (response && response.limit > 0) {
    updateBar(response.used / response.limit);
  } else {
    ensureBar();
  }
}

browser.runtime.onMessage.addListener(message => {
  if (message && message.type === "limitStatusUpdate" && message.limit > 0) {
    updateBar(message.used / message.limit);
  }
});

const observer = new MutationObserver(() => {
  if (!track || !track.isConnected) {
    updateBar(lastRatio);
  }
});

setInterval(() => {
  if (document.hidden) return;
  refresh();
}, 1000);

ensureBar();
refresh();

if (document.documentElement) {
  observer.observe(document.documentElement, { childList: true, subtree: true });
} else {
  document.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}
