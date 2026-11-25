const CJK_RUN_RE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]+/gu;
const CJK_CHAR_RE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]/u;

const LEADING_NOISE_WORDS = new Set([
  "vircs",
  "my",
  "the",
  "proj",
  "project",
  "repo",
  "workspace",
]);

const GENERIC_DESCRIPTOR_WORDS = new Set([
  "agent",
  "app",
  "api",
  "bench",
  "bot",
  "cli",
  "client",
  "code",
  "core",
  "demo",
  "desktop",
  "helper",
  "hub",
  "infra",
  "lab",
  "mobile",
  "project",
  "repo",
  "sdk",
  "server",
  "service",
  "studio",
  "test",
  "tool",
  "tools",
  "ui",
  "web",
]);

const ROMAN_DIGIT: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
};

function splitLatinWords(input: string): string[] {
  const rawTokens = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  const words: string[] = [];
  for (const token of rawTokens) {
    if (CJK_CHAR_RE.test(token)) continue;
    // Split camelCase / PascalCase boundaries (e.g. OpenLess -> Open, Less; web2App -> web2, App)
    const parts = token
      .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
      .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, "$1 $2")
      .split(/\s+/)
      .filter(Boolean);
    words.push(...parts);
  }
  return words;
}

function initialForWord(word: string): string {
  const lower = word.toLowerCase();
  const roman = ROMAN_DIGIT[lower];
  if (roman) return roman;
  return (Array.from(word)[0] ?? "").toUpperCase();
}

export function isCjkMonogram(text: string): boolean {
  return CJK_CHAR_RE.test(text);
}

/**
 * Computes a short badge for a project name: up to 2 CJK chars for CJK/mixed names,
 * or 2–3 uppercase Latin initials/acronyms after stripping noisy prefixes like `vircs-`.
 */
export function projectMonogram(projectName: string): string {
  const normalized = projectName.normalize("NFKC").trim();
  if (!normalized) return "PR";

  // 1. Prefer meaningful CJK phrases (>= 2 chars) or leading CJK characters.
  const cjkRuns = normalized.match(CJK_RUN_RE) ?? [];
  const multiCharCjk = cjkRuns.find((run) => Array.from(run).length >= 2);
  if (multiCharCjk) {
    return Array.from(multiCharCjk).slice(0, 2).join("");
  }
  const firstGlyph = Array.from(normalized.replace(/^[^\p{L}\p{N}]+/u, ""))[0] ?? "";
  if (firstGlyph && CJK_CHAR_RE.test(firstGlyph)) {
    const joinedCjk = cjkRuns.join("");
    return Array.from(joinedCjk).slice(0, 2).join("") || firstGlyph;
  }

  // 2. Latin / alphanumeric words.
  let words = splitLatinWords(normalized);
  if (words.length === 0) return "PR";

  while (words.length > 1 && LEADING_NOISE_WORDS.has(words[0]!.toLowerCase())) {
    words = words.slice(1);
  }

  const firstWord = words[0]!;
  const firstGlyphs = Array.from(firstWord);

  if (words.length === 1) {
    const digit = firstGlyphs.slice(1).find((g) => /\p{N}/u.test(g));
    if (digit) {
      return `${firstGlyphs[0]!.toUpperCase()}${digit}`;
    }
    if (firstGlyphs.length <= 3) {
      return firstWord.toUpperCase();
    }
    return firstGlyphs.slice(0, 2).join("").toUpperCase();
  }

  // Two or more words: keep crisp 2-3 char first token when followed by a generic descriptor
  // (e.g. t3-code -> T3, ECS-infra -> ECS, llm-bench -> LLM, fgo-agent -> FGO, maa-agent -> MAA)
  const secondLower = words[1]!.toLowerCase();
  if (
    words.length === 2 &&
    firstGlyphs.length >= 2 &&
    firstGlyphs.length <= 3 &&
    GENERIC_DESCRIPTOR_WORDS.has(secondLower)
  ) {
    const digit = firstGlyphs.slice(1).find((g) => /\p{N}/u.test(g));
    if (digit && firstGlyphs.length > 3) {
      return `${firstGlyphs[0]!.toUpperCase()}${digit}`;
    }
    return firstWord.toUpperCase();
  }

  // If first word contains a digit (e.g. "web2 app", "t3 code"), keep letter+digit ("W2", "T3")
  const firstDigit = firstGlyphs.slice(1).find((g) => /\p{N}/u.test(g));
  if (firstDigit && firstGlyphs.length <= 4) {
    return `${firstGlyphs[0]!.toUpperCase()}${firstDigit}`;
  }

  // 3+ words: up to 3 leading-word initials (with roman numerals ii/iii/iv -> 2/3/4)
  if (words.length >= 3) {
    return words
      .slice(0, 3)
      .map(initialForWord)
      .join("")
      .slice(0, 3);
  }

  // 2 words: first initial of word 1 + first initial of word 2
  return `${initialForWord(words[0]!)}${initialForWord(words[1]!)}`;
}
