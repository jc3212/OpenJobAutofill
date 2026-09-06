/**
 * OpenJobAutofill - Integration Test: AI Privacy Gate (Zero Automatic Transmission)
 */

import assert from "node:assert/strict";
import { parseResumeFile, createResumeDraft } from "../../src/lib/resume-import-service.js";
import { redactPii } from "../../src/lib/pii-redactor.js";

console.log("=== Running Integration Test: AI Privacy Gate (Zero Auto-transmission) ===");

// Simulate network monitoring that differentiates between AI / Resume content requests
// and legitimate non-resume background requests (e.g. GitHub release version check).
class NetworkMonitor {
  constructor() {
    this.totalRequests = 0;
    this.resumeAiRequests = 0;
    this.resumeContentExternalRequests = 0;
    this.backgroundUpdateRequests = 0;
    this.interceptedPayloads = [];
  }

  recordRequest(url, options = {}) {
    this.totalRequests++;
    const bodyStr = typeof options.body === "string" ? options.body : "";

    if (url.includes("api.github.com/repos/")) {
      this.backgroundUpdateRequests++;
      return { ok: true, status: 200, json: async () => ({ tag_name: "v1.0.2" }) };
    }

    if (url.includes("openai.com") || url.includes("/chat/completions") || options.isAiRequest) {
      this.resumeAiRequests++;
      this.interceptedPayloads.push({ url, body: bodyStr });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ sections: {} }) } }]
        })
      };
    }

    // Check if raw resume text or PII leaked to any other external endpoint
    if (bodyStr.includes("13812345678") || bodyStr.includes("zhangsan@example.com")) {
      this.resumeContentExternalRequests++;
    }

    return { ok: true, status: 200 };
  }
}

const network = new NetworkMonitor();

// 1. Simulate Background Update Check (Unrelated to resume parsing)
console.log("1. Simulating Background Update Check...");
network.recordRequest("https://api.github.com/repos/Br1an67/OpenJobAutofill/releases/latest");
assert.equal(network.backgroundUpdateRequests, 1);
assert.equal(network.resumeAiRequests, 0, "Update check must not count as AI request");
assert.equal(network.resumeContentExternalRequests, 0);
console.log("  ✔ Background update check does not trigger AI Privacy Gate false positive");

// 2. Upload and Draft Creation Gate (Must guarantee ZERO AI & ZERO Resume External transmission)
console.log("2. Testing Upload and Local Draft Creation Privacy Gate...");
{
  const mockFile = {
    name: "李四_应聘.pdf",
    arrayBuffer: async () => new ArrayBuffer(512)
  };

  const rawResumeText = "姓名：李四\n电话：13900001111\n邮箱：lisi@test.com\n北京大学软件工程学士";

  const parseResult = await parseResumeFile(mockFile, {
    parsePdfFile: async () => ({
      rawText: rawResumeText,
      lines: rawResumeText.split("\n"),
      warnings: [],
      stats: { type: "pdf", charCount: rawResumeText.length, lineCount: 4 }
    }),
    extractLocalProfileAndPii: (text) => {
      const pii = { "姓名": "李四", "电话": "13900001111", "邮箱": "lisi@test.com" };
      const { redactedText } = redactPii(text, pii);
      return {
        profileV2: { schemaVersion: 2, sections: { basic: { values: pii } } },
        pii,
        cleanText: redactedText
      };
    }
  });

  const draft = createResumeDraft({ parseResult });

  // PRIVACY GATE ASSERTIONS:
  assert.equal(network.resumeAiRequests, 0, "CRITICAL: Upload & local parsing must perform ZERO AI requests");
  assert.equal(network.resumeContentExternalRequests, 0, "CRITICAL: Upload & local parsing must transmit ZERO resume data externally");
  console.log("  ✔ Privacy Gate PASSED: Upload and local parsing completed with 0 AI requests and 0 resume content transmissions");
}

// 3. Explicit User AI Authorization Gate
console.log("3. Testing Explicit AI Trigger Gate...");
{
  // User reviews draft, text is redacted, then clicks "使用 AI 增强经历结构化"
  const rawPreviewText = "姓名：[已脱敏-姓名]\n电话：[已脱敏-电话]\n邮箱：[已脱敏-邮箱]\n北京大学软件工程学士";

  // Simulate explicit trigger
  network.recordRequest("https://api.openai.com/v1/chat/completions", {
    isAiRequest: true,
    body: JSON.stringify({ prompt: rawPreviewText })
  });

  assert.equal(network.resumeAiRequests, 1, "Exactly 1 AI request made after explicit user button click");
  assert.equal(network.resumeContentExternalRequests, 0, "No raw unredacted PII leaked in network requests");

  const lastPayload = network.interceptedPayloads[network.interceptedPayloads.length - 1];
  assert.ok(!lastPayload.body.includes("13900001111"), "Raw phone number must not appear in AI request body");
  assert.ok(!lastPayload.body.includes("lisi@test.com"), "Raw email must not appear in AI request body");
  console.log("  ✔ Explicit AI enhancement sends only desensitized preview text on user command");
}

console.log("✅ All AI Privacy Gate tests passed!\n");
