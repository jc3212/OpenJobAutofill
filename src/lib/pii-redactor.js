/**
 * OpenJobAutofill - Safe PII Redactor
 * 
 * Uses longest-value-first literal replacement to eliminate dynamic RegExp
 * vulnerabilities (such as unescaped quantifiers, e.g. "+86", or dot regex collisions)
 * and prevent substring collisions (e.g. "张三" corrupting "张三丰").
 */

export const DEFAULT_PII_PLACEHOLDERS = Object.freeze({
  "电话": "[已脱敏-电话]",
  "手机": "[已脱敏-电话]",
  "手机号码": "[已脱敏-电话]",
  "邮箱": "[已脱敏-邮箱]",
  "电子邮箱": "[已脱敏-邮箱]",
  "姓名": "[已脱敏-姓名]",
  "身份证号": "[已脱敏-身份证]",
  "出生日期": "[已脱敏-出生日期]"
});

/**
 * Safely redacts PII entries from text using literal replacement.
 * 
 * @param {string} text Raw resume text
 * @param {Record<string, string>} pii Key-value pairs of PII (e.g. { "姓名": "张三", "电话": "+86 138-0013-8000" })
 * @param {Record<string, string>} [customPlaceholders] Optional custom placeholder mappings
 * @returns {{ redactedText: string, replacements: Array<{ key: string, original: string, placeholder: string }> }}
 */
export function redactPii(text, pii, customPlaceholders = {}) {
  if (typeof text !== "string" || !text) {
    return { redactedText: "", replacements: [] };
  }
  if (!pii || typeof pii !== "object") {
    return { redactedText: text, replacements: [] };
  }

  const placeholders = { ...DEFAULT_PII_PLACEHOLDERS, ...customPlaceholders };

  // 1. Gather candidate strings to replace
  const candidates = [];
  for (const [key, rawVal] of Object.entries(pii)) {
    const val = String(rawVal || "").trim();
    if (!val || val.length < 2) continue; // Ignore single characters to prevent over-redaction

    let placeholder = `[已脱敏-${key}]`;
    for (const [pKey, pVal] of Object.entries(placeholders)) {
      if (key.includes(pKey) || pKey.includes(key)) {
        placeholder = pVal;
        break;
      }
    }

    candidates.push({ key, value: val, placeholder });

    // If phone has country code or dashes, also register the pure 11-digit mobile
    if (key.includes("电话") || key.includes("手机")) {
      const pureDigits = val.replace(/\D/g, "");
      if (pureDigits.length === 11 && pureDigits !== val) {
        candidates.push({ key, value: pureDigits, placeholder });
      }
    }
  }

  // 2. CRITICAL: Sort candidates by value length descending!
  // Guarantees longest string is replaced first (e.g. "+86 13800138000" before "13800138000",
  // and "张三丰" before "张三").
  candidates.sort((a, b) => b.value.length - a.value.length);

  // 3. Perform literal replacement without dynamic RegExp
  let result = text;
  const appliedReplacements = [];

  for (const { key, value, placeholder } of candidates) {
    if (result.includes(value)) {
      result = result.split(value).join(placeholder);
      appliedReplacements.push({ key, original: value, placeholder });
    }
  }

  return {
    redactedText: result,
    replacements: appliedReplacements
  };
}
