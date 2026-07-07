// popup/popup.js

const statusEl = document.getElementById("status");
const pageInfoEl = document.getElementById("pageInfo");
const pageTitleEl = document.getElementById("pageTitle");
const domainSelect = document.getElementById("domainSelect");
const apiKeyWarningEl = document.getElementById("apiKeyWarning");
const openOptionsLink = document.getElementById("openOptions");
const globalEnabledToggle = document.getElementById("globalEnabledToggle");
const siteEnabledToggle = document.getElementById("siteEnabledToggle");

let activeTab = null;
let activeHostname = null;
let globalEnabled = true;
let siteDisabled = false;

function setStatus(text, ok = false) {
  statusEl.innerHTML = `<p class="status__line${ok ? " status__line--ok" : ""}">${text}</p>`;
}

function populateDomainSelect(domains, current) {
  domainSelect.innerHTML = "";
  // If the saved domain isn't one of the canonical options (e.g. it was
  // typed as free text in the in-page banner), it must still be shown as
  // selected -- otherwise no <option> matches, the browser silently falls
  // back to displaying option #0, and a correctly-saved custom domain
  // *looks* like it reverted to whatever happens to be first in the list.
  const list = current && !domains.includes(current) ? [current, ...domains] : domains;
  list.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    if (d === current) opt.selected = true;
    domainSelect.appendChild(opt);
  });
}

domainSelect.addEventListener("change", () => {
  if (!activeHostname) return;
  chrome.runtime.sendMessage(
    {
      type: "SET_DOMAIN",
      tabId: activeTab.id,
      hostname: activeHostname,
      domain: domainSelect.value,
    },
    () => {
      setStatus(`Domain set to "${domainSelect.value}" — future highlights will use it.`, true);
    }
  );
});

openOptionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// The site toggle is meaningless once the extension is off everywhere, so
// it's disabled (grayed out) rather than left clickable but inert.
function reflectEnabledControls() {
  globalEnabledToggle.checked = globalEnabled;
  siteEnabledToggle.checked = !siteDisabled;
  siteEnabledToggle.disabled = !globalEnabled;

  if (!globalEnabled) {
    setStatus("Reading Assistant is turned off. Flip the switch above to turn it back on.");
  } else if (siteDisabled) {
    setStatus("Turned off for this site. Flip the switch below to re-enable it here.");
  }
}

globalEnabledToggle.addEventListener("change", () => {
  globalEnabled = globalEnabledToggle.checked;
  chrome.runtime.sendMessage({ type: "SET_EXTENSION_ENABLED", enabled: globalEnabled }, () => {
    reflectEnabledControls();
    if (globalEnabled) refreshPageInfo();
  });
});

siteEnabledToggle.addEventListener("change", () => {
  if (!activeHostname) return;
  siteDisabled = !siteEnabledToggle.checked;
  chrome.runtime.sendMessage(
    { type: "SET_SITE_DISABLED", hostname: activeHostname, disabled: siteDisabled },
    () => {
      reflectEnabledControls();
      if (!siteDisabled) refreshPageInfo();
    }
  );
});

async function checkApiKey() {
  chrome.runtime.sendMessage({ type: "GET_API_KEY" }, (response) => {
    apiKeyWarningEl.hidden = Boolean(response?.hasKey);
  });
}

function refreshPageInfo() {
  chrome.runtime.sendMessage({ type: "GET_TAB_CONTEXT", tabId: activeTab.id }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setStatus("Background script unreachable.");
      return;
    }

    if (!response.state) {
      // Distinguish "turned off" from "content script just hasn't reported
      // in yet" -- otherwise a perfectly normal disabled state looks like
      // something is broken and needs a page reload.
      if (!globalEnabled || siteDisabled) return; // reflectEnabledControls() already covers the messaging
      setStatus("Content script hasn't reported in yet. Try reloading the page.");
      return;
    }

    setStatus("Connected — highlight any word on the page to get an explanation.", true);
    pageInfoEl.hidden = false;
    pageTitleEl.textContent = response.state.context?.title || "(untitled)";
    populateDomainSelect(response.domains, response.state.domain);
  });
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;

  if (!tab) {
    setStatus("No active tab found.");
    return;
  }

  try {
    activeHostname = new URL(tab.url).hostname;
  } catch {
    activeHostname = null;
  }

  chrome.runtime.sendMessage({ type: "GET_ENABLED_STATE", hostname: activeHostname || "" }, (response) => {
    if (!chrome.runtime.lastError && response?.ok) {
      globalEnabled = response.globalEnabled;
      siteDisabled = response.siteDisabled;
    }
    reflectEnabledControls();
    refreshPageInfo();
  });

  checkApiKey();
}

main();
