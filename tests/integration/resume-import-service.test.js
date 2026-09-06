/**
 * OpenJobAutofill - Integration Test: Resume Import Service & Draft-First Workflow
 */

import assert from "node:assert/strict";
import { parseResumeFile, createResumeDraft } from "../../src/lib/resume-import-service.js";
import { createDefaultResumeEnvelope } from "../../src/lib/protocol.js";

console.log("=== Running Integration Test: Resume Import & Draft Workflow ===");

// 1. Testing parseResumeFile with mock dependencies
console.log("1. Testing parseResumeFile...");
{
  const mockPdfFile = {
    name: "张三-简历.pdf",
    arrayBuffer: async () => new ArrayBuffer(1024)
  };

  const mockDeps = {
    parsePdfFile: async () => ({
      rawText: "姓名：张三\n电话：13800138000\n邮箱：zhangsan@example.com\n毕业于清华大学计算机系",
      lines: ["姓名：张三", "电话：13800138000", "邮箱：zhangsan@example.com", "毕业于清华大学计算机系"],
      warnings: [],
      stats: { type: "pdf", charCount: 50, lineCount: 4 }
    }),
    extractLocalProfileAndPii: (rawText) => ({
      profileV2: {
        schemaVersion: 2,
        sections: {
          basic: { kind: "simple", values: { "姓名": "张三" } }
        }
      },
      pii: { "姓名": "张三", "电话": "13800138000", "邮箱": "zhangsan@example.com" }
    })
  };

  const res = await parseResumeFile(mockPdfFile, mockDeps);
  assert.equal(res.fileName, "张三-简历.pdf");
  assert.equal(res.quality.valid, true);
  assert.equal(res.quality.code, "OK");
  assert.equal(res.pii["姓名"], "张三");
  assert.equal(res.lines.length, 4);

  // Scanned PDF (empty rawText)
  const scannedMockDeps = {
    parsePdfFile: async () => ({
      rawText: "",
      lines: [],
      warnings: ["未检测到文本图层"],
      stats: { type: "pdf", charCount: 0, lineCount: 0 }
    }),
    extractLocalProfileAndPii: () => ({ profileV2: {}, pii: {} })
  };
  const scannedRes = await parseResumeFile(mockPdfFile, scannedMockDeps);
  assert.equal(scannedRes.quality.valid, false);
  assert.equal(scannedRes.quality.code, "NO_EXTRACTABLE_TEXT");
  assert.ok(scannedRes.warnings.some((w) => w.includes("NO_EXTRACTABLE_TEXT")));

  // Unsupported file format
  await assert.rejects(
    async () => parseResumeFile({ name: "virus.exe" }),
    /不支持的文件格式/
  );

  console.log("  ✔ parseResumeFile accurately delegates to parsers, validates contracts & evaluates quality");
}

// 2. Testing createResumeDraft & Concurrency Snapshot
console.log("2. Testing createResumeDraft & Target Concurrency Snapshot...");
{
  const envelope = createDefaultResumeEnvelope();
  const defaultProfileId = envelope.activeProfileId;
  envelope.profiles[defaultProfileId].name = "我的主简历";
  envelope.profiles[defaultProfileId].revision = 3;

  const mockParseResult = {
    fileName: "李四_应聘工程师.docx",
    rawText: "李四的个人简历内容...",
    lines: ["李四的个人简历内容..."],
    warnings: [],
    quality: { valid: true, code: "OK" },
    profileV2: {
      schemaVersion: 2,
      sections: {
        basic: { values: { "姓名": "李四" } }
      }
    },
    pii: { "姓名": "李四" },
    stats: { charCount: 15 }
  };

  // Case A: User has an active/editing profile selected
  const draftWithTarget = createResumeDraft({
    parseResult: mockParseResult,
    currentEnvelope: envelope,
    editingProfileId: defaultProfileId
  });

  assert.equal(draftWithTarget.suggestedName, "李四-简历");
  assert.equal(draftWithTarget.fileName, "李四_应聘工程师.docx");
  assert.ok(draftWithTarget.id.startsWith("draft_") || draftWithTarget.id.length > 10);
  assert.deepEqual(draftWithTarget.target, {
    profileId: defaultProfileId,
    profileName: "我的主简历",
    baseProfileRevision: 3
  }, "Draft MUST snapshot target profile revision at moment of creation!");

  // Case B: No profile selected
  const draftWithoutTarget = createResumeDraft({
    parseResult: mockParseResult,
    currentEnvelope: envelope,
    editingProfileId: null
  });
  assert.equal(draftWithoutTarget.target, null);

  // Invariant assertion: Upload & Draft creation MUST NOT modify store envelope!
  assert.equal(envelope.profiles[defaultProfileId].revision, 3);
  assert.equal(Object.keys(envelope.profiles).length, 1);
  console.log("  ✔ createResumeDraft captures target revision snapshot and guarantees zero persistence side effects on upload");
}

console.log("✅ All Resume Import Service & Draft-First Workflow tests passed!\n");
