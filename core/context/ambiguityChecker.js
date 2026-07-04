// core/context/ambiguityChecker.js
// Decides: does this concept need its domain attached before asking the AI?

// Curated seed list of terms known to mean different things in different fields.
// This grows over time; it doesn't need to be exhaustive because the fallback
// heuristic below catches most other ambiguous-looking words.
const KNOWN_AMBIGUOUS = new Set([
  "stress", "strain", "force", "mass", "weight", "current", "field",
  "function", "model", "vector", "domain", "range", "set", "frame",
  "memory", "kernel", "table", "tree", "node", "state", "energy",
  "power", "resistance", "charge", "load", "scale", "matrix", "root",
  // Cross-faculty terms added when expanding beyond STEM (e.g. "cell" means
  // something different in Biology/Medicine vs. a spreadsheet; "culture"
  // differs between Biology/Medicine and Fine Arts/Social Work; "crown"
  // between Dentistry and everyday use; "case" between Law, Social Work,
  // and Business).
  "cell", "culture", "crown", "case", "plate", "impression", "development",
  "trauma", "presentation", "reflection", "solution", "concentration",
  "resolution", "sample", "population", "distribution", "value",
]);

// Terms that are almost always unambiguous regardless of context —
// acronyms, proper nouns of specific technologies, etc.
const KNOWN_UNAMBIGUOUS = new Set([
  "cpu", "gpu", "ram", "html", "css", "http", "https", "json", "api",
  "url", "dna", "rna", "pdf", "usb", "wifi", "ide", "sql",
]);

function normalize(word) {
  return word.trim().toLowerCase();
}

/**
 * @param {string} concept
 * @returns {{ ambiguous: boolean, reason: string }}
 */
function checkAmbiguity(concept) {
  const word = normalize(concept);

  if (KNOWN_UNAMBIGUOUS.has(word)) {
    return { ambiguous: false, reason: "known-unambiguous" };
  }

  if (KNOWN_AMBIGUOUS.has(word)) {
    return { ambiguous: true, reason: "known-ambiguous" };
  }

  // ALL-CAPS short tokens (<=5 chars) read as acronyms -> unambiguous.
  const isLikelyAcronym = /^[A-Z]{2,5}$/.test(concept.trim());
  if (isLikelyAcronym) {
    return { ambiguous: false, reason: "heuristic-acronym" };
  }

  // Everything else -- including multi-word phrases, full sentences, and
  // questions -- defaults to attaching the domain. There used to be a rule
  // here that treated any multi-word selection as "already specific enough"
  // and dropped the domain entirely. That was the actual cause behind
  // "the domain doesn't show up" reports: single words are a minority of
  // real highlights (most are phrases/sentences/questions), so that rule
  // was silently discarding the domain — and therefore the subject-aware
  // prompt lens and the card's domain badge — for the large majority of
  // real usage, regardless of what the student had set. Attaching the
  // domain is cheap (a few extra words in the prompt), so defaulting to
  // "attach it" is the safe choice; the two cases above remain the only
  // deliberate exceptions.
  return { ambiguous: true, reason: "default-attach" };
}

self.ARAAmbiguityChecker = { checkAmbiguity };
