// services/openrouterService.js
// Talks to OpenRouter (https://openrouter.ai) — an OpenAI-compatible chat
// completions API that can route to many underlying models. Requires an
// API key set via the options page.

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

function stripJsonFences(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
}

function friendlyErrorFromStatus(status, bodyText) {
  let apiMessage = "";
  try {
    const parsed = JSON.parse(bodyText);
    apiMessage = parsed?.error?.message || "";
  } catch {
    // body wasn't JSON, ignore
  }

  if (status === 429) {
    return "You've hit OpenRouter's rate limit or run out of credits for now. Wait a moment and try again, or check your usage at openrouter.ai/activity.";
  }
  if (status === 401) {
    return "That OpenRouter API key looks invalid or missing. Double-check it on the Settings page.";
  }
  if (status === 402) {
    return "OpenRouter says this account is out of credit. Add credit at openrouter.ai/credits.";
  }
  if (status === 400 && /model/i.test(apiMessage)) {
    return `OpenRouter rejected the model name: ${apiMessage}`;
  }
  return apiMessage ? `OpenRouter error: ${apiMessage}` : `OpenRouter API error (${status}).`;
}

/**
 * @param {string} prompt
 * @param {string} apiKey
 * @param {string} [model] defaults to DEFAULT_MODEL if not provided
 */
async function callOpenRouter(prompt, apiKey, model, maxTokens = 800) {
  if (!apiKey) {
    const err = new Error("Missing OpenRouter API key. Set it in the extension's options page.");
    err.code = "NO_API_KEY";
    throw err;
  }

  // Proactive check: the service worker's `navigator.onLine` is a cheap,
  // immediate signal before even attempting the request.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const err = new Error("No internet connection. Reconnect and try again.");
    err.code = "NO_INTERNET";
    throw err;
  }

  let response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        // OpenRouter uses these for its optional leaderboard/analytics — not required to be real URLs.
        "HTTP-Referer": "https://ai-reading-assistant.local",
        "X-Title": "AI Reading Assistant",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    });
  } catch {
    // fetch() itself throws (rather than resolving with a non-ok status) on
    // a whole range of causes: genuinely being offline, but also CORS
    // rejections, a dropped/reset connection, a transient DNS hiccup, or
    // the request being aborted mid-flight. Blaming ALL of these on "no
    // internet connection" was actively misleading whenever the real cause
    // was something else entirely (and confusing when the user's internet
    // was fine). Only report NO_INTERNET when the browser itself confirms
    // it's offline; otherwise report a distinct, honest "couldn't reach
    // the server" error.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const err = new Error(
      offline
        ? "No internet connection. Reconnect and try again."
        : "Couldn't reach OpenRouter. This can be a dropped connection or a temporary hiccup — please try again."
    );
    err.code = offline ? "NO_INTERNET" : "NETWORK_ERROR";
    throw err;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const err = new Error(friendlyErrorFromStatus(response.status, bodyText));
    err.code = response.status === 429 ? "QUOTA_EXCEEDED" : "API_ERROR";
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "";

  if (!text) {
    const err = new Error("OpenRouter returned an empty response.");
    err.code = "EMPTY_RESPONSE";
    throw err;
  }

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    const err = new Error("OpenRouter response was not valid JSON.");
    err.code = "PARSE_ERROR";
    err.raw = text;
    throw err;
  }
}

async function getFastExplanation(concept, domain, apiKey, model, seenBefore) {
  const prompt = self.ARAPromptBuilder.buildFastExplanationPrompt(concept, domain, seenBefore);
  // This is meant to be the *fast* path. The plain-term shape grew a bit
  // (title/intuition/analogy added alongside explanation/example), so it
  // gets a slightly bigger budget than before to avoid truncated JSON,
  // while staying small enough to keep real latency low.
  return callOpenRouter(prompt, apiKey, model, 550);
}

async function getLearningObject(concept, domain, apiKey, model) {
  const prompt = self.ARAPromptBuilder.buildLearningObjectPrompt(concept, domain);
  // The adaptive learning object can return up to 7 short sections (vs.
  // the old fixed 8-field template) — 750 tokens is comfortably enough
  // without giving the model room to pad each section out unnecessarily.
  return callOpenRouter(prompt, apiKey, model, 750);
}

/**
 * Tier 2 domain classifier — used only when the local keyword heuristic
 * (services/domainService.js) is unconfident. Small, cheap prompt: just
 * a domain name + confidence label, so 60 tokens is plenty.
 * @param {object} pageContext
 * @param {string[]} candidateDomains
 * @returns {Promise<{domain: string, confidence: string}>}
 */
async function classifyDomain(pageContext, candidateDomains, apiKey, model) {
  const prompt = self.ARAPromptBuilder.buildDomainClassificationPrompt(pageContext, candidateDomains);
  return callOpenRouter(prompt, apiKey, model, 60);
}

self.ARAOpenRouterService = { getFastExplanation, getLearningObject, classifyDomain, DEFAULT_MODEL };
