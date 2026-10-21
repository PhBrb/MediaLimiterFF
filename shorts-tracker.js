function reportVisibility() {
  browser.runtime.sendMessage({
    type: "shortsVisibility",
    visible: !document.hidden
  }).catch(() => {});
}

document.addEventListener("visibilitychange", reportVisibility);
reportVisibility();
