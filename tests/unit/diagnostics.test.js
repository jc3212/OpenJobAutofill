/**
 * OpenJobAutofill - Unit Test: Content Observability & Diagnostics Redactor Gate
 */

import assert from "node:assert/strict";
import { sanitizeDiagnosticPayload, formatDiagnosticEntry } from "../../src/lib/diagnostics.js";

console.log("=== Running Unit Test: Content Observability & Diagnostics Redactor Gate ===");

// 1. Testing Strict PII Redaction on Sensitive Field Keys
console.log("1. Testing Strict PII Redaction on Sensitive Field Keys...");
{
  const rawPayload = {
    event: "candidate_fill",
    name: "李建国",
    phone: "13987654321",
    email: "jianguo.li@zju.edu.cn",
    password: "supersecretpassword",
    idcard: "110101199001011234",
    value: "浙江大学 计算机学院",
    text: "求职意向：全栈架构师"
  };

  const clean = sanitizeDiagnosticPayload(rawPayload);

  // Original object must not be mutated
  assert.equal(rawPayload.name, "李建国");
  assert.equal(rawPayload.phone, "13987654321");

  // Redacted fields must never contain plain text personal data
  assert.equal(clean.name, "[REDACTED_LEN_3]");
  assert.equal(clean.phone, "[REDACTED_LEN_11]");
  assert.equal(clean.email, "[REDACTED_LEN_21]");
  assert.equal(clean.password, "[REDACTED_LEN_19]");
  assert.equal(clean.idcard, "[REDACTED_LEN_18]");
  assert.equal(clean.value, "[REDACTED_LEN_10]");
  assert.equal(clean.text, "[REDACTED_LEN_10]");
  console.log("  ✔ Sensitive keys (name, phone, email, password, idcard, value, text) strictly redacted to length masks");
}

// 2. Testing Metadata Preservation
console.log("2. Testing Metadata Preservation...");
{
  const telemetry = {
    fieldId: "field_42",
    fieldLabel: "毕业院校",
    fieldCategory: "education",
    score: 98,
    confidence: 0.95,
    mappingSource: "rule_exact",
    writeMode: "input",
    ok: true,
    runId: 105,
    counts: {
      attempted: 12,
      filled: 10,
      failed: 1,
      skipped: 1
    }
  };

  const clean = sanitizeDiagnosticPayload(telemetry);
  assert.deepEqual(clean, telemetry, "Safe metadata must be preserved 100% untouched");
  console.log("  ✔ Safe diagnostic metadata completely preserved without alterations");
}

// 3. Testing Deeply Nested Candidate Payloads & Array Collections
console.log("3. Testing Deeply Nested Candidate Payloads...");
{
  const nestedDebugLog = {
    runId: 201,
    candidates: [
      {
        id: "c_1",
        fieldLabel: "姓名",
        value: "张三",
        sourceLabel: "个人信息",
        score: 100
      },
      {
        id: "c_2",
        fieldLabel: "手机号码",
        value: "13800000000",
        sourceLabel: "联系电话",
        score: 95
      }
    ],
    summary: {
      user: {
        name: "张三",
        contact: {
          phone: "13800000000"
        }
      }
    }
  };

  const clean = sanitizeDiagnosticPayload(nestedDebugLog);
  assert.equal(clean.candidates[0].value, "[REDACTED_LEN_2]");
  assert.equal(clean.candidates[0].fieldLabel, "姓名");
  assert.equal(clean.candidates[1].value, "[REDACTED_LEN_11]");
  assert.equal(clean.summary.user.name, "[REDACTED_LEN_2]");
  assert.equal(clean.summary.user.contact.phone, "[REDACTED_LEN_11]");
  console.log("  ✔ Deeply nested arrays and object graphs thoroughly sanitized");
}

// 4. Testing formatDiagnosticEntry
console.log("4. Testing formatDiagnosticEntry...");
{
  const entry = formatDiagnosticEntry("Form Filling Started", {
    tabId: 12,
    candidateCount: 8,
    name: "王小明"
  });

  assert.equal(entry.eventTag, "[OJAF] Form Filling Started");
  assert.equal(entry.sanitizedPayload.tabId, 12);
  assert.equal(entry.sanitizedPayload.candidateCount, 8);
  assert.equal(entry.sanitizedPayload.name, "[REDACTED_LEN_3]");
  console.log("  ✔ formatDiagnosticEntry correctly structures prefix tag and sanitized payload");
}

console.log("✅ All Content Observability & Diagnostics Redactor tests passed!");
