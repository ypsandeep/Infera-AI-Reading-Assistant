// utils/promptBuilder.js

// "Other" is a UI sentinel (used for banner chips / manual override) that
// means "no confident domain" — it must never be treated as a real subject
// and sent to the model as literal context (e.g. "Subject context: Other"),
// which actively misleads the model instead of just omitting the hint.
function normalizeDomain(domain) {
  if (!domain || domain === "Other") return null;
  return domain;
}

function buildConceptLabel(concept, domain) {
  domain = normalizeDomain(domain);
  return domain ? `${concept} (in the context of ${domain})` : concept;
}

// A single highlighted word/short phrase ("gradient descent") should be
// *defined*. A highlighted sentence or paragraph should be *explained* —
// asking the model to "define" a whole sentence produces awkward, often
// unhelpful output. This is a cheap word-count heuristic, not a hard rule.
const PASSAGE_WORD_THRESHOLD = 7;

function isPassage(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > PASSAGE_WORD_THRESHOLD;
}

// Detects whether the highlighted text is itself a question (e.g. a quiz
// or exam question the student is stuck on) rather than a term/passage to
// explain. In that case the student's actual need is "what's the right
// answer, and why" — not a definition. Deliberately a loose heuristic:
// false positives just mean the model still explains it reasonably, but
// false negatives mean a question gets treated as a normal passage, so we
// bias toward catching more questions.
const QUESTION_STARTERS =
  /^(what|why|how|when|where|which|who|whom|whose|is|are|was|were|does|do|did|can|could|should|would|will|explain|describe|calculate|solve|find|determine|state|define|list|identify|compare|differentiate|prove|derive|name|outline|discuss)\b/i;

// Matches multiple-choice option markers: "A)", "(a)", "A.", "1)", "1." etc.
// Both "A)"/"A."-style letter options and "1)"/"1."-style numbered options
// are common in real exam/quiz text, so both are matched.
const MCQ_OPTION_PATTERN = /(^|\s)([a-dA-D][.)]|\([a-dA-D]\)|[1-4][.)]|\([1-4]\))\s/;

function isQuestion(text) {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  if (QUESTION_STARTERS.test(t)) return true;
  if (MCQ_OPTION_PATTERN.test(t)) return true;
  return false;
}

// Pulls out distinct lettered options (A-D, either "A)" or "A." style) so
// we can tell the model this is specifically multiple-choice and expect a
// per-option breakdown back. Requires at least 2 distinct letters found —
// a single stray "A." elsewhere in the text shouldn't count as an MCQ.
const MCQ_LETTER_OPTION_RE = /(?:^|\s)([A-Da-d])[.)]\s+\S/g;

function extractMcqOptionLetters(text) {
  const letters = new Set();
  for (const match of text.matchAll(MCQ_LETTER_OPTION_RE)) {
    letters.add(match[1].toUpperCase());
  }
  return Array.from(letters).sort();
}

function isMCQ(text) {
  return extractMcqOptionLetters(text).length >= 2;
}

function buildFastExplanationPrompt(concept, domain) {
  domain = normalizeDomain(domain);
  const label = buildConceptLabel(concept, domain);

  if (isQuestion(concept)) {
    if (isMCQ(concept)) {
      return `A university student highlighted the multiple-choice question below — likely from a quiz, exam, homework, or textbook — because they're stuck on it. Identify the single correct option, then explain why it's correct, AND briefly explain why EACH of the other options is incorrect — the second part matters just as much as the first for real understanding, not just guessing.

Question: "${concept}"${domain ? `\nSubject context: ${domain}` : ""}

Be direct and confident about the correct option; if you are genuinely uncertain, say so plainly rather than guessing silently.

Respond ONLY with strict JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "isQuestion": true,
  "isMCQ": true,
  "answer": "the correct option letter followed by its text, e.g. \\"B. A system designed for a specific function\\"",
  "whyCorrect": "1-2 sentences on why that option is correct",
  "whyOthersWrong": [
    { "option": "A", "reason": "one short sentence on why this specific option is incorrect" }
  ]
}
Include one entry in "whyOthersWrong" for every option that is NOT the correct answer, in their original order.`;
    }

    return `A university student highlighted the question below — likely from a quiz, exam, homework, or textbook — because they're stuck on it. Give them the correct answer, not just an explanation of the topic.

Question: "${concept}"${domain ? `\nSubject context: ${domain}` : ""}

Be direct and confident about the correct answer; if you are genuinely uncertain, say so plainly rather than guessing silently.

Respond ONLY with strict JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "isQuestion": true,
  "answer": "the correct answer, stated directly and concisely",
  "explanation": "1-3 sentences on why that's correct",
  "example": "a short related tip, similar example, or empty string if not useful"
}`;
  }

  if (isPassage(concept)) {
    return `A university student highlighted the passage below while reading a lecture or document because part of it confused them. Help them understand it quickly.

Passage: "${concept}"${domain ? `\nSubject context: ${domain}` : ""}

Respond ONLY with strict JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "definition": "one sentence giving the main point/gist of the passage",
  "simple": "a 2-4 sentence plain-language rewording of the passage, explaining any technical terms it contains",
  "example": "one short concrete example that illustrates what the passage is saying"
}`;
  }

  return `You are explaining a concept to a university student who is reading a lecture or document and just highlighted a term.

Concept: ${label}

Respond ONLY with strict JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "definition": "one precise sentence",
  "simple": "a 1-2 sentence plain-language explanation, as if to a beginner",
  "example": "one short concrete example"
}`;
}

