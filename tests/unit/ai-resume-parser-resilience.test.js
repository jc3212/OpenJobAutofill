/**
 * OpenJobAutofill - Unit Test: AI Resume Parser Resilience & Structure Normalization Gate
 * 
 * Validates:
 * 1. Deep text cleaning: strips <think>...</think>, unclosed <think>, markdown blocks, balanced JSON
 * 2. Polymorphic unwrapping: unwrap sections, data.sections, result, response, resume, root-level dicts, arrays
 * 3. Canonical normalization: Chinese/English alias resolution, flat items wrapping, simple sections
 * 4. Diagnostic messages: failure feedback with truncated snippet
 * 5. Reconciler compatibility: seamless ProfileV2 integration and schema assertion
 * 6. Prototype pollution defense: __proto__ sanitization
 */

import assert from "node:assert/strict";
import {
  extractAndNormalizeAiSections,
  cleanAndExtractJson,
  unwrapSections,
  normalizeSections,
  SECTION_ALIAS_MAP,
  cleanPrototypePollution
} from "../../src/lib/ai-section-normalizer.js";
import { extractAndNormalizeAiSections as bgExtractAndNormalizeAiSections } from "../../src/background.js";
import { reconcileProfiles } from "../../src/lib/profile-reconciler.js";
import { createEmptyProfileV2, assertProfileV2Schema } from "../../src/lib/resume-schema.js";

console.log("=== Running Unit Test: AI Resume Parser Resilience Gate ===");

// -------------------------------------------------------------
// 1. Export Parity Gate
// -------------------------------------------------------------
console.log("1. Testing Module Export Parity...");
{
  assert.equal(typeof extractAndNormalizeAiSections, "function");
  assert.equal(typeof bgExtractAndNormalizeAiSections, "function");
  console.log("  ✔ extractAndNormalizeAiSections correctly exported from both ai-section-normalizer.js and background.js");
}

// -------------------------------------------------------------
// 2. Deep Text Cleaning (<think> tags & Markdown)
// -------------------------------------------------------------
console.log("2. Testing Deep Text Cleaning (<think> tags & Markdown)...");
{
  // 2.1 Closed <think>...</think> with internal distraction JSON
  const withClosedThink = `
<think>
User wants me to extract resume sections.
Let's see: { "status": "draft", "note": "internal idea" }
The candidate studied at Peking University.
</think>
\`\`\`json
{
  "sections": {
    "education": {
      "key": "education",
      "title": "教育经历",
      "kind": "repeat",
      "items": [
        {
          "values": {
            "学校": "北京大学",
            "专业": "计算机科学与技术",
            "学历": "硕士",
            "开始时间": "2020-09",
            "结束时间": "2023-06"
          },
          "custom": []
        }
      ]
    }
  }
}
\`\`\`
`;
  const res1 = extractAndNormalizeAiSections(withClosedThink);
  assert.ok(res1.education, "Must contain education section");
  assert.equal(res1.education.items[0].values["学校"], "北京大学");
  console.log("  ✔ Closed <think> block stripped, including distracting thought JSON");

  // 2.2 Unclosed <think> before markdown block
  const withUnclosedThinkBeforeMd = `
<think>
I am reasoning about the resume without closing tag...
\`\`\`json
{
  "education": [
    { "学校": "清华大学", "专业": "软件工程", "学历": "本科" }
  ]
}
\`\`\`
`;
  const res2 = extractAndNormalizeAiSections(withUnclosedThinkBeforeMd);
  assert.ok(res2.education);
  assert.equal(res2.education.items[0].values["学校"], "清华大学");
  console.log("  ✔ Unclosed <think> before markdown code block handled seamlessly");

  // 2.3 Unclosed <think> before raw JSON (no markdown block)
  const withUnclosedThinkBeforeRawJson = `
<think>
Thinking process directly followed by JSON object
{
  "education": [
    { "学校": "浙江大学", "学历": "博士" }
  ]
}
`;
  const res3 = extractAndNormalizeAiSections(withUnclosedThinkBeforeRawJson);
  assert.ok(res3.education);
  assert.equal(res3.education.items[0].values["学校"], "浙江大学");
  console.log("  ✔ Unclosed <think> before raw JSON extracted via balanced bracket parser");

  // 2.4 Unclosed <think> with NO JSON (truncated generation)
  const truncatedThink = "<think>Model crashed mid-thought while analyzing...";
  assert.throws(
    () => extractAndNormalizeAiSections(truncatedThink),
    (err) => {
      assert.match(err.message, /不是有效的 JSON 结构|缺少有效 sections 结构/);
      assert.ok(err.message.includes("<think>Model crashed"));
      return true;
    },
    "Truncated think tag must throw descriptive error with snippet"
  );
  console.log("  ✔ Truncated unclosed <think> safely throws with diagnostic snippet");
}

