/**
 * OpenJobAutofill - Profile Reconciler Engine
 * 
 * Implements non-destructive reconciliation between local profile data and
 * external AI-extracted sections.
 * 
 * Rules:
 * 1. PII Immunity: Local high-confidence PII is never overwritten by AI.
 * 2. Non-destructive repeaters: Unmatched local items are 100% preserved.
 * 3. Non-duplicative enrichment: Matched items enrich missing fields without duplicating entries.
 * 4. Schema Compliance: Output is strictly validated against ProfileV2 schema.
 */

import {
  normalizeProfileV2,
  assertProfileV2Schema,
  STANDARD_SECTION_DEFINITIONS,
  STANDARD_SECTION_KEYS
} from "./resume-schema.js";

function isPlainObject(val) {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

/**
 * Normalizes field aliases commonly returned by AI models to match standard editor field keys.
 * 
 * @param {string} sectionKey 
 * @param {object} values 
 * @returns {object} Normalized values
 */
export function normalizeAiFieldAliases(sectionKey, values = {}) {
  const normVal = { ...values };

  if (sectionKey === "education") {
    if (normVal["学校名称"] && !normVal["学校"]) normVal["学校"] = normVal["学校名称"];
    if (normVal["学校"] && !normVal["学校名称"]) normVal["学校名称"] = normVal["学校"];
    if (normVal["起始时间"] && !normVal["开始时间"]) normVal["开始时间"] = normVal["起始时间"];
    if (normVal["开始时间"] && !normVal["起始时间"]) normVal["起始时间"] = normVal["开始时间"];
  } else if (sectionKey === "work" || sectionKey === "internship") {
    if (normVal["公司名称"] && !normVal["公司"]) normVal["公司"] = normVal["公司名称"];
    if (normVal["公司"] && !normVal["公司名称"]) normVal["公司名称"] = normVal["公司"];
    if (normVal["职位名称"] && !normVal["职位"]) normVal["职位"] = normVal["职位名称"];
    if (normVal["职位"] && !normVal["职位名称"]) normVal["职位名称"] = normVal["职位"];
    if (normVal["工作描述"] && !normVal["工作内容"]) normVal["工作内容"] = normVal["工作描述"];
    if (normVal["工作内容"] && !normVal["工作描述"]) normVal["工作描述"] = normVal["工作内容"];
  } else if (sectionKey === "project") {
    if (normVal["项目描述"] && !normVal["项目内容"]) normVal["项目内容"] = normVal["项目描述"];
    if (normVal["项目内容"] && !normVal["项目描述"]) normVal["项目描述"] = normVal["项目内容"];
    if (normVal["主要业绩"] && !normVal["项目成果"]) normVal["项目成果"] = normVal["主要业绩"];
    if (normVal["项目成果"] && !normVal["主要业绩"]) normVal["主要业绩"] = normVal["项目成果"];
    if (normVal["项目角色"]) {
      if (!normVal["职位"]) normVal["职位"] = normVal["项目角色"];
      if (!normVal["本人职责"]) normVal["本人职责"] = normVal["项目角色"];
    }
  }

  return normVal;
}

/**
 * Checks whether an AI item matches an existing local item in the same section.
 * 
 * @param {object} localItem 
 * @param {object} aiItem 
 * @param {string} sectionKey 
 * @returns {boolean}
 */
export function isMatchingItem(localItem, aiItem, sectionKey) {
  if (!localItem || !aiItem) return false;
  const lVal = localItem.values || {};
  const aVal = aiItem.values || {};

  if (sectionKey === "education") {
    const lSchool = (lVal["学校"] || lVal["学校名称"] || "").toLowerCase().trim();
    const aSchool = (aVal["学校"] || aVal["学校名称"] || "").toLowerCase().trim();
    if (lSchool && aSchool && (lSchool.includes(aSchool) || aSchool.includes(lSchool))) {
      return true;
    }
    const lDate = (lVal["开始时间"] || lVal["起始时间"] || "").trim();
    const aDate = (aVal["开始时间"] || aVal["起始时间"] || "").trim();
    if (lDate && aDate && lDate === aDate) {
      return true;
    }
    return false;
  }

  if (sectionKey === "work" || sectionKey === "internship") {
    const lCompany = (lVal["公司"] || lVal["公司名称"] || "").toLowerCase().trim();
    const aCompany = (aVal["公司"] || aVal["公司名称"] || "").toLowerCase().trim();
    if (lCompany && aCompany && (lCompany.includes(aCompany) || aCompany.includes(lCompany))) {
      return true;
    }
    const lDate = (lVal["开始时间"] || lVal["起始时间"] || "").trim();
    const aDate = (aVal["开始时间"] || aVal["起始时间"] || "").trim();
    if (lDate && aDate && lDate === aDate) {
      return true;
    }
    return false;
  }

  if (sectionKey === "project") {
    const lProj = (lVal["项目名称"] || "").toLowerCase().trim();
    const aProj = (aVal["项目名称"] || "").toLowerCase().trim();
    if (lProj && aProj && (lProj.includes(aProj) || aProj.includes(lProj))) {
      return true;
    }
    const lDate = (lVal["开始时间"] || lVal["起始时间"] || "").trim();
    const aDate = (aVal["开始时间"] || aVal["起始时间"] || "").trim();
    if (lDate && aDate && lDate === aDate) {
      return true;
    }
    return false;
  }

  // Generic title match for other repeater sections (awards, languages, etc.)
  const lTitle = (localItem.title || "").toLowerCase().trim();
  const aTitle = (aiItem.title || "").toLowerCase().trim();
  if (lTitle && aTitle && (lTitle === aTitle || lTitle.includes(aTitle) || aTitle.includes(lTitle))) {
    return true;
  }

  return false;
}

/**
 * Reconciles items of a repeater section non-destructively:
 * - 100% of unmatched local items are preserved.
 * - Matched items are enriched (local non-empty values take precedence).
 * - Unmatched AI items are appended.
 * 
 * @param {Array} localItems 
 * @param {Array} aiItems 
 * @param {string} sectionKey 
 * @returns {Array} Reconciled items
 */
export function reconcileRepeaterItems(localItems = [], aiItems = [], sectionKey = "") {
  const reconciled = [];
  const matchedAiIndices = new Set();

  // 1. Process each local item: find match in AI items or preserve as-is
  for (const localItem of localItems) {
    let matchedAiItem = null;
    for (let i = 0; i < aiItems.length; i++) {
      if (matchedAiIndices.has(i)) continue;
      if (isMatchingItem(localItem, aiItems[i], sectionKey)) {
        matchedAiItem = aiItems[i];
        matchedAiIndices.add(i);
        break;
      }
    }

    if (!matchedAiItem) {
      // 100% preserve unmatched local item
      reconciled.push((typeof structuredClone === "function") ? structuredClone(localItem) : JSON.parse(JSON.stringify(localItem)));
    } else {
      // Enrich matched item: local values take precedence, AI fills in missing blanks
      const lValues = localItem.values || {};
      const aValues = normalizeAiFieldAliases(sectionKey, matchedAiItem.values || {});
      const mergedValues = { ...aValues };

      for (const [k, v] of Object.entries(lValues)) {
        const valStr = String(v == null ? "" : v).trim();
        if (valStr) {
          mergedValues[k] = valStr; // Local non-empty value strictly preserved
        }
      }

      reconciled.push({
        title: localItem.title || matchedAiItem.title || `${sectionKey} ${reconciled.length + 1}`,
        values: mergedValues,
        custom: Array.isArray(localItem.custom) && localItem.custom.length > 0
          ? localItem.custom
          : (matchedAiItem.custom || [])
      });
    }
  }

  // 2. Append remaining unmatched AI items
  for (let i = 0; i < aiItems.length; i++) {
    if (!matchedAiIndices.has(i)) {
      const aItem = aiItems[i];
      const aValues = normalizeAiFieldAliases(sectionKey, aItem.values || {});
      reconciled.push({
        title: aItem.title || aValues["学校"] || aValues["公司"] || aValues["项目名称"] || `${sectionKey} ${reconciled.length + 1}`,
        values: aValues,
        custom: aItem.custom || []
      });
    }
  }

  return reconciled;
}

/**
 * Reconciles an entire ProfileV2 with AI sections non-destructively.
 * Enforces PII immunity on basic fields and produces schema-validated output.
 * 
 * @param {object} localProfile 
 * @param {object} aiSections 
 * @returns {object} Canonical reconciled ProfileV2
 */
export function reconcileProfiles(localProfile, aiSections) {
  const base = normalizeProfileV2(localProfile);
  if (!isPlainObject(aiSections)) {
    return base;
  }

  const resultSections = { ...base.sections };

  // Iterate over AI returned sections
  for (const [secKey, aiSec] of Object.entries(aiSections)) {
    // 1. PII Immunity: Ignore AI basic section completely to protect identity
    if (secKey === "basic") {
      continue;
    }

    if (!isPlainObject(aiSec)) continue;

    const standardDef = STANDARD_SECTION_DEFINITIONS[secKey];
    const isRepeat = standardDef ? standardDef.kind === "repeat" : aiSec.kind === "repeat";

    if (isRepeat && Array.isArray(aiSec.items)) {
      const existingItems = resultSections[secKey]?.items || [];
      const mergedItems = reconcileRepeaterItems(existingItems, aiSec.items, secKey);
      resultSections[secKey] = {
        key: secKey,
        title: resultSections[secKey]?.title || standardDef?.title || aiSec.title || secKey,
        kind: "repeat",
        items: mergedItems
      };
    } else if (!isRepeat && isPlainObject(aiSec.values)) {
      // Simple section (e.g. self, declarations, other)
      const existingValues = resultSections[secKey]?.values || {};
      const mergedValues = { ...existingValues };

      for (const [k, v] of Object.entries(aiSec.values)) {
        const valStr = String(v == null ? "" : v).trim();
        // If local value is empty, enrich with AI value
        if (!mergedValues[k] && valStr) {
          mergedValues[k] = valStr;
        }
      }

      resultSections[secKey] = {
        key: secKey,
        title: resultSections[secKey]?.title || standardDef?.title || aiSec.title || secKey,
        kind: "simple",
        values: mergedValues,
        custom: resultSections[secKey]?.custom || []
      };
    }
  }

  const reconciledProfile = {
    ...base,
    sections: resultSections,
    updatedAt: new Date().toISOString()
  };

  const canonical = normalizeProfileV2(reconciledProfile);
  assertProfileV2Schema(canonical);
  return canonical;
}
