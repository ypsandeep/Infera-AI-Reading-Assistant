// core/cache/cache.js
// Caches AI explanations so the same concept+domain pair never costs a
// second API call. Backed by chrome.storage.local via utils/storage.js.

// Short deterministic hash (djb2) used only for long selections (full
// sentences/paragraphs) so a cache key never grows unbounded. Short
// word/phrase selections — the common case — are left exactly as before,
// so previously cached entries keep working unchanged.
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

const MAX_KEY_TEXT = 80;

function cacheKey(concept, domain) {
  const c = concept.trim().toLowerCase();
  const d = (domain || "general").trim().toLowerCase();
  const keyText = c.length > MAX_KEY_TEXT ? `${c.slice(0, MAX_KEY_TEXT)}…${hashString(c)}` : c;
  return `cache:${d}:${keyText}`;
}

const explanationCache = {
  /** @returns {Promise<object|null>} cached explanation object, or null on miss */
  async getExplanation(concept, domain) {
    const value = await self.ARAStorage.get(cacheKey(concept, domain));
    return value || null;
  },

  async setExplanation(concept, domain, explanation) {
    await self.ARAStorage.set(cacheKey(concept, domain), {
      ...explanation,
      cachedAt: Date.now(),
    });
  },

  /** @returns {Promise<object|null>} cached learning object, or null on miss */
  async getLearningObject(concept, domain) {
    const value = await self.ARAStorage.get(cacheKey(concept, domain) + ":learn");
    return value || null;
  },

  async setLearningObject(concept, domain, learningObject) {
    await self.ARAStorage.set(cacheKey(concept, domain) + ":learn", {
      ...learningObject,
      cachedAt: Date.now(),
    });
  },
};

self.ARACache = explanationCache;
