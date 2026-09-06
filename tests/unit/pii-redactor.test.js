/**
 * OpenJobAutofill - Unit Test: Safe PII Redactor
 */

import assert from "node:assert/strict";
import { redactPii } from "../../src/lib/pii-redactor.js";

console.log("=== Running Unit Test: PII Redactor Gate ===");

// 1. Longest-value-first assertion (Substring Collision Prevention)
console.log("1. Testing Longest-Value-First sorting against Substring Collisions...");
{
  const text = "在校期间由导师张三丰指导，学生张三负责核心算法实现。";
  const pii = {
    "学生姓名": "张三",
    "导师姓名": "张三丰"
  };

  const { redactedText } = redactPii(text, pii);

  // If "张三" ran first, "张三丰" would become "[已脱敏-姓名]丰"
  assert.equal(
    redactedText,
    "在校期间由导师[已脱敏-姓名]指导，学生[已脱敏-姓名]负责核心算法实现。",
    "Longer name '张三丰' must be redacted BEFORE shorter substring '张三'"
  );
  assert.ok(!redactedText.includes("丰"), "Must not leave dangling suffix '丰'");
  console.log("  ✔ Longest-value-first safely prevents substring collision between '张三' and '张三丰'");
}

// 2. Special Characters and Regex Quantifier Immunity (+, ., -, etc.)
console.log("2. Testing immunity to Regex special characters (+86, ., -, etc.)...");
{
  const text = "紧急联系人：+86 138-0013-8000，常用邮箱：my.name+jobs@company.co.uk。";
  const pii = {
    "电话": "+86 138-0013-8000",
    "邮箱": "my.name+jobs@company.co.uk"
  };

  // Literal replacement must not throw SyntaxError for '+' quantifier or regex unescaped '.'
  const { redactedText, replacements } = redactPii(text, pii);

  assert.ok(!redactedText.includes("+86 138-0013-8000"));
  assert.ok(!redactedText.includes("my.name+jobs@company.co.uk"));
  assert.equal(
    redactedText,
    "紧急联系人：[已脱敏-电话]，常用邮箱：[已脱敏-邮箱]。"
  );
  assert.equal(replacements.length, 2);
  console.log("  ✔ Literal string replacement handles '+86' and 'name+jobs@...' with zero regex syntax issues");
}

// 3. Normalization of Phone Digits
console.log("3. Testing Phone Variant Normalization...");
{
  const text = "简历正文手机号写的是 13800138000，顶部写的是 138-0013-8000。";
  const pii = {
    "电话": "138-0013-8000"
  };

  const { redactedText } = redactPii(text, pii);
  assert.ok(!redactedText.includes("13800138000"));
  assert.ok(!redactedText.includes("138-0013-8000"));
  assert.equal(
    redactedText,
    "简历正文手机号写的是 [已脱敏-电话]，顶部写的是 [已脱敏-电话]。"
  );
  console.log("  ✔ Automatically identifies pure 11-digit phone variants");
}

// 4. Boundary & Edge Cases
console.log("4. Testing edge cases and over-redaction guards...");
{
  assert.equal(redactPii("", {}).redactedText, "");
  assert.equal(redactPii("正常文本", null).redactedText, "正常文本");
  assert.equal(redactPii("正常文本", {}).redactedText, "正常文本");

  // Single character values (e.g. initial or noise) must not be redacted everywhere
  const singleCharPii = { "姓名": "张", "代码": "A" };
  const safeText = "张三在 A 公司工作";
  const res = redactPii(safeText, singleCharPii);
  assert.equal(res.redactedText, safeText, "Single characters must not trigger catastrophic redaction");
  console.log("  ✔ Single character guard prevents over-redaction");
}

console.log("✅ All PII Redactor tests passed!\n");
