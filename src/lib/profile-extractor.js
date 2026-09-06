/**
 * OpenJobAutofill - Full Automated Local Resume Profile Extractor and PII Isolator
 */

import { redactPii } from "./pii-redactor.js";
import { reconcileProfiles } from "./profile-reconciler.js";

/**
 * Education degree weight ranks for calculating highest degree accurately.
 */
export const DEGREE_RANKS = Object.freeze([
  { pattern: /(?:博士后|博士研究生|博士|PhD)/i, degree: "博士", weight: 5 },
  { pattern: /(?:硕士研究生|硕士|MBA|EMBA|Master)/i, degree: "硕士", weight: 4 },
  { pattern: /(?:本科|学士|双学士|Bachelor)/i, degree: "本科", weight: 3 },
  { pattern: /(?:大专|专科|高职|高职高专)/i, degree: "大专", weight: 2 },
  { pattern: /(?:高中|中专|中技)/i, degree: "高中", weight: 1 }
]);

/**
 * Extracts highest degree from text by weight ranking.
 * Prevents picking lower degrees when multiple degrees or chronological orders are mentioned.
 * 
 * @param {string} text 
 * @returns {string} Highest degree name
 */
export function extractHighestDegree(text) {
  if (typeof text !== "string" || !text.trim()) return "";

  // 1. Explicit label check takes precedence if formatted as 最高学历：xxx
  const labeled = text.match(/(?:最高学历|学历)[:：\s]*(博士后|博士研究生|硕士研究生|博士|硕士|本科|大专|专科|高中|中专)/);
  if (labeled) {
    return labeled[1].trim();
  }

  // 2. Rank calculation across whole text
  let maxWeight = 0;
  let bestDegree = "";

  const allMatches = text.matchAll(/(博士后|博士研究生|硕士研究生|博士|硕士|本科|大专|专科|学士|双学士|高中|中专)/g);
  for (const match of allMatches) {
    const term = match[1];
    for (const rank of DEGREE_RANKS) {
      if (rank.pattern.test(term)) {
        if (rank.weight > maxWeight) {
          maxWeight = rank.weight;
          bestDegree = term;
        }
        break;
      }
    }
  }

  return bestDegree;
}

