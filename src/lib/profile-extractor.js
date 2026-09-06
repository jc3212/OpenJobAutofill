/**
 * OpenJobAutofill - Conservative Local Resume Profile Extractor and PII Isolator
 */

export function extractLocalProfileAndPii(rawText) {
  const text = String(rawText || "").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const pii = {
    "姓名": "",
    "电话": "",
    "邮箱": "",
    "性别": "",
    "出生日期": "",
    "最高学历": "",
    "当前居住地": ""
  };

  // 1. Phone extraction (11-digit Chinese mobile or international)
  const phoneMatch = text.match(/(?:(?:\+|00)86[- ]?)?(1[3-9]\d{9})\b/);
  if (phoneMatch) {
    pii["电话"] = phoneMatch[1];
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

  // 4. Highest Education degree
  const eduMatch = text.match(/(博士研究生|硕士研究生|博士|硕士|本科|大专|专科)/);
  if (eduMatch) {
    pii["最高学历"] = eduMatch[1];
  }

  // 5. Name extraction
  // Check labeled name first: 姓名: xxx
  const labeledName = text.match(/姓名[:：]\s*([\u4e00-\u9fa5]{2,4}|[A-Za-z\s]{2,20})/);
  if (labeledName) {
    pii["姓名"] = labeledName[1].trim();
  } else {
    // If first line is 2-4 Chinese characters and not a generic title
    if (lines.length > 0) {
      const first = lines[0];
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(first) && !/^(个人简历|求职简历|基本信息|工作经历)$/.test(first)) {
        pii["姓名"] = first;
      }
    }
  }

  // 6. Birthday / age
  const birthMatch = text.match(/(?:出生年月|出生日期|生日)[:：]?\s*(\d{4}[-/.年]\d{1,2}[-/.月]?)/);
  if (birthMatch) {
    pii["出生日期"] = birthMatch[1].replace(/[年月]/g, "-").replace(/[-.]$/, "");
  }

  // 7. City
  const cityMatch = text.match(/(?:现居|城市|住址|常住地)[:：]\s*([\u4e00-\u9fa5]{2,10}(?:市|省|区)?)/);
  if (cityMatch) {
    pii["当前居住地"] = cityMatch[1].trim();
  }

  // Prepare isolated experience text by redacting phone and email
  let experienceText = text;
  if (pii["电话"]) {
    experienceText = experienceText.replace(new RegExp(pii["电话"], "g"), "[已脱敏手机号]");
  }
  if (pii["邮箱"]) {
    experienceText = experienceText.replace(new RegExp(pii["邮箱"], "g"), "[已脱敏邮箱]");
  }

  // Construct initial local ProfileV2 structure
  const now = new Date().toISOString();
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
          "简历名称": pii["姓名"] ? `${pii["姓名"]}-个人简历` : "个人简历",
          "性别": pii["性别"] || "",
          "电话": pii["电话"] || "",
          "邮箱": pii["邮箱"] || "",
          "出生日期": pii["出生日期"] || "",
          "最高学历": pii["最高学历"] || "",
          "当前居住地": pii["当前居住地"] || ""
        },
        custom: []
      },
      education: {
        key: "education",
        title: "教育经历",
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
        title: "项目经历",
        kind: "repeat",
        items: []
      },
      skills: {
        key: "skills",
        title: "专业技能",
        kind: "simple",
        values: {
          "专业技能掌握情况": ""
        },
        custom: []
      },
      certificates: {
        key: "certificates",
        title: "证书与执照",
        kind: "repeat",
        items: []
      },
      awards: {
        key: "awards",
        title: "奖励与荣誉",
        kind: "repeat",
        items: []
      }
    },
    customSections: []
  };

  // Perform conservative section segmentation to populate basic items
  segmentSections(lines, localProfile);

  return {
    localProfile,
    profileV2: localProfile,
    piiSummary: pii,
    pii,
    experienceText: experienceText.trim(),
    cleanText: experienceText.trim()
  };
}

function segmentSections(lines, profile) {
  let currentSection = null;
  const sectionBuffers = {};

  const SECTION_KEYWORDS = {
    education: ["教育经历", "教育背景", "学历信息", "就读经历"],
    work: ["工作经历", "实习经历", "工作经验", "实习经验", "职业经历"],
    project: ["项目经历", "项目经验", "科研经历"],
    skills: ["专业技能", "技能特长", "个人技能", "IT技能"],
    certificates: ["证书与执照", "资质证书", "荣誉证书", "技能证书"],
    awards: ["奖励与荣誉", "所获奖项", "奖学金与荣誉", "个人荣誉"]
  };

  for (const line of lines) {
    let matched = null;
    for (const [secKey, keywords] of Object.entries(SECTION_KEYWORDS)) {
      if (keywords.some((kw) => line.includes(kw) && line.length < 15)) {
        matched = secKey;
        break;
      }
    }

    if (matched) {
      currentSection = matched;
      if (!sectionBuffers[currentSection]) {
        sectionBuffers[currentSection] = [];
      }
      continue;
    }

    if (currentSection) {
      sectionBuffers[currentSection].push(line);
    }
  }

  // Populate skills if found
  if (sectionBuffers.skills?.length) {
    profile.sections.skills.values["专业技能掌握情况"] = sectionBuffers.skills.join("\n");
  }

  // Populate raw fallback items for repeated sections so user has text
  if (sectionBuffers.education?.length) {
    profile.sections.education.items.push({
      values: {
        "学校名称": sectionBuffers.education[0] || "",
        "专业": "",
        "学历": profile.sections.basic.values["最高学历"] || "",
        "起始时间": "",
        "结束时间": ""
      },
      custom: []
    });
  }

  if (sectionBuffers.work?.length) {
    profile.sections.work.items.push({
      values: {
        "公司名称": sectionBuffers.work[0] || "",
        "职位名称": "",
        "所属部门": "",
        "起始时间": "",
        "结束时间": "",
        "工作描述": sectionBuffers.work.slice(1).join("\n")
      },
      custom: []
    });
  }

  if (sectionBuffers.project?.length) {
    profile.sections.project.items.push({
      values: {
        "项目名称": sectionBuffers.project[0] || "",
        "项目角色": "",
        "起始时间": "",
        "结束时间": "",
        "项目描述": sectionBuffers.project.slice(1).join("\n"),
        "主要业绩": ""
      },
      custom: []
    });
  }
}

/**
 * Merges AI extracted sections into local profile without EVER overwriting local high-confidence PII.
 */
export function mergeAiSectionsIntoProfile(localProfile, aiSections) {
  if (!localProfile || typeof localProfile !== "object" || !localProfile.sections) {
    return localProfile;
  }

  if (!aiSections || typeof aiSections !== "object") {
    return localProfile;
  }

  // Merge experience sections only - never touch basic section!
  for (const secKey of ["education", "work", "project", "skills", "certificates", "awards"]) {
    if (aiSections[secKey]) {
      localProfile.sections[secKey] = JSON.parse(JSON.stringify(aiSections[secKey]));
    }
  }

  return localProfile;
}