// ---------------------------------------------------------------------
// Learning Object -- domain-adaptive
//
// A single fixed template (what/why/how/where/example/analogy/confusion/
// quiz) reads great for an engineering or CS concept, but is a poor fit
// for other faculties: a medical/dental/vet term is usually better taught
// through presentation -> cause -> mechanism -> management; an art or
// social work concept through context -> approach -> significance ->
// example; a GIS/geography concept through what it represents -> how it's
// measured or computed -> real-world use. Instead of guessing one shape
// for everything, we tell the model which "lens" tends to work best for
// the page's detected subject, but let it pick and label the 4-7 sections
// that will actually resolve *this* student's confusion for *this*
// concept -- that's the primary goal, not filling out a fixed form.
// ---------------------------------------------------------------------

// Broad subject buckets so many `domain` values (as produced by
// services/domainService.js) map onto a shared teaching lens.
const DOMAIN_LENS_HINTS = [
  {
    match: ["Medicine", "Nursing & Health Sciences", "Veterinary Science", "Dentistry", "Pharmacy"],
    hint:
      "This is a clinical/health-sciences concept. A useful structure often covers: what it is, presentation or how it shows up, cause or mechanism, how it's identified/assessed, how it's managed or treated, and why it matters for a practitioner -- but only include the angles that genuinely fit this specific term.",
  },
  {
    match: ["Mathematics"],
    hint:
      "This is a mathematics concept. A useful structure often covers: an informal statement of what it says, the intuition behind it, the core idea of how/why it's true or how it's used, a worked example, and a common mistake students make -- but adapt freely to what actually helps for this specific concept.",
  },
  {
    match: [
      "Electrical & Electronics Engineering",
      "Mechanical Engineering",
      "Automotive Engineering",
      "Civil Engineering",
      "Computer Science",
      "Artificial Intelligence",
    ],
    hint:
      "This is an engineering/technical concept. A useful structure often covers: what it is, why it exists (what problem it solves), how it works, where it's used in practice, a concrete example, and a common point of confusion -- but adapt freely to what actually helps for this specific concept.",
  },
  {
    match: ["Physics", "Chemistry", "Biology", "Agriculture & Environmental Science"],
    hint:
      "This is a natural-science concept. A useful structure often covers: what it is, the underlying mechanism or principle, why it happens, a real-world example or application, and a common misconception -- but adapt freely to what actually helps for this specific concept.",
  },
  {
    match: ["Fine Arts & Design"],
    hint:
      "This is an art/design concept. A useful structure often covers: what it is, the context or movement it comes from, the technique or approach involved, why it matters or what effect it creates, and a concrete example (a work, artist, or project) -- but adapt freely to what actually helps for this specific concept.",
  },
  {
    match: ["Social Work", "Psychology"],
    hint:
      "This is a social/behavioral-science concept. A useful structure often covers: what it is, the context in which it arises, why it matters in practice, a real-world or case example, and a common misconception -- but adapt freely to what actually helps for this specific concept.",
  },
  {
    match: ["Geography & GIS"],
    hint:
      "This is a geography/GIS concept. A useful structure often covers: what it represents, how it's measured, collected, or computed, how it's visualized or stored (e.g. raster vs vector, map layer), a real-world application, and a common confusion -- but adapt freely to what actually helps for this specific concept.",
  },
  {
    match: ["Business & Management"],
    hint:
      "This is a business/management concept. A useful structure often covers: what it is, why it matters to an organization, how it's applied in practice, a concrete example, and a common pitfall -- but adapt freely to what actually helps for this specific concept.",
  },
  {
    match: ["Law"],
    hint:
      "This is a legal concept. A useful structure often covers: what it is, its legal basis or source, how it's applied or tested in practice, a concrete example or case, and a common misconception -- but adapt freely to what actually helps for this specific concept.",
  },
];

const GENERIC_LENS_HINT =
  "Choose whichever angles best resolve confusion for this specific concept: for example what it is, why it exists, how it works, where it's used, a concrete example, an analogy, or a common point of confusion. Only use what genuinely helps.";