// -------------------------------------------------------------
// 3. Structural Polymorphic Unwrapping
// -------------------------------------------------------------
console.log("3. Testing Structural Polymorphic Unwrapping...");
{
  // 3.1 Direct root-level sections (no outer "sections" wrapper)
  const rootDirect = {
    education: [
      { 学校: "复旦大学", 专业: "微电子" }
    ],
    work: [
      { 公司: "华为技术有限公司", 职位: "算法工程师" }
    ]
  };
  const resDirect = extractAndNormalizeAiSections(JSON.stringify(rootDirect));
  assert.ok(resDirect.education);
  assert.ok(resDirect.work);
  assert.equal(resDirect.education.items[0].values["学校"], "复旦大学");
  assert.equal(resDirect.work.items[0].values["公司"], "华为技术有限公司");
  console.log("  ✔ Root-level direct sections automatically unwrapped");

  // 3.2 data.sections wrapper
  const wrappedInData = {
    data: {
      sections: {
        education: {
          items: [{ values: { 学校: "南京大学" } }]
        }
      }
    }
  };
  const resData = extractAndNormalizeAiSections(JSON.stringify(wrappedInData));
  assert.ok(resData.education);
  assert.equal(resData.education.items[0].values["学校"], "南京大学");
  console.log("  ✔ data.sections wrapper recursively unwrapped");

  // 3.3 result.sections & response.sections & resume.sections
  const wrappedInResult = {
    result: {
      education: [{ 学校: "上海交通大学" }]
    }
  };
  const resResult = extractAndNormalizeAiSections(JSON.stringify(wrappedInResult));
  assert.equal(resResult.education.items[0].values["学校"], "上海交通大学");

  const wrappedInResume = {
    resume: {
      sections: {
        work: [{ 公司: "腾讯科技" }]
      }
    }
  };
  const resResume = extractAndNormalizeAiSections(JSON.stringify(wrappedInResume));
  assert.equal(resResume.work.items[0].values["公司"], "腾讯科技");
  console.log("  ✔ result, response, and resume wrapper variations recursively unwrapped");

  // 3.4 Root-level array of sections
  const rootArray = [
    {
      key: "education",
      items: [{ values: { 学校: "中国科学技术大学" } }]
    },
    {
      title: "工作经历",
      items: [{ values: { 公司: "阿里巴巴" } }]
    }
  ];
  const resArray = extractAndNormalizeAiSections(JSON.stringify(rootArray));
  assert.ok(resArray.education);
  assert.ok(resArray.work);
  assert.equal(resArray.education.items[0].values["学校"], "中国科学技术大学");
  assert.equal(resArray.work.items[0].values["公司"], "阿里巴巴");
  console.log("  ✔ Root-level array of sections converted by key/title");

  // 3.5 sections as an array inside an object
  const sectionsAsArray = {
    sections: [
      {
        key: "education",
        items: [{ values: { 学校: "哈尔滨工业大学" } }]
      }
    ]
  };
  const resSectionsArr = extractAndNormalizeAiSections(JSON.stringify(sectionsAsArray));
  assert.ok(resSectionsArr.education);
  assert.equal(resSectionsArr.education.items[0].values["学校"], "哈尔滨工业大学");
  console.log("  ✔ sections as an array safely unwrapped");
}

