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

const SEEN_CONCEPTS_KEY = "memory:seenConcepts";
const MAX_SEEN_CONCEPTS = 300;

function normalizeConceptKey(concept) {
  const c = concept.trim().toLowerCase();
  return c.length > MAX_KEY_TEXT ? `${c.slice(0, MAX_KEY_TEXT)}…${hashString(c)}` : c;
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

  // ---------------------------------------------------------------------
  // Memory awareness: "has this student encountered this concept before
  // through the tool?" This is intentionally separate from the response
  // cache above -- clearing the cache (e.g. via the options page) shouldn't
  // also erase the student's learning history, and this only needs a tiny
  // footprint (concept -> last-seen timestamp), not full cached responses.
  // Deliberately domain-agnostic (a concept the student has met before is
  // "known" regardless of which page they met it on).
  //
  // Known tradeoff: a cache HIT for a concept skips calling the model
  // entirely (see background.js), so "seen before" only affects the
  // prompt on genuinely fresh generations, not ones served from cache.
  // That's an accepted simplification -- re-running the model just to
  // possibly deepen an already-cached explanation would undercut the
  // whole point of caching (cost/latency).
  // ---------------------------------------------------------------------

  async hasSeenConcept(concept) {
    const seen = (await self.ARAStorage.get(SEEN_CONCEPTS_KEY)) || {};
    return Boolean(seen[normalizeConceptKey(concept)]);
  },

  async markConceptSeen(concept) {
    const seen = (await self.ARAStorage.get(SEEN_CONCEPTS_KEY)) || {};
    seen[normalizeConceptKey(concept)] = Date.now();

    const entries = Object.entries(seen);
    if (entries.length > MAX_SEEN_CONCEPTS) {
      // Evict the oldest entries so this can never grow unbounded over a
      // long-running semester of use.
      entries.sort((a, b) => a[1] - b[1]);
      const trimmed = entries.slice(entries.length - MAX_SEEN_CONCEPTS);
      await self.ARAStorage.set(SEEN_CONCEPTS_KEY, Object.fromEntries(trimmed));
    } else {
      await self.ARAStorage.set(SEEN_CONCEPTS_KEY, seen);
    }
  },
};

self.ARACache = explanationCache;
