// content.js
// Observes the WhatsApp Web DOM and counts messages YOU SEND (not received) per day,
// broken down by recipient (contact/group name of the currently open chat).
//
// METHOD (message detection): every message has a container with attribute
// data-testid="msg-meta" that groups the timestamp and, ONLY for messages you sent,
// the delivery status icon (single/double/blue checkmark), rendered as an
// <svg><title>wds-ic-...</title>. Received messages never have these checkmarks:
// a reliable, language-independent marker.
//
// METHOD (recipient detection): reads the contact/group name from the chat header
// currently shown in #main. WhatsApp usually puts the full name in a title="..."
// attribute (used for the truncation tooltip), which we prefer; falls back to the
// first non-empty text span in the header otherwise.
//
// To avoid re-counting the same message when its checkmark status changes
// (single -> double -> blue), each msg-meta element is marked exactly once
// with the data-wa-counter-seen attribute directly in the DOM.
//
// On startup, the chat history already visible on the page is "marked as seen"
// but NOT counted (otherwise every WhatsApp Web reload would recount the whole
// open chat). Only messages that appear AFTER the script starts are counted.

(function () {
  const STORAGE_PREFIX = "wa_count_";
  const PROCESSED_ATTR = "data-wa-counter-seen";

  // Set to true to log debug info in the console (message detection + recipient
  // name detection) — useful if WhatsApp changes its DOM structure again.
  window.__WA_COUNTER_DEBUG__ = false;

  function todayDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function todayKey() {
    return STORAGE_PREFIX + todayDateStr();
  }

  function incrementTodayCount() {
    const key = todayKey();
    chrome.storage.local.get([key, "dailyLimit"], (res) => {
      const newCount = (res[key] || 0) + 1;
      const set = {};
      set[key] = newCount;
      chrome.storage.local.set(set);

      const limit = res.dailyLimit || 100;
      if (newCount === limit) {
        chrome.runtime.sendMessage({
          type: "limitReached",
          count: newCount,
          limit: limit,
        });
      }
    });
  }

  // ---------- Recipient detection ----------

  function getCurrentChatName() {
    // Primary: the exact element WhatsApp uses for the chat title text.
    const titleEl = document.querySelector(
      '[data-testid="conversation-info-header-chat-title"]'
    );
    if (titleEl) {
      const t = (titleEl.textContent || "").trim();
      if (t) return t;
    }

    // Fallback (older/alternate layouts): first non-empty text span in the header,
    // skipping the misleading accessibility title on the clickable header button
    // (e.g. "click here for group info").
    const header =
      document.querySelector("#main header") ||
      document.querySelector('header[data-testid="conversation-header"]');
    if (!header) return null;

    const spans = header.querySelectorAll('span[dir="auto"]');
    for (const s of spans) {
      const txt = (s.textContent || "").trim();
      if (txt) return txt;
    }
    return null;
  }

  function recordRecipientStat(name, dateStr) {
    const recipient = name || "Unknown";
    chrome.storage.local.get("recipientStats", (res) => {
      const stats = res.recipientStats || {};
      if (!stats[dateStr]) stats[dateStr] = {};
      stats[dateStr][recipient] = (stats[dateStr][recipient] || 0) + 1;
      chrome.storage.local.set({ recipientStats: stats });
    });
  }

  // ---------- Message detection ----------

  function isOutgoingMetaEl(metaEl) {
    const titles = metaEl.querySelectorAll("svg title");
    for (const t of titles) {
      if (/^wds-ic-/i.test(t.textContent || "")) return true;
    }
    return false;
  }

  function processMetaEl(metaEl, baseline) {
    if (metaEl.hasAttribute(PROCESSED_ATTR)) return;
    metaEl.setAttribute(PROCESSED_ATTR, "1");

    const outgoing = isOutgoingMetaEl(metaEl);

    if (window.__WA_COUNTER_DEBUG__) {
      console.log("[WA Counter][DEBUG] msg-meta found", {
        baseline,
        outgoing,
        chatName: getCurrentChatName(),
        outerHTML: metaEl.outerHTML.slice(0, 300),
      });
    }

    if (baseline) return; // don't count history already present at startup
    if (outgoing) {
      incrementTodayCount();
      recordRecipientStat(getCurrentChatName(), todayDateStr());
    }
  }

  function scanNode(node, baseline) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches && node.matches('[data-testid="msg-meta"]')) {
      processMetaEl(node, baseline);
    }
    if (node.querySelectorAll) {
      node
        .querySelectorAll('[data-testid="msg-meta"]')
        .forEach((el) => processMetaEl(el, baseline));
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => scanNode(n, false));
    }
  });

  // ---------- Floating on-page overlay ----------

  function ensureOverlay() {
    let el = document.getElementById("wa-counter-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "wa-counter-overlay";
      Object.assign(el.style, {
        position: "fixed",
        bottom: "16px",
        right: "16px",
        zIndex: 999999,
        background: "#128C7E",
        color: "#fff",
        padding: "6px 10px",
        borderRadius: "16px",
        fontFamily: "Segoe UI, Arial, sans-serif",
        fontSize: "13px",
        fontWeight: "600",
        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      });
      el.title = "Messages sent today on WhatsApp Web (right-click to hide)";

      const label = document.createElement("span");
      label.id = "wa-counter-overlay-label";
      el.appendChild(label);

      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        el.style.display = "none";
      });

      document.body.appendChild(el);
    }
    return el;
  }

  function renderOverlay(count, limit) {
    const el = ensureOverlay();
    const label = el.querySelector("#wa-counter-overlay-label");
    label.textContent = `✉️ ${count} / ${limit}`;
    el.style.background = count >= limit ? "#e53935" : "#128C7E";
  }

  function refreshOverlayFromStorage() {
    const key = todayKey();
    chrome.storage.local.get([key, "dailyLimit"], (res) => {
      renderOverlay(res[key] || 0, res.dailyLimit || 100);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[todayKey()] || changes.dailyLimit) {
      refreshOverlayFromStorage();
    }
  });

  function start() {
    scanNode(document.body, true);
    observer.observe(document.body, { childList: true, subtree: true });
    refreshOverlayFromStorage();
    console.log("[WA Counter] Active: message observer started (baseline marked, not counted).");
  }

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start);
  }
})();
