const DEFAULT_SETTINGS = {
  shortsLimitSeconds: 600,
  siteCostSeconds: 30,
  extraSites: []
};

const limitInput = document.getElementById("limitMinutes");
const newSiteInput = document.getElementById("newSite");
const addSiteButton = document.getElementById("addSite");
const siteList = document.getElementById("siteList");
const usageDisplay = document.getElementById("usageDisplay");
const resetUsageButton = document.getElementById("resetUsage");
const status = document.getElementById("status");

let settings = { ...DEFAULT_SETTINGS };

function showStatus(message) {
  status.textContent = message;
  setTimeout(() => { status.textContent = ""; }, 2000);
}

function formatMinutes(seconds) {
  return Math.round(seconds / 60);
}

function formatUsage(statusInfo) {
  const usedMin = Math.floor(statusInfo.used / 60);
  const usedSec = Math.floor(statusInfo.used % 60);
  const limitMin = formatMinutes(statusInfo.limit);
  return `${usedMin}m ${usedSec}s of ${limitMin}m used in the last hour (${Math.max(0, Math.ceil(statusInfo.remaining))}s remaining)`;
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

async function saveSettings() {
  const minutes = parseInt(limitInput.value, 10);
  if (Number.isNaN(minutes) || minutes < 1 || minutes > 60) {
    showStatus("Limit must be between 1 and 60 minutes.");
    return;
  }
  settings.shortsLimitSeconds = minutes * 60;
  await browser.storage.local.set({ settings });
  showStatus("Saved.");
  await refreshUsage();
}

async function renderSiteList() {
  siteList.innerHTML = "";
  for (const site of settings.extraSites) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = site;
    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      settings.extraSites = settings.extraSites.filter(s => s !== site);
      await browser.storage.local.set({ settings });
      renderSiteList();
      showStatus("Removed " + site);
    });
    li.appendChild(span);
    li.appendChild(removeButton);
    siteList.appendChild(li);
  }
}

async function addSite() {
  const normalized = normalizeSiteInput(newSiteInput.value);
  if (!normalized) {
    showStatus("Enter a valid domain like example.com");
    return;
  }
  if (settings.extraSites.includes(normalized)) {
    showStatus(normalized + " is already listed.");
    return;
  }
  settings.extraSites.push(normalized);
  await browser.storage.local.set({ settings });
  newSiteInput.value = "";
  renderSiteList();
  showStatus("Added " + normalized);
}

async function refreshUsage() {
  const response = await browser.runtime.sendMessage({ type: "getLimitStatus" });
  if (response) {
    usageDisplay.textContent = formatUsage(response);
  }
}

limitInput.addEventListener("change", saveSettings);
addSiteButton.addEventListener("click", addSite);
newSiteInput.addEventListener("keydown", event => {
  if (event.key === "Enter") addSite();
});

resetUsageButton.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "resetUsage" });
  showStatus("Usage reset.");
  await refreshUsage();
});

async function init() {
  document.getElementById("version").textContent = "Version " + browser.runtime.getManifest().version;
  const stored = await browser.storage.local.get("settings");
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  limitInput.value = formatMinutes(settings.shortsLimitSeconds);
  renderSiteList();
  await refreshUsage();
  setInterval(refreshUsage, 5000);
}

init();