export function extractLocalProfileAndPii(rawText) {
  const text = String(rawText || "").trim();
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const pii = {
    "姓名": "",
    "电话": "",
    "邮箱": "",
    "性别": "",
    "出生日期": "",
    "最高学历": "",
    "当前居住地": "",
    "政治面貌": ""
  };

  // 1. Phone extraction (11-digit Chinese mobile or international format)
  const phoneMatch = text.match(/(?:(?:\+|00)86[- ]?)?(1[3-9]\d{9})\b/);
  if (phoneMatch) {
    pii["电话"] = phoneMatch[1];
  } else {
    const telMatch = text.match(/(?:电话|手机|联系方式|TEL)[:：\s]*(\+?[0-9-]{7,18})/i);
    if (telMatch) {
      pii["电话"] = telMatch[1].trim();
    }
  }

  // 2. Email extraction
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  if (emailMatch) {
    pii["邮箱"] = emailMatch[0];
  }

  // 3. Gender extraction
  if (/(?:^|\s|性别[:：]\s*)(男|女)(?:\s|$)/.test(text)) {
    const m = text.match(/(?:^|\s|性别[:：]\s*)(男|女)(?:\s|$)/);
    pii["性别"] = m ? m[1] : "";
  }

  // 4. Highest Education degree by rank
  pii["最高学历"] = extractHighestDegree(text);

  // 5. Name extraction
  const labeledName = text.match(/(?:姓名|Name)[:：\s]*([\u4e00-\u9fa5]{2,4}|[A-Za-z\s]{2,20})/i);
  if (labeledName && !/^(个人简历|求职简历|基本信息|工作经历)$/.test(labeledName[1].trim())) {
    pii["姓名"] = labeledName[1].trim();
  } else {
    for (let i = 0; i < Math.min(rawLines.length, 5); i++) {
      const line = rawLines[i].replace(/\s+/g, "");
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(line) && !/^(个人简历|求职简历|基本信息|工作经历|教育经历|个人信息|联系方式)$/.test(line)) {
        pii["姓名"] = rawLines[i].trim();
        break;
      }
    }
  }

  // 6. Birthday / age
  const birthMatch = text.match(/(?:出生年月|出生日期|生日)[:：]?\s*(\d{4}[-/.年]\d{1,2}[-/.月]?(?:\d{1,2}[日号]?)?)/);
  if (birthMatch) {
    pii["出生日期"] = birthMatch[1].replace(/[年月]/g, "-").replace(/[-.]$/, "").replace(/日|号/, "");
  }

  // 7. City / Location
  const cityMatch = text.match(/(?:现居|现居住城市|城市|住址|常住地|现居住地)[:：\s]*([\u4e00-\u9fa5]{2,10}(?:市|省|区)?)/);
  if (cityMatch) {
    pii["当前居住地"] = cityMatch[1].trim();
  }

  // 8. Political status
  const poliMatch = text.match(/(?:政治面貌)[:：\s]*(中共党员|中共预备党员|共青团员|群众|民主党派)/);
  if (poliMatch) {
    pii["政治面貌"] = poliMatch[1];
  }

  // 9. Job intention
  let intentionRole = "";
  let intentionCity = "";
  let intentionSalary = "";
  const roleMatch = text.match(/(?:求职意向|期望职位|应聘职位|目标岗位|期望岗位|意向岗位)[:：\s]*([^\n\r,，。]+)/);
  if (roleMatch) intentionRole = roleMatch[1].trim();
  const intentCityMatch = text.match(/(?:期望城市|工作地点|意向城市|期望工作城市)[:：\s]*([^\n\r,，。]+)/);
  if (intentCityMatch) intentionCity = intentCityMatch[1].trim();
  const salaryMatch = text.match(/(?:期望薪资|期望月薪|薪资要求)[:：\s]*([^\n\r,，。]+)/);
  if (salaryMatch) intentionSalary = salaryMatch[1].trim();

  // Prepare isolated experience text by redacting phone and email safely with literal replacement
  const { redactedText } = redactPii(text, {
    "电话": pii["电话"],
    "邮箱": pii["邮箱"]
  });
  const experienceText = redactedText;

  // Construct initial local ProfileV2 structure
  const now = new Date().toISOString();
  const candidateName = pii["姓名"] || "未命名";
  const localProfile = {
    schemaVersion: 2,
    updatedAt: now,
    sections: {
      basic: {
        key: "basic",
        title: "基本信息",
        kind: "simple",
        values: {
          "姓名": pii["姓名"] || "",
          "简历名称": `${candidateName}-简历`,
          "性别": pii["性别"] || "",
          "电话": pii["电话"] || "",
          "邮箱": pii["邮箱"] || "",
          "出生日期": pii["出生日期"] || "",
          "最高学历": pii["最高学历"] || "",
          "当前居住地": pii["当前居住地"] || "",
          "现居住城市": pii["当前居住地"] || "",
          "政治面貌": pii["政治面貌"] || ""
        },
        custom: []
      },
      intention: {
        key: "intention",
        title: "求职意向",
        kind: "repeat",
        items: [
          {
            title: "求职意向 1",
            values: {
              "意向岗位": intentionRole,
              "期望工作城市": intentionCity,
              "期望薪资": intentionSalary
            },
            custom: []
          }
        ]
      },
      education: {
        key: "education",
        title: "教育经历",
        kind: "repeat",
        items: []
      },
      internship: {
        key: "internship",
        title: "实习经历",
        kind: "repeat",
        items: []
      },
      work: {
        key: "work",
        title: "工作经历",
        kind: "repeat",
        items: []
      },
      project: {
        key: "project",
        title: "项目经历/实践活动",
        kind: "repeat",
        items: []
      },
      computer: {
        key: "computer",
        title: "计算机技能（IT技能）",
        kind: "repeat",
        items: []
      },
      language: {
        key: "language",
        title: "外语能力",
        kind: "repeat",
        items: []
      },
      certificates: {
        key: "certificates",
        title: "证书",
        kind: "repeat",
        items: []
      },
      awards: {
        key: "awards",
        title: "奖惩情况",
        kind: "repeat",
        items: []
      },
      self: {
        key: "self",
        title: "自我描述",
        kind: "simple",
        values: {
          "自我评价": ""
        },
        custom: []
      }
    },
    customSections: []
  };

  // Run comprehensive multi-section segmentation
  parseFullSections(rawLines, localProfile);

  return {
    localProfile,
    profileV2: localProfile,
    piiSummary: pii,
    pii,
    experienceText: experienceText.trim(),
    cleanText: experienceText.trim()
  };
}

