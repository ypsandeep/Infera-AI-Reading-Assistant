// core/browser/pageExtractor.js
// Runs inside the content script's world. Pulls lightweight, local-only
// signals from the page: no network calls, no AI.

function extractHeadings(maxPerLevel = 8) {
  const pick = (selector) =>
    Array.from(document.querySelectorAll(selector))
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .slice(0, maxPerLevel);

  return {
    h1: pick("h1"),
    h2: pick("h2"),
    h3: pick("h3"),
  };
}

// Title + headings alone are often too thin a signal: many real course
// pages (PDF viewers, slide decks, single-page apps) have a generic title
// and zero real <h1>/<h2>/<h3> elements, which was the main cause of the
// domain guesser landing on the wrong subject or just giving up. Meta tags
// and a short snippet of the actual visible text give it much more to
// work with, while staying purely local (no network calls).
function extractMeta() {
  const content = (selector) => document.querySelector(selector)?.getAttribute("content") || "";
  return {
    description: content('meta[name="description"]') || content('meta[property="og:description"]'),
    keywords: content('meta[name="keywords"]'),
  };
}

function extractBodySnippet(maxChars = 800) {
  const container = document.querySelector("article, main") || document.body;
  if (!container) return "";
  return (container.innerText || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function detectPdfFileName() {
  // Chrome's built-in PDF viewer renders the file at a URL ending in .pdf
  // (or with a #page= fragment). We can't read the PDF's internal text
  // from a content script without extra permissions, but the filename
  // itself is a strong, free signal.
  const url = location.href;
  const isPdf =
    document.contentType === "application/pdf" ||
    /\.pdf($|[?#])/i.test(url);

  if (!isPdf) return { isPdf: false, fileName: null };

  let fileName = null;
  try {
    const path = new URL(url).pathname;
    fileName = decodeURIComponent(path.split("/").pop() || "");
  } catch {
    fileName = null;
  }

  return { isPdf: true, fileName };
}

function extractPageContext() {
  const { isPdf, fileName } = detectPdfFileName();

  return {
    url: location.href,
    hostname: location.hostname,
    title: document.title,
    headings: extractHeadings(),
    meta: extractMeta(),
    bodySnippet: extractBodySnippet(),
    isPdf,
    pdfFileName: fileName,
  };
}

// Exposed as a global so content.js (loaded right after this file) can call it.
self.ARAPageExtractor = { extractPageContext };
