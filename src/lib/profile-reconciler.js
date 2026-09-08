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
    const school = normVal["学校"] || normVal["学校名称"] || normVal["毕业院校"] || normVal["院校"] || normVal["大学"] || normVal["school"] || normVal["university"] || normVal["college"] || normVal["institution"];
    if (school) {
      normVal["学校"] = school;
      normVal["学校名称"] = school;
    }
    const major = normVal["专业"] || normVal["专业名称"] || normVal["所学专业"] || normVal["major"] || normVal["discipline"] || normVal["subject"];
    if (major) {
      normVal["专业"] = major;
    }
    const degree = normVal["学历"] || normVal["学历层次"] || normVal["学历学位"] || normVal["学位"] || normVal["degree"] || normVal["education_level"];
    if (degree) {
      normVal["学历"] = degree;
    }
    const startTime = normVal["开始时间"] || normVal["起始时间"] || normVal["入学时间"] || normVal["入学年月"] || normVal["开始年月"] || normVal["start_time"] || normVal["startDate"] || normVal["start_date"] || normVal["from"];
    if (startTime) {
      normVal["开始时间"] = startTime;
      normVal["起始时间"] = startTime;
    }
    const endTime = normVal["结束时间"] || normVal["毕业时间"] || normVal["毕业年月"] || normVal["结束年月"] || normVal["end_time"] || normVal["endDate"] || normVal["end_date"] || normVal["to"];
    if (endTime) {
      normVal["结束时间"] = endTime;
    }
    const desc = normVal["专业描述"] || normVal["学习描述"] || normVal["主修课程"] || normVal["description"] || normVal["courses"];
    if (desc && !normVal["专业描述"]) {
      normVal["专业描述"] = desc;
    }
  } else if (sectionKey === "work" || sectionKey === "internship") {
    const company = normVal["公司"] || normVal["公司名称"] || normVal["单位名称"] || normVal["工作单位"] || normVal["企业名称"] || normVal["company"] || normVal["company_name"] || normVal["organization"] || normVal["employer"];
    if (company) {
      normVal["公司"] = company;
      normVal["公司名称"] = company;
    }
    const position = normVal["职位"] || normVal["职位名称"] || normVal["担任职位"] || normVal["岗位名称"] || normVal["岗位"] || normVal["position"] || normVal["title"] || normVal["job_title"] || normVal["role"];
    if (position) {
      normVal["职位"] = position;
      normVal["职位名称"] = position;
    }
    const dept = normVal["部门"] || normVal["所属部门"] || normVal["部门名称"] || normVal["department"];
    if (dept) {
      normVal["部门"] = dept;
    }
    const startTime = normVal["开始时间"] || normVal["起始时间"] || normVal["入职时间"] || normVal["入职年月"] || normVal["开始年月"] || normVal["start_time"] || normVal["startDate"] || normVal["start_date"] || normVal["from"];
    if (startTime) {
      normVal["开始时间"] = startTime;
      normVal["起始时间"] = startTime;
    }
    const endTime = normVal["结束时间"] || normVal["离职时间"] || normVal["离职年月"] || normVal["结束年月"] || normVal["end_time"] || normVal["endDate"] || normVal["end_date"] || normVal["to"];
    if (endTime) {
      normVal["结束时间"] = endTime;
    }
    const workDesc = normVal["工作内容"] || normVal["工作描述"] || normVal["工作职责"] || normVal["职责描述"] || normVal["主要职责"] || normVal["description"] || normVal["responsibilities"] || normVal["content"];
    if (workDesc) {
      normVal["工作内容"] = workDesc;
      normVal["工作描述"] = workDesc;
    }
  } else if (sectionKey === "project") {
    const projName = normVal["项目名称"] || normVal["project_name"] || normVal["projectName"] || normVal["name"];
    if (projName) {
      normVal["项目名称"] = projName;
    }
    const role = normVal["项目角色"] || normVal["担任角色"] || normVal["role"] || normVal["position"];
    if (role) {
      if (!normVal["职位"]) normVal["职位"] = role;
      if (!normVal["本人职责"]) normVal["本人职责"] = role;
    }
    const projDesc = normVal["项目内容"] || normVal["项目描述"] || normVal["项目介绍"] || normVal["description"] || normVal["content"];
    if (projDesc) {
      normVal["项目内容"] = projDesc;
      normVal["项目描述"] = projDesc;
    }
    const result = normVal["项目成果"] || normVal["主要业绩"] || normVal["业绩"] || normVal["achievements"] || normVal["outcome"] || normVal["result"];
    if (result) {
      normVal["项目成果"] = result;
      normVal["主要业绩"] = result;
    }
    const startTime = normVal["开始时间"] || normVal["起始时间"] || normVal["开始年月"] || normVal["start_time"] || normVal["startDate"] || normVal["start_date"] || normVal["from"];
    if (startTime) {
      normVal["开始时间"] = startTime;
      normVal["起始时间"] = startTime;
    }
    const endTime = normVal["结束时间"] || normVal["结束年月"] || normVal["end_time"] || normVal["endDate"] || normVal["end_date"] || normVal["to"];
    if (endTime) {
      normVal["结束时间"] = endTime;
    }
  } else if (sectionKey === "computer") {
    const skillName = normVal["证书名称（技能名称）"] || normVal["技能名称"] || normVal["技能"] || normVal["IT技能"] || normVal["技术"] || normVal["name"] || normVal["skill"] || normVal["skill_name"] || normVal["technology"] || normVal["tech"];
    if (skillName) {
      normVal["证书名称（技能名称）"] = skillName;
    }
    const level = normVal["掌握程度"] || normVal["熟练度"] || normVal["熟练程度"] || normVal["level"] || normVal["proficiency"];
    if (level) {
      normVal["掌握程度"] = level;
    }
  } else if (sectionKey === "language") {
    const lang = normVal["外语种类"] || normVal["语种"] || normVal["语言"] || normVal["language"] || normVal["lang"];
    if (lang) {
      normVal["外语种类"] = lang;
    }
    const cert = normVal["证书名称（技能名称）"] || normVal["证书名称"] || normVal["证书"] || normVal["考试"] || normVal["cert"] || normVal["exam"];
    if (cert) {
      normVal["证书名称（技能名称）"] = cert;
    }
    const score = normVal["成绩"] || normVal["分数"] || normVal["得分"] || normVal["score"] || normVal["grade"];
    if (score) {
      normVal["成绩"] = score;
    }
    const level = normVal["掌握程度"] || normVal["水平"] || normVal["熟练程度"] || normVal["level"] || normVal["proficiency"];
    if (level) {
      normVal["掌握程度"] = level;
    }
  } else if (sectionKey === "awards") {
    const awardName = normVal["奖惩名称"] || normVal["奖项名称"] || normVal["荣誉名称"] || normVal["奖励名称"] || normVal["奖项"] || normVal["荣誉"] || normVal["name"] || normVal["award"] || normVal["honor"] || normVal["title"];
    if (awardName) {
      normVal["奖惩名称"] = awardName;
    }
    const awardTime = normVal["奖惩时间"] || normVal["获奖时间"] || normVal["时间"] || normVal["date"] || normVal["time"] || normVal["year"];
    if (awardTime) {
      normVal["奖惩时间"] = awardTime;
    }
    const issuer = normVal["颁奖单位"] || normVal["授奖单位"] || normVal["颁发机构"] || normVal["发证机构"] || normVal["issuer"] || normVal["organization"];
    if (issuer) {
      normVal["颁奖单位"] = issuer;
    }
    const level = normVal["奖励等级"] || normVal["等级"] || normVal["level"];
    if (level) {
      normVal["奖励等级"] = level;
    }
    const desc = normVal["奖惩描述"] || normVal["描述"] || normVal["说明"] || normVal["description"];
    if (desc) {
      normVal["奖惩描述"] = desc;
    }
  } else if (sectionKey === "certificates") {
    const certName = normVal["证书名称（技能名称）"] || normVal["证书名称"] || normVal["证书"] || normVal["name"] || normVal["certificate_name"] || normVal["cert_name"];
    if (certName) {
      normVal["证书名称（技能名称）"] = certName;
    }
    const certTime = normVal["证书获得时间"] || normVal["获得时间"] || normVal["发证时间"] || normVal["date"] || normVal["issue_date"] || normVal["time"];
    if (certTime) {
      normVal["证书获得时间"] = certTime;
    }
    const issuer = normVal["授予单位"] || normVal["发证机构"] || normVal["颁发单位"] || normVal["issuer"] || normVal["organization"];
    if (issuer) {
      normVal["授予单位"] = issuer;
    }
    const certNo = normVal["证书编号"] || normVal["编号"] || normVal["number"] || normVal["cert_no"] || normVal["id"];
    if (certNo) {
      normVal["证书编号"] = certNo;
    }
  } else if (sectionKey === "self") {
    const selfDesc = normVal["自我评价"] || normVal["自我描述"] || normVal["个人评价"] || normVal["个人总结"] || normVal["自我总结"] || normVal["个人优势"] || normVal["self_evaluation"] || normVal["summary"] || normVal["evaluation"] || normVal["introduction"] || normVal["bio"] || normVal["content"];
    if (selfDesc) {
      normVal["自我评价"] = selfDesc;
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