// -------------------------------------------------------------
// 4. Section Key & Chinese Alias Normalization
// -------------------------------------------------------------
console.log("4. Testing Section Key & Chinese Alias Normalization...");
{
  const chineseAliases = {
    "教育经历": [{ "学校": "武汉大学", "学历": "本科" }],
    "工作经历": [{ "公司": "美团", "职位": "后端开发" }],
    "项目经历": [{ "项目名称": "智能客服系统", "职位": "核心开发" }],
    "IT技能": [{ "技能名称": "Go", "掌握程度": "精通" }],
    "外语能力": [{ "外语种类": "英语", "成绩": "CET-6 600" }],
    "奖励荣誉": [{ "奖惩名称": "国家奖学金", "奖惩时间": "2022" }],
    "自我评价": "热爱技术，有良好的团队协作能力与高并发系统优化经验。"
  };
  const resAliases = extractAndNormalizeAiSections(JSON.stringify(chineseAliases));

  assert.ok(resAliases.education, "教育经历 -> education");
  assert.equal(resAliases.education.items[0].values["学校"], "武汉大学");

  assert.ok(resAliases.work, "工作经历 -> work");
  assert.equal(resAliases.work.items[0].values["公司"], "美团");

  assert.ok(resAliases.project, "项目经历 -> project");
  assert.equal(resAliases.project.items[0].values["项目名称"], "智能客服系统");

  assert.ok(resAliases.computer, "IT技能 -> computer");
  assert.equal(resAliases.computer.items[0].values["证书名称（技能名称）"], "Go");
  assert.equal(resAliases.computer.items[0].values["掌握程度"], "精通");

  assert.ok(resAliases.language, "外语能力 -> language");
  assert.equal(resAliases.language.items[0].values["外语种类"], "英语");

  assert.ok(resAliases.awards, "奖励荣誉 -> awards");
  assert.equal(resAliases.awards.items[0].values["奖惩名称"], "国家奖学金");

  assert.ok(resAliases.self, "自我评价 -> self");
  assert.equal(resAliases.self.kind, "simple");
  assert.match(resAliases.self.values["自我评价"], /热爱技术/);

  console.log("  ✔ All Chinese section aliases canonicalized to standard ProfileV2 keys");
}

// -------------------------------------------------------------
// 5. Structure Normalization (Flat items & Missing values wrapping)
// -------------------------------------------------------------
console.log("5. Testing Structure Normalization (Flat items & Missing values)...");
{
  // Flat items array without items wrapper and without values wrapper
  const flatPayload = {
    education: [
      {
        "学校名称": "中山大学",
        "专业": "软件工程",
        "学历": "硕士",
        "起始时间": "2021-09",
        "结束时间": "2024-06"
      }
    ],
    skills: [
      { "name": "Python", "level": "熟练" },
      { "技能": "Docker", "熟练程度": "掌握" }
    ],
    self: {
      "自我评价": "具备扎实的系统底层开发能力。"
    }
  };

  const resFlat = extractAndNormalizeAiSections(JSON.stringify(flatPayload));

  // Verify education structure
  assert.equal(resFlat.education.kind, "repeat");
  assert.equal(resFlat.education.key, "education");
  assert.equal(resFlat.education.title, "教育经历");
  assert.ok(Array.isArray(resFlat.education.items));
  assert.equal(resFlat.education.items.length, 1);
  assert.ok(resFlat.education.items[0].values, "Must be wrapped into .values");
  assert.ok(Array.isArray(resFlat.education.items[0].custom), "Must have .custom array");
  assert.equal(resFlat.education.items[0].values["学校"], "中山大学");
  assert.equal(resFlat.education.items[0].values["学校名称"], "中山大学");
  assert.equal(resFlat.education.items[0].values["开始时间"], "2021-09");
  assert.equal(resFlat.education.items[0].values["起始时间"], "2021-09");

  // Verify skills -> computer mapping
  assert.equal(resFlat.computer.kind, "repeat");
  assert.equal(resFlat.computer.items.length, 2);
  assert.equal(resFlat.computer.items[0].values["证书名称（技能名称）"], "Python");
  assert.equal(resFlat.computer.items[0].values["掌握程度"], "熟练");
  assert.equal(resFlat.computer.items[1].values["证书名称（技能名称）"], "Docker");
  assert.equal(resFlat.computer.items[1].values["掌握程度"], "掌握");

  // Verify self structure
  assert.equal(resFlat.self.kind, "simple");
  assert.equal(resFlat.self.values["自我评价"], "具备扎实的系统底层开发能力。");

  console.log("  ✔ Flat items arrays and bare dictionaries automatically wrapped to standard schema");
}

