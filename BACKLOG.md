# Backlog — AI Reading Assistant

## Sprint 1 — Extension Skeleton ✅ DONE
**Goal:** Loadable extension with working message passing.
- [x] manifest.json (MV3)
- [x] popup shell (HTML/CSS/JS)
- [x] content script injected on all pages
- [x] background service worker holds per-tab state
- [x] popup ↔ background ↔ content round trip verified
**Acceptance:** Load unpacked, open popup on any page, see live page title/URL.

## Sprint 2 — Browser Intelligence (Step 2 of user story) ✅ DONE
**Goal:** Extract real page signals locally, no AI calls.
- [x] Extract H1/H2/H3 from content script
- [x] Detect PDF context (filename from URL/tab)
- [x] Extract website/hostname
- [x] Send structured PageContext to background (replace placeholder PAGE_LOADED payload)
**Acceptance:** Popup shows headings list + detected content type (webpage vs PDF).

## Sprint 3 — Domain Suggestion (Step 3) ✅ DONE
**Goal:** Guess subject domain locally; let user override once per page.
- [x] `services/domainService.js` — keyword/heuristic classifier
- [x] Domain confirmation UI in popup (chips: AI, Math, Electronics, Business, Other)
- [x] Persist domain choice per page (chrome.storage.local, keyed by URL)
**Acceptance:** Domain shown automatically; manual override persists across popup reopens.

## Sprint 4 — Highlight & Capture (Step 5) ✅ DONE
**Goal:** Detect text selection on the page and surface an "Explain" affordance.
- [x] Selection listener in content.js
- [x] Floating "Explain" button near selection
- [x] Selected text sent to background on click
**Acceptance:** Highlighting a word on any page shows a small button next to it.

## Sprint 5 — Ambiguity Checker (Step 6) ✅ DONE
**Goal:** Decide whether a concept needs domain context before asking AI.
- [x] Curated ambiguous-term heuristic/list
- [x] `core/context/` logic: unambiguous → strip domain; ambiguous → attach domain
**Acceptance:** Console/log shows correct decision for test words (CPU vs Stress).

## Sprint 6 — Explanation Cache (Step 7) ✅ DONE
**Goal:** Cache explanations by concept+domain before any real AI call exists.
- [x] `core/cache/` read/write helpers (chrome.storage.local or IndexedDB)
- [x] Cache-hit short-circuits to instant display (stubbed explanation for now)
**Acceptance:** Same word/domain pair returns instantly on second highlight, no network stub call.

## Sprint 7 — AI Integration via OpenRouter (Step 8) ✅ DONE
**Goal:** Real AI-backed fast explanations.
- [x] `services/openrouterService.js`
- [x] `utils/promptBuilder.js` (concept + domain → prompt)
- [x] API key handling (options page or storage)
- [x] Error/loading states in popup
**Acceptance:** Real explanation returned and cached end-to-end.

## Sprint 8 — Learning Object (Step 9-10) ✅ DONE
**Goal:** "Learn More" deep-dive teaching object.
- [x] Expanded prompt template (what/why/how/where/example/analogy/confusion/quiz)
- [x] Sidebar or expanded popup view to render it
**Acceptance:** Clicking "Learn More" renders the full structured teaching content.

## Sprint 9 — Polish
- [x] Notes/flashcard export
- [x] Settings page (API key, clear cache)
- [x] Final icon/branding pass
- [x] Error states, empty states, loading states audit

---
**Working agreement:** each sprint ends with something runnable in Chrome. We don't start sprint N+1 until sprint N's acceptance criteria pass in your browser.

## Build status: all sprints (1-8) implemented. Sprint 9 polish partially done (settings page + cache clearing shipped; flashcard export and final icon pass still open).
