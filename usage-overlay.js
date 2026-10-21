if (window.__medialimiterOverlayLoaded) {
  // Already injected; avoid duplicate bars and timers on repeated injection.
} else {
window.__medialimiterOverlayLoaded = true;

const OVERLAY_HOST_ID = "medialimiter-overlay-host";
const BAR_HEIGHT = "3px";

let host = null;
let fill = null;
let lastRatio = 0;

function setProps(el, props) {
  for (const key of Object.keys(props)) {
    el.style.setProperty(key, props[key], "important");
  }
}

function createHost() {
  host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  setProps(host, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: BAR_HEIGHT,
    "z-index": "2147483647",
    "pointer-events": "none",
    display: "block",
    visibility: "visible",
    opacity: "1",
    background: "transparent",
    border: "none",
    margin: "0",
    padding: "0"
  });

  const shadow = host.attachShadow({ mode: "closed" });

  const track = document.createElement("div");
  setProps(track, {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    background: "rgba(255,0,0,0.25)",
    display: "block",
    opacity: "1",
    border: "none",
    margin: "0",
    padding: "0"
  });

  fill = document.createElement("div");
  setProps(fill, {
    height: "100%",
    width: "0%",
    background: "#ff0000",
    display: "block",
    opacity: "1",
    border: "none",
    margin: "0",
    padding: "0"
  });

  track.appendChild(fill);
  shadow.appendChild(track);
}

function ensureHost() {
  if (!host || !host.isConnected) {
    const existing = host || document.getElementById(OVERLAY_HOST_ID);
    if (existing) {
      host = existing;
    } else {
      createHost();
    }
    if (!host.isConnected) {
      (document.documentElement || document.body).appendChild(host);
    }
  }
}

function showHost(shown) {
  ensureHost();
  host.style.setProperty("display", shown ? "block" : "none", "important");
}

function updateBar(ratio) {
  lastRatio = ratio;
  ensureHost();
  const clamped = Math.min(1, Math.max(0, ratio));
  fill.style.setProperty("width", (clamped * 100) + "%", "important");
}

async function refresh() {
  const response = await browser.runtime.sendMessage({ type: "getLimitStatus" }).catch(() => null);
  if (response && response.limit > 0) {
    updateBar(response.used / response.limit);
    showHost(response.tracked !== false);
  } else {
    showHost(false);
  }
}

browser.runtime.onMessage.addListener(message => {
  if (!message) return;
  if (message.type === "limitStatusUpdate" && message.limit > 0) {
    updateBar(message.used / message.limit);
    showHost(true);
  } else if (message.type === "overlayHidden") {
    showHost(false);
  }
});

const observer = new MutationObserver(() => {
  if (!host || !host.isConnected) {
    updateBar(lastRatio);
  }
});

function startObserver() {
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

setInterval(() => {
  if (document.hidden) return;
  refresh();
}, 1000);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    startObserver();
    refresh();
  });
} else {
  startObserver();
  refresh();
}
}
