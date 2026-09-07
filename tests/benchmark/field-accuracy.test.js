/**
 * OpenJobAutofill - ATS Benchmark Suite: Field Recognition Accuracy & Negative Exclusion
 *
 * Evaluates field identification Precision, Recall, and 100% Negative Exclusion
 * across real-world ATS form snapshots: Greenhouse, Workday, Zhiye/Beisen, and Moka.
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { matchFieldKnowledge } from "../../src/lib/field-knowledge-graph.js";

console.log("=== Running ATS Benchmark Suite: Field Accuracy & Negative Gate ===");

const FIXTURES_DIR = path.resolve("tests/fixtures/ats");

/**
 * Lightweight HTML form parser that converts offline HTML snapshots into FormFieldDescriptors.
 * Extracts labels (by for="", nearby, or wrapping), placeholders, aria-labels, and section headings.
 * 
 * @param {string} html 
 * @returns {Array<object>} FormFieldDescriptors
 */
function parseHtmlFormToDescriptors(html) {
  const descriptors = [];
  
  // Find all field rows or form-item containers
  // Match input, textarea, select, or role="combobox"
  const tagRegex = /<(input|textarea|select|div\s+[^>]*role=["']combobox["'])(\s+[^>]*)?(?:\/>|>([\s\S]*?)<\/\1>|>)/gi;
  let match;
  let fieldIdx = 0;

  while ((match = tagRegex.exec(html)) !== null) {
    fieldIdx += 1;
    const tagName = match[1].toLowerCase().startsWith("div") ? "div" : match[1].toLowerCase();
    const rawAttrs = match[2] || "";
    const innerContent = match[3] || "";

    // Parse attributes
    const getAttr = (attr) => {
      const m = rawAttrs.match(new RegExp(`${attr}=["']([^"']*)["']`, "i"));
      return m ? m[1].trim() : "";
    };

    const id = getAttr("id");
    const name = getAttr("name");
    const type = getAttr("type") || (tagName === "textarea" ? "textarea" : tagName === "select" ? "select" : "text");
    const placeholder = getAttr("placeholder");
    const ariaLabel = getAttr("aria-label");
    const role = getAttr("role");
    const className = getAttr("class");

    if (type === "hidden" || type === "submit" || type === "button") {
      continue;
    }

    // Determine label: Look for <label for="id">...</label> or preceding <label>
    let label = "";
    if (id) {
      const labelForRegex = new RegExp(`<label[^>]*for=["']${id}["'][^>]*>([\\s\\S]*?)<\\/label>`, "i");
      const labelMatch = html.match(labelForRegex);
      if (labelMatch) {
        label = labelMatch[1].replace(/<[^>]+>/g, "").replace(/\*/g, "").trim();
      }
    }

    // If no label by for="", check nearby preceding label within 600 chars before the element
    if (!label) {
      const preContext = html.slice(Math.max(0, match.index - 600), match.index);
      const allLabels = Array.from(preContext.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi));
      if (allLabels.length > 0) {
        const lastLabel = allLabels[allLabels.length - 1];
        label = lastLabel[1].replace(/<[^>]+>/g, "").replace(/\*/g, "").trim();
      }
    }

    // Determine section heading: Look for the closest preceding <legend>, <h2>, <h3>, or .title
    const preSectionContext = html.slice(0, match.index);
    let sectionHeading = "";
    const allHeadings = Array.from(
      preSectionContext.matchAll(/<(?:legend|h[1-4]|div[^>]*class=["'][^"']*(?:title|head-title|module-title|section-title)[^"']*["'])[^>]*>([\s\S]*?)<\/(?:legend|h[1-4]|div)>/gi)
    );
    if (allHeadings.length > 0) {
      const lastHeading = allHeadings[allHeadings.length - 1];
      sectionHeading = lastHeading[1].replace(/<[^>]+>/g, "").trim();
    }

    // Determine if inside a repeater item
    const isRepeaterItem = /repeater-item|resume-block|experience-card|education-card/i.test(
      html.slice(Math.max(0, match.index - 800), match.index)
    );

    descriptors.push({
      fieldId: id || name || `field_${fieldIdx}`,
      tagName,
      controlType: role === "combobox" ? "combobox" : type,
      label: label || ariaLabel || placeholder,
      ariaLabel,
      placeholder,
      nearbyText: innerContent.replace(/<[^>]+>/g, "").trim(),
      sectionHeading,
      name,
      id,
      isRepeaterItem,
      repeaterIndex: isRepeaterItem ? 0 : -1
    });
  }

  return descriptors;
}

// =========================================================================
// Ground Truth Specifications for the 4 ATS Benchmarks
// =========================================================================

// Negative fields that MUST NEVER be recognized as candidate personal info
const NEGATIVE_GROUND_TRUTH = {
  // Greenhouse
  "reference_name": "work.referenceName", // Must not match basic.name
  "reference_phone": "work.referencePhone", // Must not match basic.phone
  "supervisor_title": "work.referenceTitle", // Must not match work.role

  // Workday
  "wd_ice_name": "basic.emergencyContact", // Must not match basic.name
  "wd_ice_phone": "basic.emergencyPhone", // Must not match basic.phone
  "wd_ice_relation": "basic.emergencyRelation",

  // Zhiye
  "zy_ice_name": "basic.emergencyContact", // Must not match basic.name
  "zy_ice_phone": "basic.emergencyPhone", // Must not match basic.phone
  "zy_ice_relation": "basic.emergencyRelation",
  "zy_ref_name": "work.referenceName", // Must not match basic.name
  "zy_ref_phone": "work.referencePhone", // Must not match basic.phone

  // Moka
  "iceName": "basic.emergencyContact", // Must not match basic.name
  "icePhone": "basic.emergencyPhone", // Must not match basic.phone
  "fatherName": "rejected", // Must not match basic.name
  "fatherPhone": "rejected", // Must not match basic.phone
  "motherName": "rejected", // Must not match basic.name
  "refName": "work.referenceName", // Must not match basic.name
  "refPhone": "work.referencePhone", // Must not match basic.phone
  "refEmail": "work.referenceEmail" // Must not match basic.email
};

// Positive ground truth mappings
const POSITIVE_GROUND_TRUTH = {
  // Greenhouse
  "first_name": "basic.firstName",
  "last_name": "basic.lastName",
  "email": "basic.email",
  "phone": "basic.phone",
  "linkedin_url": "basic.homepage",
  "website_url": "basic.homepage",
  "school_name": "education.school",
  "degree": "education.degree",
  "field_of_study": "education.major",
  "edu_start_date": "education.startDate",
  "edu_end_date": "education.endDate",
  "company_name": "work.company",
  "job_title": "work.role",
  "work_start_date": "work.startDate",
  "work_end_date": "work.endDate",
  "job_description": "work.description",

  // Workday
  "wd_first_name": "basic.firstName",
  "wd_last_name": "basic.lastName",
  "wd_email": "basic.email",
  "wd_phone": "basic.phone",
  "wd_city": "basic.currentCity",
  "wd_job_title": "work.role",
  "wd_company": "work.company",
  "wd_work_from": "work.startDate",
  "wd_work_to": "work.endDate",
  "wd_role_desc": "work.description",
  "wd_school": "education.school",
  "wd_degree": "education.degree",
  "wd_field_study": "education.major",
  "wd_gpa": "education.gpa",
  "wd_edu_from": "education.startDate",
  "wd_edu_to": "education.endDate",

  // Zhiye
  "zy_name": "basic.name",
  "zy_gender": "basic.gender",
  "zy_dob": "basic.birthDate",
  "zy_id_card": "basic.idNumber",
  "zy_phone": "basic.phone",
  "zy_email": "basic.email",
  "zy_city": "basic.currentCity",
  "zy_hometown": "basic.nativePlace",
  "zy_school": "education.school",
  "zy_major": "education.major",
  "zy_degree": "education.degree",
  "zy_edu_start": "education.startDate",
  "zy_edu_end": "education.endDate",
  "zy_gpa": "education.gpa",
  "zy_company": "work.company",
  "zy_role": "work.role",
  "zy_work_start": "work.startDate",
  "zy_work_end": "work.endDate",
  "zy_work_desc": "work.description",
  "zy_proj_name": "project.name",
  "zy_proj_role": "project.role",
  "zy_proj_desc": "project.description",

  // Moka
  "candidateName": "basic.name",
  "phoneNumber": "basic.phone",
  "emailAddress": "basic.email",
  "residentCity": "basic.currentCity",
  "highestDegree": "basic.highestDegree",
  "workYears": "basic.workYears",
  "eduSchool": "education.school",
  "eduMajor": "education.major",
  "eduDegree": "education.degree",
  "eduStart": "education.startDate",
  "eduEnd": "education.endDate",
  "workCompany": "work.company",
  "workRole": "work.role",
  "workDept": "work.department",
  "workStart": "work.startDate",
  "workEnd": "work.endDate",
  "workDesc": "work.description",
  "targetCity": "basic.expectedCity",
  "targetSalary": "basic.expectedSalary"
};

// Candidate personal basic & self targets that must NEVER receive negative fields
const CANDIDATE_SELF_TARGETS = new Set([
  "basic.name",
  "basic.firstName",
  "basic.lastName",
  "basic.phone",
  "basic.email",
  "basic.idNumber",
  "work.role",
  "work.company"
]);

async function runAtsBenchmark() {
  const fixtureFiles = [
    { name: "Greenhouse Application", file: "greenhouse_apply.html" },
    { name: "Workday Candidate Form", file: "workday_form.html" },
    { name: "Zhiye / Beisen Campus Recruitment", file: "zhiye_campus.html" },
    { name: "Moka HR Form", file: "moka_application.html" }
  ];

  let totalGroundTruth = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let totalPredictions = 0;
  let negativeAttempts = 0;
  let negativeViolations = 0;

  for (const item of fixtureFiles) {
    const fullPath = path.join(FIXTURES_DIR, item.file);
    assert.ok(fs.existsSync(fullPath), `Fixture file must exist: ${item.file}`);

    const html = fs.readFileSync(fullPath, "utf8");
    const descriptors = parseHtmlFormToDescriptors(html);
    assert.ok(descriptors.length > 5, `Fixture ${item.file} should yield form descriptors, got ${descriptors.length}`);

    console.log(`\nEvaluating ${item.name} (${descriptors.length} fields detected)...`);

    for (const desc of descriptors) {
      const key = desc.fieldId;
      const matchResult = matchFieldKnowledge(desc);
      const isNegativeField = key in NEGATIVE_GROUND_TRUTH;
      const isPositiveField = key in POSITIVE_GROUND_TRUTH;

      // 1. Evaluate Negative Keyword Exclusion
      if (isNegativeField) {
        negativeAttempts += 1;
        // Check if erroneously matched candidate personal info or self experience targets
        if (matchResult.matched && CANDIDATE_SELF_TARGETS.has(matchResult.target)) {
          negativeViolations += 1;
          console.error(`  ❌ VIOLATION: Negative field '${key}' (label: "${desc.label}") erroneously matched candidate target '${matchResult.target}'!`);
        } else {
          console.log(`  ✔ Negative excluded: '${key}' ("${desc.label}") => not candidate personal info (${matchResult.target || "rejected"})`);
        }
      }

      // 2. Evaluate Positive Field Accuracy
      if (isPositiveField) {
        totalGroundTruth += 1;
        const expectedTarget = POSITIVE_GROUND_TRUTH[key];

        if (matchResult.matched) {
          totalPredictions += 1;
          if (matchResult.target === expectedTarget) {
            truePositives += 1;
            console.log(`  ✔ Correct match: '${key}' ("${desc.label}") => ${matchResult.target} (conf: ${matchResult.confidence})`);
          } else {
            falsePositives += 1;
            console.warn(`  ⚠️ Target mismatch: '${key}' ("${desc.label}") => expected '${expectedTarget}', got '${matchResult.target}'`);
          }
        } else {
          console.warn(`  ⚠️ Missed field: '${key}' ("${desc.label}") => expected '${expectedTarget}'`);
        }
      }
    }
  }

  // Calculate Metrics
  const precision = totalPredictions > 0 ? (truePositives / totalPredictions) : 0;
  const recall = totalGroundTruth > 0 ? (truePositives / totalGroundTruth) : 0;
  const negativeExclusionRate = negativeAttempts > 0 ? ((negativeAttempts - negativeViolations) / negativeAttempts) : 1;

  console.log("\n==================================================================");
  console.log("  ATS Benchmark Evaluation Results:                               ");
  console.log("==================================================================");
  console.log(`  Total Evaluated Benchmark Fields: ${totalGroundTruth}`);
  console.log(`  True Positives (Correct Matches): ${truePositives}`);
  console.log(`  Precision                       : ${(precision * 100).toFixed(2)}%`);
  console.log(`  Recall                          : ${(recall * 100).toFixed(2)}%`);
  console.log(`  Negative Fields Tested          : ${negativeAttempts}`);
  console.log(`  Negative Violations             : ${negativeViolations}`);
  console.log(`  Negative Exclusion Rate         : ${(negativeExclusionRate * 100).toFixed(2)}%`);
  console.log("==================================================================");

  // Assertions
  assert.equal(negativeViolations, 0, "Negative Exclusion MUST be 100% (0 violations allowed)");
  assert.ok(precision >= 0.90, `Precision must be >= 90%, actual: ${(precision * 100).toFixed(2)}%`);
  assert.ok(recall >= 0.90, `Recall must be >= 90%, actual: ${(recall * 100).toFixed(2)}%`);
  console.log("🎉 ATS Benchmark Suite Passed! All Precision, Recall and Negative gates satisfied.\n");
}

await runAtsBenchmark();
