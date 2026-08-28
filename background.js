// background.js
const STORAGE_PREFIX = "wa_count_";

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return STORAGE_PREFIX + `${y}-${m}-${day}`;
}

function updateBadge() {
  const key = todayKey();
  chrome.storage.local.get([key, "dailyLimit"], (res) => {
    const count = res[key] || 0;
    const limit = res.dailyLimit || 100;
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({
      color: count >= limit ? "#e53935" : "#128C7E",
    });
  });
}

// Notify when the limit is reached (message sent from the content script)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "limitReached") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: "Daily limit reached",
      message: `You've sent ${msg.count} messages today on WhatsApp Web (limit: ${msg.limit}).`,
      priority: 2,
    });
  }
});

// Keep the toolbar badge up to date even when you're not on the WhatsApp Web tab
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") updateBadge();
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
updateBadge();
