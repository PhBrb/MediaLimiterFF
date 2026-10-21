function reportVisibility() {
  browser.runtime.sendMessage({
    type: "pageVisibility",
    visible: !document.hidden
  }).catch(() => {});
}

document.addEventListener("visibilitychange", reportVisibility);
reportVisibility();
