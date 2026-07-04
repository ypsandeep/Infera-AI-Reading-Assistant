// background/background.js
// Service worker: routes messages between content script, popup, options
// page, and the various core/ + services/ modules. This is the only place
// that holds the OpenRouter API key and makes network calls.

importScripts(
  "../utils/storage.js",
  "../utils/promptBuilder.js",
  "../services/domainService.js",
  "../services/openrouterService.js",
  "../core/context/ambiguityChecker.js",
  "../core/cache/cache.js"
);

const API_KEY_STORAGE_KEY = "settings:openrouterApiKey";
const MODEL_STORAGE_KEY = "settings:openrouterModel";

/** @type {Map<number, object>} tabId -> { context, domain, needsConfirmation } */
const tabState = new Map();

function domainStorageKey(hostname) {
  return `domain:${hostname}`;
}

async function resolveDomainForPage(pageContext) {
  const saved = await self.ARAStorage.get(domainStorageKey(pageContext.hostname));
  if (saved) {
    return { domain: saved, needsConfirmation: false, source: "saved" };
  }

  // Tier 1 (keyword heuristic) always runs -- it's free and instant, and
  // its result is the fallback if AI classification is unavailable or
  // fails. But it does NOT gate whether Tier 2 runs anymore: a keyword
  // match can be *confidently wrong* (e.g. a page about automotive
  // engineering that also discusses AI-assisted driving can legitimately
  // score higher on "Artificial Intelligence" keywords than on
  // "Automotive Engineering" ones), and a confident wrong answer used to
  // silently block the smarter tier from ever being consulted. Hardcoded
  // keyword lists structurally can't know when they're wrong -- only a
  // model reading the actual content semantically can catch that, so AI
  // classification is now the primary method whenever a key is set, not
  // a fallback reserved for cases the heuristic admits it's unsure about.
  const suggestion = self.ARADomainService.suggestDomain(pageContext);

  try {
    const apiKey = await self.ARAStorage.get(API_KEY_STORAGE_KEY);
    if (apiKey) {
      const model = await self.ARAStorage.get(MODEL_STORAGE_KEY);
      const candidates = self.ARADomainService.DOMAINS.filter((d) => d !== "Other");
      const result = await self.ARAOpenRouterService.classifyDomain(pageContext, candidates, apiKey, model);
      if (result?.domain && result.domain !== "Other" && candidates.includes(result.domain)) {
        // Still surfaced via the confirmation banner (needsConfirmation
        // stays true) rather than silently committed -- a semantic
        // classification is a much better default than a keyword-overlap
        // guess, but it's still a guess, and the student should get an
        // easy one-tap way to correct it.
        return {
          domain: result.domain,
          needsConfirmation: true,
          source: "ai-classified",
          scores: suggestion.scores,
        };
      }
    }
  } catch {
    // Network/API errors here shouldn't block page load -- just fall
    // through to the Tier 1 result below.
  }

  return {
    domain: suggestion.domain,
    needsConfirmation: suggestion.needsConfirmation,
    source: "suggested",
    scores: suggestion.scores,
  };
}

async function handlePageLoaded(message, sender, sendResponse) {
  const tabId = sender.tab?.id;
  const pageContext = message.pageContext;

  const { domain, needsConfirmation, source, scores } = await resolveDomainForPage(pageContext);

  if (tabId != null) {
    tabState.set(tabId, { context: pageContext, domain, needsConfirmation, receivedAt: Date.now() });
  }

  // The full catalogue now has ~20 domains (engineering, medicine, arts,
  // GIS, management, etc.) — too many to show as banner chips on the page,
  // so the banner only gets a short, relevant shortlist. The popup's
  // dropdown still gets the full list via GET_TAB_CONTEXT below.
  const bannerDomains = scores
    ? self.ARADomainService.topCandidates(scores, 5)
    : self.ARADomainService.DOMAINS;

  // If Tier 2 (AI classification) picked a domain, put it first in the
  // chip list -- it's a stronger guess than the raw keyword scores, so it
  // should be the easiest one to accept, not buried mid-list.
  if (source === "ai-classified" && !bannerDomains.includes(domain)) {
    bannerDomains.unshift(domain);
  } else if (source === "ai-classified") {
    bannerDomains.splice(bannerDomains.indexOf(domain), 1);
    bannerDomains.unshift(domain);
  }

  sendResponse({ ok: true, domain, needsConfirmation, source, domains: bannerDomains });
}

async function handleSetDomain(message, sender, sendResponse) {
  try {
    const tabId = sender.tab?.id ?? message.tabId;
    const hostname = message.hostname;
    const domain = (message.domain || "").trim();

    if (!hostname) {
      const err = new Error("Missing page info — try refreshing the page and setting the domain again.");
      err.code = "CONTEXT_INVALIDATED";
      throw err;
    }
    if (!domain) {
      sendResponse({ ok: false, error: "Domain can't be empty.", code: "INVALID_DOMAIN" });
      return;
    }

    await self.ARAStorage.set(domainStorageKey(hostname), domain);

    const state = tabState.get(tabId);
    if (state) {
      state.domain = domain;
      state.needsConfirmation = false;
    }
    sendResponse({ ok: true, domain });
  } catch (err) {
    sendResponse({ ok: false, error: err.message, code: err.code || "UNKNOWN" });
  }
}

