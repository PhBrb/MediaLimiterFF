# MediaLimiterFF

A Firefox for Android (Gecko) WebExtension that limits media consumption.

## Features

- **YouTube Shorts limiting**: while a tab is on a YouTube Shorts page (`youtube.com/shorts/...`), usage time is tracked each second. Normal YouTube videos are not affected.
- **Rolling window**: usage is measured over a rolling 60-minute window with a default limit of 10 minutes per hour.
- **Configurable limit**: the Shorts time limit can be changed (1–60 minutes) in the settings.
- **Extra websites**: additional websites can be added in the settings. Time spent viewing a listed site is counted against the same time limit, paused when hidden or minimized.
- **Block page**: when the limit is exhausted, the Shorts tab (or the visited site) is redirected to an explanation page. Time becomes available again as older usage expires from the rolling window.

## Install (Firefox for Android)

1. Build/pack: `zip -r ../medialimiter.zip *` from this directory (or use `web-ext build`).
2. In Firefox for Android, open the menu → Settings → About Firefox. Tap the logo 5 times to unlock debug mode.
3. Connect the device to a desktop via USB and use `web-ext run -t firefox-android` or load the extension via the temporary add-on debugger at `about:debugging`.

## Settings

Open the extension's options page (Add-ons → MediaLimiter → Settings):

- **YouTube Shorts limit (minutes)**: total Shorts time allowed per rolling hour (default 10).
- **Additional websites**: list of domains; viewing time on them counts against the limit (paused when hidden/minimized, like Shorts).
- **Current usage**: live view of the used time in the current rolling window, plus a reset button.

## How tracking works

- The background page listens to `webNavigation.onCommitted` to detect Shorts navigations and visits to listed sites.
- While a Shorts tab is active, a 1-second timer records elapsed time into `storage.local` as usage events.
- Usage events older than 60 minutes are pruned on every read/write.
- Domain matching ignores `www.` and matches subdomains.
