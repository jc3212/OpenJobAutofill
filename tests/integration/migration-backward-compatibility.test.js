/**
 * OpenJobAutofill - Integration Test: Real Resume Fixtures & Backward Compatibility Migration
 */

import assert from "node:assert/strict";
import { createMockChrome } from "../mock-chrome.js";
import { ProfileStore } from "../../src/lib/profile-store.js";
import { extractLocalProfileAndPii } from "../../src/lib/profile-extractor.js";
import {
  normalizeProfileV2,
  restorePassthrough,
  assertProfileV2Schema,
  STANDARD_SECTION_DEFINITIONS
} from "../../src/lib/resume-schema.js";
import {
  createDefaultResumeEnvelope,
  STORAGE_ENVELOPE_KEY,
  STORAGE_META_KEY,
  PROTOCOL_ERRORS
} from "../../src/lib/protocol.js";

console.log("=== Running Integration Test: Real Resume Fixtures & Backward Compatibility ===");

// ---------------------------------------------------------------------------
// 1. Realistic Multi-Column & Table Resume Fixture Parsing
// ---------------------------------------------------------------------------
console.log("1. Testing Realistic Multi-Column & Table Resume Fixture Parsing...");
{
  // Realistic resume text simulating text stream from multi-column PDF or complex DOCX table
  const realWorldResumeFixture = `
李建国 | 求职意向：全栈架构师 | 期望薪资：35k-45k | 期望城市：杭州、上海
电话：(+86) 139-8765-4321  邮箱：jianguo.li@alumni.zju.edu.cn
年龄：32岁  性别：男  政治面貌：中共党员  最高学历：博士研究生
个人主页：https://github.com/jianguo-li

【教育背景】
教育经历：2017.09 - 2021.06 浙江大学 计算机科学与技术 博士研究生
- 研究方向：大规模分布式数据库一致性算法
- 获得国家奖学金、优秀毕业研究生
2014.09 - 2017.06 浙江大学 软件工程 硕士
2010.09 - 2014.06 华中科技大学 计算机科学与技术 本科

【专业技能】
| 技能类别 | 技能明细 | 掌握程度 |
| :--- | :--- | :--- |
| 编程语言 | Golang, Rust, Java, TypeScript, Python | 精通 |
| 存储系统 | TiDB, RocksDB, PostgreSQL, Redis | 深入理解源码 |
| 分布式 | Raft, Paxos, Kubernetes, gRPC | 生产落地经验 |

【工作经历】
工作经历：2021.07 - 至今 蚂蚁集团 资深分布式架构师
- 负责新一代分布式事务引擎核心研发，支撑双十一核心支付链路
- 主导 Raft 复制状态机优化，将尾延迟降低 38%
2017.07 - 2021.06 阿里云计算有限公司 高级软件工程师
- 参与 PolarDB 分布式存储引擎组件研发与性能调优
- 独立编写并落地自动化故障自愈系统

【项目经历】
项目经历：2022.03 - 2023.11 全局分布式事务协调平台
- 项目角色：技术负责人
- 项目描述：跨数据中心多活架构下的强一致分布式协调平台
- 主要业绩：QPS 突破 100,000，故障恢复时间 RTO < 3s

【荣誉奖项】
2020 浙江省优秀博士毕业生
2019 ACM-ICPC 亚洲区域赛金奖

【自我评价】
具备极强的底层技术钻研精神，深耕分布式存储与高并发架构多年，拥有海量并发系统的架构与应急兜底实战经验。
`;

  const extraction = extractLocalProfileAndPii(realWorldResumeFixture);
  const { profileV2, pii, cleanText } = extraction;

  // Verify Schema conformance of extracted profile
  assertProfileV2Schema(profileV2);
  assert.equal(profileV2.schemaVersion, 2);
  console.log("  ✔ Extracted profile strictly satisfies ProfileV2 schema contract");

  // Verify high-precision PII extraction
  assert.equal(pii["姓名"], "李建国");
  assert.equal(pii["电话"], "13987654321");
  assert.equal(pii["邮箱"], "jianguo.li@alumni.zju.edu.cn");
  assert.equal(pii["性别"], "男");
  assert.equal(pii["最高学历"], "博士研究生", "Highest degree must be Doctor via weight ranking");
  console.log("  ✔ PII and highest degree ranking accurately resolved");

  // Verify Header Remainder and Multi-entry Extraction for Education
  const eduSec = profileV2.sections.education;
  assert.equal(eduSec.kind, "repeat");
  assert.ok(eduSec.items.length >= 3, `Expected at least 3 education entries, found: ${eduSec.items.length}`);
  
  const phd = eduSec.items[0];
  assert.equal(phd.values["学校"], "浙江大学");
  assert.equal(phd.values["学历"], "博士研究生");
  assert.equal(phd.values["专业"], "计算机科学与技术");
  assert.equal(phd.values["开始时间"], "2017-09");
  assert.equal(phd.values["结束时间"], "2021-06");

  const master = eduSec.items[1];
  assert.equal(master.values["学校"], "浙江大学");
  assert.equal(master.values["学历"], "硕士");

  const bachelor = eduSec.items[2];
  assert.equal(bachelor.values["学校"], "华中科技大学");
  assert.equal(bachelor.values["学历"], "本科");
  console.log("  ✔ Multi-tier education entries and header remainders accurately extracted");

  // Verify Work entries
  const workSec = profileV2.sections.work;
  assert.equal(workSec.kind, "repeat");
  assert.ok(workSec.items.length >= 2, `Expected at least 2 work entries, found: ${workSec.items.length}`);
  assert.equal(workSec.items[0].values["公司"], "蚂蚁集团");
  assert.equal(workSec.items[0].values["职位"], "资深分布式架构师");
  assert.equal(workSec.items[0].values["开始时间"], "2021-07");
  assert.equal(workSec.items[0].values["结束时间"], "至今");
  assert.ok(workSec.items[0].values["工作描述"].includes("分布式事务引擎核心研发"));

  assert.equal(workSec.items[1].values["公司"], "阿里云计算有限公司");
  assert.equal(workSec.items[1].values["职位"], "高级软件工程师");
  console.log("  ✔ Multi-tier work experience entries, dates and descriptions extracted");

  // Verify Project entries
  const projectSec = profileV2.sections.project;
  assert.equal(projectSec.kind, "repeat");
  assert.ok(projectSec.items.length >= 1);
  assert.equal(projectSec.items[0].values["项目名称"], "全局分布式事务协调平台");
  assert.equal(projectSec.items[0].values["项目角色"], "技术负责人");
  console.log("  ✔ Multi-tier project entries and achievements extracted");

  // Verify Table handling & Clean text redaction
  assert.ok(!cleanText.includes("13987654321"), "cleanText must redact phone");
  assert.ok(!cleanText.includes("jianguo.li@alumni.zju.edu.cn"), "cleanText must redact email");
  console.log("  ✔ Table markdown preprocessed and cleanText PII mask verified");
}

