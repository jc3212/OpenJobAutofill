/**
 * OpenJobAutofill - Unit Test: Field Knowledge Graph (FKG)
 */

import assert from "node:assert/strict";
import {
  FIELD_KNOWLEDGE_GRAPH,
  matchFieldKnowledge,
  checkNegativeMatch,
  inferSectionScopeFromHeading,
  normalizeFkgText
} from "../../src/lib/field-knowledge-graph.js";

console.log("=== Running Unit Test: Field Knowledge Graph (FKG) Gate ===");

// 1. Structure and Completeness Gate
console.log("1. Testing FKG Structure and Completeness (100+ Aliases Across 4 Sections)...");
{
  assert.ok(Array.isArray(FIELD_KNOWLEDGE_GRAPH), "FKG must be an array");
  assert.ok(FIELD_KNOWLEDGE_GRAPH.length >= 25, `FKG should contain at least 25 rules, found ${FIELD_KNOWLEDGE_GRAPH.length}`);

  const requiredSections = new Set(["basic", "education", "work", "project"]);
  const presentSections = new Set(FIELD_KNOWLEDGE_GRAPH.map(r => r.sectionScope));
  for (const s of requiredSections) {
    assert.ok(presentSections.has(s), `FKG must cover section '${s}'`);
  }

  let totalAliases = 0;
  for (const rule of FIELD_KNOWLEDGE_GRAPH) {
    assert.ok(rule.id, "Rule must have id");
    assert.ok(rule.target, "Rule must have target");
    assert.ok(rule.label, "Rule must have label");
    assert.ok(rule.sectionScope, "Rule must have sectionScope");
    assert.ok(Array.isArray(rule.aliases) && rule.aliases.length > 0, `Rule ${rule.id} must have aliases`);
    assert.ok(Array.isArray(rule.negative), `Rule ${rule.id} must have negative array`);
    totalAliases += rule.aliases.length;
  }

  assert.ok(totalAliases >= 100, `Total aliases must exceed 100, actual: ${totalAliases}`);
  console.log(`  ✔ FKG Structure verified: ${FIELD_KNOWLEDGE_GRAPH.length} rules, ${totalAliases} aliases across all 4 key sections`);
}

// 2. Deterministic Field Matching Accuracy
console.log("2. Testing Deterministic Field Matching Accuracy & Confidence Scoring...");
{
  // Basic personal info
  const nameResult = matchFieldKnowledge({
    label: "真实姓名",
    placeholder: "请输入您的中文姓名",
    controlType: "text"
  });
  assert.equal(nameResult.matched, true);
  assert.equal(nameResult.target, "basic.name");
  assert.ok(nameResult.confidence >= 0.70, `Confidence should be high, got ${nameResult.confidence}`);

  // English Name
  const engNameResult = matchFieldKnowledge({
    label: "Full Name",
    placeholder: "Enter candidate legal name"
  });
  assert.equal(engNameResult.matched, true);
  assert.equal(engNameResult.target, "basic.name");

  // Phone
  const phoneResult = matchFieldKnowledge({
    label: "手机号码",
    controlType: "tel"
  });
  assert.equal(phoneResult.matched, true);
  assert.equal(phoneResult.target, "basic.phone");

  // Email
  const emailResult = matchFieldKnowledge({
    label: "电子信箱",
    name: "applicant_email",
    controlType: "email"
  });
  assert.equal(emailResult.matched, true);
  assert.equal(emailResult.target, "basic.email");

  // Education School
  const schoolResult = matchFieldKnowledge({
    label: "毕业院校",
    sectionHeading: "教育背景"
  });
  assert.equal(schoolResult.matched, true);
  assert.equal(schoolResult.target, "education.school");

  // Work Company
  const companyResult = matchFieldKnowledge({
    label: "就职企业",
    sectionHeading: "工作经历"
  });
  assert.equal(companyResult.matched, true);
  assert.equal(companyResult.target, "work.company");

  // Project Name
  const projectResult = matchFieldKnowledge({
    label: "项目名称",
    sectionHeading: "项目经历"
  });
  assert.equal(projectResult.matched, true);
  assert.equal(projectResult.target, "project.name");

  console.log("  ✔ Accurate field target identification and confidence calculation verified");
}