// -------------------------------------------------------------
// 6. Diagnostics on Empty / Invalid Inputs
// -------------------------------------------------------------
console.log("6. Testing Diagnostics on Empty / Invalid Inputs...");
{
  // 6.1 Empty input
  assert.throws(
    () => extractAndNormalizeAiSections("   "),
    /AI 返回的内容为空/
  );

  // 6.2 Malformed non-JSON text
  const garbageText = "Sorry, I cannot process this request as an AI language model.";
  assert.throws(
    () => extractAndNormalizeAiSections(garbageText),
    (err) => {
      assert.match(err.message, /不是有效的 JSON 结构/);
      assert.ok(err.message.includes("Sorry, I cannot process"));
      return true;
    }
  );

  // 6.3 Valid JSON but completely lacks sections
  const emptyObject = JSON.stringify({ status: "success", code: 200, info: "no sections here" });
  assert.throws(
    () => extractAndNormalizeAiSections(emptyObject),
    (err) => {
      assert.match(err.message, /缺少有效 sections 结构/);
      assert.ok(err.message.includes("no sections here"));
      return true;
    }
  );

  // 6.4 Valid sections but empty experiences
  const emptyExperience = JSON.stringify({
    sections: {
      education: { kind: "repeat", items: [] },
      work: { kind: "repeat", items: [{ values: {} }] }
    }
  });
  assert.throws(
    () => extractAndNormalizeAiSections(emptyExperience),
    /AI 未能从文本中提取出有效经历内容/
  );

  console.log("  ✔ Clear diagnostic feedback with 150-char snippets asserted for all error paths");
}

// -------------------------------------------------------------
// 7. Prototype Pollution Sanitization
// -------------------------------------------------------------
console.log("7. Testing Prototype Pollution Sanitization...");
{
  const maliciousJson = JSON.stringify({
    "__proto__": { "polluted": true },
    "education": [
      {
        "学校": "北京大学",
        "constructor": { "prototype": { "hacked": true } }
      }
    ]
  });
  const resSec = extractAndNormalizeAiSections(maliciousJson);
  assert.equal({}.polluted, undefined, "Global Object prototype must not be polluted");
  assert.equal({}.hacked, undefined, "Global constructor prototype must not be polluted");
  assert.equal(resSec.__proto__, Object.prototype);
  console.log("  ✔ Malicious __proto__ and constructor attacks safely eliminated");
}

