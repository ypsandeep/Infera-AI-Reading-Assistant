// services/domainService.js
// Pure local heuristic — no AI call. Looks at title/headings/hostname text
// and scores it against keyword sets for each domain.
//
// Expanded to cover a full university course catalogue (engineering,
// health sciences, arts/social sciences, management, pure sciences, etc.)
// so the domain guess — and therefore the domain-aware explanation — is
// useful across faculties, not just STEM/CS.

const DOMAINS = [
  "Artificial Intelligence",
  "Computer Science",
  "Mathematics",
  "Physics",
  "Chemistry",
  "Electrical & Electronics Engineering",
  "Mechanical Engineering",
  "Automotive Engineering",
  "Civil Engineering",
  "Biology",
  "Medicine",
  "Nursing & Health Sciences",
  "Veterinary Science",
  "Dentistry",
  "Pharmacy",
  "Psychology",
  "Social Work",
  "Geography & GIS",
  "Fine Arts & Design",
  "Business & Management",
  "Law",
  "Agriculture & Environmental Science",
  "Other",
];

const KEYWORDS = {
  "Artificial Intelligence": [
    "machine learning", "deep learning", "neural network", "regression",
    "classification", "supervised", "unsupervised", "reinforcement learning",
    "gradient descent", "training data", "large language model", "dataset",
    "artificial intelligence", "chatbot", "computer vision", "nlp",
  ],
  "Computer Science": [
    "algorithm", "data structure", "complexity", "binary tree", "sorting",
    "operating system", "compiler", "database", "software engineering",
    "programming", "recursion", "object-oriented", "api", "framework",
  ],
  "Mathematics": [
    "theorem", "proof", "integral", "derivative", "matrix", "vector space",
    "probability", "calculus", "algebra", "geometry", "statistics",
    "differential equation", "eigenvalue", "combinatorics",
  ],
  "Physics": [
    "quantum", "kinematics", "electromagnetism", "thermodynamics", "optics",
    "relativity", "particle physics", "velocity", "acceleration",
    "momentum", "wave function", "entropy", "friction",
  ],
  "Chemistry": [
    "chemical reaction", "compound", "molecule", "acid", "chemical base", "bond",
    "catalyst", "organic chemistry", "periodic table", "aqueous solution",
    "titration", "oxidation", "reduction", "stoichiometry", "polymer",
  ],
  "Electrical & Electronics Engineering": [
    "circuit", "voltage", "electric current", "resistor", "capacitor", "transistor",
    "semiconductor", "signal processing", "amplifier", "microcontroller",
    "pcb", "diode", "inductor", "power supply",
  ],
  "Mechanical Engineering": [
    "stress", "strain", "torque", "thermodynamics", "fluid dynamics",
    "kinematics", "material science", "beam", "structural load", "mechanics",
    "gear", "engine design", "manufacturing process", "cad",
  ],
  "Automotive Engineering": [
    "vehicle", "automobile", "automotive", "car body", "chassis",
    "combustion engine", "internal combustion", "powertrain", "drivetrain",
    "transmission", "gearbox", "suspension", "brake", "braking system",
    "tire", "tyre", "wheel alignment", "fuel injection", "emissions",
    "catalytic converter", "electric vehicle", "battery pack",
    "hybrid vehicle", "crash test", "crashworthiness", "clutch",
    "exhaust system", "ecu", "engine control unit", "ignition system",
    "fuel efficiency", "horsepower", "camshaft", "crankshaft",
    "axle", "differential", "adas", "autonomous vehicle", "durability testing",
  ],
  "Civil Engineering": [
    "structural", "concrete", "reinforcement", "surveying", "foundation",
    "construction", "geotechnical", "bridge design", "highway", "truss",
    "building code", "hydraulics", "urban planning",
  ],
  "Biology": [
    "cell biology", "organism", "dna", "protein", "evolution", "genome",
    "ecosystem", "photosynthesis", "enzyme", "metabolism", "species",
    "chromosome", "mitosis", "taxonomy",
  ],
  "Medicine": [
    "diagnosis", "symptom", "syndrome", "pathology", "clinical", "patient",
    "disease", "treatment", "anatomy", "physiology", "prognosis",
    "infection", "therapy", "surgical", "medication", "biopsy",
  ],
  "Nursing & Health Sciences": [
    "nursing", "vital signs", "patient care", "healthcare", "clinical trial",
    "public health", "epidemiology", "wound care", "triage", "hygiene",
    "immunization", "rehabilitation",
  ],
  "Veterinary Science": [
    "veterinary", "animal health", "livestock", "zoonotic", "breed",
    "canine", "feline", "equine", "animal husbandry", "vaccination",
    "parasite", "wildlife", "large animal",
  ],
  "Dentistry": [
    "dental", "tooth", "teeth", "oral", "cavity", "enamel", "gum",
    "orthodontic", "root canal", "periodontal", "molar", "plaque",
    "dental caries", "crown", "filling",
  ],
  "Pharmacy": [
    "drug", "dosage", "pharmacology", "prescription", "pharmacokinetics",
    "side effect", "active ingredient", "clinical dose", "formulation",
    "generic drug", "contraindication",
  ],
  "Psychology": [
    "cognitive", "behavior", "anxiety", "perception", "memory",
    "personality", "therapy", "emotion", "motivation", "psychiatric",
    "disorder", "developmental psychology", "conditioning",
  ],
  "Social Work": [
    "social work", "case work", "community", "welfare", "advocacy",
    "intervention", "client", "vulnerable", "safeguarding", "counseling",
    "social policy", "family services", "rehabilitation program",
  ],
  "Geography & GIS": [
    "gis", "geographic information system", "spatial", "cartography",
    "remote sensing", "coordinate system", "raster", "vector layer",
    "topography", "geospatial", "satellite imagery", "land use",
    "climate", "geology",
  ],
  "Fine Arts & Design": [
    "composition", "aesthetic", "palette", "sculpture", "visual art",
    "typography", "design principle", "perspective drawing", "medium",
    "art history", "installation", "curatorial", "portfolio", "critique",
  ],
  "Business & Management": [
    "marketing", "revenue", "strategy", "finance", "management",
    "stakeholder", "investment", "supply chain", "entrepreneur",
    "leadership", "operations", "human resources", "branding", "budget",
  ],
  "Law": [
    "statute", "litigation", "contract law", "jurisdiction", "plaintiff",
    "defendant", "tort", "constitutional", "legal precedent", "clause",
    "liability", "regulation",
  ],
  "Agriculture & Environmental Science": [
    "crop", "soil", "irrigation", "sustainability", "biodiversity",
    "agronomy", "fertilizer", "pesticide", "conservation", "renewable",
    "climate change", "pollution", "ecology",
  ],
};

