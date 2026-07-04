// options/options.js

const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");
const modelInput = document.getElementById("model");
const saveModelBtn = document.getElementById("saveModelBtn");
const saveModelStatus = document.getElementById("saveModelStatus");
const clearCacheBtn = document.getElementById("clearCacheBtn");
const clearStatus = document.getElementById("clearStatus");

function flashStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("status--err", isError);
  setTimeout(() => {
    el.textContent = "";
  }, 2500);
}

function loadSettings() {
  chrome.runtime.sendMessage({ type: "GET_API_KEY" }, (response) => {
    if (!response?.ok) return;
    if (response.hasKey) {
      apiKeyInput.placeholder = "•••••••••••••••••••• (key saved)";
    }
    // Show the current model as a placeholder, not a value, so it's clear
    // this is "currently in effect" rather than something that must be re-saved.
    modelInput.placeholder = response.model || "openai/gpt-4o-mini";
  });
}

saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    flashStatus(saveStatus, "Enter a key first.", true);
    return;
  }
  chrome.runtime.sendMessage({ type: "SET_API_KEY", key }, (response) => {
    if (response?.ok) {
      apiKeyInput.value = "";
      apiKeyInput.placeholder = "•••••••••••••••••••• (key saved)";
      flashStatus(saveStatus, "Saved.");
    } else {
      flashStatus(saveStatus, "Could not save key.", true);
    }
  });
});

saveModelBtn.addEventListener("click", () => {
  const model = modelInput.value.trim();
  chrome.runtime.sendMessage({ type: "SET_MODEL", model }, (response) => {
    if (response?.ok) {
      modelInput.value = "";
      modelInput.placeholder = model || "openai/gpt-4o-mini";
      flashStatus(saveModelStatus, model ? "Saved." : "Reset to default.");
    } else {
      flashStatus(saveModelStatus, "Could not save model.", true);
    }
  });
});

clearCacheBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, (response) => {
    if (response?.ok) {
      flashStatus(clearStatus, `Cleared ${response.cleared} cached item(s).`);
    } else {
      flashStatus(clearStatus, "Could not clear cache.", true);
    }
  });
});

loadSettings();
