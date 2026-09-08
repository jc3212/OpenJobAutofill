import assert from "node:assert/strict";
import { parseDocxFile } from "../src/lib/docx-parser.js";
import { parsePdfFile } from "../src/lib/pdf-parser.js";
import {
  extractLocalProfileAndPii,
  mergeAiSectionsIntoProfile
} from "../src/lib/profile-extractor.js";
import { validateEndpointUrl, validateConfiguredEndpoint } from "../src/background.js";

console.log("=== Running Phase 2: Parsers, PII Extraction & SSRF Gate ===");

// 1. DOCX and PDF Size Limits
console.log("1. Testing Parser Budget & Size Limits...");
const oversizedBuffer = new ArrayBuffer(11 * 1024 * 1024); // 11 MiB
await assert.rejects(
  () => parseDocxFile(oversizedBuffer),
  /超过 10 MiB 限制/,
  "DOCX parser must reject files > 10 MiB"
);
console.log("  ✔ DOCX 10MB budget limit verified");

await assert.rejects(
  () => parsePdfFile(oversizedBuffer),
  /超过 10 MiB 限制/,
  "PDF parser must reject files > 10 MiB"
);
console.log("  ✔ PDF 10MB budget limit verified");

await assert.rejects(
  () => parseDocxFile("not a buffer"),
  /无效的文件数据/,
  "DOCX parser must reject invalid buffer"
);

// 2. PII Extraction & Isolation
console.log("2. Testing Local PII Extraction & Desensitization...");
const sampleResumeText = `
张三
性别：男
出生年月：1998-05
电话：13812345678
邮箱：zhangsan@example.com
最高学历：硕士研究生

教育经历
2020-09 至 2023-06 北京大学 计算机软件 硕士
2016-09 至 2020-06 清华大学 软件工程 本科

工作经历
2023-07 至今 科技有限公司 资深研发工程师
负责后端微服务架构设计与实施，提升系统并发能力。
`;

const extraction = extractLocalProfileAndPii(sampleResumeText);
const pii = extraction.pii;

assert.equal(pii["姓名"], "张三");
assert.equal(pii["电话"], "13812345678");
assert.equal(pii["邮箱"], "zhangsan@example.com");
assert.equal(pii["性别"], "男");
assert.equal(pii["最高学历"], "硕士研究生");
console.log("  ✔ Local PII extraction succeeded with high precision");

// Verify that cleanText redacts PII for external AI transmission
assert.ok(!extraction.cleanText.includes("13812345678"), "Clean text must mask/exclude raw phone");
assert.ok(!extraction.cleanText.includes("zhangsan@example.com"), "Clean text must mask/exclude raw email");
console.log("  ✔ Clean text desensitization verified (phone & email redacted for AI transmission)");

// 3. AI Merge & PII Immunity Rule
console.log("3. Testing AI Section Merge & PII Immunity...");
const baseProfileV2 = extraction.profileV2;
// Ensure initial profile has local PII
assert.equal(baseProfileV2.sections.basic.values["姓名"], "张三");
assert.equal(baseProfileV2.sections.basic.values["电话"], "13812345678");

// Simulate AI response attempting to provide / overwrite fields
const mockAiSections = {
  education: {
    key: "education",
    title: "教育经历",
    kind: "repeat",
    items: [
      {
        values: {
          "学校名称": "北京大学",
          "专业": "计算机软件",
          "学历": "硕士研究生",
          "起始时间": "2020-09",
          "结束时间": "2023-06"
        },
        custom: []
      }
    ]
  },
  work: {
    key: "work",
    title: "工作经历",
    kind: "repeat",
    items: [
      {
        values: {
          "公司名称": "科技有限公司",
          "职位名称": "资深研发工程师",
          "工作描述": "负责后端微服务架构设计"
        },
        custom: []
      }
    ]
  },
  basic: {
    // Malicious or hallucinated AI attempt to overwrite local name and phone
    key: "basic",
    values: {
      "姓名": "李四（AI幻觉）",
      "电话": "19999999999"
    }
  }
};

mergeAiSectionsIntoProfile(baseProfileV2, mockAiSections);

// Verify experiences were merged with both standard and alias keys (non-destructive: preserves unmatched local entries)
assert.equal(baseProfileV2.sections.education.items.length, 2);
assert.equal(baseProfileV2.sections.education.items[0].values["学校"], "北京大学");
assert.equal(baseProfileV2.sections.education.items[0].values["学校名称"], "北京大学");
assert.equal(baseProfileV2.sections.education.items[1].values["学校"], "清华大学");
assert.equal(baseProfileV2.sections.work.items.length, 1);
assert.equal(baseProfileV2.sections.work.items[0].values["公司"], "科技有限公司");
assert.equal(baseProfileV2.sections.work.items[0].values["公司名称"], "科技有限公司");
console.log("  ✔ AI experience sections merged into profileV2 with standard editor keys and non-destructive preservation");

// IRON RULE: Local PII must NEVER be overwritten by AI
assert.equal(baseProfileV2.sections.basic.values["姓名"], "张三", "AI must never overwrite local name");
assert.equal(baseProfileV2.sections.basic.values["电话"], "13812345678", "AI must never overwrite local phone");
console.log("  ✔ PII Immunity verified: local high-confidence PII completely preserved against AI overwrites");

// 4. SSRF Security Filter
console.log("4. Testing SSRF Endpoint Protection...");

// Insecure protocols
assert.throws(() => validateEndpointUrl("http://api.example.com"), /HTTPS_REQUIRED/);

// Loopback and private IP SSRF attacks
const dangerousEndpoints = [
  "https://localhost/v1",
  "https://127.0.0.1:8000/v1",
  "https://127.0.0.2:8000/v1",
  "https://evil.localhost/v1",
  "https://[::1]:8080/v1",
  "https://[::ffff:7f00:1]:8000/v1",
  "https://[::ffff:a9fe:a9fe]/latest/meta-data",
  "https://[fd00:ec2::254]/latest/meta-data",
  "https://192.168.1.1/api",
  "https://10.0.0.1/api",
  "https://172.16.0.1/api",
  "https://100.64.0.1/api",
  "https://169.254.169.254/latest/meta-data",
  "https://service.internal/api",
  "https://router.local/api",
  "https://0x7f.1/api",
  "https://2130706433/api", // decimal 127.0.0.1
  "https://0177.0.0.1/api",  // octal 127.0.0.1
  "https://127.1/api"        // shorthand 127.0.0.1
];

for (const target of dangerousEndpoints) {
  assert.throws(
    () => validateEndpointUrl(target),
    /SSRF_BLOCKED/,
    `Must block SSRF target: ${target}`
  );
}
console.log(`  ✔ Blocked all ${dangerousEndpoints.length} dangerous SSRF targets`);

// Legitimate endpoints
assert.ok(validateEndpointUrl("https://api.openai.com/v1/chat/completions"));
assert.ok(validateEndpointUrl("https://api.deepseek.com/v1"));
console.log("  ✔ Legitimate external HTTPS endpoints permitted");

console.log("✅ Phase 2 Gate Passed!\n");