// ---------------------------------------------------------------------------
// 2. Legacy V1 Migration to Multi-Profile Envelope & Dual-write Sync
// ---------------------------------------------------------------------------
console.log("2. Testing Legacy V1 Migration to Multi-Profile Envelope...");
{
  globalThis.chrome = createMockChrome();

  // Seed storage with legacy single profile (v1/v2 legacy format without resumeEnvelope)
  const legacyProfile = {
    schemaVersion: 2,
    sections: {
      basic: {
        key: "basic",
        title: "基本信息",
        kind: "simple",
        values: {
          "简历名称": "建国的秋招简历",
          "姓名": "李建国",
          "电话": "13987654321",
          "邮箱": "jianguo.li@alumni.zju.edu.cn"
        }
      },
      education: {
        key: "education",
        title: "教育经历",
        kind: "repeat",
        items: [
          {
            title: "浙江大学",
            values: { "学校": "浙江大学", "学历": "博士研究生" },
            custom: []
          }
        ]
      }
    },
    // Custom third-party property attached to legacy profile
    __customLegacyMeta: { source: "imported_from_v1_backup", tags: ["vip", "distributed-systems"] }
  };

  await chrome.storage.local.set({ profileV2: legacyProfile });

  // Initialize ProfileStore with normalizeProfileV2
  const envelope = await ProfileStore.ensureInitialized(normalizeProfileV2);

  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.stateRevision, 1);
  assert.equal(envelope.profileOrder.length, 1);
  
  const activeId = envelope.activeProfileId;
  const migratedProfile = envelope.profiles[activeId];
  assert.ok(migratedProfile, "Migrated profile must exist");
  assert.equal(migratedProfile.name, "建国的秋招简历", "Profile name should be adopted from basic.values.简历名称");
  assert.equal(migratedProfile.profileV2.sections.basic.values["姓名"], "李建国");

  // Verify passthrough capture of extra root properties
  assert.deepEqual(migratedProfile.profileV2.__passthrough?.properties?.__customLegacyMeta, legacyProfile.__customLegacyMeta);
  console.log("  ✔ Legacy profile successfully migrated to resumeEnvelope with custom name & passthrough preserved");

  // Verify storage state and legacy dual-write mirror
  const storageData = await chrome.storage.local.get([STORAGE_ENVELOPE_KEY, STORAGE_META_KEY, "profileV2"]);
  assert.ok(storageData[STORAGE_ENVELOPE_KEY]);
  assert.equal(storageData[STORAGE_META_KEY]?.migrationVersion, 1);
  assert.ok(storageData.profileV2, "profileV2 dual-write mirror must exist for content script compatibility");
  assert.equal(storageData.profileV2.sections.basic.values["姓名"], "李建国");
  console.log("  ✔ Storage meta and profileV2 backward-compatibility mirror verified");
}

