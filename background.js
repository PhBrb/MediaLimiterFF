const DEFAULT_SETTINGS = {
  shortsLimitSeconds: 600,
  siteCostSeconds: 30,
  extraSites: []
};

const ROLLING_WINDOW_MS = 60 * 60 * 1000;
const SHORTS_URL_PATTERN = /^https:\/\/(www\.|m\.)?youtube\.com\/(shorts|live\/shorts)/i;

let trackedTabId = null;
let trackedIsShorts = false;
let trackedActiveSince = 0;
let trackedVisible = true;
let tickTimer = null;
let pendingBlockTabId = null;
let blockedTabIds = new Set();

async function getSettings() {
  const stored = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

async function getUsage() {
  const stored = await browser.storage.local.get("usage");
  const usage = stored.usage || { events: [] };
  usage.events = (usage.events || []).filter(e => Date.now() - e.t < ROLLING_WINDOW_MS);
  return usage;
}

async function saveUsage(usage) {
  await browser.storage.local.set({ usage });
}

function recordEvent(usage, seconds) {
  usage.events.push({ t: Date.now(), s: seconds });
}

async function usedSeconds(usage) {
  return usage.events.reduce((sum, e) => sum + (e.s || 0), 0);
}

function isShortsUrl(url) {
  return SHORTS_URL_PATTERN.test(url || "");
}

function normalizeSiteInput(input) {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch (e) {
      return null;
    }
  }
  value = value.replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

function matchesExtraSite(url, sites) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch (e) {
    return false;
  }
  return sites.some(s => hostname === s || hostname.endsWith("." + s));
}

async function isTrackedUrl(url) {
  if (isShortsUrl(url)) return true;
  const settings = await getSettings();
  return settings.extraSites.length > 0 && matchesExtraSite(url, settings.extraSites);
}

async function broadcastOverlayUpdate() {
  if (trackedTabId === null) return;
  try {
    const settings = await getSettings();
    const usage = await getUsage();
    const used = await usedSeconds(usage);
    await browser.tabs.sendMessage(trackedTabId, {
      type: "limitStatusUpdate",
      limit: settings.shortsLimitSeconds,
      used
    });
  } catch (e) {
  }
}

function buildBlockPageUrl(remainingSeconds) {
  return browser.runtime.getURL("blockpage.html") + "?remaining=" + encodeURIComponent(Math.ceil(remainingSeconds));
}

async function checkAndEnforce(tabId) {
  const settings = await getSettings();
  const usage = await getUsage();
  const used = await usedSeconds(usage);
  const limit = settings.shortsLimitSeconds;
  if (used >= limit) {
    await blockTab(tabId, limit - used);
    return true;
  }
  return false;
}

async function blockTab(tabId, remainingSeconds) {
  blockedTabIds.add(tabId);
  try {
    await browser.tabs.update(tabId, { url: buildBlockPageUrl(remainingSeconds) });
  } catch (e) {
  }
}

function startTicking() {
  if (tickTimer === null) {
    tickTimer = setInterval(tick, 1000);
  }
}

function stopTickingIfIdle() {
  if (trackedTabId === null && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

async function isTabForeground(tabId) {
  if (!trackedVisible) return false;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.active) return false;
    const win = await browser.windows.get(tab.windowId);
    return win.focused;
  } catch (e) {
    return false;
  }
}

async function tick() {
  if (trackedTabId === null) {
    stopTickingIfIdle();
    return;
  }
  const now = Date.now();
  const elapsed = Math.min((now - trackedActiveSince) / 1000, 60);
  trackedActiveSince = now;
  if (elapsed <= 0) return;

  if (!(await isTabForeground(trackedTabId))) return;

  const usage = await getUsage();
  recordEvent(usage, elapsed);
  await saveUsage(usage);
  await broadcastOverlayUpdate();

  const settings = await getSettings();
  const used = await usedSeconds(usage);
  if (used >= settings.shortsLimitSeconds) {
    if (trackedIsShorts) {
      pendingBlockTabId = trackedTabId;
    } else {
      const tabId = trackedTabId;
      stopTracking();
      await blockTab(tabId, settings.shortsLimitSeconds - used);
    }
  }
}

