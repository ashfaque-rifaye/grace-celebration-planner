/**
 * Input hardening before text reaches a prompt, and output cleaning after.
 *
 * The primary injection defence is structural: untrusted text is only ever sent
 * as data inside the user message, never concatenated into the system prompt.
 * Phrase filtering here is defence in depth. It neutralises rather than rejects,
 * so someone who innocently types "ignore that" still gets helped.
 */

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/gi,
  /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/gi,
  /forget\s+(?:everything|all\s+previous|your\s+instructions?)/gi,
  /you\s+are\s+now\s+(?:a|an|the)\b/gi,
  /(?:reveal|show|print|repeat)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system\s+)?(?:prompt|instructions?)/gi,
  /system\s*prompt/gi,
  /\bact\s+as\s+(?:a|an|the)\b/gi,
  /<\s*\/?\s*(?:system|assistant|user|data)\s*>/gi,
];

// C0 and C1 controls except tab and newline, plus zero-width and bidi overrides,
// which can hide instructions from a human reader but not from a model.
const INVISIBLE_CHARS =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Hard ceiling applied before any regex runs, so matching cost stays bounded. */
const MAX_SCAN_CHARS = 4000;

export interface SanitizedText {
  text: string;
  flagged: boolean;
}

export function sanitizeText(input: string): SanitizedText {
  // NFKC folds lookalikes (fullwidth letters and so on) that dodge the patterns.
  const normalised = input.slice(0, MAX_SCAN_CHARS).normalize("NFKC").replace(INVISIBLE_CHARS, "");
  let flagged = false;
  let text = normalised;
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, () => {
      flagged = true;
      return "[filtered]";
    });
  }
  // Collapse runs used to push instructions out of view and to inflate tokens.
  text = text.replace(/[ \t]{3,}/g, "  ").replace(/(?:\r?\n){3,}/g, "\n\n");
  return { text: text.trim(), flagged };
}

/** Sanitise every string in a validated payload, reporting if anything tripped. */
export function sanitizeDeep<T>(value: T): { value: T; flagged: boolean } {
  let flagged = false;
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const result = sanitizeText(node);
      flagged ||= result.flagged;
      return result.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    }
    return node;
  };
  return { value: walk(value) as T, flagged };
}

const MARKDOWN_LINK = /!?\[([^\]]{0,200})\]\([^)]{0,500}\)/g;
const HTML_TAG = /<\/?[a-z][^>]{0,200}>/gi;
const URL = /\b(?:https?:\/\/|www\.)[^\s)]{1,300}/gi;
const EMAIL = /\b[\w.+-]{1,64}@[\w-]{1,64}\.[\w.-]{1,64}\b/g;

/**
 * Strip what a compromised or confused model could use to phish: links, emails
 * and markup. React already escapes output, so this is about content, not XSS.
 */
export function cleanModelText(text: string): string {
  return text
    .replace(MARKDOWN_LINK, "$1")
    .replace(HTML_TAG, "")
    .replace(URL, "")
    .replace(EMAIL, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Apply {@link cleanModelText} to every string in a parsed model response. */
export function cleanModelOutput<T>(value: T): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return cleanModelText(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    }
    return node;
  };
  return walk(value) as T;
}