/**
 * Robust Multi-Section Segmenter: Extracts Education, Work, Project, Skills, Awards, Languages
 */
export const SECTION_HEADERS = Object.freeze([
  { key: "education", regex: /^(?:教育经历|教育背景|学历信息|就读经历|学习经历|教育信息)/ },
  { key: "internship", regex: /^(?:实习经历|实习经验|学生实践)/ },
  { key: "work", regex: /^(?:工作经历|工作经验|职业经历|从业经历|工作信息)/ },
  { key: "project", regex: /^(?:项目经历|项目经验|科研经历|个人项目|项目)/ },
  { key: "computer", regex: /^(?:专业技能|技能特长|个人技能|IT技能|计算机技能|专业技术|技能清单)/ },
  { key: "language", regex: /^(?:外语能力|语言能力|外语水平|英语水平)/ },
  { key: "certificates", regex: /^(?:证书|执照|资质证书|职业资格|资格证书)/ },
  { key: "awards", regex: /^(?:荣誉成果|奖惩情况|所获奖项|奖学金与荣誉|个人荣誉|奖励与荣誉|获奖经历)/ },
  { key: "self", regex: /^(?:自我评价|个人优势|自我介绍|个人总结|个人简介)/ }
]);

export function detectSectionHeader(line) {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Match leading symbols e.g. #, *, -, •, 【, [, numbers like 1., 一、
  const headerMatch = trimmed.match(/^[#*\-•\s【\[]*(?:一|二|三|四|五|六|七|八|九|十|\d+)?(?:[、.．\s])*\s*([^\s:：\]】]{2,12})[】\]\s:：]*(.*)$/);
  if (!headerMatch) return null;

  const titleCandidate = headerMatch[1].trim();
  const remainder = headerMatch[2]?.trim() || "";

  for (const h of SECTION_HEADERS) {
    if (h.regex.test(titleCandidate)) {
      return { key: h.key, remainder };
    }
  }

  return null;
}

export function preprocessResumeLines(lines) {
  if (!Array.isArray(lines)) return [];
  const result = [];
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;

    // Filter out Markdown table divider rows e.g. |---|---| or |:---:|
    if (/^\|?[-:\s|]+\|?$/.test(line)) {
      continue;
    }

    // Process table row with multiple | cells
    if (line.includes("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length > 1) {
        result.push(cells.join("  "));
        continue;
      }
    }

    result.push(line);
  }
  return result;
}

/**
 * Robust Multi-Section Segmenter: Extracts Education, Work, Project, Skills, Awards, Languages
 */
function parseFullSections(lines, profile) {
  const normalizedLines = preprocessResumeLines(lines);
  let currentKey = null;
  const blocks = {};

  for (const line of normalizedLines) {
    const headerMatch = detectSectionHeader(line);
    if (headerMatch) {
      currentKey = headerMatch.key;
      if (!blocks[currentKey]) blocks[currentKey] = [];
      if (headerMatch.remainder) {
        blocks[currentKey].push(headerMatch.remainder);
      }
      continue;
    }

    if (currentKey) {
      blocks[currentKey].push(line);
    }
  }

  // 1. Process Education Entries
  if (blocks.education?.length) {
    profile.sections.education.items = parseEducationEntries(blocks.education, profile.sections.basic.values["最高学历"]);
  }

  // 2. Process Internship Entries
  if (blocks.internship?.length) {
    profile.sections.internship.items = parseWorkEntries(blocks.internship, "实习经历");
  }

  // 3. Process Work Entries
  if (blocks.work?.length) {
    profile.sections.work.items = parseWorkEntries(blocks.work, "工作经历");
  }

  // 4. Process Project Entries
  if (blocks.project?.length) {
    profile.sections.project.items = parseProjectEntries(blocks.project);
  }

  // 5. Process Computer / Tech Skills
  if (blocks.computer?.length) {
    profile.sections.computer.items = parseComputerSkills(blocks.computer);
  }

  // 6. Process Languages
  if (blocks.language?.length) {
    profile.sections.language.items = parseLanguageEntries(blocks.language);
  }

  // 7. Process Awards
  if (blocks.awards?.length) {
    profile.sections.awards.items = parseAwardEntries(blocks.awards);
  }

  // 8. Process Certificates
  if (blocks.certificates?.length) {
    profile.sections.certificates.items = parseCertificateEntries(blocks.certificates);
  }

  // 9. Process Self Description
  if (blocks.self?.length) {
    profile.sections.self.values["自我评价"] = blocks.self.join("\n");
  }
}

/**
 * Parses Education entries into multiple structured items with State Machine chunking
 */
function parseEducationEntries(lines, fallbackDegree = "") {
  const items = [];
  const dateRegex = /(\d{4}[./年-]\d{1,2})\s*(?:[-~至到/]\s*(\d{4}[./年-]\d{1,2}|至今|现在|present))?/i;
  const schoolRegex = /([\u4e00-\u9fa5A-Za-z\s]+(?:大学|学院|分校|高等专科学校|中学|学校|University|College))/;
  const degreeRegex = /(博士研究生|硕士研究生|博士|硕士|本科|大专|专科|学士|双学士|MBA|EMBA)/;
  const majorRegex = /([\u4e00-\u9fa5A-Za-z\s]+(?:专业|系|工程|科学|技术|管理|经济|金融|法学|医学|计算机|软件|信息|设计|文学|英语|艺术|数学|物理|化学|生物|机械|电气|自动化|通信|土木|建筑))/;

  // State Machine chunking: avoids splitting when date and school appear on adjacent lines
  const chunks = [];
  let currentChunk = [];
  let chunkHasDate = false;
  let chunkHasSchool = false;

  for (const line of lines) {
    const isBullet = /^[-*•\s]/.test(line);
    const hasDate = dateRegex.test(line);
    const hasSchool = !isBullet && schoolRegex.test(line);

    const isNewEntry = (hasDate && chunkHasDate) ||
                       (hasSchool && chunkHasSchool) ||
                       ((hasDate && hasSchool) && currentChunk.length > 0);

    if (isNewEntry && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      chunkHasDate = false;
      chunkHasSchool = false;
    }

    currentChunk.push(line);
    if (hasDate) chunkHasDate = true;
    if (hasSchool) chunkHasSchool = true;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const fullText = chunk.join(" ");

    let startDate = "";
    let endDate = "";
    const dm = fullText.match(dateRegex);
    if (dm) {
      startDate = dm[1].replace(/[./年]/g, "-").replace(/[-.月]$/, "");
      endDate = dm[2] ? dm[2].replace(/[./年]/g, "-").replace(/[-.月]$/, "") : "至今";
    }

    let school = "";
    for (let j = 0; j < Math.min(chunk.length, 2); j++) {
      if (/^[-*•]/.test(chunk[j])) continue;
      const sm = chunk[j].match(schoolRegex);
      if (sm) {
        school = sm[1].trim();
        break;
      }
    }
    if (!school) {
      const sm = fullText.match(schoolRegex);
      if (sm) school = sm[1].trim();
    }

    let degree = "";
    const degM = fullText.match(degreeRegex);
    if (degM) {
      degree = degM[1].trim();
    } else if (fallbackDegree) {
      degree = fallbackDegree;
    }

    let major = "";
    const mm = fullText.match(majorRegex);
    if (mm) major = mm[1].trim();

    const descLines = [];
    for (let j = 0; j < chunk.length; j++) {
      const l = chunk[j];
      const isPureHeader = (j < 2) && (dateRegex.test(l) || schoolRegex.test(l));
      if (isPureHeader) continue;
      const cleanLine = l.replace(/^[-*•\s]+/, "").replace(/^\d+[.、)）]\s*/, "").trim();
      if (cleanLine) descLines.push(cleanLine);
    }
    const desc = descLines.join("\n");

    items.push({
      title: school ? `${school} (${degree || "教育经历"})` : `教育经历 ${i + 1}`,
      values: {
        "学校": school,
        "学校名称": school,
        "开始时间": startDate,
        "起始时间": startDate,
        "结束时间": endDate,
        "专业": major,
        "学历": degree,
        "学位": degree ? `${degree}学位` : "",
        "专业描述": desc
      },
      custom: []
    });
  }

  return items;
}

