// content/content.js
// Runs in every page. Talks to background.js only — never calls OpenRouter
// directly. Owns all in-page UI: the domain confirmation banner, the
// floating "Explain" button, and the explanation/learning card.

(function () {
  let pageContext = null;
  let currentDomain = null;
  let domainOptions = []; // last known shortlist, reused by the in-card domain editor
  let lastExplain = null; // { concept, rect } of the most recent explainConcept() call, for refreshing after a domain change
  let root = null;
  let explainBtnEl = null;
  let cardEl = null;
  let toastEl = null;
  let toastTimer = null;
  let lastToastKind = null; // avoid re-spamming the same toast on repeated failures
  let isActive = true; // whether the extension is enabled globally + for this site

  // Elements placed via clampElementToViewport() are positioned in viewport
  // coordinates, but their containing root uses `position: fixed`, which
  // means those coordinates never update on their own as the page scrolls —
  // the element just stays glued to the same spot on screen while the
  // actual content slides out from under it. This map remembers each
  // tracked element's true position on the page (viewport position + the
  // scroll offset at the time it was placed), so it can be resynced back
  // to the same spot on the page whenever the user scrolls or resizes.
  const scrollAnchors = new Map(); // el -> { pageLeft, pageTop }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "ara-root";
    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function clearButton() {
    if (explainBtnEl) {
      scrollAnchors.delete(explainBtnEl);
      explainBtnEl.remove();
      explainBtnEl = null;
    }
  }

  function clearCard() {
    if (cardEl) {
      scrollAnchors.delete(cardEl);
      cardEl.remove();
      cardEl = null;
    }
  }

  function placeNear(el, rect, preferredWidth = 380) {
    const margin = 8;
    let left = rect.left;
    let top = rect.bottom + margin;

    if (left + preferredWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - preferredWidth - margin);
    }

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  // The card's (and, for long selections, the button's) real size isn't
  // known in advance — a loading spinner is much shorter than the final
  // card, and a paragraph-long selection can put the button's natural
  // position off the bottom/side of the viewport. This clamps any element
  // back inside the visible viewport after it's been placed/rendered.
  function clampElementToViewport(el) {
    if (!el) return;
    const margin = 8;
    const box = el.getBoundingClientRect();

    let top = box.top;
    let left = box.left;

    if (box.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - box.height - margin);
    }
    if (box.top < margin) {
      top = margin;
    }
    if (box.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - box.width - margin);
    }
    if (box.left < margin) {
      left = margin;
    }

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;

    // Remember this as the element's true position on the page (not just
    // the viewport), so a scroll event can put it back in the same spot
    // relative to the content instead of leaving it frozen mid-air.
    scrollAnchors.set(el, { pageLeft: left + window.scrollX, pageTop: top + window.scrollY });
  }

  function clampCardToViewport() {
    clampElementToViewport(cardEl);
  }

  // Keeps every tracked element (card, explain button, domain editor
  // popover) glued to the same spot on the page as the user scrolls or
  // resizes the window, instead of staying stuck at its original viewport
  // position while the page content moves underneath it.
  let scrollSyncRaf = null;
  function syncAnchoredPositions() {
    scrollSyncRaf = null;
    for (const [el, anchor] of scrollAnchors) {
      if (!document.body.contains(el)) {
        scrollAnchors.delete(el);
        continue;
      }
      el.style.top = `${anchor.pageTop - window.scrollY}px`;
      el.style.left = `${anchor.pageLeft - window.scrollX}px`;
    }
  }
  function onPageScrollOrResize() {
    if (scrollSyncRaf) return;
    scrollSyncRaf = requestAnimationFrame(syncAnchoredPositions);
  }
  // capture: true so this also fires for scrolling inside a nested
  // scrollable container (not just the window/page itself scrolling).
  window.addEventListener("scroll", onPageScrollOrResize, { passive: true, capture: true });
  window.addEventListener("resize", onPageScrollOrResize);

  // ---------- Domain confirmation banner (Step 3) ----------

  function showDomainBanner(domains) {
    ensureRoot();
    domainOptions = domains;
    const banner = document.createElement("div");
    banner.className = "ara-banner";
    banner.innerHTML = `
      <div class="ara-banner__header">
        <span class="ara-banner__title">What is this page about?</span>
        <span class="ara-banner__close" id="ara-banner-close" title="Dismiss">✕</span>
      </div>
      <div class="ara-chips"></div>
      <div class="ara-banner__custom">
        <input type="text" class="ara-banner__input" id="ara-banner-input" placeholder="Or type your own subject…" maxlength="60" />
        <span class="ara-btn ara-btn--primary ara-banner__set" id="ara-banner-set">Set</span>
      </div>
    `;

    const closeBanner = () => banner.remove();

    banner.querySelector("#ara-banner-close").addEventListener("click", closeBanner);

    const chipsEl = banner.querySelector(".ara-chips");
    domains.forEach((domain) => {
      const chip = document.createElement("span");
      chip.className = "ara-chip";
      chip.textContent = domain;
      chip.addEventListener("click", () => {
        setDomain(domain);
        closeBanner();
      });
      chipsEl.appendChild(chip);
    });

    // Lets a student set a subject that isn't in the suggested list at all
    // (e.g. a niche course name) instead of being stuck picking the
    // closest chip or "Other".
    const input = banner.querySelector("#ara-banner-input");
    const setCustomDomain = () => {
      const value = input.value.trim();
      if (!value) return;
      setDomain(value);
      closeBanner();
    };
    banner.querySelector("#ara-banner-set").addEventListener("click", setCustomDomain);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") setCustomDomain();
    });

    root.appendChild(banner);
  }

  // Central place that actually sends SET_DOMAIN — used by the banner, the
  // in-card domain editor, and anywhere else a domain change originates.
  // Previously these fired the message and ignored the response entirely,
  // so a failure (e.g. the service worker having just restarted) silently
  // did nothing and the "manually set domain" appeared not to work.
  function setDomain(domain, onSuccess) {
    if (!pageContext) {
      showConnectionToast();
      return;
    }
    chrome.runtime.sendMessage(
      { type: "SET_DOMAIN", hostname: pageContext.hostname, domain },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          maybeShowToastForCode(response?.code) || showConnectionToast();
          return;
        }
        currentDomain = domain;
        if (onSuccess) onSuccess(domain);
      }
    );
  }

  // ---------- Toast / popup notifications ----------
  // A small, professional-looking notification used for problems that the
  // in-card error box can't really fix by itself — e.g. no API key set, or
  // the connection to the extension being lost (which needs a page
  // refresh). These sit in the corner of the page like a standard app
  // toast, with an optional action button, and can be dismissed.

  function clearToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }

  /**
   * @param {{kind: string, icon?: string, title: string, message: string, actionLabel?: string, onAction?: Function, autoDismissMs?: number}} opts
   */
  function showToast(opts) {
    // Don't stack duplicate toasts (e.g. the same "no API key" warning
    // firing again on a second highlight before the user has acted).
    if (lastToastKind === opts.kind && toastEl) return;
    lastToastKind = opts.kind;

    ensureRoot();
    clearToast();

    const toast = document.createElement("div");
    toast.className = `ara-toast ara-toast--${opts.variant || "warn"}`;
    toast.innerHTML = `
      <span class="ara-toast__icon">${opts.icon || "⚠️"}</span>
      <div class="ara-toast__body">
        <span class="ara-toast__title">${escapeHtml(opts.title)}</span>
        <span class="ara-toast__message">${escapeHtml(opts.message)}</span>
        <div class="ara-toast__actions">
          ${opts.actionLabel ? `<span class="ara-toast__action" id="ara-toast-action">${escapeHtml(opts.actionLabel)}</span>` : ""}
        </div>
      </div>
      <span class="ara-toast__close" id="ara-toast-close">✕</span>
    `;

    toast.querySelector("#ara-toast-close").addEventListener("click", clearToast);
    if (opts.actionLabel && opts.onAction) {
      toast.querySelector("#ara-toast-action").addEventListener("click", () => {
        opts.onAction();
        clearToast();
      });
    }

    // Avoid stacking directly on top of the domain-confirmation banner,
    // which lives in the same top-right corner.
    const banner = root.querySelector(".ara-banner");
    if (banner) {
      toast.style.top = `${banner.getBoundingClientRect().height + 28}px`;
    }

    root.appendChild(toast);
    toastEl = toast;

    // Auto-dismiss purely informational toasts; keep action-required ones
    // (API key, connection lost) on screen until the user deals with them.
    if (opts.autoDismissMs) {
      toastTimer = setTimeout(clearToast, opts.autoDismissMs);
    }
  }

  function showApiKeyToast() {
    showToast({
      kind: "no-api-key",
      variant: "warn",
      icon: "🔑",
      title: "API key needed",
      message: "Add your OpenRouter API key in Settings to get explanations.",
      actionLabel: "Open settings",
      onAction: () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }),
    });
  }

  function showConnectionToast() {
    showToast({
      kind: "connection-lost",
      variant: "error",
      icon: "🔄",
      title: "Connection lost",
      message: "The extension lost its connection to this page. Please refresh to reconnect.",
      actionLabel: "Refresh page",
      onAction: () => location.reload(),
    });
  }

  function showNoInternetToast() {
    showToast({
      kind: "no-internet",
      variant: "error",
      icon: "📡",
      title: "No internet connection",
      message: "You're offline right now. Reconnect and try again.",
    });
  }

  function showGenericErrorToast(message) {
    showToast({
      kind: "generic-error",
      variant: "error",
      icon: "⚠️",
      title: "Something went wrong",
      message: message || "Please try again in a moment.",
      autoDismissMs: 6000,
    });
  }

  // Routes a failed response's error `code` to the right toast (if any).
  // Returns true if a toast was shown for it.
  function maybeShowToastForCode(code) {
    if (code === "DISABLED") {
      isActive = false;
      return true; // suppress the generic error message -- this isn't a failure, just an out-of-sync toggle
    }
    if (code === "NO_API_KEY") {
      showApiKeyToast();
      return true;
    }
    if (code === "NO_INTERNET") {
      showNoInternetToast();
      return true;
    }
    if (code === "CONTEXT_INVALIDATED" || code === "TIMEOUT" || code === "CONNECTION_ERROR") {
      showConnectionToast();
      return true;
    }
    return false;
  }

  // Proactive offline/online detection: don't wait for an explain request
  // to fail before telling the student they have no connection — the
  // browser already knows, so surface it immediately.
  window.addEventListener("offline", showNoInternetToast);
  window.addEventListener("online", () => {
    if (lastToastKind === "no-internet") clearToast();
    showToast({
      kind: "back-online",
      variant: "success",
      icon: "✅",
      title: "Back online",
      message: "Your connection was restored.",
      autoDismissMs: 3000,
    });
  });

  // ---------- Page registration (Step 2-4) ----------

  function registerPage() {
    pageContext = self.ARAPageExtractor.extractPageContext();
    chrome.runtime.sendMessage({ type: "PAGE_LOADED", pageContext }, (response) => {
      if (response?.code === "DISABLED") {
        isActive = false; // background disagreed with our own enabled-state check (e.g. a toggle raced this call) -- defer to it, quietly
        return;
      }
      if (chrome.runtime.lastError || !response?.ok) {
        // The most common cause here is the service worker having just
        // reloaded (e.g. after an extension update) while this tab's
        // content script is still the old instance — a refresh reconnects
        // them. Surface that clearly instead of failing silently.
        showConnectionToast();
        return;
      }
      currentDomain = response.domain;
      domainOptions = response.domains || [];
      if (response.needsConfirmation) {
        showDomainBanner(response.domains);
      }
    });
  }

  // ---------- Highlight capture (Step 5) ----------

  function isSelectionInsideOwnUI(selection) {
    if (!selection.anchorNode) return false;
    return root && root.contains(selection.anchorNode);
  }

  // A highlighted sentence or paragraph naturally contains internal
  // whitespace/line-breaks (e.g. when the selection spans multiple <p>
  // tags, or wraps across rendered lines). Collapsing that to single
  // spaces — rather than rejecting the selection outright — is what makes
  // multi-word selections work at all; only the length of the *cleaned*
  // text needs a cap.
  const MAX_SELECTION_CHARS = 1200; // roughly a long paragraph

  function onSelectionChange() {
    if (!isActive) return;
    const selection = window.getSelection();
    const raw = selection ? selection.toString() : "";
    const text = raw.replace(/\s+/g, " ").trim();

    if (!text || isSelectionInsideOwnUI(selection)) {
      clearButton();
      return;
    }
    if (text.length > MAX_SELECTION_CHARS) {
      clearButton();
      showToast({
        kind: "selection-too-long",
        variant: "warn",
        icon: "✂️",
        title: "Selection too long",
        message: "Try highlighting a shorter passage (roughly a paragraph or less) for a clear explanation.",
        autoDismissMs: 4500,
      });
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    showExplainButton(text, rect);
  }

  function showExplainButton(text, rect) {
    ensureRoot();
    clearButton();
    clearCard();

    // Shown only after the user releases the selection (mouseup fires
    // onSelectionChange) — it never explains automatically. The user must
    // deliberately click/tap this button to actually trigger a lookup.
    const btn = document.createElement("div");
    btn.className = "ara-explain-btn";
    btn.innerHTML = `
      <span class="ara-explain-btn__icon">✨</span>
      <span class="ara-explain-btn__label">Explain "${escapeHtml(text.length > 40 ? text.slice(0, 40) + "…" : text)}"</span>
    `;
    placeNear(btn, rect, 220);
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      explainConcept(text, rect);
    });

    root.appendChild(btn);
    explainBtnEl = btn;
    // Long/multi-line selections can put the natural position off-screen
    // (e.g. bottom-of-viewport paragraphs) — pull it back in like the card.
    clampElementToViewport(btn);
    // Entrance animation class added on the next frame so the CSS
    // transition actually runs instead of starting in its end state.
    requestAnimationFrame(() => btn.classList.add("ara-explain-btn--visible"));
  }

  // Opens a small popover anchored to the card's domain badge, letting the
  // student pick a different suggested domain or type their own — without
  // needing to wait for the (one-time) confirmation banner to reappear.
  function toggleDomainEditor(anchorEl) {
    const existing = root.querySelector(".ara-domain-editor");
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement("div");
    panel.className = "ara-domain-editor";
    panel.innerHTML = `
      <span class="ara-domain-editor__title">Change subject</span>
      <div class="ara-chips"></div>
      <div class="ara-banner__custom">
        <input type="text" class="ara-banner__input" id="ara-domain-editor-input" placeholder="Type a subject…" maxlength="60" />
        <span class="ara-btn ara-btn--primary ara-banner__set" id="ara-domain-editor-set">Set</span>
      </div>
    `;

    const applyAndRefresh = (domain) => {
      panel.remove();
      setDomain(domain, () => {
        // Re-run whatever's currently on screen with the corrected domain,
        // rather than leaving the student looking at an explanation
        // generated under the old (wrong) subject.
        if (lastExplain) explainConcept(lastExplain.concept, lastExplain.rect);
      });
    };

    const chipsEl = panel.querySelector(".ara-chips");
    (domainOptions.length ? domainOptions : ["Other"]).forEach((d) => {
      const chip = document.createElement("span");
      chip.className = "ara-chip";
      chip.textContent = d;
      chip.addEventListener("click", () => applyAndRefresh(d));
      chipsEl.appendChild(chip);
    });

    const input = panel.querySelector("#ara-domain-editor-input");
    const applyCustom = () => {
      const value = input.value.trim();
      if (value) applyAndRefresh(value);
    };
    panel.querySelector("#ara-domain-editor-set").addEventListener("click", applyCustom);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyCustom();
    });

    root.appendChild(panel);
    const anchorRect = anchorEl.getBoundingClientRect();
    panel.style.top = `${anchorRect.bottom + 6}px`;
    panel.style.left = `${anchorRect.left}px`;
    clampElementToViewport(panel);

    // Close when clicking outside the popover (but not when clicking the
    // badge itself, which already toggles it via its own click handler).
    const onOutsideClick = (e) => {
      if (panel.contains(e.target) || e.target === anchorEl) return;
      panel.remove();
      document.removeEventListener("mousedown", onOutsideClick, true);
    };
    setTimeout(() => document.addEventListener("mousedown", onOutsideClick, true), 0);
  }

  // ---------- Explanation card (Step 6-8) ----------

  // Safety net: even after fixing the background handlers to always call
  // sendResponse, this guarantees the spinner can never hang forever again —
  // e.g. if the service worker was killed mid-request or the extension
  // context becomes invalid after an update/reload.
  function sendMessageWithTimeout(payload, timeoutMs = 12000) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          error: "No response from the extension after 12s. The page may need a refresh.",
          code: "TIMEOUT",
        });
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || "";
            const isContextInvalidated = /context invalidated|receiving end does not exist/i.test(msg);
            resolve({
              ok: false,
              error: isContextInvalidated
                ? "Connection to the extension was lost. Please refresh this page and try again."
                : `Could not reach the extension: ${msg}`,
              code: isContextInvalidated ? "CONTEXT_INVALIDATED" : "CONNECTION_ERROR",
            });
            return;
          }
          resolve(response || { ok: false, error: "Empty response from extension.", code: "EMPTY" });
        });
      } catch (e) {
        // sendMessage itself can throw synchronously if the context is already gone.
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          error: "Connection to the extension was lost. Please refresh this page and try again.",
          code: "CONTEXT_INVALIDATED",
        });
      }
    });
  }

  function explainConcept(concept, rect) {
    clearButton();
    clearCard();
    ensureRoot();
    lastExplain = { concept, rect };

    const card = document.createElement("div");
    card.className = "ara-card";
    card.innerHTML = `
      <div class="ara-card__header">
        <div class="ara-card__headertop">
          <div class="ara-card__titlewrap">
            <span class="ara-card__sparkle">✨</span>
            <span class="ara-card__title">${escapeHtml(concept)}</span>
          </div>
          <span class="ara-card__close">✕</span>
        </div>
        <div class="ara-card__subjectrow" id="ara-subjectrow"></div>
      </div>
      <div class="ara-card__body"><div class="ara-spinner-wrap"><span class="ara-spinner"></span><span class="ara-thinking-text">Thinking…</span></div></div>
    `;
    card.querySelector(".ara-card__close").addEventListener("click", clearCard);
    placeNear(card, rect);
    root.appendChild(card);
    cardEl = card;
    clampCardToViewport();
    requestAnimationFrame(() => card.classList.add("ara-card--visible"));

    sendMessageWithTimeout({ type: "EXPLAIN_CONCEPT", concept }).then((response) => {
      if (!cardEl) return;
      if (!response?.ok) {
        maybeShowToastForCode(response?.code);
        renderCardError(response?.error || "Something went wrong reaching the extension.", () =>
          explainConcept(concept, rect)
        );
        return;
      }
      renderFastExplanation(concept, response.domain, response.explanation);
    });
  }

  function renderCardError(message, onRetry) {
    if (!cardEl) return;
    const body = cardEl.querySelector(".ara-card__body");
    body.innerHTML = `
      <div class="ara-error-box">
        <span class="ara-error-box__icon">⚠️</span>
        <span class="ara-error-box__text">${escapeHtml(message)}</span>
      </div>
      ${onRetry ? '<div class="ara-card__actions"><span class="ara-btn ara-btn--primary" id="ara-retry">Try again</span></div>' : ""}
    `;
    if (onRetry) {
      body.querySelector("#ara-retry").addEventListener("click", onRetry);
    }
    clampCardToViewport();
  }

  function renderFastExplanation(concept, domain, explanation) {
    if (!cardEl) return;
    const subjectRow = cardEl.querySelector("#ara-subjectrow") || cardEl.querySelector(".ara-card__subjectrow");
    let badge = subjectRow.querySelector(".ara-card__domain");
    if (domain) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ara-card__domain";
        subjectRow.appendChild(badge);
      }
      badge.innerHTML = `<span class="ara-card__domain-dot"></span>${escapeHtml(domain)} <span class="ara-card__domain-edit">✎</span>`;
      badge.title = "Click to change the detected subject";
      badge.onclick = () => toggleDomainEditor(badge);
    }

    const body = cardEl.querySelector(".ara-card__body");

    if (explanation.isMCQ) {
      // Multiple-choice question: answer first, then why it's right, then
      // why each remaining option is wrong — the part that was missing
      // before and is just as important for actually learning the material
      // rather than memorizing one answer.
      const wrongItems = Array.isArray(explanation.whyOthersWrong) ? explanation.whyOthersWrong : [];
      const wrongHtml = wrongItems
        .map(
          (item) => `
          <div class="ara-wrongopt">
            <span class="ara-wrongopt__badge">${escapeHtml(item?.option || "")}</span>
            <span class="ara-wrongopt__text" data-type></span>
          </div>`
        )
        .join("");

      body.innerHTML = `
        <div class="ara-answer-box">
          <span class="ara-answer-box__icon">✅</span>
          <div class="ara-answer-box__body">
            <span class="ara-answer-box__label">Correct answer</span>
            <span class="ara-answer-box__text" data-type></span>
          </div>
        </div>
        ${
          explanation.whyCorrect
            ? `<div class="ara-card__section">
                 <div class="ara-card__labelrow"><span class="ara-card__icon">🧠</span><span class="ara-card__label">Why it's correct</span></div>
                 <span class="ara-card__text" data-type></span>
               </div>`
            : ""
        }
        ${
          wrongHtml
            ? `<div class="ara-card__section">
                 <div class="ara-card__labelrow"><span class="ara-card__icon">🚫</span><span class="ara-card__label">Why the others are wrong</span></div>
                 <div class="ara-wrongopt-list">${wrongHtml}</div>
               </div>`
            : ""
        }
        <div class="ara-card__actions">
          <span class="ara-btn ara-btn--primary" id="ara-learn-more">Learn more</span>
          <span class="ara-btn ara-btn--ghost" id="ara-dismiss">Got it</span>
        </div>
      `;
      const texts = [explanation.answer || ""];
      if (explanation.whyCorrect) texts.push(explanation.whyCorrect);
      wrongItems.forEach((item) => texts.push(item?.reason || ""));
      typeSequence(body.querySelectorAll("[data-type]"), texts);
    } else if (explanation.isQuestion) {
      // The student highlighted a question — lead with the answer itself,
      // not a generic explanation of the topic.
      body.innerHTML = `
        <div class="ara-answer-box">
          <span class="ara-answer-box__icon">✅</span>
          <div class="ara-answer-box__body">
            <span class="ara-answer-box__label">Correct answer</span>
            <span class="ara-answer-box__text" data-type></span>
          </div>
        </div>
        ${
          explanation.explanation
            ? `<div class="ara-card__section">
                 <div class="ara-card__labelrow"><span class="ara-card__icon">🧠</span><span class="ara-card__label">Why</span></div>
                 <span class="ara-card__text" data-type></span>
               </div>`
            : ""
        }
        <div class="ara-card__actions">
          <span class="ara-btn ara-btn--primary" id="ara-learn-more">Learn more</span>
          <span class="ara-btn ara-btn--ghost" id="ara-dismiss">Got it</span>
        </div>
      `;
      const texts = [explanation.answer || ""];
      if (explanation.explanation) texts.push(explanation.explanation);
      typeSequence(body.querySelectorAll("[data-type]"), texts);
    } else {
      // Difficulty badge sits next to the domain badge at the top of the
      // card (colored green/yellow/red), per spec.
      const difficulty = (explanation.difficulty || "").toUpperCase();
      const validDifficulty = ["BEGINNER", "INTERMEDIATE", "ADVANCED"].includes(difficulty) ? difficulty : null;
      let diffBadge = subjectRow.querySelector(".ara-difficulty-badge");
      if (validDifficulty) {
        if (!diffBadge) {
          diffBadge = document.createElement("span");
          subjectRow.appendChild(diffBadge);
        }
        diffBadge.className = `ara-difficulty-badge ara-difficulty-badge--${validDifficulty.toLowerCase()}`;
        diffBadge.textContent = validDifficulty.charAt(0) + validDifficulty.slice(1).toLowerCase();
      } else if (diffBadge) {
        diffBadge.remove();
      }

      // A clean AI-generated title reads better in the header than the
      // raw highlighted text, once we have one.
      if (explanation.title) {
        const titleEl = cardEl.querySelector(".ara-card__title");
        if (titleEl) titleEl.textContent = explanation.title;
      }

      // Backward-compatible: anything already sitting in a user's cache
      // from before this change only has {definition, simple, example} —
      // this still renders correctly, it just won't have a difficulty
      // badge, intuition, or analogy section.
      const mainText = explanation.explanation || explanation.simple || explanation.definition || "";
      const intuition = explanation.intuition || "";
      const example = explanation.example || "";
      const analogy = explanation.analogy || "";

      body.innerHTML = `
        <div class="ara-card__section">
          <div class="ara-card__labelrow"><span class="ara-card__icon">💡</span><span class="ara-card__label">Explanation</span></div>
          <span class="ara-card__text" data-type></span>
        </div>
        ${
          intuition
            ? `<div class="ara-card__section">
                 <div class="ara-card__labelrow"><span class="ara-card__icon">🎯</span><span class="ara-card__label">Why it exists</span></div>
                 <span class="ara-card__text" data-type></span>
               </div>`
            : ""
        }
        ${
          example
            ? `<div class="ara-card__section">
                 <div class="ara-card__labelrow"><span class="ara-card__icon">🧪</span><span class="ara-card__label">Example</span></div>
                 <span class="ara-card__text" data-type></span>
               </div>`
            : ""
        }
        ${
          analogy
            ? `<div class="ara-card__section">
                 <span class="ara-analogy-toggle" id="ara-analogy-toggle">🔗 Show analogy</span>
                 <div class="ara-analogy-content" id="ara-analogy-content" hidden>
                   <span class="ara-card__text" data-type></span>
                 </div>
               </div>`
            : ""
        }
        <div class="ara-card__actions">
          <span class="ara-btn ara-btn--primary" id="ara-learn-more">Learn more</span>
          <span class="ara-btn ara-btn--ghost" id="ara-dismiss">Got it</span>
        </div>
      `;

      // The analogy is collapsed by default (per spec: collapse optional
      // sections to avoid clutter), so it shouldn't burn the typewriter
      // effect on something the student may never open — it's typed lazily
      // the first time they expand it instead.
      const typedEls = Array.from(body.querySelectorAll("[data-type]"));
      const analogyEl = analogy ? typedEls.pop() : null;
      const texts = [mainText];
      if (intuition) texts.push(intuition);
      if (example) texts.push(example);
      typeSequence(typedEls, texts);

      if (analogy) {
        const toggle = body.querySelector("#ara-analogy-toggle");
        const content = body.querySelector("#ara-analogy-content");
        let expanded = false;
        let typed = false;
        toggle.addEventListener("click", () => {
          expanded = !expanded;
          content.hidden = !expanded;
          toggle.textContent = expanded ? "🔗 Hide analogy" : "🔗 Show analogy";
          if (expanded && !typed) {
            typed = true;
            typeInto(analogyEl, analogy);
          }
        });
      }
    }

    body.querySelector("#ara-dismiss").addEventListener("click", clearCard);
    body.querySelector("#ara-learn-more").addEventListener("click", () => {
      learnMore(concept, domain);
    });
    clampCardToViewport();
  }

  // ---------- Learning object (Step 9-10) ----------

  function learnMore(concept, domain) {
    if (!cardEl) return;
    const body = cardEl.querySelector(".ara-card__body");
    body.innerHTML = `<div class="ara-spinner-wrap"><span class="ara-spinner"></span><span class="ara-thinking-text">Building a deeper explanation…</span></div>`;
    clampCardToViewport();

    sendMessageWithTimeout({ type: "LEARN_MORE", concept }).then((response) => {
      if (!cardEl) return;
      if (!response?.ok) {
        maybeShowToastForCode(response?.code);
        renderCardError(response?.error || "Could not load the deeper explanation.", () =>
          learnMore(concept, domain)
        );
        return;
      }
      renderLearningObject(response.learningObject, domain);
    });
  }

  // The AI now decides which sections best teach a given concept for its
  // subject (see utils/promptBuilder.js) instead of always filling the same
  // 8-field template — a dentistry term and an algorithm shouldn't be
  // taught the same way. `lo.sections` is the new adaptive shape:
  // [{ icon, label, content }, ...]. We still accept the old fixed shape
  // (what/why/how/where/example/analogy/commonConfusion/quickCheck) so
  // anything already sitting in a user's cache from before this change
  // keeps rendering correctly.
  function normalizeLearningObjectSections(lo) {
    if (Array.isArray(lo?.sections) && lo.sections.length) {
      return lo.sections
        .filter((s) => s && (s.content || s.label))
        .map((s) => [s.icon || "•", s.label || "", s.content || ""]);
    }
    // Legacy fixed-template fallback.
    const where = Array.isArray(lo?.whereUsed) ? lo.whereUsed.join(", ") : lo?.whereUsed || "";
    return [
      ["🧠", "What is it?", lo?.what],
      ["🎯", "Why does it exist?", lo?.why],
      ["🧩", "What problem does it solve?", lo?.problem],
      ["⚙️", "How does it work?", lo?.how],
      ["📍", "Where is it used?", where],
      ["🧪", "Example", lo?.example],
      ["🔗", "Analogy", lo?.analogy],
      ["⚠️", "Common confusion", lo?.commonConfusion],
      ["✅", "Quick check", lo?.quickCheck],
    ].filter(([, , value]) => value);
  }

  function renderLearningObject(lo, domain) {
    if (!cardEl) return;
    const body = cardEl.querySelector(".ara-card__body");
    const items = normalizeLearningObjectSections(lo);
    const shownDomain = lo?.domain || domain;

    // If the first section is the "correct answer" (questions highlighted
    // by the student), pull it out into its own prominent callout above
    // the rest of the breakdown, instead of burying it in the list.
    let answerItem = null;
    let restItems = items;
    if (items.length && /answer/i.test(items[0][1])) {
      [answerItem, ...restItems] = items;
    }

    const answerHtml = answerItem
      ? `<div class="ara-answer-box">
           <span class="ara-answer-box__icon">${escapeHtml(answerItem[0])}</span>
           <div class="ara-answer-box__body">
             <span class="ara-answer-box__label">${escapeHtml(answerItem[1])}</span>
             <span class="ara-answer-box__text" data-type></span>
           </div>
         </div>`
      : "";

    const itemsHtml = restItems
      .map(
        ([icon, label]) => `
        <div class="ara-learn__item">
          <dt>${escapeHtml(icon)} ${escapeHtml(label)}</dt>
          <dd data-type></dd>
        </div>`
      )
      .join("");

    body.innerHTML = `
      ${shownDomain ? `<div class="ara-learn__tailored">✨ Tailored explanation for ${escapeHtml(shownDomain)}</div>` : ""}
      ${answerHtml}
      <dl class="ara-learn">${itemsHtml}</dl>
      <div class="ara-card__actions">
        <span class="ara-btn ara-btn--ghost" id="ara-dismiss-2">Close</span>
      </div>
    `;
    body.querySelector("#ara-dismiss-2").addEventListener("click", clearCard);

    const typedTexts = [];
    if (answerItem) typedTexts.push(answerItem[2]);
    restItems.forEach(([, , value]) => typedTexts.push(value || ""));
    typeSequence(body.querySelectorAll("[data-type]"), typedTexts);

    clampCardToViewport();
  }

  // ---------- utils ----------

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  // Reveals `text` into `el` character by character with a blinking caret,
  // similar to how Gemini/ChatGPT-style responses stream in — even though
  // our API call itself returns the full text in one shot (no true
  // token-streaming plumbing), this gives the same "AI is typing" feel.
  // Uses a plain text node (not innerHTML), so it's safe from injection
  // regardless of what the model returns.
  function typeInto(el, text, speedMsPerChar) {
    if (!el) return;
    const full = text || "";
    el.textContent = "";
    if (!full) return;

    // Adaptive speed: longer text types faster per-character so the total
    // reveal time stays roughly constant (~1s) instead of dragging on.
    const speed = speedMsPerChar || Math.max(4, Math.min(18, 900 / full.length));

    const textNode = document.createTextNode("");
    const cursor = document.createElement("span");
    cursor.className = "ara-typecursor";
    el.appendChild(textNode);
    el.appendChild(cursor);

    let i = 0;
    const timer = setInterval(() => {
      i++;
      textNode.nodeValue = full.slice(0, i);
      if (i >= full.length) {
        clearInterval(timer);
        cursor.remove();
      }
    }, speed);
  }

  // Starts typing into each element with a small staggered delay so
  // multiple sections fill in one after another (like a streamed response
  // rendering paragraph by paragraph) rather than all at once or fully
  // sequentially (which would feel slow for a multi-section breakdown).
  function typeSequence(elements, texts, stagger = 90) {
    elements.forEach((el, idx) => {
      setTimeout(() => typeInto(el, texts[idx] || ""), idx * stagger);
    });
  }

  document.addEventListener("mouseup", (e) => {
    if (!isActive) return;
    if (root && root.contains(e.target)) return; // clicking our own UI must never re-trigger selection detection
    setTimeout(onSelectionChange, 0);
  });
  document.addEventListener("mousedown", (e) => {
    if (root && !root.contains(e.target)) {
      clearButton();
    }
  });

  // Tears down any visible UI without touching the stored domain/state, so
  // turning the extension back on later doesn't lose anything -- it just
  // stops reacting to the page until re-enabled.
  function deactivate() {
    isActive = false;
    clearButton();
    clearCard();
    clearToast();
    if (root) {
      root.querySelectorAll(".ara-banner, .ara-domain-editor").forEach((el) => el.remove());
    }
  }

  function activate() {
    isActive = true;
    registerPage(); // resolve domain / show the confirmation banner as if the page just loaded
  }

  function init() {
    chrome.runtime.sendMessage({ type: "GET_ENABLED_STATE", hostname: location.hostname }, (response) => {
      // If the background script can't be reached at all, fail open rather
      // than silently doing nothing forever -- a broken message channel
      // shouldn't look identical to "the student turned this off on purpose".
      const enabled = !chrome.runtime.lastError && response?.ok ? response.enabled : true;
      isActive = enabled;
      if (enabled) registerPage();
    });
  }

  // Lets the popup's on/off toggle (global or per-site) take effect on
  // already-open tabs immediately, instead of only applying after the next
  // page load/refresh.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "ENABLED_STATE_CHANGED") return;
    chrome.runtime.sendMessage({ type: "GET_ENABLED_STATE", hostname: location.hostname }, (response) => {
      const enabled = !chrome.runtime.lastError && response?.ok ? response.enabled : true;
      if (enabled === isActive) return;
      if (enabled) {
        activate();
      } else {
        deactivate();
      }
    });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