async function handleExplainConcept(message, sender, sendResponse) {
  try {
    const tabId = sender.tab?.id ?? message.tabId;
    const state = tabState.get(tabId);
    const domain = state?.domain || null;
    const concept = message.concept.trim();

    const { ambiguous } = self.ARAAmbiguityChecker.checkAmbiguity(concept);
    const effectiveDomain = ambiguous ? domain : null;

    const cached = await self.ARACache.getExplanation(concept, effectiveDomain);
    if (cached) {
      sendResponse({ ok: true, source: "cache", domain: effectiveDomain, explanation: cached });
      return;
    }

    const apiKey = await self.ARAStorage.get(API_KEY_STORAGE_KEY);
    const model = await self.ARAStorage.get(MODEL_STORAGE_KEY);
    const explanation = await self.ARAOpenRouterService.getFastExplanation(concept, effectiveDomain, apiKey, model);
    await self.ARACache.setExplanation(concept, effectiveDomain, explanation);
    sendResponse({ ok: true, source: "openrouter", domain: effectiveDomain, explanation });
  } catch (err) {
    // This catch is what guarantees sendResponse always fires. Without it,
    // any throw above (e.g. ambiguity checker, cache read, storage read)
    // left the content script's callback waiting forever — the "just
    // buffering, no result" symptom.
    sendResponse({ ok: false, error: err.message, code: err.code || "UNKNOWN" });
  }
}

async function handleLearnMore(message, sender, sendResponse) {
  try {
    const tabId = sender.tab?.id ?? message.tabId;
    const state = tabState.get(tabId);
    const domain = state?.domain || null;
    const concept = message.concept.trim();

    const { ambiguous } = self.ARAAmbiguityChecker.checkAmbiguity(concept);
    const effectiveDomain = ambiguous ? domain : null;

    const cached = await self.ARACache.getLearningObject(concept, effectiveDomain);
    if (cached) {
      sendResponse({ ok: true, source: "cache", domain: effectiveDomain, learningObject: cached });
      return;
    }

    const apiKey = await self.ARAStorage.get(API_KEY_STORAGE_KEY);
    const model = await self.ARAStorage.get(MODEL_STORAGE_KEY);
    const learningObject = await self.ARAOpenRouterService.getLearningObject(concept, effectiveDomain, apiKey, model);
    await self.ARACache.setLearningObject(concept, effectiveDomain, learningObject);
    sendResponse({ ok: true, source: "openrouter", domain: effectiveDomain, learningObject });
  } catch (err) {
    sendResponse({ ok: false, error: err.message, code: err.code || "UNKNOWN" });
  }
}

async function handleGetTabContext(message, sender, sendResponse) {
  const state = tabState.get(message.tabId);
  sendResponse({ ok: true, state: state || null, domains: self.ARADomainService.DOMAINS });
}

async function handleGetApiKey(message, sender, sendResponse) {
  const key = await self.ARAStorage.get(API_KEY_STORAGE_KEY);
  const model = await self.ARAStorage.get(MODEL_STORAGE_KEY);
  sendResponse({
    ok: true,
    hasKey: Boolean(key),
    key: key || "",
    model: model || self.ARAOpenRouterService.DEFAULT_MODEL,
  });
}

async function handleSetApiKey(message, sender, sendResponse) {
  await self.ARAStorage.set(API_KEY_STORAGE_KEY, message.key.trim());
  sendResponse({ ok: true });
}

async function handleSetModel(message, sender, sendResponse) {
  const model = (message.model || "").trim();
  if (model) {
    await self.ARAStorage.set(MODEL_STORAGE_KEY, model);
  } else {
    await self.ARAStorage.remove(MODEL_STORAGE_KEY); // empty input -> fall back to default
  }
  sendResponse({ ok: true });
}

async function handleClearCache(message, sender, sendResponse) {
  const keys = await self.ARAStorage.listKeys("cache:");
  for (const k of keys) await self.ARAStorage.remove(k);
  sendResponse({ ok: true, cleared: keys.length });
}

// Lets the in-page toast's "Open settings" action button jump straight to
// the options page (used for the "no API key set" notification) without
// giving the content script direct access to chrome.runtime.openOptionsPage.
async function handleOpenOptions(message, sender, sendResponse) {
  try {
    await chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

const HANDLERS = {
  PAGE_LOADED: handlePageLoaded,
  SET_DOMAIN: handleSetDomain,
  EXPLAIN_CONCEPT: handleExplainConcept,
  LEARN_MORE: handleLearnMore,
  GET_TAB_CONTEXT: handleGetTabContext,
  GET_API_KEY: handleGetApiKey,
  SET_API_KEY: handleSetApiKey,
  SET_MODEL: handleSetModel,
  CLEAR_CACHE: handleClearCache,
  OPEN_OPTIONS: handleOpenOptions,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message.type];
  if (!handler) {
    sendResponse({ ok: false, error: "Unknown message type: " + message.type });
    return false;
  }
  handler(message, sender, sendResponse);
  return true; // keep channel open for the async handler
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

console.log("[AI Reading Assistant] background service worker started");
