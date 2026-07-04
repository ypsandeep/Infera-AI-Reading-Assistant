# AI Reading Assistant — Chrome Extension

A full implementation of the architecture: highlight a word on any webpage
or PDF and get a fast, domain-aware explanation, with an optional deep-dive
"Learning Object". Built sprint-by-sprint — see BACKLOG.md for what each
sprint covers.

## 1. Get an OpenRouter API key

Sign up and create a key at https://openrouter.ai/keys (pay-as-you-go credit; many models are very cheap or free-tier).

## 2. Load the extension

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**, select the `AI-Reading-Assistant` folder
4. Pin the extension to the toolbar

## 3. Set your API key

Click the extension icon → **Settings** (bottom right of the popup), paste
your key, click **Save key**. The key is stored only in this browser
(`chrome.storage.local`) and is sent only to OpenRouter's API.

Optionally set a specific model slug (e.g. `anthropic/claude-3.5-haiku`,
`google/gemini-2.0-flash-001`) — see the full list at
[openrouter.ai/models](https://openrouter.ai/models). Leave it blank to use
the default, `openai/gpt-4o-mini`.

## 4. Use it

1. Open any webpage or PDF
2. The extension silently extracts the page title/headings/hostname and
   guesses the subject domain. If it's not confident, a small banner in the
   top-right asks you to pick one — it remembers your choice for that site.
3. Highlight any word or short phrase
4. Click the **Explain "…"** button that appears next to it
5. Get a definition, plain-language explanation, and example in ~1-2 seconds
6. Click **Learn more** for a full structured breakdown (what/why/how/where
   used/example/analogy/common confusion/quick check)

Repeat lookups of the same concept (in the same domain) are served instantly
from a local cache — no second API call. Clear the cache anytime from the
Settings page.

## Project structure

```
manifest.json            MV3 entry point
popup/                    Toolbar popup — page status, domain override, settings link
options/                  Settings page — API key, cache management
content/                  Injected into every page — UI + page registration
background/               Service worker — message router, holds the API key
core/browser/              DOM-only extraction (headings, PDF detection)
core/context/               Ambiguity checker (does a concept need its domain attached?)
core/cache/                  Explanation cache (chrome.storage.local, keyed by concept+domain)
services/                  domainService (local heuristic), openrouterService (API calls)
utils/                     storage.js (promise wrapper), promptBuilder.js
assets/icons/              Extension icons
```

## How a request flows

```
content.js (DOM selection)
   → background.js (EXPLAIN_CONCEPT)
       → ambiguityChecker (does this need domain context?)
       → cache.js (seen this concept+domain before?)
           hit  → return cached explanation instantly
           miss → openrouterService.js → OpenRouter API → cache it → return
   → content.js renders the card
```

## Known limitations / good next steps

- PDF support is filename + URL based only (Chrome's content script can't
  read PDF.js's internal text layer without extra permissions) — Step 2's
  "read the PDF" is therefore approximate, not full-text.
- Domain heuristic is a small curated keyword list (`services/domainService.js`)
  — easy to extend with more domains/keywords as you see misclassifications.
- No flashcard/notes export yet (was Sprint 9 stretch goal).
- No automated tests — would be a good next addition (e.g. Vitest for the
  pure logic in `core/` and `services/domainService.js`, which have zero
  DOM/chrome dependencies and are easy to unit test in isolation).
