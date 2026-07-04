// utils/storage.js
// Thin promise wrapper around chrome.storage.local so the rest of the
// codebase never touches the callback API directly.

const storage = {
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result[key]));
    });
  },

  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve(true));
    });
  },

  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => resolve(true));
    });
  },

  /** Get multiple keys at once. Returns { key: value, ... }. */
  async getMany(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result));
    });
  },

  /** List all keys currently in storage that start with `prefix`. */
  async listKeys(prefix) {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (all) => {
        resolve(Object.keys(all).filter((k) => k.startsWith(prefix)));
      });
    });
  },
};

// Exposed as a global in service worker / content script contexts (no ES modules in MV3 content scripts by default).
self.ARAStorage = storage;