/**
 * Parses Work / Internship entries into multiple structured items with State Machine chunking
 */
function parseWorkEntries(lines, defaultLabel = "工作经历") {
  const items = [];
  const dateRegex = /(\d{4}[./年-]\d{1,2})\s*(?:[-~至到/]\s*(\d{4}[./年-]\d{1,2}|至今|现在|present))/i;
  const companyRegex = /([\u4e00-\u9fa5A-Za-z0-9（）()]+(?:公司|集团|事务所|银行|中心|医院|学校|有限|科技|网络|信息|技术|企业|工作室|厂|院|所|局|Corp|Inc|Ltd))/;
  const roleRegex = /([\u4e00-\u9fa5A-Za-z]+(?:工程师|开发|经理|总监|专员|主管|实习生|助理|顾问|分析师|架构师|测试|运维|运营|前端|后端|算法|产品|设计|实习|研究员|专家|负责人))/;

  const chunks = [];
  let currentChunk = [];
  let chunkHasDate = false;
  let chunkHasCompany = false;

  for (const line of lines) {
    const isBullet = /^[-*•\s]/.test(line);
    const hasDate = dateRegex.test(line);
    const hasCompany = !isBullet && companyRegex.test(line);

    const isNewEntry = (hasDate && chunkHasDate) ||
                       (hasCompany && chunkHasCompany) ||
                       ((hasDate && hasCompany) && currentChunk.length > 0);

    if (isNewEntry && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      chunkHasDate = false;
      chunkHasCompany = false;
    }

    currentChunk.push(line);
    if (hasDate) chunkHasDate = true;
    if (hasCompany) chunkHasCompany = true;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const fullText = chunk.join(" ");

    let startDate = "";
    let endDate = "";
    const dm = fullText.match(dateRegex);
    if (dm) {
      startDate = dm[1].replace(/[./年]/g, "-").replace(/[-.月]$/, "");
      endDate = dm[2] ? dm[2].replace(/[./年]/g, "-").replace(/[-.月]$/, "") : "至今";
    }

    let company = "";
    for (let j = 0; j < Math.min(chunk.length, 2); j++) {
      if (/^[-*•]/.test(chunk[j])) continue;
      const cm = chunk[j].match(companyRegex);
      if (cm) {
        company = cm[1].trim();
        break;
      }
    }
    // Positional deduction on header line: [Date] [Company] [Role]
    if (!company && chunk.length > 0 && !/^[-*•]/.test(chunk[0])) {
      const strippedDate = chunk[0].replace(dateRegex, "").trim();
      const strippedBoth = strippedDate.replace(roleRegex, "").trim();
      if (strippedBoth && strippedBoth.length >= 2 && strippedBoth.length <= 30) {
        company = strippedBoth;
      }
    }

    let role = "";
    for (let j = 0; j < Math.min(chunk.length, 2); j++) {
      if (/^[-*•]/.test(chunk[j])) continue;
      const rm = chunk[j].match(roleRegex);
      if (rm) {
        role = rm[1].trim();
        break;
      }
    }
    if (!role) {
      const rm = fullText.match(roleRegex);
      if (rm) role = rm[1].trim();
    }

    const descLines = [];
    for (let j = 0; j < chunk.length; j++) {
      const l = chunk[j];
      const isPureHeader = (j < 2) && (dateRegex.test(l) || companyRegex.test(l));
      if (isPureHeader) continue;
      const cleanLine = l.replace(/^[-*•\s]+/, "").replace(/^\d+[.、)）]\s*/, "").trim();
      if (cleanLine) descLines.push(cleanLine);
    }
    const desc = descLines.join("\n");

    items.push({
      title: company ? `${company} - ${role || defaultLabel}` : `${defaultLabel} ${i + 1}`,
      values: {
        "公司": company,
        "公司名称": company,
        "开始时间": startDate,
        "起始时间": startDate,
        "结束时间": endDate,
        "职位": role,
        "职位名称": role,
        "工作内容": desc,
        "工作描述": desc,
        "工作成果": ""
      },
      custom: []
    });
  }

  return items;
}