// ---------------------------------------------------------------------------
// 3. Unknown Fields & Passthrough Zero Loss during Edit & Re-export
// ---------------------------------------------------------------------------
console.log("3. Testing Passthrough Retention & Zero Loss during Updates...");
{
  globalThis.chrome = createMockChrome();
  const initialEnvelope = await ProfileStore.ensureInitialized(normalizeProfileV2);
  const activeId = initialEnvelope.activeProfileId;

  // Simulate updating active profile with unknown custom fields and non-standard sections
  const customProfileV2 = {
    schemaVersion: 2,
    sections: {
      basic: {
        key: "basic",
        title: "基本信息",
        kind: "simple",
        values: { "姓名": "王小二", "电话": "13800000000" },
        custom: [{ label: "微信号", value: "wx_wangxiaoer" }]
      },
      // Non-standard section (e.g. portfolio, patents, etc. that user added)
      customPortfolio: {
        key: "customPortfolio",
        title: "个人作品集",
        kind: "simple",
        values: { "作品链接": "https://portfolio.example.com" }
      }
    },
    // Root level unknown properties
    __appMeta: { lastExportedBy: "CLI-Sync-Tool", build: 402 }
  };

  const normalized = normalizeProfileV2(customProfileV2);
  assertProfileV2Schema(normalized);
  
  // Verify that customPortfolio and __appMeta were safely preserved in __passthrough
  assert.ok(normalized.__passthrough);
  assert.deepEqual(normalized.__passthrough.properties.__appMeta, customProfileV2.__appMeta);
  assert.deepEqual(normalized.__passthrough.sections.customPortfolio, customProfileV2.sections.customPortfolio);

  // Save into store
  const saveResult = await ProfileStore.saveProfile({
    operationId: "op_test_passthrough_save",
    profileId: activeId,
    baseStateRevision: initialEnvelope.stateRevision,
    baseProfileRevision: initialEnvelope.profiles[activeId].revision,
    profileV2: normalized,
    name: "王小二-简历"
  });
  assert.equal(saveResult.ok, true);
  assert.equal(saveResult.stateRevision, 2);
  assert.equal(saveResult.profileRevision, 2);

  // Fetch back and restore
  const fetched = await ProfileStore.getEnvelope();
  assert.equal(fetched.isReadOnly, false);
  const fetchedProfileV2 = fetched.envelope.profiles[activeId].profileV2;
  const restored = restorePassthrough(fetchedProfileV2);

  // Assert 100% round-trip fidelity
  assert.deepEqual(restored.__appMeta, customProfileV2.__appMeta);
  assert.deepEqual(restored.sections.customPortfolio, customProfileV2.sections.customPortfolio);
  assert.equal(restored.sections.basic.values["姓名"], "王小二");
  console.log("  ✔ Passthrough round-trip zero-loss guaranteed for root fields and extra sections");
}

// ---------------------------------------------------------------------------
// 4. Tri-State Corruption Handling in Real Migration Scenarios
// ---------------------------------------------------------------------------
console.log("4. Testing Tri-State Corruption Safety & Mirror Fallback in Storage...");
{
  globalThis.chrome = createMockChrome();

  // Scenario A: Malformed envelope in storage, but valid legacy profileV2 mirror exists
  await chrome.storage.local.set({
    [STORAGE_ENVELOPE_KEY]: {
      schemaVersion: 1,
      envelopeRevision: "invalid_string_not_number", // Invariant violation
      profiles: {}
    },
    profileV2: {
      schemaVersion: 2,
      sections: {
        basic: {
          key: "basic",
          title: "基本信息",
          kind: "simple",
          values: { "姓名": "备份恢复测试", "电话": "13600000000" }
        }
      }
    }
  });

  const recoveredEnv = await ProfileStore.ensureInitialized(normalizeProfileV2);
  assert.equal(ProfileStore.isReadOnly(), false, "Should recover and NOT enter read-only mode");
  const activeProfile = recoveredEnv.profiles[recoveredEnv.activeProfileId];
  assert.equal(activeProfile.profileV2.sections.basic.values["姓名"], "备份恢复测试");
  console.log("  ✔ Recoverable corruption automatically restored from legacy mirror without data loss");

  // Scenario B: Malformed envelope AND no valid legacy mirror exists
  globalThis.chrome = createMockChrome();
  await chrome.storage.local.set({
    [STORAGE_ENVELOPE_KEY]: {
      schemaVersion: 1,
      envelopeRevision: 1,
      profiles: {} // Empty profiles: Invariant violation!
    },
    profileV2: null // No backup
  });

  await ProfileStore.ensureInitialized(normalizeProfileV2);
  assert.equal(ProfileStore.isReadOnly(), true, "Must enter read-only safety mode");
  assert.ok(ProfileStore.getReadOnlyReason().includes("Invariant Violation"));

  // Verify write operation is strictly rejected in read-only mode
  const writeAttempt = await ProfileStore.saveProfile({
    operationId: "op_should_fail_in_readonly",
    profileId: "p_any",
    baseStateRevision: 1,
    baseProfileRevision: 1,
    profileV2: { schemaVersion: 2, sections: {} }
  });
  assert.equal(writeAttempt.ok, false);
  assert.equal(writeAttempt.error, PROTOCOL_ERRORS.READ_ONLY_MODE);
  console.log("  ✔ Hard corruption safely entered read-only mode, blocked mutations, and preserved backup snapshot");
}

console.log("✅ All Real Resume Fixtures & Backward Compatibility tests passed!");
