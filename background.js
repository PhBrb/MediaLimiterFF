const DEFAULT_SETTINGS = {
  shortsLimitSeconds: 600,
  siteCostSeconds: 30,
  extraSites: []
};

const ROLLING_WINDOW_MS = 60 * 60 * 1000;
const SHORTS_URL_PATTERN = /^https:\/\/(www\.|m\.)?youtube\.com\/(shorts|live\/shorts)/i;
let activeShortsTabId = null;
let shortsActiveSince = 0;
let tickTimer = null;
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
  if (activeShortsTabId === null && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

async function tick() {
  if (activeShortsTabId === null) {
    stopTickingIfIdle();
    return;
  }
  const now = Date.now();
  const elapsed = Math.min((now - shortsActiveSince) / 1000, 60);
  shortsActiveSince = now;
  if (elapsed <= 0) return;

  const usage = await getUsage();
  recordEvent(usage, elapsed);
  await saveUsage(usage);

  const settings = await getSettings();
  const used = await usedSeconds(usage);
  if (used >= settings.shortsLimitSeconds) {
    const tabId = activeShortsTabId;
    stopShortsTracking();
    await blockTab(tabId, settings.shortsLimitSeconds - used);
  }
}

async function syncTrackingWithActiveTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    const tab = tabs[0];
    if (isShortsUrl(tab.url)) {
      if (activeShortsTabId !== tab.id) {
        if (activeShortsTabId !== null) {
          await tick();
        }
        activeShortsTabId = tab.id;
        shortsActiveSince = Date.now();
        startTicking();
      }
    } else if (activeShortsTabId === tab.id) {
      await tick();
      stopShortsTracking();
    }
  } catch (e) {
  }
}

function stopShortsTracking() {
  activeShortsTabId = null;
  shortsActiveSince = 0;
  stopTickingIfIdle();
}

async function onNavigation(details) {
  const settings = await getSettings();
  const url = details.url || "";

  if (details.frameId !== 0) return;

  if (isShortsUrl(url)) {
    if (await checkAndEnforce(details.tabId)) return;
    if (activeShortsTabId !== details.tabId) {
      if (activeShortsTabId !== null) {
        await tick();
      }
      activeShortsTabId = details.tabId;
      shortsActiveSince = Date.now();
      startTicking();
    }
    return;
  }

  if (activeShortsTabId === details.tabId) {
    await tick();
    stopShortsTracking();
  }

  const usage = await getUsage();
  const used = await usedSeconds(usage);
  if (used >= settings.shortsLimitSeconds && blockedTabIds.has(details.tabId)) {
    return;
  }

  if (settings.extraSites.length > 0 && matchesExtraSite(url, settings.extraSites)) {
    const lastChargeKey = "sitecharge_" + details.tabId;
    const stored = await browser.storage.local.get(lastChargeKey);
    const lastCharge = stored[lastChargeKey] || 0;
    const now = Date.now();
    if (now - lastCharge > 5000) {
      await browser.storage.local.set({ [lastChargeKey]: now });
      recordEvent(usage, settings.siteCostSeconds);
      await saveUsage(usage);
      const usedAfter = used + settings.siteCostSeconds;
      if (usedAfter >= settings.shortsLimitSeconds) {
        await blockTab(details.tabId, settings.shortsLimitSeconds - usedAfter);
      }
    }
  }
}

browser.webNavigation.onCommitted.addListener(onNavigation);

browser.webNavigation.onHistoryStateUpdated.addListener(onNavigation);

browser.windows.onFocusChanged.addListener(syncTrackingWithActiveTab);

browser.tabs.onRemoved.addListener(tabId => {
  if (activeShortsTabId === tabId) {
    stopShortsTracking();
  }
  blockedTabIds.delete(tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (activeShortsTabId === tabId && changeInfo.status === "complete") {
    shortsActiveSince = Date.now();
  }
  if (changeInfo.url) {
    onNavigation({ tabId, url: changeInfo.url, frameId: 0 });
  }
});

browser.tabs.onActivated.addListener(async activeInfo => {
  if (activeShortsTabId !== null && activeShortsTabId !== activeInfo.tabId) {
    await tick();
    stopShortsTracking();
  }
  await syncTrackingWithActiveTab();
});

syncTrackingWithActiveTab();

browser.runtime.onMessage.addListener(async message => {
  if (message && message.type === "getLimitStatus") {
    const settings = await getSettings();
    const usage = await getUsage();
    const used = await usedSeconds(usage);
    return {
      limit: settings.shortsLimitSeconds,
      used,
      remaining: Math.max(0, settings.shortsLimitSeconds - used)
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

