// popup.js
const STORAGE_PREFIX = "wa_count_";
const TOP_RECIPIENTS_LIMIT = 10;

function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    key: STORAGE_PREFIX + `${y}-${m}-${day}`,
    dateStr: `${y}-${m}-${day}`,
    label: `${day}/${m}`,
  };
}

function todayDateStr() {
  return dateKey(0).dateStr;
}

// ---------- Daily total + history ----------

function renderTotals() {
  const today = dateKey(0);
  chrome.storage.local.get([today.key, "dailyLimit"], (res) => {
    const count = res[today.key] || 0;
    const limit = res.dailyLimit || 100;

    document.getElementById("count").textContent = count;
    document.getElementById("limitLabel").textContent = `/ ${limit}`;
    document.getElementById("limit").value = limit;

    const pct = Math.min(100, Math.round((count / limit) * 100));
    const bar = document.getElementById("bar");
    bar.style.width = pct + "%";
    bar.classList.toggle("over", count >= limit);
  });

  const keys = [];
  for (let i = 0; i < 7; i++) keys.push(dateKey(i));
  chrome.storage.local.get(
    keys.map((k) => k.key),
    (res) => {
      const list = document.getElementById("history");
      list.innerHTML = "";
      keys.forEach((k) => {
        const li = document.createElement("li");
        const val = res[k.key] || 0;
        li.innerHTML = `<span>${k.label}</span><span>${val}</span>`;
        list.appendChild(li);
      });
    }
  );
}

// ---------- Top recipients ----------

function aggregateRecipients(stats, period) {
  const today = todayDateStr(); // YYYY-MM-DD
  const monthPrefix = today.slice(0, 7); // YYYY-MM
  const yearPrefix = today.slice(0, 4); // YYYY

  const totals = {};
  for (const dateStr of Object.keys(stats)) {
    let include = false;
    if (period === "today") include = dateStr === today;
    else if (period === "month") include = dateStr.startsWith(monthPrefix);
    else if (period === "year") include = dateStr.startsWith(yearPrefix);
    else if (period === "all") include = true;

    if (!include) continue;

    const dayStats = stats[dateStr] || {};
    for (const name of Object.keys(dayStats)) {
      totals[name] = (totals[name] || 0) + dayStats[name];
    }
  }

  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RECIPIENTS_LIMIT);
}

function renderRecipientList() {
  const period = document.getElementById("statsPeriod").value;
  chrome.storage.local.get("recipientStats", (res) => {
    const stats = res.recipientStats || {};
    const top = aggregateRecipients(stats, period);
    const list = document.getElementById("recipientList");
    list.innerHTML = "";

    if (top.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No data yet for this period.";
      list.appendChild(empty);
      return;
    }

    top.forEach(([name, count]) => {
      const li = document.createElement("li");
      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = name;
      nameSpan.title = name;
      const countSpan = document.createElement("span");
      countSpan.textContent = count;
      li.appendChild(nameSpan);
      li.appendChild(countSpan);
      list.appendChild(li);
    });
  });
}

function renderAll() {
  renderTotals();
  renderRecipientList();
}

document.getElementById("save").addEventListener("click", () => {
  const val = parseInt(document.getElementById("limit").value, 10);
  if (!val || val < 1) return;
  chrome.storage.local.set({ dailyLimit: val }, renderAll);
});

document.getElementById("resetToday").addEventListener("click", () => {
  const today = dateKey(0);
  const set = {};
  set[today.key] = 0;
  chrome.storage.local.set(set, renderAll);
});

document.getElementById("resetContacts").addEventListener("click", () => {
  const confirmed = confirm(
    "This will permanently delete all per-recipient statistics (names and counts). The daily/monthly totals are not affected. Continue?"
  );
  if (!confirmed) return;
  chrome.storage.local.remove("recipientStats", renderAll);
});

document.getElementById("statsPeriod").addEventListener("change", renderRecipientList);

renderAll();