const HOSTNAME_HINTS = [
  { pattern: /lms\.|university|\.edu/i, weight: 0 }, // neutral, just confirms academic context
];

function scoreText(text, keywords) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += kw.split(" ").length; // multi-word matches count more
  }
  return score;
}

/**
 * @param {{title: string, headings: {h1: string[], h2: string[], h3: string[]}, hostname: string, meta?: {description?: string, keywords?: string}, bodySnippet?: string, pdfFileName?: string}} pageContext
 * @returns {{ domain: string, confidence: number, scores: Record<string, number> }}
 */
function suggestDomain(pageContext) {
  // Title + headings alone are frequently empty or too generic (PDFs,
  // slide viewers, single-page apps) which used to make the guesser fall
  // back to "Other" far more than it should, or lock onto a wrong domain
  // from one stray word. Meta description/keywords, a snippet of visible
  // body text, and the PDF filename (e.g. "CS101_Sorting_Algorithms.pdf")
  // give it much more real signal to work with.
  const normalizedFileName = (pageContext.pdfFileName || "").replace(/[_\-.]+/g, " ");
  const text = [
    pageContext.title || "",
    ...(pageContext.headings?.h1 || []),
    ...(pageContext.headings?.h2 || []),
    ...(pageContext.headings?.h3 || []),
    pageContext.meta?.description || "",
    pageContext.meta?.keywords || "",
    normalizedFileName,
    pageContext.bodySnippet || "",
  ].join(" ");

  const scores = {};
  for (const domain of Object.keys(KEYWORDS)) {
    scores[domain] = scoreText(text, KEYWORDS[domain]);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topDomain, topScore] = ranked[0];
  const [, secondScore] = ranked[1] || [null, 0];

  // Confident if there's a real signal (score of at least 2 — i.e. more
  // than one throwaway single-word match) and it's not essentially tied
  // with the runner-up. A margin of 2 was too strict once real body-text
  // signal was added: a page that clearly scored e.g. Dentistry=2 vs.
  // Medicine=1 (a shared term like "pathology") is a confident dentistry
  // match, not an ambiguous one.
  const confident = topScore >= 2 && topScore >= secondScore + 1;

  return {
    domain: confident ? topDomain : "Other",
    confidence: confident ? Math.min(1, topScore / 6) : 0,
    needsConfirmation: !confident,
    scores,
  };
}

/**
 * Top N candidate domains by score, for showing a short, glanceable set of
 * chips in the on-page confirmation banner instead of all ~20 domains.
 * "Other" is always appended last as an escape hatch.
 * @param {Record<string, number>} scores
 * @param {number} n
 */
function topCandidates(scores, n = 5) {
  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain)
    .filter((d) => d !== "Other");
  const top = ranked.slice(0, n);
  top.push("Other");
  return top;
}

self.ARADomainService = { suggestDomain, DOMAINS, topCandidates };
