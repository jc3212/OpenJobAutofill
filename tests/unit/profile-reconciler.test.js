/**
 * OpenJobAutofill - Unit Test: Profile Reconciler & Non-destructive AI Merge Gate
 */

import assert from "node:assert/strict";
import { reconcileProfiles, isMatchingItem } from "../../src/lib/profile-reconciler.js";
import { assertProfileV2Schema } from "../../src/lib/resume-schema.js";

console.log("=== Running Unit Test: Profile Reconciler Gate ===");

// 1. Unmatched Local Items 100% Preserved
console.log("1. Testing 100% Preservation of Unmatched Local Items...");
{
  const localProfile = {
    schemaVersion: 2,
    sections: {
      education: {
        key: "education",
        title: "教育经历",
        kind: "repeat",
        items: [
          {
            title: "北京大学",
            values: { "学校": "北京大学", "学历": "硕士", "开始时间": "2020-09" },
            custom: []
          },
          {
            title: "清华大学",
            values: { "学校": "清华大学", "学历": "本科", "开始时间": "2016-09" },
            custom: []
          }
        ]
      }
    }
  };

  // AI only recognized Tsinghua, omitted Peking University
  const aiSections = {
    education: {
      key: "education",
      kind: "repeat",
      items: [
        {
          title: "清华大学",
          values: { "学校": "清华大学", "专业课程": "操作系统、编译原理" },
          custom: []
        }
      ]
    }
  };

  const reconciled = reconcileProfiles(localProfile, aiSections);
  assert.doesNotThrow(() => assertProfileV2Schema(reconciled));

  const items = reconciled.sections.education.items;
  assert.equal(items.length, 2, "Unmatched Peking University MUST NOT be dropped");
  assert.equal(items[0].values["学校"], "北京大学");
  assert.equal(items[1].values["学校"], "清华大学");
  assert.equal(items[1].values["专业课程"], "操作系统、编译原理", "Matched item must be enriched");
  console.log("  ✔ Unmatched local items 100% preserved and matched items enriched");
}

// 2. Matched Item Enrichment without Duplicate Creation
console.log("2. Testing Non-duplicative Item Enrichment...");
{
  const localProfile = {
    schemaVersion: 2,
    sections: {
      work: {
        key: "work",
        title: "工作经历",
        kind: "repeat",
        items: [
          {
            title: "字节跳动",
            values: { "公司": "字节跳动", "职位": "后端工程师", "开始时间": "2024-07" },
            custom: []
          }
        ]
      }
    }
  };

  const aiSections = {
    work: {
      key: "work",
      kind: "repeat",
      items: [
        {
          title: "字节跳动",
          values: { "公司名称": "字节跳动", "开始时间": "2024-07", "工作内容": "微服务研发与架构升级" },
          custom: []
        },
        {
          title: "腾讯科技",
          values: { "公司名称": "腾讯科技", "开始时间": "2023-01", "工作内容": "实习研发" },
          custom: []
        }
      ]
    }
  };

  const reconciled = reconcileProfiles(localProfile, aiSections);
  const items = reconciled.sections.work.items;
  assert.equal(items.length, 2, "Must merge matching ByteDance without duplicate and append Tencent");
  assert.equal(items[0].values["公司"], "字节跳动");
  assert.equal(items[0].values["职位"], "后端工程师", "Existing local value preserved");
  assert.equal(items[0].values["工作内容"], "微服务研发与架构升级", "Missing field enriched from AI");
  assert.equal(items[1].values["公司"], "腾讯科技", "New AI item appended");
  console.log("  ✔ Enrichment occurred without creating duplicate entries for ByteDance");
}

// 3. Local High-Confidence Values Immune to AI Overwrite
console.log("3. Testing Local Field Conflict Immunity...");
{
  const localProfile = {
    schemaVersion: 2,
    sections: {
      education: {
        key: "education",
        kind: "repeat",
        items: [
          {
            title: "清华大学",
            values: { "学校": "清华大学", "专业": "软件工程", "开始时间": "2020-09" },
            custom: []
          }
        ]
      }
    }
  };

  // AI has a hallucinated or different major
  const aiSections = {
    education: {
      key: "education",
      kind: "repeat",
      items: [
        {
          title: "清华大学",
          values: { "学校": "清华大学", "专业": "计算机与信息科学", "开始时间": "2020-09" },
          custom: []
        }
      ]
    }
  };

  const reconciled = reconcileProfiles(localProfile, aiSections);
  const eduItem = reconciled.sections.education.items[0];
  assert.equal(eduItem.values["专业"], "软件工程", "Local non-empty value must be protected from AI overwrite");
  console.log("  ✔ Local user-defined values strictly protected against AI overwrite");
}

// 4. PII Immunity: AI Basic Section Ignored
console.log("4. Testing PII Immunity against AI Overwrite...");
{
  const localProfile = {
    schemaVersion: 2,
    sections: {
      basic: {
        key: "basic",
        title: "基本信息",
        kind: "simple",
        values: {
          "姓名": "张三",
          "电话": "13800138000",
          "邮箱": "zhangsan@example.com",
          "最高学历": "硕士"
        },
        custom: []
      }
    }
  };

  // AI returns hallucinated PII
  const aiSections = {
    basic: {
      key: "basic",
      kind: "simple",
      values: {
        "姓名": "李四 (AI Hallucination)",
        "电话": "19999999999",
        "邮箱": "fake@ai.com"
      }
    }
  };

  const reconciled = reconcileProfiles(localProfile, aiSections);
  const basic = reconciled.sections.basic.values;
  assert.equal(basic["姓名"], "张三", "PII 姓名 must NOT be overwritten");
  assert.equal(basic["电话"], "13800138000", "PII 电话 must NOT be overwritten");
  assert.equal(basic["邮箱"], "zhangsan@example.com", "PII 邮箱 must NOT be overwritten");
  assert.equal(basic["最高学历"], "硕士");
  console.log("  ✔ PII Immunity strictly verified: AI basic section completely ignored");
}

console.log("✅ All Profile Reconciler tests passed!\n");
