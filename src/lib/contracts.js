/**
 * OpenJobAutofill - Runtime Contracts & Quality Evaluation
 * 
 * Provides strict assertions for internal data exchange and decouples
 * structural contracts from text content quality evaluation.
 */

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Validates the structural contract of a resume parse result.
 * Strictly asserts types and required properties.
 * Note: rawText is allowed to be empty string (e.g. scanned image PDF).
 * Content quality evaluation is handled separately by evaluateResumeParseQuality.
 * 
 * @param {any} result
 * @returns {boolean} true if contract is met, throws Error otherwise.
 */
export function assertResumeParseResult(result) {
  if (!isPlainObject(result)) {
    throw new Error("Contract Violation: parse result must be a non-null object.");
  }

  if (typeof result.rawText !== "string") {
    throw new Error("Contract Violation: parse result must contain 'rawText' as a string.");
  }

  if (!Array.isArray(result.lines)) {
    throw new Error("Contract Violation: parse result must contain 'lines' as an array.");
  }

  if (!Array.isArray(result.warnings)) {
    throw new Error("Contract Violation: parse result must contain 'warnings' as an array.");
  }

  if (!isPlainObject(result.stats)) {
    throw new Error("Contract Violation: parse result must contain 'stats' as a non-null object.");
  }

  return true;
}

/**
 * Evaluates the extraction quality of parsed resume text.
 * Decoupled from structural schema validation to gracefully diagnose scanned PDFs,
 * image-only files, or empty documents without throwing unhandled contract exceptions.
 * 
 * @param {object} result A structurally valid parse result
 * @returns {{ valid: boolean, code: "OK" | "NO_EXTRACTABLE_TEXT" | "INSUFFICIENT_EXTRACTABLE_TEXT", message: string }}
 */
export function evaluateResumeParseQuality(result) {
  if (!result || typeof result.rawText !== "string") {
    return {
      valid: false,
      code: "NO_EXTRACTABLE_TEXT",
      message: "无效的解析对象或缺少文本。"
    };
  }

  const trimmed = result.rawText.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      code: "NO_EXTRACTABLE_TEXT",
      message: "未能从该文件提取有效文本。文件可能是图片扫描件、纯图形 PDF 或使用了不受支持的特殊编码。"
    };
  }

  if (trimmed.length < 10) {
    return {
      valid: false,
      code: "INSUFFICIENT_EXTRACTABLE_TEXT",
      message: `提取文本字符数过少（少于 10 字符，实际仅 ${trimmed.length} 字符），无法作为有效简历进行结构化解析。`
    };
  }

  return {
    valid: true,
    code: "OK",
    message: "文本提取成功且质量合格。"
  };
}

/**
 * Validates the structural contract of AI resume parsing results.
 * Guarantees that AI response contains a valid sections object without requiring inner ok: true.
 * 
 * @param {any} result
 * @returns {boolean} true if contract is met, throws Error otherwise.
 */
export function assertAiResumeResult(result) {
  if (!isPlainObject(result)) {
    throw new Error("Contract Violation: AI result must be a non-null object.");
  }

  if (!isPlainObject(result.sections)) {
    throw new Error("Contract Violation: AI result must contain a 'sections' object.");
  }

  return true;
}