/**
 * Parses Project entries into multiple structured items with State Machine chunking
 */
function parseProjectEntries(lines) {
  const items = [];
  const dateRegex = /(\d{4}[./年-]\d{1,2})\s*(?:[-~至到/]\s*(\d{4}[./年-]\d{1,2}|至今|现在|present))?/i;
  const projectRegex = /(?:项目名称[:：]?\s*)?([^\n\r,，。]+(?:系统|平台|项目|App|APP|小程序|设计|开发|重构|工程|工具|算法|模块|组件|服务|架构|框架|引擎|网站))/;

  const chunks = [];
  let currentChunk = [];
  let chunkHasDate = false;
  let chunkHasProject = false;

  for (const line of lines) {
    const isBullet = /^[-*•\s]/.test(line);
    const hasDate = dateRegex.test(line);
    const hasProjectName = !isBullet && projectRegex.test(line);

    const isNewEntry = (hasDate && chunkHasDate) ||
                       (hasProjectName && chunkHasProject) ||
                       ((hasDate && hasProjectName) && currentChunk.length > 0);

    if (isNewEntry && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      chunkHasDate = false;
      chunkHasProject = false;
    }

    currentChunk.push(line);
    if (hasDate) chunkHasDate = true;
    if (hasProjectName) chunkHasProject = true;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const fullText = chunk.join(" ");

    let startDate = "";
    let endDate = "";
    const dm = fullText.match(dateRegex);
    if (dm) {
      startDate = dm[1].replace(/[./年]/g, "-").replace(/[-.月]$/, "");
      endDate = dm[2] ? dm[2].replace(/[./年]/g, "-").replace(/[-.月]$/, "") : "至今";
    }

    let projectName = "";
    for (let j = 0; j < Math.min(chunk.length, 2); j++) {
      if (/^[-*•]/.test(chunk[j])) continue;
      const stripped = chunk[j].replace(dateRegex, "").trim();
      const pm = stripped.match(projectRegex);
      if (pm) {
        projectName = stripped.replace(/^项目名称[:：]?\s*/, "").trim();
        break;
      }
    }
    if (!projectName && chunk.length > 0 && !/^[-*•]/.test(chunk[0])) {
      const stripped = chunk[0].replace(dateRegex, "").replace(/^项目名称[:：]?\s*/, "").trim();
      if (stripped && stripped.length >= 2 && stripped.length <= 40) {
        projectName = stripped;
      }
    }
    if (!projectName) {
      projectName = `项目经历 ${i + 1}`;
    }

    let role = "";
    const roleMatch = fullText.match(/(?:项目角色|担任角色|职位|本人职责|职责)[:：\s]*([^\n\r,，。]+)/);
    if (roleMatch) {
      role = roleMatch[1].trim();
    }

    const descLines = [];
    for (let j = 0; j < chunk.length; j++) {
      const l = chunk[j];
      const isPureHeader = (j < 2) && (dateRegex.test(l) || projectRegex.test(l));
      if (isPureHeader) continue;
      const cleanLine = l.replace(/^[-*•\s]+/, "").replace(/^\d+[.、)）]\s*/, "").trim();
      if (cleanLine) descLines.push(cleanLine);
    }
    const desc = descLines.join("\n");

    items.push({
      title: projectName || `项目经历 ${i + 1}`,
      values: {
        "项目名称": projectName,
        "开始时间": startDate,
        "起始时间": startDate,
        "结束时间": endDate,
        "职位": role,
        "本人职责": role,
        "项目角色": role,
        "项目内容": desc,
        "项目描述": desc,
        "项目成果": ""
      },
      custom: []
    });
  }

  return items;
}

