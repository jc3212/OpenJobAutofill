/**
 * OpenJobAutofill - Unit Test: Resume Segmentation, State Machine & Degree Ranking Gate
 */

import assert from "node:assert/strict";
import {
  extractHighestDegree,
  detectSectionHeader,
  preprocessResumeLines,
  extractLocalProfileAndPii
} from "../../src/lib/profile-extractor.js";

console.log("=== Running Unit Test: Resume Segmentation & Degree Ranking Gate ===");

// 1. Highest Degree Weight Ranking
console.log("1. Testing Highest Degree Extraction by Weight Ranking...");
{
  // A. Labeled degree preference
  const text1 = "个人简介：张三，求职意向：前端。最高学历：硕士研究生，具有多年开发经验。";
  assert.equal(extractHighestDegree(text1), "硕士研究生");

  // B. Unlabeled text with multiple chronological degrees (Master > Bachelor)
  const text2 = `
    学习经历：
    2016-09 至 2020-06 清华大学 计算机科学 本科
    2020-09 至 2023-06 清华大学 软件工程 硕士
  `;
  assert.equal(extractHighestDegree(text2), "硕士", "Must select 硕士 over 本科 based on weight");

  // C. Unlabeled text with Doctor > Master > College
  const text3 = "2012年专科毕业，2016年专升本，2019年获硕士学位，2024年获得博士研究生学位";
  assert.equal(extractHighestDegree(text3), "博士研究生", "Must select 博士研究生 based on maximum weight (5)");

  // D. High school vs College vs Bachelor
  const text4 = "高中就读于黄冈中学，2020年获得武汉大学本科学位";
  assert.equal(extractHighestDegree(text4), "本科", "Must select 本科 over 高中");

  console.log("  ✔ Degree weight ranking correctly selects highest educational achievement");
}

// 2. Section Header & Header Remainder Detection
console.log("2. Testing Section Header & Header Remainder Extraction...");
{
  // A. Header with remainder on same line
  const h1 = detectSectionHeader("教育经历：2020.09 - 2024.06 清华大学 计算机科学与技术 本科");
  assert.ok(h1, "Must match section header");
  assert.equal(h1.key, "education");
  assert.equal(h1.remainder, "2020.09 - 2024.06 清华大学 计算机科学与技术 本科");

  // B. Markdown header with remainder
  const h2 = detectSectionHeader("## 工作经历 2021.07 - 2023.08 腾讯科技有限公司 后端开发工程师");
  assert.ok(h2);
  assert.equal(h2.key, "work");
  assert.equal(h2.remainder, "2021.07 - 2023.08 腾讯科技有限公司 后端开发工程师");

  // C. Bracketed header without remainder
  const h3 = detectSectionHeader("【项目经历/实践活动】");
  assert.ok(h3);
  assert.equal(h3.key, "project");
  assert.equal(h3.remainder, "");

  // D. Non-header line
  const h4 = detectSectionHeader("清华大学 计算机系 本科生");
  assert.equal(h4, null);

  console.log("  ✔ Section header remainder successfully extracted without dropping first-line data");
}

// 3. Table Rows & Preprocessing
console.log("3. Testing Markdown & Pipe Table Preprocessing...");
{
  const rawLines = [
    "基本信息",
    "| 姓名 | 张三 | 性别 | 男 |",
    "|:---|:---|:---|:---|",
    "教育背景",
    "| 2020.09 - 2024.06 | 清华大学 | 计算机科学与技术 | 本科 |",
    "|---|---|---|---|",
    "工作经历"
  ];

  const preprocessed = preprocessResumeLines(rawLines);
  assert.equal(preprocessed.length, 5, "Divider rows must be filtered out");
  assert.ok(preprocessed[1].includes("姓名") && preprocessed[1].includes("张三"));
  assert.ok(preprocessed[3].includes("清华大学") && preprocessed[3].includes("2020.09 - 2024.06"));
  console.log("  ✔ Table rows preprocessed and table dividers safely discarded");
}

// 4. End-to-End Extraction with Multi-line Bullets & Header Remainder
console.log("4. Testing End-to-End Multi-line Entry Extraction...");
{
  const testResume = `
张三
电话：13800138000
邮箱：zhangsan@example.com

教育经历：2020.09 - 2024.06 清华大学 计算机科学与技术 本科
主修课程：操作系统、数据结构、计算机网络

工作经历
2024.07 - 至今 字节跳动 后端工程师
- 负责抖音电商千万级高并发微服务架构研发
- 2025年主导完成分布式缓存优化，性能提升30%
- 独立编写技术白皮书

项目经历
2023.03 - 2023.12 分布式搜索引擎研发
- 基于 Raft 协议实现高可用分布式共识
- 实现了高吞吐量倒排索引，QPS 达到 50,000
  `;

  const res = extractLocalProfileAndPii(testResume);

  // Assert Education extracted with header remainder
  assert.equal(res.localProfile.sections.education.items.length, 1);
  const edu = res.localProfile.sections.education.items[0];
  assert.equal(edu.values["学校"], "清华大学");
  assert.equal(edu.values["开始时间"], "2020-09");
  assert.equal(edu.values["结束时间"], "2024-06");
  assert.equal(edu.values["学历"], "本科");

  // Assert Work experience with multi-line bullets
  assert.equal(res.localProfile.sections.work.items.length, 1);
  const work = res.localProfile.sections.work.items[0];
  assert.equal(work.values["公司"], "字节跳动");
  assert.equal(work.values["职位"], "后端工程师");
  assert.equal(work.values["开始时间"], "2024-07");
  assert.equal(work.values["结束时间"], "至今");
  assert.ok(work.values["工作内容"].includes("负责抖音电商千万级高并发"));
  assert.ok(work.values["工作内容"].includes("2025年主导完成分布式缓存优化"));

  // Assert Project experience
  assert.equal(res.localProfile.sections.project.items.length, 1);
  const proj = res.localProfile.sections.project.items[0];
  assert.equal(proj.values["项目名称"], "分布式搜索引擎研发");
  assert.ok(proj.values["项目内容"].includes("基于 Raft 协议实现高可用分布式共识"));

  console.log("  ✔ End-to-end multi-line entries, dates, bullet points and header remainders accurately captured");
}

console.log("✅ All Resume Segmentation tests passed!\n");