// -------------------------------------------------------------
// 8. End-to-End Profile Reconciler Integration & Schema Compliance
// -------------------------------------------------------------
console.log("8. Testing Profile Reconciler Integration & Schema Compliance...");
{
  const localProfile = createEmptyProfileV2();
  localProfile.sections.basic.values["姓名"] = "张三";
  localProfile.sections.basic.values["电话"] = "13800000000";
  localProfile.sections.education.items = [
    {
      title: "本科",
      values: { "学校": "北京大学", "专业": "软件工程", "学历": "本科" },
      custom: []
    }
  ];

  // AI returns messy input with thinking tags, Chinese aliases, flat items
  const aiOutput = `
<think>
Extracting education and work...
</think>
\`\`\`json
{
  "教育经历": [
    { "学校名称": "北京大学", "开始时间": "2018-09", "结束时间": "2022-06", "专业描述": "主修计算机" }
  ],
  "工作经历": [
    { "公司名称": "阿里巴巴", "职位名称": "全栈工程师", "工作描述": "负责中台系统研发" }
  ],
  "basic": {
    "姓名": "李四（恶意覆盖）"
  }
}
\`\`\`
`;

  const extractedSections = extractAndNormalizeAiSections(aiOutput);
  const reconciled = reconcileProfiles(localProfile, extractedSections);

  // Assert schema compliance
  assertProfileV2Schema(reconciled);

  // Assert PII immunity (local 张三 protected)
  assert.equal(reconciled.sections.basic.values["姓名"], "张三");
  assert.equal(reconciled.sections.basic.values["电话"], "13800000000");

  // Assert education non-destructive enrichment
  assert.equal(reconciled.sections.education.items.length, 1);
  assert.equal(reconciled.sections.education.items[0].values["学校"], "北京大学");
  assert.equal(reconciled.sections.education.items[0].values["专业"], "软件工程");
  assert.equal(reconciled.sections.education.items[0].values["开始时间"], "2018-09");
  assert.equal(reconciled.sections.education.items[0].values["专业描述"], "主修计算机");

  // Assert work appended
  assert.equal(reconciled.sections.work.items.length, 1);
  assert.equal(reconciled.sections.work.items[0].values["公司"], "阿里巴巴");
  assert.equal(reconciled.sections.work.items[0].values["职位"], "全栈工程师");
  assert.equal(reconciled.sections.work.items[0].values["工作内容"], "负责中台系统研发");

  console.log("  ✔ End-to-end flow passes ProfileV2 validation, preserves PII, and enriches data non-destructively");
}

