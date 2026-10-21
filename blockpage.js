const params = new URLSearchParams(window.location.search);
const remaining = params.get("remaining");
const message = document.getElementById("message");
if (remaining && parseInt(remaining, 10) < 0) {
  message.textContent = "You have used your configured media time for this hour. Time becomes available again as the rolling window expires.";
} else if (remaining) {
  message.textContent = `You have used your configured media time for this hour. Approximately ${Math.ceil(parseInt(remaining, 10) / 60)} minute(s) will become available again as the rolling window expires.`;
}