/**
 * Parses Tech & Computer skills into structured items
 */
function parseComputerSkills(lines) {
  const text = lines.join("\n");
  const knownTechs = [
    "Java", "Python", "Go", "Golang", "C++", "C#", "JavaScript", "TypeScript", "HTML/CSS",
    "React", "Vue", "Angular", "Node.js", "Spring Boot", "Spring", "Django", "Flask",
    "MySQL", "PostgreSQL", "Redis", "MongoDB", "Elasticsearch",
    "Docker", "Kubernetes", "Linux", "Git", "Nginx", "Kafka", "Flink", "PyTorch", "TensorFlow"
  ];

  const found = [];
  for (const tech of knownTechs) {
    const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reg = new RegExp(`\\b${escaped}\\b`, "i");
    if (reg.test(text)) {
      found.push(tech);
    }
  }

  const items = [];
  if (found.length > 0) {
    // Group into batches of 4-6
    for (let i = 0; i < found.length; i += 5) {
      const group = found.slice(i, i + 5).join(" / ");
      items.push({
        title: group,
        values: {
          "证书名称（技能名称）": group,
          "掌握程度": "熟练"
        },
        custom: []
      });
    }
  } else {
    // Fallback line by line
    for (const line of lines.slice(0, 5)) {
      items.push({
        title: line.slice(0, 20),
        values: {
          "证书名称（技能名称）": line,
          "掌握程度": "熟练"
        },
        custom: []
      });
    }
  }

  return items;
}

