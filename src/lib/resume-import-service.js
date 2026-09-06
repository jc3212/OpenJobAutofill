/**
 * OpenJobAutofill - Resume Import Service
 * 
 * Orchestrates local resume file parsing and creates in-memory ResumeDrafts.
 * Strictly adheres to the Draft-First principle: file parsing generates an in-memory
 * draft with a captured target revision snapshot, and NEVER performs persistence on upload.
 */

import { assertResumeParseResult, evaluateResumeParseQuality } from "./contracts.js";
import { parsePdfFile as defaultParsePdfFile } from "./pdf-parser.js";
import { parseDocxFile as defaultParseDocxFile } from "./docx-parser.js";
import { extractLocalProfileAndPii as defaultExtractLocalProfileAndPii } from "./profile-extractor.js";

/**
 * Parses a resume file (PDF, DOCX, or JSON) locally.
 * 
 * @param {File | { name: string, arrayBuffer: () => Promise<ArrayBuffer>, text: () => Promise<string> }} file
 * @param {object} [deps] Injectable dependencies for testing and modularity
 * @returns {Promise<{
 *   fileName: string,
 *   rawText: string,
 *   lines: string[],
 *   warnings: string[],
 *   stats: object,
 *   quality: { valid: boolean, code: string, message: string },
 *   profileV2: object,
 *   pii: object
 * }>}
 */
export async function parseResumeFile(file, deps = {}) {
  if (!file || typeof file.name !== "string") {
    throw new Error("无效的简历文件对象。");
  }

  const fileName = file.name;
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();

  const parsePdf = deps.parsePdfFile || defaultParsePdfFile;
  const parseDocx = deps.parseDocxFile || defaultParseDocxFile;
  const extractLocal = deps.extractLocalProfileAndPii || defaultExtractLocalProfileAndPii;
  const parseJson = deps.parseImportedProfileBackup;

  if (ext === ".json") {
    const text = typeof file.text === "function" ? await file.text() : "";
    if (!parseJson) {
      throw new Error("未提供 JSON 备份解析函数。");
    }
    const profileV2 = parseJson(text);
    const pii = { "姓名": profileV2?.sections?.basic?.values?.["姓名"] || "" };
    return {
      fileName,
      rawText: "(从 JSON 备份文件导入)",
      lines: [],
      warnings: [],
      stats: { type: "json" },
      quality: { valid: true, code: "OK", message: "JSON 备份有效。" },
      profileV2,
      pii
    };
  }

  if (ext === ".pdf" || ext === ".docx") {
    const buffer = typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : null;
    if (!buffer) {
      throw new Error("无法读取文件二进制数据。");
    }

    const parsed = ext === ".pdf" ? await parsePdf(buffer) : await parseDocx(buffer);
    assertResumeParseResult(parsed);

    const quality = evaluateResumeParseQuality(parsed);
    const warnings = [...(parsed.warnings || [])];
    if (!quality.valid) {
      warnings.unshift(`[质量诊断 ${quality.code}] ${quality.message}`);
    }

    const localResult = extractLocal(parsed.rawText);

    return {
      fileName,
      rawText: parsed.rawText,
      lines: parsed.lines || [],
      warnings,
      stats: parsed.stats || {},
      quality,
      profileV2: localResult.profileV2,
      pii: localResult.pii || {}
    };
  }

  throw new Error(`不支持的文件格式（${ext}），仅支持 .pdf, .docx, .json。`);
}

/**
 * Creates an in-memory ResumeDraft capturing the target profile concurrency snapshot.
 * 
 * @param {object} params
 * @param {object} params.parseResult Result returned from parseResumeFile
 * @param {object} [params.currentEnvelope] The current store envelope
 * @param {string} [params.editingProfileId] The profile ID currently selected in the editor
 * @returns {object} ResumeDraft object
 */
export function createResumeDraft({ parseResult, currentEnvelope, editingProfileId }) {
  if (!parseResult || typeof parseResult !== "object") {
    throw new Error("创建草稿失败：parseResult 必须是非空对象。");
  }

  const candidateName = parseResult.pii?.["姓名"] ||
    parseResult.profileV2?.sections?.basic?.values?.["姓名"] ||
    "";
  const baseName = parseResult.fileName ? parseResult.fileName.replace(/\.[^/.]+$/, "") : "新简历";
  const suggestedName = candidateName ? `${candidateName}-简历` : baseName;

  let target = null;
  if (editingProfileId && currentEnvelope?.profiles?.[editingProfileId]) {
    const editingProfile = currentEnvelope.profiles[editingProfileId];
    target = {
      profileId: editingProfileId,
      profileName: editingProfile.name || "未命名简历",
      baseProfileRevision: Number.isInteger(editingProfile.revision) ? editingProfile.revision : 1
    };
  }

  return {
    id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fileName: parseResult.fileName,
    suggestedName,
    rawText: parseResult.rawText || "",
    cleanText: parseResult.rawText || "",
    lines: parseResult.lines || [],
    warnings: [...(parseResult.warnings || [])],
    quality: parseResult.quality || { valid: true, code: "OK", message: "" },
    profileV2: parseResult.profileV2,
    pii: parseResult.pii || {},
    stats: parseResult.stats || {},
    target, // Snapshot of target profile revision at the moment the draft is created
    createdAt: new Date().toISOString()
  };
}
