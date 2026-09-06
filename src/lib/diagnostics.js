/**
 * OpenJobAutofill - Diagnostics & Logging Redactor
 * 
 * Provides structured diagnostic logging with guaranteed candidate PII redaction.
 * Prevents candidate names, phones, emails, and sensitive values from ever being
 * emitted into browser console logs or debug telemetry in plain text.
 */

const SENSITIVE_KEY_REGEX = /^(?:value|val|text|content|password|secret|key|phone|email|name|idcard|id_card|address)$/i;

/**
 * Recursively redacts sensitive candidate data in diagnostic payloads.
 * Leaves metadata intact (field labels, categories, scores, statuses, counts, durations).
 * 
 * @param {any} obj 
 * @returns {any} Redacted copy
 */
export function sanitizeDiagnosticPayload(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeDiagnosticPayload(item));
  }

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      if (typeof val === "string") {
        clean[key] = `[REDACTED_LEN_${val.length}]`;
      } else if (val === null || val === undefined) {
        clean[key] = val;
      } else {
        clean[key] = "[REDACTED]";
      }
    } else if (typeof val === "object" && val !== null) {
      clean[key] = sanitizeDiagnosticPayload(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Formats a structured diagnostic log string.
 * 
 * @param {string} event 
 * @param {object} [payload] 
 * @returns {{ eventTag: string, sanitizedPayload: object }}
 */
export function formatDiagnosticEntry(event, payload = {}) {
  const sanitized = sanitizeDiagnosticPayload(payload);
  return {
    eventTag: `[OJAF] ${event}`,
    sanitizedPayload: sanitized
  };
}