/**
 * Parses Language entries into structured items
 */
function parseLanguageEntries(lines) {
  const items = [];
  const text = lines.join("\n");
  const certs = [
    { name: "大学英语六级 (CET-6)", regex: /(?:CET[- ]?6|六级)/i },
    { name: "大学英语四级 (CET-4)", regex: /(?:CET[- ]?4|四级)/i },
    { name: "托福 (TOEFL)", regex: /TOEFL|托福/i },
    { name: "雅思 (IELTS)", regex: /IELTS|雅思/i },
    { name: "专业八级 (TEM-8)", regex: /TEM[- ]?8|专八/i },
    { name: "专业四级 (TEM-4)", regex: /TEM[- ]?4|专四/i }
  ];

  for (const c of certs) {
    if (c.regex.test(text)) {
      items.push({
        title: c.name,
        values: {
          "外语种类": "英语",
          "证书名称（技能名称）": c.name,
          "掌握程度": "良好"
        },
        custom: []
      });
    }
  }

  return items;
}

/**
 * Parses Award entries into structured items
 */
function parseAwardEntries(lines) {
  const items = [];
  const dateRegex = /(\d{4}[./年-]\d{1,2}|\d{4}年?)/;

  for (const line of lines.slice(0, 10)) {
    const dm = line.match(dateRegex);
    const dateStr = dm ? dm[1].replace(/[./年]/g, "-").replace(/[-.]$/, "") : "";
    const awardName = line.replace(dateRegex, "").replace(/^[-*•\s]+/, "").trim();
    if (awardName) {
      items.push({
        title: awardName.slice(0, 20),
        values: {
          "奖惩名称": awardName,
          "奖惩时间": dateStr,
          "奖惩描述": line
        },
        custom: []
      });
    }
  }

  return items;
}

/**
 * Parses Certificate entries into structured items
 */
function parseCertificateEntries(lines) {
  const items = [];
  const dateRegex = /(\d{4}[./年-]\d{1,2}|\d{4}年?)/;

  for (const line of lines.slice(0, 10)) {
    const dm = line.match(dateRegex);
    const dateStr = dm ? dm[1].replace(/[./年]/g, "-").replace(/[-.]$/, "") : "";
    const certName = line.replace(dateRegex, "").replace(/^[-*•\s]+/, "").trim();
    if (certName) {
      items.push({
        title: certName.slice(0, 20),
        values: {
          "证书名称（技能名称）": certName,
          "证书获得时间": dateStr
        },
        custom: []
      });
    }
  }

  return items;
}

/**
 * Merges AI extracted sections into local profile without EVER overwriting local high-confidence PII.
 * Uses non-destructive reconciliation to preserve unmatched local entries and enrich existing ones.
 */
export function mergeAiSectionsIntoProfile(localProfile, aiSections) {
  if (!localProfile || typeof localProfile !== "object") return localProfile;
  const reconciled = reconcileProfiles(localProfile, aiSections);
  if (reconciled && reconciled.sections) {
    localProfile.sections = reconciled.sections;
    localProfile.updatedAt = reconciled.updatedAt;
  }
  return localProfile;
}