function lensHintForDomain(domain) {
  if (!domain) return GENERIC_LENS_HINT;
  const bucket = DOMAIN_LENS_HINTS.find((b) => b.match.includes(domain));
  return bucket ? bucket.hint : GENERIC_LENS_HINT;
}

function buildLearningObjectPrompt(concept, domain) {
  domain = normalizeDomain(domain);
  const label = buildConceptLabel(concept, domain);
  const lensHint = lensHintForDomain(domain);
  const question = isQuestion(concept);
  const passage = isPassage(concept);

  const subjectLine = question || passage
    ? `Text the student highlighted: "${concept}"${domain ? `\nSubject context: ${domain}` : ""}`
    : `Concept: ${label}`;

  let framingLine;
  if (question) {
    framingLine = isMCQ(concept)
      ? "The student highlighted a multiple-choice question (likely from a quiz, exam, homework, or textbook). Make the FIRST section the correct answer -- label it \"Correct answer\", icon \"✅\" -- naming the correct option letter and its text. Then add a section explaining WHY it's correct, a section on the underlying concept needed to solve it, and a section labeled \"Why the others are wrong\" that addresses EACH remaining option by letter and explains why it's incorrect."
      : "The student highlighted a question (likely from a quiz, exam, homework, or textbook). Make the FIRST section the correct answer -- label it \"Correct answer\", icon \"✅\" -- stated directly and confidently. Then add sections that explain WHY it's correct, the underlying concept needed to solve it, and common mistakes to avoid.";
  } else if (passage) {
    framingLine =
      "The student highlighted a full sentence or passage (not a single term) because something in it confused them. Break down what it's saying and why it matters, calling out and explaining any technical terms it contains.";
  } else {
    framingLine =
      "Decide for yourself which sections will best teach THIS concept to a student in THIS subject. Do not force-fit a generic template -- a dentistry term should not be explained the same way as an algorithm, and a social work concept should not be explained the same way as a physics law.";
  }

  return `You are a patient, expert tutor creating a short structured "learning object" for a university student about the text below, so they deeply understand it -- not just memorize a definition. Your single goal is to resolve the student's confusion as efficiently as possible.

${subjectLine}

Subject guidance: ${lensHint}

${framingLine} Pick 4-7 sections, each with:
- "icon": a single emoji that fits the section
- "label": a short 2-4 word section title (e.g. "How it works", "Symptoms & signs", "Legal basis", "Common confusion")
- "content": 1-3 plain-language sentences

Always make the LAST section a short self-check question the student can ask themselves to test whether they truly understood it (label it something like "Quick check").

Respond ONLY with strict JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "domain": "the subject domain given above, or \\"General\\" if none was given",
  "isQuestion": ${question},
  "sections": [
    { "icon": "emoji", "label": "short label", "content": "1-3 sentences" }
  ]
}`;
}

// ---------------------------------------------------------------------
// AI fallback domain classifier (Tier 2)
//
// Tier 1 (services/domainService.js) is a free, instant keyword-overlap
// heuristic. It's a bag-of-words match, so it only recognizes exact
// vocabulary it was seeded with, and can't handle a subject nobody
// thought to enumerate. When it comes back unconfident, this prompt asks
// the model itself to classify the page semantically -- it understands
// synonyms, context, and subfields we never hardcoded, at the cost of one
// network call. The result gets cached per-hostname so it's a one-time
// cost per site, not a per-highlight cost.
// ---------------------------------------------------------------------
function buildDomainClassificationPrompt(pageContext, candidateDomains) {
  const { title, headings, meta, bodySnippet, pdfFileName } = pageContext;
  const headingText = [...(headings?.h1 || []), ...(headings?.h2 || []), ...(headings?.h3 || [])].join(" | ");

  return `Classify the academic subject/domain of the web page described below. This is for a student-facing reading assistant that tailors explanations to the right subject.

Title: ${title || "(none)"}
Headings: ${headingText || "(none)"}
Meta description: ${meta?.description || "(none)"}
Meta keywords: ${meta?.keywords || "(none)"}
File name: ${pdfFileName || "(none)"}
Visible text snippet: "${(bodySnippet || "").slice(0, 500)}"

Candidate domains: ${candidateDomains.join(", ")}

Pick the single best-fitting domain from the candidate list above. Only return "Other" if the page genuinely does not fit any of them -- do not default to it just because the signals are thin; use your judgment about the subject matter even from limited context.

Respond ONLY with strict JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "domain": "one of the candidate domains listed above, or \\"Other\\"",
  "confidence": "high" | "medium" | "low"
}`;
}

self.ARAPromptBuilder = {
  buildFastExplanationPrompt,
  buildLearningObjectPrompt,
  buildDomainClassificationPrompt,
  isQuestion,
  isPassage,
  isMCQ,
};