// 3. Strict 100% Negative Exclusion
console.log("3. Testing 100% Negative Exclusion (Preventing Misattribution)...");
{
  // Candidate name vs Emergency Contact
  const emergencyName = matchFieldKnowledge({
    label: "紧急联系人姓名",
    placeholder: "发生紧急情况时的联系人"
  });
  assert.notEqual(emergencyName.target, "basic.name", "Emergency contact name must NOT match basic.name");
  assert.equal(emergencyName.target, "basic.emergencyContact", "Should match basic.emergencyContact");

  // Candidate phone vs Emergency Contact Phone
  const emergencyPhone = matchFieldKnowledge({
    label: "紧急联系人电话",
    sectionHeading: "紧急联络人"
  });
  assert.notEqual(emergencyPhone.target, "basic.phone", "Emergency phone must NOT match basic.phone");
  assert.equal(emergencyPhone.target, "basic.emergencyPhone");

  // Candidate name vs Reference Name
  const referenceName = matchFieldKnowledge({
    label: "证明人姓名",
    placeholder: "前雇主直属主管姓名",
    sectionHeading: "工作经历证明人"
  });
  assert.notEqual(referenceName.target, "basic.name", "Reference name must NOT match candidate basic.name");
  assert.equal(referenceName.target, "work.referenceName");

  // English Reference Name
  const engRefName = matchFieldKnowledge({
    label: "Reference Name",
    sectionHeading: "Professional References"
  });
  assert.notEqual(engRefName.target, "basic.name", "Reference Name must NOT match basic.name");
  assert.equal(engRefName.target, "work.referenceName");

  // Candidate phone vs Office Phone
  const officePhone = matchFieldKnowledge({
    label: "公司座机电话",
    nearbyText: "请勿填写个人手机号"
  });
  assert.notEqual(officePhone.target, "basic.phone", "Company phone must NOT match basic.phone");

  // Candidate name vs Father's Name
  const fatherName = matchFieldKnowledge({
    label: "父亲姓名",
    sectionHeading: "家庭成员情况"
  });
  assert.notEqual(fatherName.target, "basic.name", "Father's name must NOT match candidate basic.name");

  // Candidate phone vs Family Phone (Father/Mother/Spouse)
  const fatherPhone = matchFieldKnowledge({ label: "父亲电话" });
  assert.notEqual(fatherPhone.target, "basic.phone", "Father's phone must NOT match candidate basic.phone");
  const motherPhone = matchFieldKnowledge({ label: "母亲手机" });
  assert.notEqual(motherPhone.target, "basic.phone", "Mother's phone must NOT match candidate basic.phone");
  const spousePhone = matchFieldKnowledge({ label: "配偶电话" });
  assert.notEqual(spousePhone.target, "basic.phone", "Spouse phone must NOT match candidate basic.phone");

  // Candidate email vs Family / Supervisor Email
  const fatherEmail = matchFieldKnowledge({ label: "父亲邮箱" });
  assert.notEqual(fatherEmail.target, "basic.email", "Father's email must NOT match candidate basic.email");
  const supEmail = matchFieldKnowledge({ label: "主管邮箱" });
  assert.notEqual(supEmail.target, "basic.email", "Supervisor email must NOT match candidate basic.email");

  // Reference email vs Reference Name
  const refEmail = matchFieldKnowledge({ label: "证明人邮箱" });
  assert.equal(refEmail.target, "work.referenceEmail", "Reference email must match work.referenceEmail, not referenceName");

  // Candidate work role vs Supervisor Role
  const supervisorRole = matchFieldKnowledge({ label: "主管职位" });
  assert.notEqual(supervisorRole.target, "work.role", "Supervisor title must NOT match candidate work.role");

  // Candidate ID card vs Emergency contact ID
  const emergencyId = matchFieldKnowledge({ label: "紧急联系人身份证号" });
  assert.notEqual(emergencyId.target, "basic.idNumber", "Emergency ID must NOT match candidate basic.idNumber");
  assert.notEqual(emergencyId.target, "basic.emergencyContact", "Emergency ID must NOT match emergencyContact name");

  console.log("  ✔ 100% Negative keyword exclusion verified (Emergency, Reference, Family, Manager blocked)");
}

// 4. Section Scope Disambiguation and Context Isolation
console.log("4. Testing Section Scope Disambiguation & Context Isolation...");
{
  // Same label "开始时间" in different sections
  const eduStart = matchFieldKnowledge({
    label: "开始时间",
    sectionHeading: "教育背景"
  });
  assert.equal(eduStart.target, "education.startDate", "Start date under Education must match education.startDate");

  const workStart = matchFieldKnowledge({
    label: "开始时间",
    sectionHeading: "工作经历"
  });
  assert.equal(workStart.target, "work.startDate", "Start date under Work must match work.startDate");

  const projStart = matchFieldKnowledge({
    label: "开始时间",
    sectionHeading: "项目经历"
  });
  assert.equal(projStart.target, "project.startDate", "Start date under Project must match project.startDate");

  // Cross-section incompatibility: School inside Work section should be disqualified
  const invalidCrossSection = matchFieldKnowledge({
    label: "学校",
    sectionHeading: "工作履历"
  });
  assert.notEqual(invalidCrossSection.target, "work.company");

  // Repeater isolation: basic.name must NOT match inside repeater items
  const repeaterField = matchFieldKnowledge({
    label: "姓名",
    isRepeaterItem: true,
    sectionHeading: "工作经历 1"
  });
  assert.notEqual(repeaterField.target, "basic.name", "basic.name must not match inside repeater item");

  console.log("  ✔ Section scope disambiguation and experience repeater isolation verified");
}

console.log("✅ All Field Knowledge Graph tests passed!\n");
