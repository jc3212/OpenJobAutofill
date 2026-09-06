/**
 * OpenJobAutofill - Unit Test: Runtime Contracts & Quality Evaluation
 */

import assert from "node:assert/strict";
import {
  assertResumeParseResult,
  evaluateResumeParseQuality,
  assertAiResumeResult
} from "../../src/lib/contracts.js";
import { MESSAGE_TYPES } from "../../src/lib/protocol.js";

console.log("=== Running Unit Test: Contracts & Quality Gate ===");

// 1. Structural Resume Parse Contract
console.log("1. Testing assertResumeParseResult...");
{
  // Valid parse result with content
  const valid = {
    rawText: "姓名：张三\n学历：本科",
    lines: ["姓名：张三", "学历：本科"],
    warnings: [],
    stats: { type: "pdf", charCount: 15, lineCount: 2 }
  };
  assert.equal(assertResumeParseResult(valid), true, "Valid result should pass assertion");

  // Valid structural result with empty rawText (e.g. scanned image PDF)
  // Structural assertion MUST pass because empty text is a valid output of image-only PDF
  const scannedImagePdfResult = {
    rawText: "",
    lines: [],
    warnings: ["未检测到文本图层"],
    stats: { type: "pdf", charCount: 0, lineCount: 0 }
  };
  assert.equal(assertResumeParseResult(scannedImagePdfResult), true, "Scanned PDF result should pass structural contract");

  // Invalid cases must throw
  assert.throws(() => assertResumeParseResult(null), /must be a non-null object/);
  assert.throws(() => assertResumeParseResult({}), /must contain 'rawText' as a string/);
  assert.throws(() => assertResumeParseResult({ rawText: 123 }), /must contain 'rawText' as a string/);
  assert.throws(() => assertResumeParseResult({ rawText: "", lines: "not-array" }), /must contain 'lines' as an array/);
  assert.throws(() => assertResumeParseResult({ rawText: "", lines: [], warnings: "not-array" }), /must contain 'warnings' as an array/);
  assert.throws(() => assertResumeParseResult({ rawText: "", lines: [], warnings: [], stats: null }), /must contain 'stats' as a non-null object/);
  console.log("  ✔ assertResumeParseResult validates schema and permits empty rawText without crashing");
}

// 2. Decoupled Content Quality Evaluation
console.log("2. Testing evaluateResumeParseQuality...");
{
  // Empty text -> NO_EXTRACTABLE_TEXT
  const emptyRes = evaluateResumeParseQuality({ rawText: "", lines: [], warnings: [], stats: {} });
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.code, "NO_EXTRACTABLE_TEXT");
  assert.match(emptyRes.message, /扫描件/);

  // Whitespace only -> NO_EXTRACTABLE_TEXT
  const wsRes = evaluateResumeParseQuality({ rawText: "   \n\t  ", lines: [], warnings: [], stats: {} });
  assert.equal(wsRes.valid, false);
  assert.equal(wsRes.code, "NO_EXTRACTABLE_TEXT");

  // Very short text -> INSUFFICIENT_EXTRACTABLE_TEXT
  const shortRes = evaluateResumeParseQuality({ rawText: "简短内容", lines: ["简短内容"], warnings: [], stats: {} });
  assert.equal(shortRes.valid, false);
  assert.equal(shortRes.code, "INSUFFICIENT_EXTRACTABLE_TEXT");
  assert.match(shortRes.message, /少于 10 字符/);

  // Sufficient text -> OK
  const okRes = evaluateResumeParseQuality({
    rawText: "张三的个人简历，毕业于北京大学计算机系，具有五年全栈开发经验。",
    lines: ["张三的个人简历"],
    warnings: [],
    stats: {}
  });
  assert.equal(okRes.valid, true);
  assert.equal(okRes.code, "OK");
  console.log("  ✔ evaluateResumeParseQuality accurately diagnoses scanned, empty, insufficient, and valid texts");
}

// 3. AI Result Contract Assertion
console.log("3. Testing assertAiResumeResult...");
{
  const validAiResult = {
    sections: {
      education: { kind: "repeat", items: [] },
      work: { kind: "repeat", items: [] }
    },
    diagnostics: { provider: "openai-compatible", model: "gpt-4o" }
  };
  assert.equal(assertAiResumeResult(validAiResult), true);

  // Valid even without inner ok: true
  assert.equal("ok" in validAiResult, false, "AI result should not require redundant inner ok: true");

  assert.throws(() => assertAiResumeResult(null), /must be a non-null object/);
  assert.throws(() => assertAiResumeResult({}), /must contain a 'sections' object/);
  assert.throws(() => assertAiResumeResult({ sections: null }), /must contain a 'sections' object/);
  console.log("  ✔ assertAiResumeResult validates sections object without double-nested ok");
}

// 4. Frozen Protocol Message Types
console.log("4. Testing MESSAGE_TYPES constant...");
{
  assert.equal(Object.isFrozen(MESSAGE_TYPES), true, "MESSAGE_TYPES must be frozen");
  assert.equal(MESSAGE_TYPES.PARSE_RESUME_WITH_AI, "OJAF_PARSE_RESUME_WITH_AI");
  assert.equal(MESSAGE_TYPES.SAVE_PROFILE, "OJAF_SAVE_PROFILE");
  assert.equal(MESSAGE_TYPES.SET_ACTIVE_PROFILE, "OJAF_SET_ACTIVE_PROFILE");
  assert.equal(MESSAGE_TYPES.CREATE_PROFILE, "OJAF_CREATE_PROFILE");
  assert.equal(MESSAGE_TYPES.DELETE_PROFILE, "OJAF_DELETE_PROFILE");
  assert.equal(MESSAGE_TYPES.GET_SETTINGS, "OJAF_GET_SETTINGS");
  console.log("  ✔ MESSAGE_TYPES is frozen and maps all protocol messages correctly");
}

console.log("✅ All Contracts & Quality tests passed!\n");