function stopTracking() {
  trackedTabId = null;
  trackedIsShorts = false;
  trackedActiveSince = 0;
  trackedVisible = true;
  stopTickingIfIdle();
}

async function injectVisibilityReporter(tabId) {
  try {
    await browser.tabs.executeScript(tabId, {
      file: "visibility-reporter.js",
      runAt: "document_idle"
    });
  } catch (e) {
  }
}

async function injectOverlay(tabId) {
  try {
    await browser.tabs.executeScript(tabId, {
      file: "usage-overlay.js",
      runAt: "document_start"
    });
  } catch (e) {
  }
}

async function startTracking(tabId, isShorts) {
  if (trackedTabId !== null && trackedTabId !== tabId) {
    await tick();
    stopTracking();
  }
  trackedTabId = tabId;
  trackedIsShorts = isShorts;
  trackedVisible = true;
  trackedActiveSince = Date.now();
  if (!isShorts) {
    await injectVisibilityReporter(tabId);
  }
  await injectOverlay(tabId);
  await broadcastOverlayUpdate();
  startTicking();
}

async function onNavigation(details) {
  const url = details.url || "";

  if (details.frameId !== 0) return;

  if (pendingBlockTabId === details.tabId && isShortsUrl(url)) {
    const tabId = pendingBlockTabId;
    pendingBlockTabId = null;
    const settings = await getSettings();
    const usage = await getUsage();
    const used = await usedSeconds(usage);
    stopTracking();
    await blockTab(tabId, settings.shortsLimitSeconds - used);
    return;
  }

  if (await isTrackedUrl(url)) {
    if (await checkAndEnforce(details.tabId)) return;
    if (trackedTabId !== details.tabId) {
      await startTracking(details.tabId, isShortsUrl(url));
    } else {
      await broadcastOverlayUpdate();
    }
    return;
  }

  if (trackedTabId === details.tabId) {
    await tick();
    stopTracking();
  }
}

async function syncTrackingWithActiveTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    const tab = tabs[0];
    if (await isTrackedUrl(tab.url)) {
      if (trackedTabId !== tab.id) {
        await startTracking(tab.id, isShortsUrl(tab.url));
      }
    } else if (trackedTabId === tab.id) {
      await tick();
      stopTracking();
    }
  } catch (e) {
  }
}

browser.webNavigation.onCommitted.addListener(onNavigation);

browser.webNavigation.onHistoryStateUpdated.addListener(onNavigation);

browser.windows.onFocusChanged.addListener(async windowId => {
  trackedActiveSince = Date.now();
  await syncTrackingWithActiveTab();
});

browser.tabs.onRemoved.addListener(tabId => {
  if (trackedTabId === tabId) {
    stopTracking();
  }
  if (pendingBlockTabId === tabId) {
    pendingBlockTabId = null;
  }
  blockedTabIds.delete(tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" && trackedTabId === tabId) {
    trackedActiveSince = Date.now();
  }
  if (changeInfo.url) {
    onNavigation({ tabId, url: changeInfo.url, frameId: 0 });
  }
});

browser.tabs.onActivated.addListener(async activeInfo => {
  if (trackedTabId !== null && trackedTabId !== activeInfo.tabId) {
    await tick();
    stopTracking();
  }
  await syncTrackingWithActiveTab();
});

browser.runtime.onMessage.addListener(async message => {
  if (message && message.type === "pageVisibility") {
    if (trackedTabId === null) return;
    if (message.visible) {
      if (!trackedVisible) {
        trackedVisible = true;
        trackedActiveSince = Date.now();
        startTicking();
      }
    } else {
      await tick();
      trackedVisible = false;
      trackedActiveSince = Date.now();
      stopTickingIfIdle();
    }
    return;
  }
  if (message && message.type === "getLimitStatus") {
    const settings = await getSettings();
    const usage = await getUsage();
    const used = await usedSeconds(usage);
    return {
      limit: settings.shortsLimitSeconds,
      used,
      remaining: Math.max(0, settings.shortsLimitSeconds - used),
      tracked: trackedTabId !== null
    };
  }
  if (message && message.type === "resetUsage") {
    await browser.storage.local.set({ usage: { events: [] } });
    return { ok: true };
  }
});

browser.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await browser.storage.local.set({ settings });
});

syncTrackingWithActiveTab();