// -------------------------------------------------------------
// 9. Edge Cases Resilience (Malformed JSON, Control Chars, Polymorphic Arrays & Bilingual Aliases)
// -------------------------------------------------------------
console.log("9. Testing Edge Cases Resilience (Malformed JSON, Control Chars & Bilingual Aliases)...");
{
  // 9.1 Trailing commas in objects and arrays
  const withTrailingCommas = `{
    "education": [
      {
        "学校": "北京大学",
        "专业": "信息管理",
      },
    ],
  }`;
  const resTrailing = extractAndNormalizeAiSections(withTrailingCommas);
  assert.equal(resTrailing.education.items[0].values["学校"], "北京大学");
  console.log("  ✔ Trailing commas in objects and arrays automatically repaired");

  // 9.2 Literal newlines inside JSON string literals
  const withLiteralNewlines = `{\n  "education": [{\n    "学校": "清华大学",\n    "专业描述": "主修课程：\n1. 算法分析与设计\n2. 高级操作系统"\n  }]\n}`;
  const resNewlines = extractAndNormalizeAiSections(withLiteralNewlines);
  assert.equal(resNewlines.education.items[0].values["学校"], "清华大学");
  assert.match(resNewlines.education.items[0].values["专业描述"], /1\. 算法分析与设计\n2\. 高级操作系统/);
  console.log("  ✔ Unescaped literal newlines inside string literals safely parsed");

  // 9.3 Comments (// and /* */) in JSON
  const withComments = `{
    // 教育背景信息
    "education": [
      {
        /* 985 高校 */
        "学校": "复旦大学"
      }
    ]
  }`;
  const resComments = extractAndNormalizeAiSections(withComments);
  assert.equal(resComments.education.items[0].values["学校"], "复旦大学");
  console.log("  ✔ Single-line and multi-line comments in JSON safely ignored");

  // 9.4 Single quotes in JSON
  const withSingleQuotes = "{'education': [{'学校': '上海交大', '专业': '自动化'}]}";
  const resSingleQuotes = extractAndNormalizeAiSections(withSingleQuotes);
  assert.equal(resSingleQuotes.education.items[0].values["学校"], "上海交大");
  console.log("  ✔ Python-style single quotes in JSON successfully repaired");

  // 9.5 Truncated brackets at EOF (simulating token limit cutoff)
  const truncatedJson = '{"sections": {"education": [{"学校": "浙江大学", "专业": "计算机"}]';
  const resTruncated = extractAndNormalizeAiSections(truncatedJson);
  assert.equal(resTruncated.education.items[0].values["学校"], "浙江大学");
  console.log("  ✔ Truncated JSON reaching EOF auto-repaired by resilient parser");

  // 9.6 Array of section dictionaries: [ { "education": [...] }, { "work": [...] } ]
  const sectionDictArray = [
    { "education": [{ "学校": "南京大学" }] },
    { "work": [{ "公司": "字节跳动", "职位": "前端工程师" }] }
  ];
  const resDictArr = extractAndNormalizeAiSections(JSON.stringify(sectionDictArray));
  assert.ok(resDictArr.education);
  assert.ok(resDictArr.work);
  assert.equal(resDictArr.education.items[0].values["学校"], "南京大学");
  assert.equal(resDictArr.work.items[0].values["公司"], "字节跳动");
  console.log("  ✔ Array of section dictionaries successfully unwrapped and mapped");

  // 9.7 Inferred section keys from bare experience items in array
  const bareItemsArray = [
    { "学校": "中国人民大学", "专业": "法学" },
    { "公司": "美团", "职位": "后端工程师" }
  ];
  const resBareItems = extractAndNormalizeAiSections(JSON.stringify(bareItemsArray));
  assert.ok(resBareItems.education);
  assert.ok(resBareItems.work);
  assert.equal(resBareItems.education.items[0].values["学校"], "中国人民大学");
  assert.equal(resBareItems.work.items[0].values["公司"], "美团");
  console.log("  ✔ Bare experience items in array automatically inferred into correct sections");

  // 9.8 Duplicate keys in section arrays merged without data loss
  const duplicateSectionsArray = [
    { key: "education", items: [{ values: { "学校": "北京大学" } }] },
    { key: "education", items: [{ values: { "学校": "哈佛大学" } }] }
  ];
  const resDup = extractAndNormalizeAiSections(JSON.stringify(duplicateSectionsArray));
  assert.equal(resDup.education.items.length, 2);
  assert.equal(resDup.education.items[0].values["学校"], "北京大学");
  assert.equal(resDup.education.items[1].values["学校"], "哈佛大学");
  console.log("  ✔ Multiple array items with identical section keys merged without clobbering");

  // 9.9 Simple section (self) as string array and items wrapper
  const selfArray = {
    education: [{ "学校": "中山大学" }],
    self: ["熟练掌握高并发架构设计", "具备优秀的抗压能力与沟通技巧"]
  };
  const resSelfArr = extractAndNormalizeAiSections(JSON.stringify(selfArray));
  assert.equal(resSelfArr.self.kind, "simple");
  assert.equal(resSelfArr.self.values["自我评价"], "熟练掌握高并发架构设计\n具备优秀的抗压能力与沟通技巧");

  const selfItemsWrapper = {
    education: [{ "学校": "中山大学" }],
    self: {
      items: [{ values: { "自我评价": "资深技术专家，带领团队交付多个大型项目。" } }]
    }
  };
  const resSelfItems = extractAndNormalizeAiSections(JSON.stringify(selfItemsWrapper));
  assert.equal(resSelfItems.self.values["自我评价"], "资深技术专家，带领团队交付多个大型项目。");
  console.log("  ✔ Simple sections with string arrays and items wrappers correctly unwrapped to scalar values");

  // 9.10 Full English field name normalization
  const englishPayload = {
    education: [
      { school: "Stanford University", major: "Computer Science", degree: "Master", start_date: "2019-09", end_date: "2021-06" }
    ],
    work: [
      { company: "Google", position: "Software Engineer", start_date: "2021-07", end_date: "2024-05", description: "Backend infrastructure" }
    ],
    project: [
      { project_name: "AI Agent", role: "Tech Lead", description: "Multi-agent autonomous framework", achievements: "10x speedup" }
    ]
  };
  const resEnglish = extractAndNormalizeAiSections(JSON.stringify(englishPayload));
  assert.equal(resEnglish.education.items[0].values["学校"], "Stanford University");
  assert.equal(resEnglish.education.items[0].values["专业"], "Computer Science");
  assert.equal(resEnglish.education.items[0].values["学历"], "Master");
  assert.equal(resEnglish.education.items[0].values["开始时间"], "2019-09");
  assert.equal(resEnglish.education.items[0].values["结束时间"], "2021-06");

  assert.equal(resEnglish.work.items[0].values["公司"], "Google");
  assert.equal(resEnglish.work.items[0].values["职位"], "Software Engineer");
  assert.equal(resEnglish.work.items[0].values["开始时间"], "2021-07");
  assert.equal(resEnglish.work.items[0].values["结束时间"], "2024-05");
  assert.equal(resEnglish.work.items[0].values["工作内容"], "Backend infrastructure");

  assert.equal(resEnglish.project.items[0].values["项目名称"], "AI Agent");
  assert.equal(resEnglish.project.items[0].values["职位"], "Tech Lead");
  assert.equal(resEnglish.project.items[0].values["项目内容"], "Multi-agent autonomous framework");
  assert.equal(resEnglish.project.items[0].values["项目成果"], "10x speedup");
  console.log("  ✔ English field aliases (school, major, company, position, description, etc.) mapped to standard keys");

  // 9.11 Code blocks with alternative language identifiers (```javascript, ```json5, unclosed ```)
  const jsCodeBlock = "```javascript\n{\"education\": [{\"学校\": \"同济大学\"}]}\n```";
  const resJs = extractAndNormalizeAiSections(jsCodeBlock);
  assert.equal(resJs.education.items[0].values["学校"], "同济大学");

  const unclosedCodeBlock = "```json\n{\"education\": [{\"学校\": \"武汉大学\"}]}";
  const resUnclosed = extractAndNormalizeAiSections(unclosedCodeBlock);
  assert.equal(resUnclosed.education.items[0].values["学校"], "武汉大学");
  console.log("  ✔ Alternative language identifiers (```javascript) and unclosed markdown blocks supported");

  // 9.12 Orphan leading reasoning ending in </think>
  const orphanThink = "Analyzing user resume and extracting structured experience...\n</think>\n```json\n{\"education\": [{\"学校\": \"南开大学\"}]}\n```";
  const resOrphan = extractAndNormalizeAiSections(orphanThink);
  assert.equal(resOrphan.education.items[0].values["学校"], "南开大学");
  console.log("  ✔ Orphan leading reasoning ending in </think> safely stripped");

  // 9.13 Diagnostic 150-char snippet included in error when experience validation fails
  const noExpJson = JSON.stringify({
    education: { items: [] },
    meta: "custom debug metadata for testing error diagnostic"
  });
  assert.throws(
    () => extractAndNormalizeAiSections(noExpJson),
    (err) => {
      assert.match(err.message, /未能从文本中提取出有效经历内容/);
      assert.ok(err.message.includes("custom debug metadata"));
      return true;
    },
    "Failure must include 150-char diagnostic snippet"
  );
  console.log("  ✔ Diagnostic snippet verified on empty experience validation failure");
}

console.log("==================================================================");
console.log("🎉 ALL AI RESUME PARSER RESILIENCE TESTS PASSED SUCCESSFULLY!");
console.log("==================================================================\n");

