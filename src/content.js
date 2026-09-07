(() => {
  const SCRIPT_VERSION = "0.8.7-ai-first-cn";

  if (window.__OJAF_AUTOFILL_VERSION__ === SCRIPT_VERSION) {
    return;
  }

  window.__OJAF_AUTOFILL_VERSION__ = SCRIPT_VERSION;
  window.__OJAF_AUTOFILL_LOADED__ = true;

  const FIELD_ATTR = "data-ojaf-field-id";
  const MARK_ATTR = "data-ojaf-mark";
  const EDIT_ATTEMPT_ATTR = "data-ojaf-edit-attempted";
  const STYLE_ID = "ojaf-autofill-style";
  const PANEL_ID = "ojaf-profile-panel";
  const FLOAT_ID = "ojaf-floating-status";
  const PANEL_HIDDEN_ATTR = "data-ojaf-hidden";
  const PANEL_COLLAPSED_ATTR = "data-ojaf-collapsed";
  const MAX_EDIT_EXPANSIONS = 20;
  const PROFILE_PANEL_STATE_DEBOUNCE_MS = 300;
  let fieldCounter = 0;
  let profilePanelVisible = false;
  let profilePanelCollapsed = false;
  let profilePanel = null;
  let profilePanelStateSaveTimer = null;
  let profilePanelStateRestored = false;
  let currentProfileV2 = null;
  let currentProfileLoadPromise = null;
  let currentSiteAdapter = null;
  let sidebarFilter = "";
  let activeProfileCategory = "";
  let autofillInProgress = false;
  let autofillProgress = { active: false, stage: "", percent: 0, detail: "" };
  let autofillSummary = null;
  let lastAutofillDebug = null;
  let autofillRunId = 0;
  let autofillProgressTimer = null;
  let autofillAiState = createAutofillAiState();

  const OJAF_DEBUG_LOGS = true;

  function sanitizeDiagnosticPayload(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeDiagnosticPayload(item));
    }
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/^(?:value|val|text|content|password|secret|key|phone|email|name|idcard|id_card|address)$/i.test(k)) {
        clean[k] = typeof v === "string" ? `[REDACTED_LEN_${v.length}]` : (v === null || v === undefined ? v : "[REDACTED]");
      } else if (typeof v === "object" && v !== null) {
        clean[k] = sanitizeDiagnosticPayload(v);
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }

  function logDiagnostic(event, payload = {}) {
    if (!OJAF_DEBUG_LOGS) return;
    try {
      const sanitized = sanitizeDiagnosticPayload(payload);
      console.log(`[OJAF] ${event}`, sanitized);
    } catch {
      // Never crash on diagnostic logging
    }
  }

  const CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]):not([type="file"])',
    "textarea",
    "select",
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="radio"]',
    '[role="checkbox"]'
  ].join(",");

  function isWritableTarget(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const tagName = String(element.tagName || "").toUpperCase();
    if (element instanceof HTMLInputElement || tagName === "INPUT") {
      const type = (element.getAttribute?.("type") || element.type || "text").toLowerCase();
      if (["password", "file", "hidden", "submit", "button", "reset", "image"].includes(type)) {
        return false;
      }
    }

    if (element.disabled || element.getAttribute?.("aria-disabled") === "true" || element.hasAttribute?.("disabled")) {
      return false;
    }

    if (element.readOnly || element.getAttribute?.("aria-readonly") === "true" || element.getAttribute?.("readonly") != null) {
      return false;
    }

    return true;
  }

  const SITE_ADAPTERS = [
    {
      id: "zhiye",
      name: "智易/智业 ATS",
      urlPattern: /(?:^|\.)zhiye\.com$/i,
      confidence: 0.94,
      indicators: [".ant-form-item", ".ant-select", "[class*='form-item']", "[class*='FormItem']"],
      containerSelector: ".ant-form-item,.form-item,[class*='formItem'],[class*='FormItem'],[class*='field'],[class*='Field']",
      labelSelector: ".ant-form-item-label,label,[class*='label'],[class*='Label'],[class*='formLabel']",
      sectionSelector: ".ant-card-head-title,.ant-collapse-header,.form-section-title,[class*='sectionTitle'],[class*='module-title'],h2,h3,h4",
      repeatItemSelector: ".ant-card,.ant-collapse-item,.resume-block,[class*='list-item'],[class*='resume-item'],[class*='record-item']",
      saveLabels: ["保存", "确定", "完成"],
      editLabels: ["编辑", "修改", "完善"]
    },
    {
      id: "hotjob",
      name: "HotJob",
      urlPattern: /(?:^|\.)hotjob\.cn$/i,
      confidence: 0.92,
      indicators: [".form-item", ".resume-block", "[class*='kuma']", "[class*='uxcore']"],
      containerSelector: ".form-item,.kuma-form-item,.uxcore-form-row,[class*='form-item'],[class*='field']",
      labelSelector: ".kuma-label,.form-label,label,[class*='label']",
      sectionSelector: ".module-title,.resume-title,.card-title,.uxcore-card-title-text,h2,h3,h4",
      repeatItemSelector: ".resume-block,.uxcore-card,[class*='resume-item'],[class*='experience-item'],[class*='list-item']",
      saveLabels: ["保存", "确定", "提交"],
      editLabels: ["编辑", "修改"]
    },
    {
      id: "liepin",
      name: "猎聘/通用 ATS",
      urlPattern: /(?:^|\.)liepin\.com$/i,
      confidence: 0.86,
      indicators: [".form-item", "[class*='resume']", "[class*='apply']"],
      containerSelector: ".form-item,[class*='formItem'],[class*='field'],[class*='apply']",
      labelSelector: "label,[class*='label'],[class*='Label']",
      sectionSelector: "[class*='title'],[class*='Title'],h2,h3,h4",
      repeatItemSelector: "[class*='resume-item'],[class*='experience-item'],[class*='list-item'],[class*='record-item']",
      saveLabels: ["保存", "确定"],
      editLabels: ["编辑", "修改"]
    },
    {
      id: "moka",
      name: "Moka 招聘",
      urlPattern: /(?:^|\.)(?:mokahr|moka)\.com$/i,
      confidence: 0.9,
      indicators: [".ant-form-item", "[class*='application-form']", "[class*='questionnaire']", "[class*='schema-form']"],
      containerSelector: ".ant-form-item,[class*='form-item'],[class*='field-wrapper'],[class*='question-item'],[class*='schema-form-item']",
      labelSelector: ".ant-form-item-label,label,[class*='field-label'],[class*='question-label'],[class*='question-title']",
      sectionSelector: ".ant-card-head-title,[class*='module-title'],[class*='questionnaire-title'],[class*='block-title'],h2,h3,h4",
      repeatItemSelector: ".ant-card,[class*='resume-item'],[class*='experience-item'],[class*='list-item'],[class*='card-item']",
      saveLabels: ["保存", "确定", "下一步", "完成"],
      editLabels: ["编辑", "修改", "完善"]
    },
    {
      id: "beisen",
      name: "北森/iTalentX",
      urlPattern: /(?:^|\.)beisen\.com$|(?:^|\.)italent\.cn$|(?:^|\.)italentx\.cn$|(?:^|\.)italentx\.com$/i,
      confidence: 0.89,
      indicators: [".el-form-item", ".ant-form-item", "[class*='resume-form']", "[class*='talent-form']", "[class*='bs-']"],
      containerSelector: ".el-form-item,.ant-form-item,[class*='form-item'],[class*='resume-field'],[class*='field-row']",
      labelSelector: ".el-form-item__label,.ant-form-item-label,label,[class*='field-label'],[class*='label']",
      sectionSelector: ".el-card__header,[class*='block-title'],[class*='section-title'],[class*='module-title'],h2,h3,h4",
      repeatItemSelector: ".el-card,[class*='resume-item'],[class*='experience-item'],[class*='list-item'],[class*='record-item']",
      saveLabels: ["保存", "确定", "下一步", "完成"],
      editLabels: ["编辑", "修改", "完善", "填写"]
    },
    {
      id: "nowcoder",
      name: "牛客网申",
      urlPattern: /(?:^|\.)nowcoder\.com$/i,
      confidence: 0.84,
      indicators: [".ant-form-item", "[class*='questionnaire']", "[class*='resume-module']", "[class*='form-item']"],
      containerSelector: ".ant-form-item,[class*='form-item'],[class*='question-item'],[class*='resume-field']",
      labelSelector: ".ant-form-item-label,label,[class*='field-label'],[class*='question-title'],[class*='label']",
      sectionSelector: ".ant-card-head-title,[class*='module-title'],[class*='questionnaire-title'],[class*='resume-title'],h2,h3,h4",
      repeatItemSelector: ".ant-card,[class*='resume-item'],[class*='experience-item'],[class*='list-item']",
      saveLabels: ["保存", "确定", "下一步", "完成"],
      editLabels: ["编辑", "修改", "完善"]
    },
    {
      id: "zhaopin",
      name: "智联招聘",
      urlPattern: /(?:^|\.)zhaopin\.com$/i,
      confidence: 0.83,
      indicators: [".ant-form-item", "[class*='resume-edit']", "[class*='questionnaire']", "[class*='form-item']"],
      containerSelector: ".ant-form-item,[class*='form-item'],[class*='resume-field'],[class*='field-row']",
      labelSelector: ".ant-form-item-label,label,[class*='field-label'],[class*='label']",
      sectionSelector: ".ant-card-head-title,[class*='module-title'],[class*='resume-title'],[class*='section-title'],h2,h3,h4",
      repeatItemSelector: ".ant-card,[class*='resume-module'],[class*='resume-item'],[class*='list-item']",
      saveLabels: ["保存", "确定", "下一步", "完成"],
      editLabels: ["编辑", "修改", "完善"]
    },
    {
      id: "feishu-jobs",
      name: "飞书招聘",
      urlPattern: /(?:^|\.)jobs\.feishu\.cn$/i,
      confidence: 0.82,
      indicators: [".ud-formily-item", "[class*='applyFormModuleWrapper']", "[data-form-field-id]", "[data-form-field-name]"],
      containerSelector: ".ud-formily-item,[class*='applyFormModuleWrapper'],[class*='form-item'],[class*='field']",
      labelSelector: ".ud-formily-item-label-content,label,[class*='label'],[data-form-field-i18n-name]",
      sectionSelector: ".applyFormModuleWrapper-text,[class*='module-title'],[class*='section-title'],h2,h3,h4",
      repeatItemSelector: "[class*='applyFormModuleWrapper'],[class*='list-item'],[class*='record-item'],[class*='card-item']",
      saveLabels: ["保存", "确定", "下一步", "完成"],
      editLabels: ["编辑", "修改", "完善"]
    },
    {
      id: "ant-design",
      name: "Ant Design 表单",
      confidence: 0.78,
      indicators: [".ant-form-item", ".ant-select", ".ant-radio-wrapper"],
      containerSelector: ".ant-form-item,.ant-row.ant-form-item,[class*='ant-form-item']",
      labelSelector: ".ant-form-item-label,label,.ant-checkbox-wrapper,.ant-radio-wrapper",
      sectionSelector: ".ant-card-head-title,.ant-collapse-header,.ant-tabs-tab,.ant-typography,h2,h3,h4",
      repeatItemSelector: ".ant-card,.ant-collapse-item,[class*='list-item'],[class*='record-item'],[class*='card-item']",
      saveLabels: ["保存", "确定", "完成"],
      editLabels: ["编辑", "修改"]
    },
    {
      id: "arco-design",
      name: "Arco Design 表单",
      confidence: 0.77,
      indicators: [".arco-form-item", ".arco-select-view", ".arco-radio"],
      containerSelector: ".arco-form-item,[class*='arco-form-item']",
      labelSelector: ".arco-form-item-label,label,.arco-radio,.arco-checkbox",
      sectionSelector: ".arco-card-header,[class*='section-title'],[class*='module-title'],h2,h3,h4",
      repeatItemSelector: ".arco-card,[class*='list-item'],[class*='record-item'],[class*='card-item']",
      saveLabels: ["保存", "确定", "完成"],
      editLabels: ["编辑", "修改"]
    },
    {
      id: "element-ui",
      name: "Element UI 表单",
      confidence: 0.76,
      indicators: [".el-form-item", ".el-select", ".el-radio"],
      containerSelector: ".el-form-item,[class*='el-form-item']",
      labelSelector: ".el-form-item__label,label,.el-checkbox,.el-radio",
      sectionSelector: ".el-card__header,.el-collapse-item__header,[class*='title'],h2,h3,h4",
      repeatItemSelector: ".el-card,.el-collapse-item,[class*='list-item'],[class*='record-item'],[class*='card-item']",
      saveLabels: ["保存", "确定", "完成"],
      editLabels: ["编辑", "修改"]
    },
    {
      id: "tdesign",
      name: "TDesign 表单",
      confidence: 0.75,
      indicators: [".t-form__item", ".t-select", ".t-radio"],
      containerSelector: ".t-form__item,[class*='t-form__item']",
      labelSelector: ".t-form__label,label,.t-radio,.t-checkbox",
      sectionSelector: ".t-card__header,[class*='section-title'],[class*='module-title'],h2,h3,h4",
      repeatItemSelector: ".t-card,[class*='list-item'],[class*='record-item'],[class*='card-item']",
      saveLabels: ["保存", "确定", "完成"],
      editLabels: ["编辑", "修改"]
    }
  ];

  const AUTO_FILL_SECTION_ORDER = [
    "基本信息",
    "求职意向",
    "教育经历",
    "实习经历",
    "工作经历",
    "绩效考核",
    "专业资格",
    "项目经历",
    "社团工作",
    "学生工作",
    "奖惩情况",
    "外语能力",
    "计算机技能",
    "证书技能",
    "语言能力",
    "家庭信息",
    "培训经历",
    "论文著作",
    "专利成果",
    "自我描述",
    "有关声明",
    "其他信息",
    "自定义资料"
  ];

  const PROFILE_LABEL_ALIASES = {
    姓名: ["真实姓名", "名字"],
    姓: ["姓氏", "中文姓"],
    名: ["名字", "中文名"],
    姓拼音: ["姓（拼音）", "姓氏拼音", "拼音姓", "Last Name Pinyin"],
    名拼音: ["名（拼音）", "名字拼音", "拼音名", "First Name Pinyin"],
    性别: ["男女性别"],
    英文名: ["英文姓名", "英文名称", "English Name"],
    出生日期: ["生日", "出生年月", "出生时间", "出生年月日"],
    国籍: ["国家", "国籍地区", "国籍国家或地区", "国籍（国家或地区）"],
    证件类型: ["身份证件类型", "证件类别", "证件号码类型"],
    证件号码类型: ["证件类型", "身份证件类型", "证件类别"],
    证件号码: ["身份证号", "身份证号码", "证件号", "身份证", "居民身份证号码"],
    婚姻状况: ["婚姻状态"],
    最高全日制学历: ["最高学历", "学历", "学历层次"],
    最高学历: ["最高全日制学历", "学历", "学历层次"],
    培养方式: ["教育类型", "学习形式", "办学形式", "统招统分"],
    教育类型: ["培养方式", "学习形式", "办学形式", "是否全日制"],
    学习形式: ["培养方式", "教育类型"],
    是否全日制: ["全日制", "是否为全日制"],
    专业排名: ["绩点排名", "GPA排名", "成绩排名", "排名"],
    绩点排名: ["专业排名", "GPA排名", "成绩排名", "排名"],
    班级排名: ["班级成绩排名"],
    无班级排名原因: ["没有班级排名的原因", "请写明没有班级排名的原因"],
    无专业排名原因: ["没有专业排名的原因", "请写明没有专业排名的原因"],
    GPA分数: ["GPA", "平均学分成绩", "平均学分成绩GPA", "绩点"],
    GPA满分: ["GPA满分", "绩点满分", "4分制"],
    身高厘米: ["身高", "净身高", "身高cm", "身高厘米"],
    体重公斤: ["体重", "体重kg", "体重公斤"],
    手机号码: ["手机号", "手机", "联系电话", "联系方式", "电话号码"],
    电话: ["手机号码", "手机号", "手机", "联系电话", "联系方式"],
    邮箱: ["电子邮箱", "邮件", "email", "e-mail"],
    确认邮箱: ["确认电子邮箱", "再次输入邮箱"],
    微信: ["微信号", "微信账号", "WeChat"],
    QQ: ["QQ号", "QQ号码"],
    民族: ["民族"],
    政治面貌: ["政治身份"],
    取得政治面貌时间: ["政治面貌取得时间", "入党时间", "入团时间"],
    户籍: ["户口所在地", "户籍所在地", "现户口所在地"],
    生源地: ["生源户口", "生源所在地", "生源地省", "生源地市"],
    现居住地: ["当前居住地", "居住地", "现居地", "所在地", "现居住城市"],
    现居住城市: ["现居住地", "当前居住城市", "居住城市"],
    现居住详细地址: ["当前居住地详细地址", "现居住地址", "居住地址", "现住址", "当前地址"],
    通讯地址: ["通信地址", "邮寄地址", "收件地址"],
    联系地址: ["通讯地址", "通信地址", "邮寄地址", "收件地址"],
    邮编: ["邮政编码"],
    邮政编码: ["邮编"],
    现户口所在地: ["当前户口所在地", "户口所在地", "户籍所在地"],
    户口类型: ["户籍类型"],
    户籍类型: ["户口类型"],
    人事档案所在单位: ["档案所在单位", "档案单位"],
    血型: ["血液类型"],
    健康状况: ["身体状况"],
    高考时间: ["参加高考时间"],
    高考科目: ["文理科", "高考文理科"],
    工作年限: ["工作经验年限", "工作经验"],
    专业技术职称: ["技术职称", "职称"],
    紧急联系人电话: ["紧急联系人手机", "紧急联系人手机号", "紧急联系方式"],
    与紧急联系人关系: ["紧急联系人关系", "紧急联系人与本人关系"],
    意向岗位: ["目标岗位", "应聘岗位", "申请岗位", "投递岗位"],
    预计入职时间: ["可入职时间", "到岗时间"],
    当前薪资: ["目前薪资", "现薪资"],
    当前年收入: ["目前年收入", "现年收入", "当前年薪", "目前年薪"],
    期望工作城市: ["意向工作城市", "期望城市", "意向城市", "期望工作地点"],
    期望薪资: ["期望年薪", "期望月薪", "期望年收入", "期待薪资"],
    期望年收入: ["期望薪资", "期望年薪", "期待年收入"],
    面试城市: ["可面试城市"],
    简历来源: ["招聘信息来源", "信息来源"],
    即将获得最高学历: ["最高学历", "学历"],
    最高学历院校: ["最高学历学校", "毕业院校", "学校名称", "院校名称"],
    最高学历院系: ["最高学历学院", "学院名称", "院系", "院系名称"],
    本科毕业院校: ["本科院校", "本科毕业学校"],
    本科院系: ["本科专业院系", "本科院系名称"],
    专业名称: ["专业", "所学专业", "专业方向"],
    专业类型: ["专业", "专业名称", "所学专业", "学科专业"],
    学校名称: ["毕业院校", "院校名称", "学校"],
    学校所在国家地区: ["学校所在国家/地区", "学校国家地区", "学校国家"],
    学院名称: ["院系", "院系名称", "学院"],
    院系中文: ["院系（中文）", "院系", "学院名称", "院系名称"],
    学历: ["学历层次", "最高学历"],
    学位: ["学位类型"],
    学历学位: ["学历/学位", "学历学位", "最高学历学位"],
    学号: ["学生证号"],
    学制: ["学习年限", "几年制"],
    城市: ["所在城市", "学校城市", "地点"],
    学校类别: ["院校类别", "学校类型"],
    录取批次: ["高考录取批次", "招生批次"],
    专业描述: ["专业介绍"],
    专业课程: ["主修课程", "核心课程"],
    研究方向: ["研究领域"],
    毕业论文: ["论文题目", "毕业论文题目"],
    成绩: ["学习成绩", "GPA分数", "平均成绩"],
    学历证书编号: ["学历证书号", "毕业证书编号"],
    学历证书号: ["学历证书编号", "毕业证书编号"],
    学位证书编号: ["学位证书号"],
    毕业状态: ["毕（结、肆）业", "毕结肆业"],
    "毕（结、肆）业": ["毕业状态", "毕结肆业"],
    辅导员姓名: ["辅导员"],
    辅导员联系方式: ["辅导员电话", "辅导员手机号"],
    是否为海外教育经历: ["是否海外教育经历", "是否海外学历", "海外教育经历"],
    开始时间: ["起始时间", "入学时间", "开始日期", "实践开始时间"],
    结束时间: ["截止时间", "毕业时间", "结束日期", "实践结束时间", "取得毕业证时间"],
    升学类型: ["本段经历升学类型", "入学方式"],
    高考所在地: ["高考省份", "高考所在地"],
    高考分数: ["高考成绩", "分数"],
    高考总分: ["高考总分数", "总分数"],
    是否有转学经历: ["转学经历", "有无转学经历"],
    单位名称: ["公司名称", "公司", "实习单位", "实践单位", "工作单位", "组织名称"],
    公司: ["公司名称", "单位名称", "实习单位", "工作单位"],
    类型: ["经历类型", "工作实习类型"],
    是否目标公司实习: ["是否为应聘单位实习", "是否为目标公司实习"],
    部门: ["部门名称", "所在部门"],
    职位名称: ["岗位", "岗位名称", "实习岗位", "职务名称", "角色"],
    职位: ["职务", "岗位", "职位名称", "家属职务", "亲属职务"],
    工作实习地点: ["工作/实习地点", "工作地点", "实习地点"],
    地点: ["工作地点", "实习地点", "项目地点", "培训地点"],
    工资: ["薪资", "实习工资", "月薪"],
    行业属性: ["行业", "所属行业"],
    行业: ["行业属性", "所属行业"],
    其他行业属性: ["请填写其他行业属性"],
    实习内容: ["实践内容", "工作内容", "工作内容描述", "职责描述", "工作职责", "项目描述"],
    工作内容: ["工作内容描述", "职责描述", "工作职责", "实践内容"],
    工作成果: ["实习成果", "工作业绩", "项目成果"],
    证明人: ["证明人姓名", "推荐人"],
    证明人姓名: ["证明人", "推荐人"],
    证明人职位: ["证明人职务"],
    证明人联系方式: ["证明人电话", "证明人手机号", "证明人及联系方式"],
    离职原因: ["离开原因"],
    项目名称: ["项目", "实践名称"],
    参与人数: ["项目人数", "团队人数"],
    项目内容: ["项目描述", "实践内容"],
    实践方式: ["实践类型", "活动方式"],
    本人职责: ["个人职责", "本人负责内容", "职责"],
    项目成果: ["项目产出", "实践成果"],
    项目链接: ["项目地址", "作品链接"],
    部门名称社团名称: ["部门名称", "社团名称", "组织名称"],
    组织名称: ["社团名称", "学生组织", "部门名称"],
    职务描述: ["职责", "活动描述", "工作职责或活动描述"],
    奖惩时间: ["获奖时间", "奖励时间"],
    奖惩解除时间: ["解除时间", "处分解除时间"],
    奖惩名称: ["奖励名称", "奖项名称", "荣誉名称"],
    颁奖单位: ["授奖单位", "奖惩单位", "颁发单位"],
    奖惩单位: ["颁奖单位", "授奖单位", "授予单位"],
    奖励等级: ["奖项等级", "奖励级别", "奖惩层级"],
    奖惩层级: ["奖励等级", "奖项等级", "奖励级别"],
    奖惩描述: ["获奖描述", "奖励描述", "奖惩原因"],
    奖惩原因: ["奖惩描述", "获奖描述", "奖励描述"],
    证书: ["证书名称", "资格证书", "技能证书"],
    证书名称技能名称: ["证书名称（技能名称）", "证书名称", "技能名称"],
    证书类别: ["证书类型", "资格证书类别"],
    外语种类: ["外语语种", "语言类型", "语种"],
    获得时间: ["获取日期", "取得时间", "证书取得时间", "获得日期"],
    证书获得时间: ["证书取得时间", "获得时间", "取得时间"],
    其他类请填写: ["其他证书", "其他证书名称"],
    证书颁发单位: ["发证机构", "颁发单位"],
    授予单位: ["颁发单位", "证书颁发单位", "发证机构"],
    发证单位: ["授予单位", "颁发单位", "证书颁发单位", "发证机构"],
    证书编号: ["证书号码"],
    证书说明: ["证书描述", "证书备注"],
    获取日期: ["取得时间", "证书取得时间", "获得日期"],
    竞赛项目: ["竞赛名称", "比赛项目"],
    竞赛奖项: ["奖项", "竞赛级别"],
    竞赛时间: ["比赛时间", "获奖时间"],
    计算机水平: ["计算机能力", "计算机技能"],
    其它技能: ["其他技能", "技能特长"],
    语言类型: ["外语语种", "语种"],
    掌握程度: ["熟练程度", "语言水平", "外语水平"],
    听说: ["听说能力"],
    读写: ["读写能力"],
    培训名称: ["培训项目", "课程名称"],
    培训机构: ["培训单位"],
    培训地点: ["培训城市", "培训地址"],
    培训课程: ["培训内容", "课程内容"],
    培训获得证书: ["培训证书"],
    培训内容: ["培训描述"],
    刊物名称: ["期刊名称", "发表刊物"],
    刊物层级: ["期刊层级"],
    论文名称: ["论文题目", "文章名称"],
    论文描述: ["论文摘要", "论文说明"],
    专利名称: ["专利题目"],
    专利编号: ["专利号"],
    专利类型: ["发明专利", "实用新型"],
    专利成果: ["专利描述", "专利说明"],
    与本人关系: ["关系", "亲属关系"],
    亲属在应聘单位工作: ["是否存在亲属在应聘单位工作"],
    工作单位: ["家属工作单位", "亲属工作单位"],
    部门及职位: ["家属职务", "亲属职务", "职务"],
    联系电话: ["家属联系电话", "亲属联系电话"],
    有无工作经历: ["是否有工作经历", "工作经历"],
    是否退休: ["有无退休", "退休情况"],
    考核年度: ["绩效年度", "年度考核"],
    绩效考核等级: ["考核等级", "年度绩效考核等级"],
    年度绩效排名: ["绩效排名", "考核排名", "排名"],
    绩效证明人: ["考核证明人", "证明人"],
    绩效证明人联系方式: ["证明人联系方式", "联系方式", "联系电话"],
    绩效说明: ["考核说明", "绩效评语"],
    兴趣爱好: ["爱好", "特长爱好具体内容"],
    特长: ["个人特长", "技能特长"],
    社会校园活动: ["社会/校园活动", "校园活动", "社会活动"],
    受到奖励学术成果: ["受到奖励/学术成果", "奖励学术成果", "奖励成果", "学术成果"],
    工作地点是否服从调剂: ["是否接受调剂", "是否服从调剂", "接受调剂"],
    是否同意部门岗位调配: ["是否同意部门/岗位调配", "部门岗位调配", "岗位调配"],
    首选工作地点: ["第一工作地点", "意向工作地点"],
    首选工作地点是否接受调剂: ["工作地点是否接受调剂", "地点调剂"],
    是否存在亲属在应聘单位工作: ["亲属在应聘单位工作", "是否存在亲属在本行工作情况", "亲属在本行工作", "亲属在我行工作"],
    是否患有影响工作的疾病: ["是否患有传染病高血压心脏病糖尿病肾炎精神病等影响工作的疾病", "是否患有重大疾病"],
    是否在第三方企业任兼职或持有企业股权: ["是否在第三方企业任兼职或持有企业股权", "任兼职或持有企业股权"],
    是否存在曾被用人单位辞退情况: ["曾被用人单位辞退情况", "是否曾被用人单位辞退"],
    是否享有境外长期或永久居留权: ["是否享有境外国家或地区长期或永久居留权", "境外长期或永久居留权"]
  };

  function normalizeText(value, maxLength = 260) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    try {
      if (typeof window.getComputedStyle === "function") {
        const style = window.getComputedStyle(element);
        if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
          return false;
        }
      } else if (element.style) {
        if (element.style.display === "none" || element.style.visibility === "hidden" || element.style.opacity === "0") {
          return false;
        }
      }

      if (typeof element.getBoundingClientRect === "function") {
        const rect = element.getBoundingClientRect();
        if (rect && rect.width === 0 && rect.height === 0) {
          return false;
        }
      }
    } catch {}

    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function getPageKey() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function detectSiteAdapter() {
    const hostname = location.hostname || "";
    const href = location.href || "";
    const scoreMap = new Map();

    for (const adapter of SITE_ADAPTERS) {
      let score = 0;
      const hasUrlPattern = Boolean(adapter.urlPattern);
      const urlMatched = hasUrlPattern && (adapter.urlPattern.test(hostname) || adapter.urlPattern.test(href));
      if (urlMatched) {
        score += 70;
      }

      for (const indicator of adapter.indicators || []) {
        try {
          if (document.querySelector(indicator)) {
            score += 8;
          }
        } catch {
          // Ignore invalid selectors from future compatibility probes.
        }
      }

      if (score > 0) {
        scoreMap.set(adapter, { score, urlMatched, hasUrlPattern });
      }
    }

    const scored = Array.from(scoreMap.entries())
      .map(([adapter, meta]) => {
        const baseConfidence =
          meta.hasUrlPattern && !meta.urlMatched
            ? Math.min(adapter.confidence || 0.7, 0.62)
            : adapter.confidence || 0.7;
        return {
          ...adapter,
          confidence: Math.min(0.99, baseConfidence + meta.score / 100)
        };
      })
      .sort((left, right) => right.confidence - left.confidence);

    return scored[0] || null;
  }

  function getActiveSiteAdapter() {
    if (currentSiteAdapter) {
      return currentSiteAdapter;
    }
    currentSiteAdapter = detectSiteAdapter();
    return currentSiteAdapter;
  }

  function getAdapterSelectors() {
    const adapter = getActiveSiteAdapter();
    return {
      containerSelector: adapter?.containerSelector || "",
      labelSelector: adapter?.labelSelector || "",
      sectionSelector: adapter?.sectionSelector || "",
      repeatItemSelector: adapter?.repeatItemSelector || "",
      saveLabels: Array.isArray(adapter?.saveLabels) ? adapter.saveLabels : ["保存"],
      editLabels: Array.isArray(adapter?.editLabels) ? adapter.editLabels : ["编辑", "修改"]
    };
  }

  function getAdapterActionLabels(action) {
    const selectors = getAdapterSelectors();
    if (action === "save") {
      return selectors.saveLabels;
    }
    if (action === "edit") {
      return selectors.editLabels;
    }
    return ["保存"];
  }

  function normalizeProgressPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function setAutofillProgress(stage, percent, detail = "", active = true) {
    const normalizedStage = normalizeText(stage || "", 80);
    const now = Date.now();
    const previous = autofillProgress || {};
    const sameStage = previous.active && previous.stage === normalizedStage;
    const step = getAutofillProgressStep(normalizedStage);
    autofillProgress = {
      active: Boolean(active),
      stage: normalizedStage,
      percent: normalizeProgressPercent(percent),
      detail: normalizeText(detail || "", 160),
      stepIndex: step.index,
      stepTotal: step.total,
      stepLabel: step.label,
      startedAt: previous.active && previous.startedAt ? previous.startedAt : now,
      stageStartedAt: sameStage && previous.stageStartedAt ? previous.stageStartedAt : now
    };

    renderFloatingStatus();
    if (profilePanelVisible) {
      renderProfilePanel();
    }
    updateAutofillProgressTimer();
  }

  function clearAutofillProgress(detail = "") {
    autofillInProgress = false;
    autofillProgress = { active: false, stage: "", percent: 0, detail: normalizeText(detail || "", 160) };
    renderFloatingStatus();
    if (profilePanelVisible) {
      renderProfilePanel();
    }
    updateAutofillProgressTimer();
  }

  function getAutofillProgressStep(stage) {
    const text = normalizeText(stage || "", 80);
    if (/读取本机资料|加载已保存资料|开始填写|扫描页面并准备填写|准备简历资料/.test(text)) {
      return { index: 1, total: 6, label: "准备简历资料" };
    }
    if (/扫描当前页面/.test(text)) {
      return { index: 2, total: 6, label: "扫描当前页面" };
    }
    if (/整理表单字段|AI 识别表单字段/.test(text)) {
      return { index: 3, total: 6, label: "整理表单字段" };
    }
    if (/AI 匹配字段|本地兜底匹配|匹配本地资料|AI 识别字段|整理匹配结果|匹配完成/.test(text)) {
      return { index: 4, total: 6, label: "匹配你的资料" };
    }
    if (/填写匹配项/.test(text)) {
      return { index: 5, total: 6, label: "填写表单" };
    }
    return { index: 6, total: 6, label: "完成复核" };
  }

  function updateAutofillProgressTimer() {
    if (autofillProgress.active) {
      if (!autofillProgressTimer) {
        autofillProgressTimer = window.setInterval(() => {
          renderFloatingStatus();
          if (profilePanelVisible) {
            renderProfilePanel();
          }
        }, 1000);
      }
      return;
    }

    if (autofillProgressTimer) {
      window.clearInterval(autofillProgressTimer);
      autofillProgressTimer = null;
    }
  }

  function formatElapsedTime(startedAt) {
    const start = Number(startedAt || 0);
    if (!start) {
      return "";
    }
    const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    if (seconds < 1) {
      return "";
    }
    if (seconds < 60) {
      return `${seconds} 秒`;
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  }

  function createAutofillAiState() {
    return {
      status: "idle",
      attempted: false,
      used: false,
      fallback: false,
      currentPhase: "",
      usedPhases: [],
      fallbackReasons: [],
      notes: []
    };
  }

  function resetAutofillAiState() {
    autofillAiState = createAutofillAiState();
  }

  function appendUniqueText(list, value, maxLength = 160) {
    const text = normalizeText(value || "", maxLength);
    if (!text || list.includes(text)) {
      return list;
    }
    return [...list, text];
  }

  function normalizeAutofillAiReason(reason) {
    return {
      phase: normalizeText(reason?.phase || "", 60),
      reason: normalizeText(reason?.reason || "", 180)
    };
  }

  function formatErrorMessage(error) {
    if (!error) {
      return "未知错误";
    }
    if (error instanceof Error) {
      return normalizeText(error.message || String(error), 180);
    }
    return normalizeText(String(error), 180);
  }

  function setAutofillAiTrying(phase) {
    autofillAiState = {
      ...autofillAiState,
      status: "trying",
      attempted: true,
      currentPhase: normalizeText(phase || "AI 优先匹配", 60)
    };
    renderFloatingStatus();
  }

  function setAutofillAiUsed(phase) {
    const phaseText = normalizeText(phase || "AI 优先匹配", 60);
    autofillAiState = {
      ...autofillAiState,
      status: autofillAiState.fallback ? "partial" : "used",
      attempted: true,
      used: true,
      currentPhase: "",
      usedPhases: appendUniqueText(autofillAiState.usedPhases || [], phaseText, 60)
    };
    renderFloatingStatus();
  }

  function setAutofillAiNoResult(phase, note) {
    const phaseText = normalizeText(phase || "AI 优先匹配", 60);
    const notes = appendUniqueText(autofillAiState.notes || [], note || `${phaseText}未返回可用建议`, 160);
    let status = "no-result";
    if (autofillAiState.used && autofillAiState.fallback) {
      status = "partial";
    } else if (autofillAiState.used) {
      status = "used";
    } else if (autofillAiState.fallback) {
      status = "fallback";
    }
    autofillAiState = {
      ...autofillAiState,
      status,
      attempted: true,
      currentPhase: "",
      notes
    };
    renderFloatingStatus();
  }

  function setAutofillAiFallback(phase, error) {
    const phaseText = normalizeText(phase || "AI 优先匹配", 60);
    const reason = formatErrorMessage(error);
    const nextReason = normalizeAutofillAiReason({ phase: phaseText, reason });
    const fallbackReasons = (autofillAiState.fallbackReasons || [])
      .map(normalizeAutofillAiReason)
      .filter((item) => item.phase || item.reason);
    const duplicate = fallbackReasons.some((item) => item.phase === nextReason.phase && item.reason === nextReason.reason);
    autofillAiState = {
      ...autofillAiState,
      status: autofillAiState.used ? "partial" : "fallback",
      attempted: true,
      fallback: true,
      currentPhase: "",
      fallbackReasons: duplicate ? fallbackReasons : [...fallbackReasons, nextReason]
    };
    renderFloatingStatus();
  }

  function formatAutofillAiFallbackReasons(state = autofillAiState) {
    const reasons = Array.isArray(state?.fallbackReasons) ? state.fallbackReasons : [];
    return reasons
      .map(normalizeAutofillAiReason)
      .filter((item) => item.phase || item.reason)
      .map((item) => `${item.phase || "AI"}：${item.reason || "未知错误"}`)
      .join("；");
  }

  function getAutofillAiStatusText(state = autofillAiState) {
    const status = state?.status || "idle";
    const usedPhases = Array.isArray(state?.usedPhases) ? state.usedPhases.filter(Boolean).join("、") : "";
    const fallbackReasons = formatAutofillAiFallbackReasons(state);

    if (status === "trying") {
      return `正在用 AI 优先匹配字段，只发送字段名称，不发送资料值。`;
    }
    if (state?.used && state?.fallback) {
      return `AI 已优先匹配部分字段，本地规则已兜底补齐其余字段${fallbackReasons ? `：${fallbackReasons}` : ""}。`;
    }
    if (state?.used) {
      return `AI 已优先匹配字段${usedPhases ? `（${usedPhases}）` : ""}，资料取值和填写仍由浏览器本地完成。`;
    }
    if (state?.fallback) {
      return `AI 不可用，已切换到本地规则兜底${fallbackReasons ? `：${fallbackReasons}` : ""}。`;
    }
    if (status === "no-result" || state?.attempted) {
      return "AI 没有提供可用匹配，本次改用本地规则兜底。";
    }
    return "未调用 AI，本次使用本地规则。";
  }

  function getAutofillModeBadgeText(state = autofillAiState, progress = autofillProgress) {
    const status = state?.status || "idle";
    const phase = normalizeText(state?.currentPhase || "", 60);
    const stage = normalizeText(progress?.stage || "", 80);
    const localMatching = /本地兜底匹配|匹配本地资料|整理匹配结果|匹配完成/.test(stage);

    if (status === "trying") {
      if (/字段理解/.test(phase)) {
        return "AI · 正在优先匹配字段";
      }
      return "AI · 正在分析页面结构";
    }
    if (state?.used && state?.fallback) {
      return localMatching ? "AI 优先匹配 · 本地规则兜底" : "AI 优先匹配 + 本地规则兜底";
    }
    if (state?.fallback) {
      return localMatching ? "本地规则兜底 · AI 不可用" : "本地规则 · AI 不可用";
    }
    if (status === "no-result" || (state?.attempted && !state?.used && !state?.fallback)) {
      return localMatching ? "本地规则兜底 · AI 无匹配" : "本地规则 · AI 无可用匹配";
    }
    if (state?.used) {
      if (/填写匹配项/.test(stage)) {
        return "本地填写 · AI 不参与填写";
      }
      if (localMatching) {
        return "AI 优先匹配 · 本地整理结果";
      }
      return "AI 优先匹配 · 本地继续处理";
    }
    if (/读取本机资料|加载已保存资料|开始填写|扫描页面并准备填写|准备简历资料/.test(stage)) {
      return "本地规则 · 正在准备简历资料";
    }
    if (/扫描当前页面/.test(stage)) {
      return "本地规则 · 正在扫描页面";
    }
    if (/整理表单字段/.test(stage)) {
      return "本地规则 · 正在整理字段";
    }
    if (localMatching) {
      return "正在用本地规则匹配";
    }
    if (/填写匹配项/.test(stage)) {
      return "本地填写 · 不自动提交";
    }
    return "本地规则 · 正在处理";
  }

  function getAutofillCompletionBadgeText(state = autofillAiState) {
    const status = state?.status || "idle";
    if (state?.used && state?.fallback) {
      return "AI 优先匹配 + 本地规则兜底";
    }
    if (state?.used) {
      return "AI 优先匹配 · 本地填写";
    }
    if (state?.fallback) {
      return "本地规则完成 · AI 不可用";
    }
    if (status === "no-result" || state?.attempted) {
      return "本地规则完成 · AI 无建议";
    }
    return "本地规则完成";
  }

  function sanitizeAutofillAiUsage(aiUsage = {}) {
    const fallbackReasons = Array.isArray(aiUsage.fallbackReasons)
      ? aiUsage.fallbackReasons.map(normalizeAutofillAiReason).filter((item) => item.phase || item.reason)
      : [];
    const usedPhases = Array.isArray(aiUsage.usedPhases)
      ? aiUsage.usedPhases.map((phase) => normalizeText(phase || "", 60)).filter(Boolean)
      : [];
    const notes = Array.isArray(aiUsage.notes)
      ? aiUsage.notes.map((note) => normalizeText(note || "", 160)).filter(Boolean)
      : [];
    const state = {
      status: normalizeText(aiUsage.status || "idle", 40),
      attempted: Boolean(aiUsage.attempted),
      used: Boolean(aiUsage.used),
      fallback: Boolean(aiUsage.fallback),
      currentPhase: normalizeText(aiUsage.currentPhase || "", 60),
      usedPhases,
      fallbackReasons,
      notes
    };
    const fallbackReason = normalizeText(aiUsage.fallbackReason || formatAutofillAiFallbackReasons(state), 260);
    return {
      ...state,
      fallbackReason,
      message: normalizeText(aiUsage.message || getAutofillAiStatusText(state), 300)
    };
  }

  function getAutofillAiSnapshot() {
    return sanitizeAutofillAiUsage(autofillAiState);
  }

  function getDisplayedProgressPercent() {
    if (!autofillProgress.active) {
      return 0;
    }
    const startedAt = Number(autofillProgress.startedAt || autofillProgress.stageStartedAt || Date.now());
    const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
    const eased = 1 - Math.exp(-elapsedSeconds / 75);
    return Math.min(96, normalizeProgressPercent(eased * 96));
  }

  function getAutofillProgressTitle() {
    if (!autofillProgress.active) {
      return "";
    }
    const label = autofillProgress.stepLabel || autofillProgress.stage || "处理当前页面";
    return /^正在/.test(label) ? label : `正在${label}`;
  }

  function getAutofillProgressDetail() {
    if (!autofillProgress.active) {
      return "";
    }
    const detail = autofillProgress.detail || "正在处理当前网页，请勿重复点击。";
    const elapsed = formatElapsedTime(autofillProgress.stageStartedAt);
    const isAiTrying = autofillAiState.status === "trying";
    if (isAiTrying && elapsed) {
      return `${detail}，正在等待 API 响应，已等待 ${elapsed}`;
    }
    if (elapsed) {
      return `${detail}，已处理 ${elapsed}`;
    }
    return detail;
  }

  function startAutofillRun(stage = "处理中") {
    if (autofillInProgress) {
      return 0;
    }

    autofillInProgress = true;
    autofillRunId += 1;
    autofillSummary = null;
    lastAutofillDebug = null;
    resetAutofillAiState();
    setAutofillProgress(stage, 4, "准备开始", true);
    logDiagnostic("Autofill Run Started", { runId: autofillRunId, stage });
    return autofillRunId;
  }

  function isCurrentAutofillRun(runId) {
    return Boolean(autofillInProgress && runId && runId === autofillRunId);
  }

  function getAutofillRuntimeState() {
    return {
      profilePanelVisible,
      profilePanelCollapsed,
      sidebarFilter,
      activeProfileCategory,
      autofillInProgress,
      autofillProgress: { ...autofillProgress },
      autofillSummary: autofillSummary ? { ...autofillSummary } : null,
      autofillAi: getAutofillAiSnapshot()
    };
  }

  function getAutofillDebugSnapshot() {
    return lastAutofillDebug
      ? {
          ...lastAutofillDebug,
          exportedAt: new Date().toISOString()
        }
      : null;
  }

  function getProfilePanelStateSnapshot() {
    return {
      profilePanelVisible,
      profilePanelCollapsed,
      sidebarFilter,
      activeProfileCategory
    };
  }

  function queueProfilePanelStateSave() {
    scheduleProfilePanelStateSave(getProfilePanelStateSnapshot());
  }

  function renderAndSaveProfilePanel(statusMessage = "", isError = false) {
    renderProfilePanel();
    if (statusMessage) {
      setProfilePanelStatus(statusMessage, isError);
    }
    queueProfilePanelStateSave();
  }

  function goProfilePanelHome() {
    activeProfileCategory = "";
    sidebarFilter = "";
    renderAndSaveProfilePanel("已返回主页。");
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error("Extension runtime unavailable."));
        return;
      }

      let settled = false;
      try {
        const p = chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Runtime message failed."));
            return;
          }
          resolve(response.data);
        });
        if (p && typeof p.then === "function") {
          p.then((res) => {
            if (settled) return;
            settled = true;
            if (res && res.ok === false) {
              reject(new Error(res.error || "Runtime message failed."));
            } else {
              resolve(res?.data);
            }
          }).catch((err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  function scheduleProfilePanelStateSave(patch = {}) {
    if (profilePanelStateSaveTimer) {
      clearTimeout(profilePanelStateSaveTimer);
    }

    profilePanelStateSaveTimer = setTimeout(() => {
      profilePanelStateSaveTimer = null;
      void persistProfilePanelState(patch);
    }, PROFILE_PANEL_STATE_DEBOUNCE_MS);
  }

  async function persistProfilePanelState(patch = {}) {
    try {
      await sendRuntimeMessage({
        type: "OJAF_SAVE_PROFILE_PANEL_STATE",
        payload: {
          pageKey: getPageKey(),
          patch
        }
      });
    } catch {
      // Session state is an enhancement only; continue without persistence.
    }
  }

  async function restoreProfilePanelState() {
    if (profilePanelStateRestored) {
      return;
    }
    profilePanelStateRestored = true;

    try {
      const state = await sendRuntimeMessage({
        type: "OJAF_GET_PROFILE_PANEL_STATE",
        payload: {
          pageKey: getPageKey()
        }
      });

      if (!state) {
        return;
      }

      profilePanelVisible = Boolean(state.profilePanelVisible);
      profilePanelCollapsed = Boolean(state.profilePanelCollapsed);
      sidebarFilter = normalizeText(state.sidebarFilter || "", 80);
      activeProfileCategory = normalizeText(state.activeProfileCategory || "", 80);

      if (profilePanelVisible) {
        const panel = ensureProfilePanel();
        panel.setAttribute(PANEL_HIDDEN_ATTR, "false");
        panel.setAttribute(PANEL_COLLAPSED_ATTR, profilePanelCollapsed ? "true" : "false");
        renderProfilePanel();
      }
    } catch {
      // No persisted state available.
    }
  }

  function compactText(value) {
    return normalizeText(value, 900)
      .replace(/[\s|*＊:：,，.。;；()（）[\]【】<>《》"'“”‘’/\\-]/g, "")
      .toLowerCase();
  }

  function textMatchScore(source, target) {
    const sourceText = compactText(source);
    const targetText = compactText(target);

    if (!sourceText || !targetText) {
      return 0;
    }

    if (sourceText === targetText) {
      return 5;
    }

    if (sourceText.includes(targetText) || targetText.includes(sourceText)) {
      return 4;
    }

    const sourceTokens = new Set(
      normalizeText(source, 900)
        .toLowerCase()
        .split(/[\s|*＊:：,，.。;；()（）[\]【】<>《》"'“”‘’/\\-]+/)
        .filter((token) => token.length > 1)
    );
    const targetTokens = normalizeText(target, 900)
      .toLowerCase()
      .split(/[\s|*＊:：,，.。;；()（）[\]【】<>《》"'“”‘’/\\-]+/)
      .filter((token) => token.length > 1);

    let overlap = 0;
    for (const token of targetTokens) {
      if (sourceTokens.has(token)) {
        overlap += 1;
      }
    }

    return Math.min(3, overlap);
  }

  function getButtonText(element) {
    if (!element) {
      return "";
    }

    return normalizeText(
      element.innerText ||
        element.textContent ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.getAttribute("value") ||
        ""
    );
  }

  function isActionControl(element, labels) {
    if (!element || !(element instanceof Element) || !isVisible(element)) {
      return false;
    }

    if (element.disabled || element.getAttribute("aria-disabled") === "true") {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    const isClickable =
      tagName === "button" ||
      role === "button" ||
      (element instanceof HTMLInputElement && ["button", "submit"].includes(element.type));

    if (!isClickable) {
      return false;
    }

    const text = getButtonText(element);
    return labels.some((label) => text === label || text.includes(label));
  }

  function clickActionElement(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    try {
      element.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {}
    const MouseEvt = typeof MouseEvent !== "undefined" ? MouseEvent : CustomEvent;
    try {
      element.dispatchEvent(new MouseEvt("mousedown", { bubbles: true, cancelable: true, view: typeof window !== "undefined" ? window : null }));
      element.dispatchEvent(new MouseEvt("mouseup", { bubbles: true, cancelable: true, view: typeof window !== "undefined" ? window : null }));
    } catch {}
    if (typeof element.click === "function") {
      element.click();
    }
    return true;
  }

  function getOrCreateFieldId(element) {
    let fieldId = element.getAttribute(FIELD_ATTR);
    if (!fieldId) {
      fieldCounter += 1;
      fieldId = `arf_${Date.now().toString(36)}_${fieldCounter}`;
      element.setAttribute(FIELD_ATTR, fieldId);
    }
    return fieldId;
  }

  function getElementText(element) {
    if (!element) {
      return "";
    }
    return normalizeText(element.innerText || element.textContent || "");
  }

  function getTextWithoutControls(element) {
    if (!element) {
      return "";
    }

    const clone = element.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, button, script, style, svg").forEach((node) => {
      node.remove();
    });
    return normalizeText(clone.innerText || clone.textContent || "");
  }

  function getLabelByFor(element) {
    if (!element.id) {
      return "";
    }

    const escapedId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(element.id) : element.id;
    const label = document.querySelector(`label[for="${escapedId}"]`);
    return getElementText(label);
  }

  function getAriaLabelText(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return normalizeText(ariaLabel);
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (!labelledBy) {
      return "";
    }

    return normalizeText(
      labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(getElementText)
        .join(" ")
    );
  }

  function getClosestDataAttributeValue(element, attributeNames, maxDepth = 6) {
    let current = element;
    for (let depth = 0; current && depth <= maxDepth; depth += 1, current = current.parentElement) {
      if (!(current instanceof Element)) {
        continue;
      }
      for (const name of attributeNames) {
        const value = current.getAttribute(name);
        if (value) {
          const normalized = normalizeText(value, 140);
          if (normalized) {
            return normalized;
          }
        }
      }
    }
    return "";
  }

  function getDataAttributeLabelText(element) {
    return normalizeFieldLabelText(
      getClosestDataAttributeValue(element, [
        "data-form-field-i18n-name",
        "data-form-field-name",
        "data-field-label",
        "data-label",
        "data-title"
      ])
    );
  }

  function getDataAttributeSectionText(element) {
    const direct = getClosestDataAttributeValue(element, [
      "data-section-title",
      "data-module-title",
      "data-group-title"
    ], 10);
    if (direct) {
      return direct;
    }

    let current = element.parentElement;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      if (!(current instanceof Element)) {
        continue;
      }
      const scoped = current.querySelector(
        ".applyFormModuleWrapper-text,[data-section-title],[data-module-title],[class*='module-title'],[class*='section-title']"
      );
      const text = normalizeText(scoped?.textContent || "", 140);
      if (text) {
        return text;
      }
    }
    return "";
  }

  function getWrappingLabel(element) {
    const label = element.closest("label");
    return getTextWithoutControls(label);
  }

  function findFieldContainer(element) {
    const adapterSelectors = getAdapterSelectors();
    if (adapterSelectors.containerSelector) {
      const container = element.closest(adapterSelectors.containerSelector);
      if (container) {
        return container;
      }
    }

    let current = element.parentElement;
    let best = null;

    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const text = getTextWithoutControls(current);
      const className = String(current.className || "");
      const likelyField =
        /form|field|item|row|cell|control|input|el-form-item|ant-form-item/i.test(className) ||
        current.querySelector("label") ||
        /[:：*]/.test(text);

      if (likelyField && text && text.length <= 180) {
        best = current;
        break;
      }

      if (!best && text && text.length <= 120) {
        best = current;
      }
    }

    return best || element.parentElement;
  }

  function getNearbyText(element) {
    const parts = [];
    const container = findFieldContainer(element);

    parts.push(getLabelByFor(element));
    parts.push(getWrappingLabel(element));
    parts.push(getAriaLabelText(element));
    parts.push(getDataAttributeLabelText(element));
    parts.push(getAdapterLabelText(element));
    parts.push(getDataAttributeSectionText(element));

    if (container) {
      parts.push(getTextWithoutControls(container));

      let previous = container.previousElementSibling;
      for (let i = 0; previous && i < 3; i += 1, previous = previous.previousElementSibling) {
        const text = getElementText(previous);
        if (text && text.length <= 120) {
          parts.push(text);
          break;
        }
      }
    }

    parts.push(element.getAttribute("placeholder"));
    parts.push(element.getAttribute("name"));
    parts.push(element.getAttribute("id"));
    parts.push(element.getAttribute("title"));

    return normalizeText([...new Set(parts.filter(Boolean))].join(" | "), 420);
  }

  function getFieldOptionLabelsText(field, maxLength = 180) {
    const options = Array.isArray(field?.options) ? field.options : [];
    const labels = options
      .map((option) => normalizeText(option?.label || option?.value || "", 40))
      .filter(Boolean);
    return normalizeText([...new Set(labels)].join(" | "), maxLength);
  }

  function normalizeFieldLabelText(value, maxLength = 90) {
    return normalizeText(value, maxLength)
      .replace(/^[*＊•\s]+/, "")
      .replace(/[:：]\s*$/, "")
      .replace(/^(请输入|请选择|请填写|请写明|点击选择)\s*/, "")
      .replace(/\s*(请输入|请选择|点击选择|选择)$/, "")
      .trim();
  }

  function isOptionOnlyLabel(value) {
    const text = normalizeText(value, 120);
    const key = compactText(text);
    if (!key) {
      return false;
    }
    if (/^(男|女|男女|是|否|是否|否是|有|无|有无|未参加|参加过|至今|填写结束时间|长期有效|填写有效期)$/i.test(key)) {
      return true;
    }
    return (
      key.length <= 80 &&
      (
        /^(离婚|离异|丧偶|已婚|未婚){2,}$/.test(key) ||
        /^(博士研究生|硕士研究生|大学本科|大学专科|中等专科|职业高中|技工学校|普通高中|其他|无){2,}$/.test(key) ||
        /^(博士|硕士|学士|其他|无){2,}$/.test(key) ||
        /^(A型|B型|AB型|O型|其他){2,}$/i.test(key) ||
        /^(全日制|非全日制|无数据){1,3}$/.test(key)
      )
    );
  }

  function isGenericFieldLabel(value) {
    const text = normalizeFieldLabelText(value, 80);
    return !text || /^(请输入|请选择|请填写|选择|内容列表|分数|总分数|日期|时间)$/i.test(text);
  }

  function extractFieldContainerLabel(container) {
    if (!container) {
      return "";
    }

    const text = getTextWithoutControls(container);
    if (!text) {
      return "";
    }

    const requiredMatches = Array.from(text.matchAll(/[*＊]\s*([^:：\n]{1,70})\s*[:：]/g));
    if (requiredMatches.length > 0) {
      return normalizeFieldLabelText(requiredMatches[0][1]);
    }

    const matches = Array.from(text.matchAll(/([^:：\n]{1,70})\s*[:：]/g));
    if (matches.length > 0) {
      return normalizeFieldLabelText(matches[0][1]);
    }

    return normalizeFieldLabelText(text.split(/\s{2,}|\|/)[0], 90);
  }

  function getPlaceholderDerivedLabel(placeholder, containerText = "") {
    const text = normalizeText(placeholder, 100);
    const context = compactText(containerText);
    if (!text) {
      return "";
    }

    if (/GPA|平均学分成绩/i.test(text)) {
      return "GPA分数";
    }
    if (/没有班级排名/.test(text)) {
      return "无班级排名原因";
    }
    if (/没有专业排名/.test(text)) {
      return "无专业排名原因";
    }
    if (/其他行业属性/.test(text)) {
      return "其他行业属性";
    }
    if (/工作内容描述/.test(text)) {
      return "工作内容描述";
    }
    if (/受到奖励|学术成果/.test(text)) {
      return "受到奖励/学术成果";
    }
    if (/社会\/?校园活动/.test(text)) {
      return "社会/校园活动";
    }
    if (/爱好|专长/.test(text)) {
      return "爱好及专长";
    }
    if (/自我评价/.test(text)) {
      return "自我评价";
    }
    if (/总分数/.test(text)) {
      return "高考总分";
    }
    if (/分数/.test(text) && /六级/.test(context)) {
      return "六级分数";
    }
    if (/分数/.test(text) && /四级/.test(context)) {
      return "四级分数";
    }
    if (/分数/.test(text) && /托福|toefl/i.test(context)) {
      return "TOEFL分数";
    }
    if (/分数/.test(text) && /雅思|ielts/i.test(context)) {
      return "IELTS分数";
    }
    if (/分数/.test(text) && /gre/i.test(context)) {
      return "GRE分数";
    }
    if (/分数/.test(text) && /gmat/i.test(context)) {
      return "GMAT分数";
    }
    if (/分数/.test(text)) {
      return "考试分数";
    }

    const cleaned = normalizeFieldLabelText(text);
    return /^(日期|时间|请输入|请选择|请填写)$/.test(cleaned) ? "" : cleaned;
  }

  function getGroupedControlInfo(container, element) {
    if (!container) {
      return { controls: [], index: -1 };
    }

    const controls = Array.from(container.querySelectorAll(CONTROL_SELECTOR))
      .filter((item, index, array) => array.indexOf(item) === index)
      .filter((item) => !item.closest(`#${PANEL_ID}`))
      .filter(isVisible);

    const index = controls.findIndex((item) => item === element || item.contains(element) || element.contains(item));
    return { controls, index };
  }

  function getRepeatGroupLabelText(element) {
    const root = findRepeatItemRoot(element);
    if (!root) {
      return "";
    }

    const controls = Array.from(root.querySelectorAll(CONTROL_SELECTOR))
      .filter((item, index, array) => array.indexOf(item) === index)
      .filter((item) => !item.closest(`#${PANEL_ID}`))
      .filter(isVisible);
    const labels = controls
      .map(getControlContextLabel)
      .filter((label) => label && !isOptionOnlyLabel(label) && !/OpenJobAutofill/.test(label));

    return normalizeText([...new Set(labels)].join(" | "), 360);
  }

  function getControlContextLabel(control) {
    const container = findFieldContainer(control);
    return normalizeFieldLabelText(
      extractFieldContainerLabel(container) ||
        getDataAttributeLabelText(control) ||
        getAdapterLabelText(control) ||
        getLabelByFor(control) ||
        getWrappingLabel(control) ||
        getAriaLabelText(control) ||
        ""
    );
  }

  function isRepeatItemRootCandidate(root) {
    if (!root || root.closest?.(`#${PANEL_ID}`)) {
      return false;
    }

    const controls = Array.from(root.querySelectorAll?.(CONTROL_SELECTOR) || []).filter(isVisible);
    if (controls.length < 2 || controls.length > 24) {
      return false;
    }

    const text = getTextWithoutControls(root);
    return Boolean(text && text.length <= 2600);
  }

  function getLocationGroupedLabel(context, index) {
    if (index < 0) {
      return "";
    }

    const suffixes = ["省", "市", "区县"];
    const suffix = suffixes[index] || `第${index + 1}项`;
    const groups = [
      [/工作\/实习地点|工作实习地点|实习地点|工作地点/, "工作/实习地点"],
      [/现户口所在地|当前户口所在地|户口所在地/, "现户口所在地"],
      [/生源地/, "生源地"],
      [/籍贯/, "籍贯"],
      [/高考所在地|高考省份/, "高考所在地"]
    ];

    for (const [pattern, label] of groups) {
      if (pattern.test(context)) {
        return `${label}${suffix}`;
      }
    }

    return "";
  }

  function disambiguateGroupedFieldLabel(element, label, container, placeholder) {
    const containerText = getTextWithoutControls(container);
    const context = compactText([label, containerText, placeholder].join(" "));
    const { controls, index } = getGroupedControlInfo(container, element);
    const type = getControlType(element);

    if (controls.length >= 2) {
      const locationLabel = getLocationGroupedLabel(context, index);
      if (locationLabel) {
        return locationLabel;
      }
    }

    if (/平均学分成绩gpa/.test(context)) {
      if (/分数|数字/.test(compactText(placeholder)) || element instanceof HTMLInputElement) {
        return "GPA分数";
      }
      if (type === "combobox" || type === "select") {
        return "GPA满分";
      }
      return "平均学分成绩（GPA）";
    }

    if (/有无班级排名/.test(context)) {
      if (/原因/.test(context) || element instanceof HTMLInputElement) {
        return "无班级排名原因";
      }
      if (type === "combobox" || type === "select") {
        return "班级排名";
      }
      return "有无班级排名";
    }

    if (/有无专业排名/.test(context)) {
      if (/原因/.test(context) || element instanceof HTMLInputElement) {
        return "无专业排名原因";
      }
      if (type === "combobox" || type === "select") {
        return "专业排名";
      }
      return "有无专业排名";
    }

    if (/本段经历升学类型/.test(context)) {
      if (/总分/.test(context)) {
        return "高考总分";
      }
      if (/分数/.test(context) && (type === "number" || type === "text")) {
        return "考试分数";
      }
      return "本段经历升学类型";
    }

    if (/竞赛/.test(context)) {
      if (/项目/.test(context)) {
        return "竞赛项目";
      }
      if (/奖项/.test(context)) {
        return "竞赛奖项";
      }
      if (/时间|日期/.test(context)) {
        return "竞赛时间";
      }
    }

    for (const test of [
      ["六级", "六级"],
      ["四级", "四级"],
      ["toefl", "TOEFL"],
      ["ielts", "IELTS"],
      ["gre", "GRE"],
      ["gmat", "GMAT"]
    ]) {
      const [needle, title] = test;
      if (context.includes(needle)) {
        if (/分数/.test(context)) {
          return `${title}分数`;
        }
        if (/获得时间|取得时间/.test(context)) {
          return `${title}获得时间`;
        }
        if (/有效期/.test(context)) {
          return `${title}有效期`;
        }
        return title;
      }
    }

    return label;
  }

  function extractContextualLabelFromText(text) {
    const source = normalizeText(text, 500);
    if (!source) {
      return "";
    }

    const parts = source.split(/\s*\|\s*/).map((part) => normalizeText(part, 140)).filter(Boolean);
    for (const part of parts) {
      const match = part.match(/(?:^|[\s*＊])([^:：]{1,70})[:：]/);
      const label = normalizeFieldLabelText(match ? match[1] : part);
      if (
        label &&
        !isGenericFieldLabel(label) &&
        !isOptionOnlyLabel(label) &&
        !/^\d+\/\d+$/.test(label) &&
        !/请上传|请选择|请输入|无数据/.test(label)
      ) {
        return label;
      }
    }

    return "";
  }

  function improveFieldLabel(element, rawLabel, nearbyText) {
    const container = findFieldContainer(element);
    const containerLabel = extractFieldContainerLabel(container);
    const contextLabel = extractContextualLabelFromText(nearbyText);
    const placeholder = normalizeText(element.getAttribute("placeholder"), 100);
    const placeholderLabel = getPlaceholderDerivedLabel(placeholder, getTextWithoutControls(container));
    const raw = normalizeFieldLabelText(rawLabel);
    let label = raw;

    if (isGenericFieldLabel(label) || isOptionOnlyLabel(label)) {
      label = contextLabel || containerLabel || label;
    }

    if (placeholderLabel && (isGenericFieldLabel(label) || /原因|分数|行业属性|工作内容|奖励|活动|评价|专长/.test(placeholderLabel))) {
      label = placeholderLabel;
    }

    if (isGenericFieldLabel(label) || isOptionOnlyLabel(label)) {
      label = contextLabel || normalizeFieldLabelText(nearbyText.split(/\s*\|\s*/)[0]);
    }

    return disambiguateGroupedFieldLabel(element, normalizeFieldLabelText(label), container, placeholder);
  }

  function getAdapterLabelText(element) {
    const { labelSelector } = getAdapterSelectors();
    const container = findFieldContainer(element);
    if (!container || !labelSelector) {
      return "";
    }

    try {
      const labels = Array.from(container.querySelectorAll(labelSelector))
        .slice(0, 4)
        .map((label) => getElementText(label))
        .filter(Boolean);
      return normalizeText(labels.join(" | "), 160);
    } catch {
      return "";
    }
  }

  function getSectionText(element) {
    const parts = [];
    const elementRect = element.getBoundingClientRect();
    const adapterSelectors = getAdapterSelectors();
    const headingSelector = [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "legend",
      "[role='heading']",
      ".title",
      ".section-title",
      ".card-title",
      adapterSelectors.sectionSelector
    ]
      .filter(Boolean)
      .join(",");

    const pushText = (text) => {
      const normalized = normalizeSectionHeadingText(text);
      if (normalized) {
        parts.push(normalized);
        return;
      }
      const plain = normalizeText(text, 180);
      if (plain && plain.length <= 180 && /[\u4e00-\u9fa5A-Za-z]/.test(plain)) {
        parts.push(plain);
      }
    };

    pushText(getDataAttributeSectionText(element));

    let current = element.parentElement;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const headingText = getNearestScopedHeadingText(current, headingSelector, element, elementRect);
      if (headingText) {
        pushText(headingText);
      }

      let previous = current.previousElementSibling;
      for (let i = 0; previous && i < 8; i += 1, previous = previous.previousElementSibling) {
        const text = getElementText(previous);
        if (text && /[\u4e00-\u9fa5A-Za-z]/.test(text)) {
          pushText(text);
          break;
        }
      }
    }

    return normalizeText([...new Set(parts)].join(" | "), 240);
  }

  function getNearestScopedHeadingText(root, headingSelector, element, elementRect) {
    if (!root?.querySelectorAll || !headingSelector) {
      return "";
    }

    let best = null;
    let bestBottom = -Infinity;
    for (const heading of Array.from(root.querySelectorAll(headingSelector))) {
      if (!(heading instanceof Element) || heading.contains(element)) {
        continue;
      }
      const rect = heading.getBoundingClientRect();
      if (rect.bottom > elementRect.top + 8 || rect.bottom < bestBottom) {
        continue;
      }
      const text = getElementText(heading);
      if (!text || text.length > 260) {
        continue;
      }
      best = text;
      bestBottom = rect.bottom;
    }
    return best || "";
  }

  function normalizeSectionHeadingText(text) {
    const key = compactText(text);
    if (!key) {
      return "";
    }

    const sections = [
      ["基本信息", /基本信息|个人信息/],
      ["教育经历", /教育经历|教育背景/],
      ["工作经历", /工作经历/],
      ["绩效考核", /近三年年度绩效考核|绩效考核/],
      ["家庭信息", /家庭及社会关系|家庭情况|家庭信息|社会关系/],
      ["证书技能", /证书信息|证书技能|资格证书/],
      ["专业资格", /专业技术资格|职业资格|职称/],
      ["奖惩情况", /奖惩信息|奖惩情况/],
      ["自我描述", /自我评价及相关情况说明|自我评价|自我描述/],
      ["有关声明", /有关声明/]
    ];

    for (const [label, pattern] of sections) {
      if (pattern.test(key)) {
        return label;
      }
    }

    return "";
  }

  function getOptions(element) {
    if (element instanceof HTMLSelectElement) {
      return Array.from(element.options).map((option) => ({
        value: option.value,
        label: normalizeText(option.textContent)
      }));
    }

    const ariaControls = element.getAttribute("aria-controls");
    const optionRoot = ariaControls ? document.getElementById(ariaControls) : getExpandedOptionRoot(element);
    if (!optionRoot) {
      return [];
    }

    return Array.from(optionRoot.querySelectorAll('[role="option"], li, .option'))
      .slice(0, 80)
      .map((option) => ({
        value: option.getAttribute("data-value") || getElementText(option),
        label: getElementText(option)
      }))
      .filter((option) => option.label || option.value);
  }

  function getExpandedOptionRoot(element) {
    if (!element) {
      return null;
    }

    const ariaExpanded = element.getAttribute("aria-expanded");
    if (ariaExpanded === "true") {
      const popupId = element.getAttribute("aria-controls") || element.getAttribute("aria-owns");
      if (popupId) {
        const controlled = document.getElementById(popupId);
        if (controlled) {
          return controlled;
        }
      }
    }

    const closestPopup = element.closest('[role="combobox"],[class*="select"],[class*="picker"]');
    if (closestPopup) {
      const popup = closestPopup.querySelector('[role="listbox"],[role="menu"],[class*="dropdown"],[class*="option"]');
      if (popup) {
        return popup;
      }
    }

    return null;
  }

  function getControlType(element) {
    if (element instanceof HTMLTextAreaElement) {
      return "textarea";
    }

    if (element instanceof HTMLSelectElement) {
      return "select";
    }

    if (element.isContentEditable) {
      return "contenteditable";
    }

    const role = element.getAttribute("role");
    if (role === "combobox") {
      return "combobox";
    }
    if (role === "radio") {
      return "radio";
    }
    if (role === "checkbox") {
      return "checkbox";
    }

    if (element instanceof HTMLInputElement) {
      return element.type || "text";
    }

    return role || "text";
  }

  function getControlCurrentValue(element) {
    if (!element) {
      return "";
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
        return element.checked ? "checked" : "";
      }
      return normalizeText(element.value || "", 260);
    }

    if (element.isContentEditable) {
      return normalizeText(element.textContent || "", 260);
    }

    return "";
  }

  function hasMeaningfulControlValue(element, label, currentValue) {
    const value = normalizeText(currentValue, 120);
    if (!value || /^(请选择|请先选择|无数据|undefined|null)$/i.test(value)) {
      return false;
    }

    const labelKey = normalizeMatchKey(label);
    if (
      element instanceof HTMLInputElement &&
      (element.type === "number" || element.getAttribute("role") === "spinbutton") &&
      /^(0|1|0\.0+|1\.0+)$/.test(value) &&
      /身高|体重|收入|薪资|年薪/.test(labelKey)
    ) {
      return false;
    }

    return true;
  }

  function inferSectionHeading(element) {
    if (!element || !(element instanceof Element)) {
      return "";
    }

    const directFieldset = element.closest("fieldset");
    if (directFieldset) {
      const legend = directFieldset.querySelector("legend");
      if (legend) {
        const text = getElementText(legend);
        if (text) return normalizeText(text, 120);
      }
    }

    let current = element.parentElement;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      if (current.closest?.(`#${PANEL_ID}`)) {
        break;
      }

      if (current.tagName === "FIELDSET") {
        const legend = current.querySelector("legend");
        if (legend) {
          const text = getElementText(legend);
          if (text) return normalizeText(text, 120);
        }
      }

      const isContainer = current.matches?.(
        "fieldset, [class*='card'], [class*='module'], [class*='section'], [class*='block'], [class*='group'], [role='region'], [role='group']"
      );

      if (isContainer) {
        const headingEl = current.querySelector(
          "legend, h1, h2, h3, h4, [class*='title'], [class*='header'], [role='heading']"
        );
        if (headingEl && headingEl !== element && !headingEl.contains(element)) {
          const text = getElementText(headingEl);
          if (text && text.length <= 120) {
            return normalizeText(text, 120);
          }
        }
      }

      let prev = current.previousElementSibling;
      for (let s = 0; prev && s < 3; s += 1, prev = prev.previousElementSibling) {
        if (/^H[1-4]$/i.test(prev.tagName) || prev.matches?.("[class*='title'], [class*='header'], legend, [role='heading']")) {
          const text = getElementText(prev);
          if (text && text.length <= 120) {
            return normalizeText(text, 120);
          }
        }
      }
    }

    return "";
  }

  function getRepeaterIndex(element, repeatRoot) {
    if (!repeatRoot || !repeatRoot.parentElement) {
      return 0;
    }
    const parent = repeatRoot.parentElement;
    const siblings = Array.from(parent.children).filter((child) => {
      if (child.tagName !== repeatRoot.tagName) return false;
      if (repeatRoot.className && child.className) {
        const rootClasses = String(repeatRoot.className).split(/\s+/).filter(Boolean);
        const childClasses = String(child.className).split(/\s+/).filter(Boolean);
        return rootClasses.some((c) => childClasses.includes(c));
      }
      return true;
    });
    const idx = siblings.indexOf(repeatRoot);
    return idx >= 0 ? idx : 0;
  }

  function buildFieldMeta(element) {
    const adapter = getActiveSiteAdapter();
    const type = getControlType(element);
    const canFill = isWritableTarget(element);
    const rawLabel = normalizeText(
      getLabelByFor(element) ||
        getDataAttributeLabelText(element) ||
        getAdapterLabelText(element) ||
        getWrappingLabel(element) ||
        getAriaLabelText(element)
    );
    const nearbyText = getNearbyText(element);
    const label = improveFieldLabel(element, rawLabel, nearbyText);
    const ariaLabel = normalizeText(getAriaLabelText(element) || element.getAttribute("aria-label") || "");
    const currentValue = getControlCurrentValue(element);
    const groupText = getRepeatGroupLabelText(element);
    const inferredHeading = inferSectionHeading(element);
    const sectionHeading = inferredHeading || getSectionText(element);
    const repeatRoot = findRepeatItemRoot(element);
    const isRepeaterItem = Boolean(repeatRoot);
    const repeaterIndex = isRepeaterItem ? getRepeaterIndex(element, repeatRoot) : -1;

    return {
      fieldId: getOrCreateFieldId(element),
      controlType: type,
      type,
      tagName: element.tagName.toLowerCase(),
      label,
      ariaLabel,
      placeholder: normalizeText(element.getAttribute("placeholder")),
      nearbyText,
      sectionHeading,
      section: sectionHeading,
      isRepeaterItem,
      repeaterIndex,
      name: normalizeText(element.getAttribute("name")),
      id: normalizeText(element.getAttribute("id")),
      required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      readOnly: Boolean(element.readOnly || element.getAttribute("aria-readonly") === "true" || element.getAttribute("readonly") != null),
      hasCurrentValue: hasMeaningfulControlValue(element, label, currentValue),
      currentValue,
      canFill,
      groupText,
      options: getOptions(element),
      cssPath: getCssPath(element),
      siteAdapterId: adapter?.id || "",
      siteAdapterName: adapter?.name || ""
    };
  }

  function getCssPath(element) {
    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        selector += `#${CSS.escape ? CSS.escape(current.id) : current.id}`;
        parts.unshift(selector);
        break;
      }

      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }

      const className = String(current.className || "")
        .split(/\s+/)
        .filter((c) => c && /^[a-zA-Z0-9_-]+$/.test(c) && !c.startsWith("ojaf-") && !c.includes("focus") && !c.includes("active"))
        .slice(0, 2)
        .join(".");
      if (className) {
        selector += `.${className}`;
      }
      selector += `:nth-of-type(${index})`;

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function collectVisibleControls(root = document) {
    return Array.from(root.querySelectorAll(CONTROL_SELECTOR))
      .filter((element, index, array) => array.indexOf(element) === index)
      .filter((element) => !element.closest(`#${PANEL_ID}`))
      .filter(isVisible);
  }

  function hasVisibleControls(root) {
    return collectVisibleControls(root).length > 0;
  }

  function looksLikeEditableSummary(text) {
    return Boolean(text && text.length >= 8 && text.length <= 1400 && /[:：]/.test(text));
  }

  function findActionRoot(actionElement) {
    let current = actionElement?.parentElement || null;
    let best = current;

    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const text = getTextWithoutControls(current);
      if (text && text.length <= 1400) {
        best = current;
        if (looksLikeEditableSummary(text)) {
          return current;
        }
      }
    }

    return best || actionElement?.parentElement || null;
  }

  function findNextClosedEditButton() {
    const buttons = Array.from(
      document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')
    );
    const editLabels = getAdapterActionLabels("edit");

    return (
      buttons.find((button) => {
        if (
          !isActionControl(button, editLabels) ||
          button.getAttribute(EDIT_ATTEMPT_ATTR) === "true"
        ) {
          return false;
        }

        const root = findActionRoot(button);
        if (!root) {
          return false;
        }

        const text = getTextWithoutControls(root);
        return looksLikeEditableSummary(text) && !hasVisibleControls(root);
      }) || null
    );
  }

  async function expandEditableCardsForScan() {
    let expanded = 0;

    for (let i = 0; i < MAX_EDIT_EXPANSIONS; i += 1) {
      const button = findNextClosedEditButton();
      if (!button) {
        break;
      }

      button.setAttribute(EDIT_ATTEMPT_ATTR, "true");
      clickActionElement(button);
      expanded += 1;
      await sleep(180);
    }

    return expanded;
  }

  async function scanForm() {
    currentSiteAdapter = detectSiteAdapter();
    const expandedEditCards = await expandEditableCardsForScan();
    const controls = collectVisibleControls();

    const fields = controls.map((element) => buildFieldMeta(element));
    const adapter = getActiveSiteAdapter();

    return {
      url: location.href,
      hostname: location.hostname,
      title: document.title,
      siteAdapter: adapter
        ? {
            id: adapter.id || "",
            name: adapter.name || "",
            confidence: adapter.confidence || 0
          }
        : null,
      scannedAt: new Date().toISOString(),
      expandedEditCards,
      fields
    };
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${MARK_ATTR}="filled"] {
        outline: 2px solid #19a974 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(25, 169, 116, 0.14) !important;
      }
      [${MARK_ATTR}="uncertain"] {
        outline: 2px solid #f5a623 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(245, 166, 35, 0.18) !important;
      }
      [${MARK_ATTR}="error"] {
        outline: 2px solid #f5a623 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(245, 166, 35, 0.18) !important;
      }
      #${FLOAT_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: min(360px, calc(100vw - 36px));
        padding: 14px;
        border: 1px solid rgba(38, 58, 44, 0.14);
        border-radius: 18px;
        background:
          linear-gradient(180deg, rgba(255, 253, 247, 0.98), rgba(249, 244, 234, 0.96)),
          radial-gradient(circle at 0% 0%, rgba(15, 107, 79, 0.13), transparent 42%);
        box-shadow: 0 18px 58px rgba(32, 33, 36, 0.18);
        z-index: 2147483645;
        color: #202124;
        font: 13px/1.45 ui-serif, Georgia, "Times New Roman", "Noto Serif SC", serif;
      }
      #${FLOAT_ID}[hidden] {
        display: none;
      }
      #${FLOAT_ID} * {
        box-sizing: border-box;
      }
      #${FLOAT_ID} .arf-float-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      #${FLOAT_ID} .arf-float-title {
        color: #26231e;
        font-size: 15px;
        font-weight: 700;
      }
      #${FLOAT_ID} .arf-float-detail {
        margin-top: 3px;
        color: #6f6a60;
        font-size: 12px;
      }
      #${FLOAT_ID} .arf-float-privacy {
        margin-top: 8px;
        padding: 8px 10px;
        border: 1px solid rgba(15, 107, 79, 0.14);
        border-radius: 12px;
        background: rgba(15, 107, 79, 0.07);
        color: #4d6458;
        font-size: 11px;
        line-height: 1.45;
      }
      #${FLOAT_ID} .arf-float-ai {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 107, 79, 0.12);
        color: #0f6b4f;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.3;
      }
      #${FLOAT_ID} .arf-float-close {
        width: 26px;
        min-width: 26px;
        height: 26px;
        border: 1px solid #ded6c8;
        border-radius: 9px;
        background: #fff;
        color: #4b463f;
        cursor: pointer;
      }
      #${FLOAT_ID} .arf-float-progress {
        margin-top: 11px;
      }
      #${FLOAT_ID} .arf-float-track {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(15, 107, 79, 0.12);
      }
      #${FLOAT_ID} .arf-float-fill {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #0f6b4f, #d48a1f);
        transition: width 0.25s ease;
      }
      #${FLOAT_ID} .arf-float-chips {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }
      #${FLOAT_ID} .arf-float-chip {
        padding: 8px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.74);
        color: #6f6a60;
        text-align: center;
      }
      #${FLOAT_ID} .arf-float-chip strong {
        display: block;
        color: #26231e;
        font-size: 18px;
        line-height: 1.1;
      }
      #${FLOAT_ID} .arf-float-chip.is-ok strong {
        color: #0f6b4f;
      }
      #${FLOAT_ID} .arf-float-chip.is-warn strong {
        color: #bf7a18;
      }
      #${FLOAT_ID} .arf-float-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      #${FLOAT_ID} .arf-float-actions button {
        flex: 1;
        min-height: 34px;
        border: 0;
        border-radius: 11px;
        background: #0f6b4f;
        color: #fff;
        cursor: pointer;
      }
      #${FLOAT_ID} .arf-float-actions button.secondary {
        border: 1px solid #0f6b4f;
        background: transparent;
        color: #0f6b4f;
      }
      #${PANEL_ID} {
        position: fixed;
        top: 8px;
        right: 0;
        width: min(430px, calc(100vw - 28px));
        height: calc(100dvh - 16px);
        max-height: calc(100dvh - 16px);
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px 16px max(18px, env(safe-area-inset-bottom));
        border: 0;
        border-left: 1px solid rgba(38, 58, 44, 0.16);
        border-radius: 18px 0 0 18px;
        background:
          linear-gradient(180deg, rgba(255, 253, 247, 0.99), rgba(250, 246, 236, 0.98)),
          radial-gradient(circle at 10% 0%, rgba(15, 107, 79, 0.1), transparent 32%);
        box-shadow: -18px 0 48px rgba(34, 34, 34, 0.16);
        z-index: 2147483646;
        font-size: 13px;
        color: #202124;
        overflow: hidden;
      }
      @supports not (height: 100dvh) {
        #${PANEL_ID} {
          height: calc(100vh - 16px);
          max-height: calc(100vh - 16px);
        }
      }
      #${PANEL_ID}[${PANEL_HIDDEN_ATTR}="true"] {
        display: none;
      }
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] {
        top: calc(50vh - 76px);
        width: 46px;
        height: 152px;
        padding: 6px;
        border: 1px solid rgba(38, 58, 44, 0.16);
        border-right: 0;
        border-radius: 14px 0 0 14px;
      }
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-body,
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-footer,
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-subtitle,
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-home,
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-close {
        display: none;
      }
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-header {
        height: 100%;
        align-items: center;
        justify-content: center;
      }
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-title {
        display: none;
      }
      #${PANEL_ID}[${PANEL_COLLAPSED_ATTR}="true"] .arf-toggle {
        width: 34px;
        height: 132px;
        min-height: 132px;
        padding: 0;
        writing-mode: vertical-rl;
        letter-spacing: 0.16em;
      }
      #${PANEL_ID} * {
        box-sizing: border-box;
      }
      #${PANEL_ID} .arf-body {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
        overflow-y: auto;
        padding: 0 3px 8px 0;
        overscroll-behavior: contain;
      }
      #${PANEL_ID} .arf-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      #${PANEL_ID} .arf-title {
        font-size: 18px;
        font-weight: 700;
      }
      #${PANEL_ID} .arf-subtitle {
        margin-top: 2px;
        color: #6f6a60;
        line-height: 1.45;
      }
      #${PANEL_ID} .arf-close {
        width: 28px;
        min-height: 28px;
        border: 1px solid #ded6c8;
        border-radius: 8px;
        background: #fff;
        color: #333;
      }
      #${PANEL_ID} .arf-home,
      #${PANEL_ID} .arf-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 28px;
        min-height: 28px;
        padding: 0;
        border: 1px solid #ded6c8;
        border-radius: 8px;
        background: #fff;
        color: #333;
        cursor: pointer;
      }
      #${PANEL_ID} .arf-header-actions {
        display: flex;
        flex: none;
        align-items: center;
        gap: 6px;
      }
      #${PANEL_ID} .arf-search {
        width: 100%;
        min-height: 40px;
        padding: 0 12px;
        border: 1px solid #ded6c8;
        border-radius: 13px;
        background: #fffdf8;
        color: #202124;
        font: inherit;
      }
      #${PANEL_ID} .arf-content {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #${PANEL_ID} .arf-overview {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }
      #${PANEL_ID} .arf-category-card {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        width: 100%;
        padding: 14px;
        border: 1px solid #e2d8c8;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.74);
        color: #202124;
        text-align: left;
        cursor: pointer;
      }
      #${PANEL_ID} .arf-category-card:hover {
        border-color: rgba(15, 107, 79, 0.35);
        background: #fffdf8;
      }
      #${PANEL_ID} .arf-category-title {
        font-size: 15px;
        font-weight: 700;
        color: #26231e;
      }
      #${PANEL_ID} .arf-category-note {
        margin-top: 5px;
        color: #7a7164;
        font-size: 12px;
        line-height: 1.45;
      }
      #${PANEL_ID} .arf-category-count {
        align-self: start;
        min-width: 34px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(15, 107, 79, 0.12);
        color: #0f6b4f;
        font-size: 12px;
        font-weight: 700;
        text-align: center;
      }
      #${PANEL_ID} .arf-detail-head {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0 4px;
        background: linear-gradient(180deg, rgba(255, 253, 247, 0.99), rgba(255, 253, 247, 0.88));
      }
      #${PANEL_ID} .arf-back {
        min-height: 32px;
        padding: 0 11px;
        border: 1px solid #ded6c8;
        border-radius: 10px;
        background: #fff;
        color: #4b463f;
        cursor: pointer;
      }
      #${PANEL_ID} .arf-detail-title {
        font-size: 16px;
        font-weight: 700;
      }
      #${PANEL_ID} .arf-detail-card {
        padding: 14px;
        border: 1px solid #e2d8c8;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.78);
      }
      #${PANEL_ID} .arf-subsection-title {
        margin: 2px 0 10px;
        color: #0f6b4f;
        font-size: 13px;
        font-weight: 700;
      }
      #${PANEL_ID} .arf-readable {
        user-select: text;
        -webkit-user-select: text;
      }
      #${PANEL_ID} .arf-row {
        display: grid;
        grid-template-columns: minmax(84px, 0.38fr) minmax(0, 1fr);
        gap: 10px;
        padding: 7px 0;
        border-top: 1px dashed rgba(222, 214, 200, 0.82);
        line-height: 1.55;
      }
      #${PANEL_ID} .arf-row:first-child {
        border-top: 0;
        padding-top: 0;
      }
      #${PANEL_ID} .arf-row-label {
        color: #7a7164;
        font-size: 12px;
      }
      #${PANEL_ID} .arf-row-value {
        color: #26231e;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${PANEL_ID} .arf-row-value.is-empty {
        color: #aaa196;
      }
      #${PANEL_ID} .arf-empty {
        padding: 12px;
        border: 1px dashed #ded6c8;
        border-radius: 12px;
        color: #6f6a60;
        background: #fffdf8;
        line-height: 1.5;
      }
      #${PANEL_ID} .arf-footer {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex-shrink: 0;
        padding: 8px 0 0;
        border-top: 1px solid rgba(231, 223, 209, 0.9);
        background: linear-gradient(180deg, rgba(250, 246, 236, 0), rgba(250, 246, 236, 0.98) 18%);
      }
      #${PANEL_ID} .arf-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      #${PANEL_ID} .arf-actions button {
        min-height: 34px;
        border: 0;
        border-radius: 10px;
        background: #0f6b4f;
        color: #fff;
        cursor: pointer;
      }
      #${PANEL_ID} .arf-actions button.secondary {
        background: #eaf2ed;
        color: #0f6b4f;
      }
      #${PANEL_ID} .arf-actions button.ghost {
        background: #f5f1e8;
        color: #4b463f;
      }
      #${PANEL_ID} .arf-actions button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      #${PANEL_ID} .arf-meta {
        color: #6f6a60;
        font-size: 12px;
        line-height: 1.45;
      }
      #${PANEL_ID} .arf-progress {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      #${PANEL_ID} .arf-progress[hidden] {
        display: none;
      }
      #${PANEL_ID} .arf-progress-track {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(15, 107, 79, 0.12);
      }
      #${PANEL_ID} .arf-progress-fill {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #0f6b4f, #d48a1f);
        transition: width 0.25s ease;
      }
      #${PANEL_ID} .arf-progress-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #6f6a60;
        font-size: 11px;
        line-height: 1.35;
      }
      #${PANEL_ID} .arf-progress-meta span:last-child {
        min-width: 0;
        overflow: hidden;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function markElement(element, mark, title) {
    injectStyle();
    element.setAttribute(MARK_ATTR, mark);
    if (title) {
      element.setAttribute("title", title);
    }
  }

  function clearMarks() {
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((element) => {
      element.removeAttribute(MARK_ATTR);
    });
    autofillSummary = null;
    const floating = document.getElementById(FLOAT_ID);
    if (floating) {
      floating.hidden = true;
    }
  }

  function ensureFloatingStatus() {
    injectStyle();
    let floating = document.getElementById(FLOAT_ID);
    if (floating) {
      return floating;
    }

    floating = document.createElement("div");
    floating.id = FLOAT_ID;
    floating.hidden = true;
    floating.innerHTML = `
      <div class="arf-float-head">
        <div>
          <div class="arf-float-title" data-role="float-title">简历填写中</div>
          <div class="arf-float-detail" data-role="float-detail">正在准备...</div>
        </div>
        <button class="arf-float-close" type="button" data-action="float-hide" title="隐藏">×</button>
      </div>
      <div class="arf-float-privacy">隐私：资料仅保存在浏览器本地；绝不扫描电脑硬盘，也不会自动提交。</div>
      <div class="arf-float-ai" data-role="float-ai" hidden></div>
      <div class="arf-float-progress" data-role="float-progress">
        <div class="arf-float-track">
          <div class="arf-float-fill" data-role="float-fill"></div>
        </div>
      </div>
      <div class="arf-float-chips" data-role="float-chips" hidden></div>
      <div class="arf-float-actions">
        <button type="button" data-action="float-detail">打开资料面板</button>
        <button class="secondary" type="button" data-action="float-clear">清除颜色标记</button>
      </div>
    `;

    floating.querySelector('[data-action="float-hide"]')?.addEventListener("click", () => {
      floating.hidden = true;
    });
    floating.querySelector('[data-action="float-detail"]')?.addEventListener("click", () => {
      showProfilePanel();
      renderProfilePanel();
    });
    floating.querySelector('[data-action="float-clear"]')?.addEventListener("click", clearMarks);

    document.documentElement.appendChild(floating);
    return floating;
  }

  function setAutofillSummary(summary) {
    const failed = Number(summary?.failed || 0);
    const skipped = Number(summary?.skipped || 0);
    autofillSummary = {
      attempted: Number(summary?.attempted || 0),
      filled: Number(summary?.filled || 0),
      failed,
      skipped,
      pending: Number(summary?.pending ?? skipped + failed),
      total: Number(summary?.total || 0),
      message: normalizeText(summary?.message || "", 160),
      aiUsage: sanitizeAutofillAiUsage(summary?.aiUsage || getAutofillAiSnapshot())
    };
    renderFloatingStatus();
  }

  function renderFloatingStatus() {
    const shouldShow = Boolean(autofillProgress.active || autofillSummary);
    const floating = ensureFloatingStatus();
    floating.hidden = !shouldShow;
    if (!shouldShow) {
      return;
    }

    const title = floating.querySelector('[data-role="float-title"]');
    const detail = floating.querySelector('[data-role="float-detail"]');
    const aiFlag = floating.querySelector('[data-role="float-ai"]');
    const progress = floating.querySelector('[data-role="float-progress"]');
    const fill = floating.querySelector('[data-role="float-fill"]');
    const chips = floating.querySelector('[data-role="float-chips"]');

    if (autofillProgress.active) {
      const modeBadge = getAutofillModeBadgeText(autofillAiState, autofillProgress);
      if (title) {
        title.textContent = getAutofillProgressTitle() || "正在填写";
      }
      if (detail) {
        detail.textContent = getAutofillProgressDetail();
      }
      if (progress) {
        progress.hidden = false;
      }
      if (fill) {
        fill.style.width = `${getDisplayedProgressPercent()}%`;
      }
      if (chips) {
        chips.hidden = true;
        chips.textContent = "";
      }
      if (aiFlag) {
        aiFlag.hidden = !modeBadge;
        aiFlag.textContent = modeBadge || "";
      }
      return;
    }

    const summary = autofillSummary || {};
    const modeBadge = getAutofillCompletionBadgeText(summary.aiUsage || autofillAiState);
    if (title) {
      title.textContent = "填写完成";
    }
    if (detail) {
      detail.textContent = summary.message || "请直接在页面上检查绿色已填写和橙色待处理标记。";
    }
    if (progress) {
      progress.hidden = true;
    }
    if (chips) {
      chips.hidden = false;
      chips.innerHTML = `
        <div class="arf-float-chip is-ok"><strong>${summary.filled || 0}</strong>已填写</div>
        <div class="arf-float-chip is-warn"><strong>${summary.pending || 0}</strong>待处理</div>
      `;
    }
    if (aiFlag) {
      aiFlag.hidden = !modeBadge;
      aiFlag.textContent = modeBadge || "";
    }
  }

  function setProfilePanelStatus(message, isError = false) {
    const panel = ensureProfilePanel();
    const statusEl = panel.querySelector('[data-role="status"]');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b23b3b" : "#6f6a60";
    }
  }

  function setProfilePanelVisible(nextVisible) {
    profilePanelVisible = Boolean(nextVisible);
    const panel = ensureProfilePanel();
    panel.setAttribute(PANEL_HIDDEN_ATTR, profilePanelVisible ? "false" : "true");
    panel.setAttribute(PANEL_COLLAPSED_ATTR, profilePanelCollapsed ? "true" : "false");
    if (profilePanelVisible) {
      renderAndSaveProfilePanel();
    } else {
      queueProfilePanelStateSave();
    }
  }

  function showProfilePanel() {
    setProfilePanelVisible(true);
    void refreshCurrentProfile();
  }

  function toggleProfilePanelCollapsed() {
    profilePanelCollapsed = !profilePanelCollapsed;
    renderAndSaveProfilePanel();
  }

  function ensureProfilePanel() {
    injectStyle();
    if (profilePanel && (typeof document.contains === "function" ? document.contains(profilePanel) : Boolean(profilePanel.parentElement))) {
      return profilePanel;
    }

    const stalePanel = document.getElementById(PANEL_ID);
    if (stalePanel) {
      stalePanel.remove();
    }

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.setAttribute(PANEL_HIDDEN_ATTR, "true");
    panel.setAttribute(PANEL_COLLAPSED_ATTR, "false");

    const header = document.createElement("div");
    header.className = "arf-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "arf-title";
    title.textContent = "OpenJobAutofill";
    const subtitle = document.createElement("div");
    subtitle.className = "arf-subtitle";
    subtitle.dataset.role = "subtitle";
    subtitle.textContent = "执行状态与填表进度。个人简历数据严格隔离在插件页面中保护隐私。";
    titleWrap.append(title, subtitle);

    const headerActions = document.createElement("div");
    headerActions.className = "arf-header-actions";

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "arf-toggle";
    collapseBtn.dataset.action = "collapse";
    collapseBtn.textContent = "收起";
    collapseBtn.addEventListener("click", toggleProfilePanelCollapsed);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "arf-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => setProfilePanelVisible(false));
    headerActions.append(collapseBtn, closeBtn);
    header.append(titleWrap, headerActions);

    const body = document.createElement("div");
    body.className = "arf-body";

    const content = document.createElement("div");
    content.className = "arf-content";
    content.dataset.role = "quick-copy-list";
    content.textContent = "简历数据安全隔离：资料仅在插件设置页中查看与编辑，当前页面不暴露任何私密文本。";

    const status = document.createElement("div");
    status.className = "arf-meta";
    status.dataset.role = "status";
    status.textContent = "资料仅在浏览器本地加载（保护隐私）。";

    const progress = document.createElement("div");
    progress.className = "arf-progress";
    progress.dataset.role = "progress";
    progress.hidden = true;
    progress.innerHTML = `
      <div class="arf-progress-track">
        <div class="arf-progress-fill" data-role="progress-fill"></div>
      </div>
      <div class="arf-progress-meta">
        <span data-role="progress-stage"></span>
        <span data-role="progress-detail"></span>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "arf-actions";

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "secondary";
    refreshBtn.dataset.action = "refresh";
    refreshBtn.textContent = "刷新";
    refreshBtn.addEventListener("click", () => {
      void refreshCurrentProfile({ force: true });
    });

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "ghost";
    settingsBtn.dataset.action = "settings";
    settingsBtn.textContent = "设置";
    settingsBtn.addEventListener("click", () => {
      void openOptionsPageFromProfilePanel();
    });

    actions.append(refreshBtn, settingsBtn);

    const footer = document.createElement("div");
    footer.className = "arf-footer";

    footer.append(status, progress, actions);

    body.append(content);
    panel.append(header, body, footer);
    document.documentElement.appendChild(panel);
    profilePanel = panel;
    return panel;
  }

  async function openOptionsPageFromProfilePanel() {
    try {
      await sendRuntimeMessage({ type: "OJAF_OPEN_OPTIONS" });
      setProfilePanelStatus("已打开设置页。");
    } catch (error) {
      setProfilePanelStatus(`打开设置失败：${error.message}`, true);
    }
  }

  async function refreshCurrentProfile(options = {}) {
    if (currentProfileLoadPromise && !options.force) {
      return currentProfileLoadPromise;
    }

    currentProfileLoadPromise = (async () => {
      const snapshot = await sendRuntimeMessage({ type: "OJAF_GET_ACTIVE_PROFILE_SNAPSHOT" }).catch(() => null);
      if (snapshot?.profileV2) {
        currentProfileV2 = snapshot.profileV2;
        return currentProfileV2;
      }
      const settings = await sendRuntimeMessage({ type: "OJAF_GET_SETTINGS" });
      currentProfileV2 = settings.profileV2 || null;
      return currentProfileV2;
    })();

    try {
      const profile = await currentProfileLoadPromise;
      if (profilePanelVisible) {
        renderProfilePanel();
      }
      if (options.force && profilePanelVisible) {
        setProfilePanelStatus("已刷新简历资料。");
      }
      return profile;
    } catch (error) {
      if (profilePanelVisible) {
        setProfilePanelStatus(`加载简历资料失败：${error.message}`, true);
      }
      return null;
    } finally {
      currentProfileLoadPromise = null;
    }
  }

  function formatQuickCopyValue(value, maxLength = 64) {
    if (value == null || value === "") {
      return "";
    }

    if (typeof value === "string") {
      return normalizeText(value, maxLength);
    }

    if (typeof value === "object") {
      try {
        return normalizeText(JSON.stringify(value), maxLength);
      } catch {
        return normalizeText(String(value), maxLength);
      }
    }

    return normalizeText(String(value), maxLength);
  }

  function normalizeProfileCategory(title) {
    const text = normalizeText(title, 80);
    if (!text) {
      return "其他信息";
    }

    if (/基本|个人信息|联系方式/.test(text)) {
      return "基本信息";
    }
    if (/求职意向|意向岗位|期望薪资|期望工作|面试城市/.test(text)) {
      return "求职意向";
    }
    if (/教育|学历|学校/.test(text)) {
      return "教育经历";
    }
    if (/项目/.test(text)) {
      return "项目经历";
    }
    if (/实习|实践/.test(text)) {
      return "实习经历";
    }
    if (/工作经历/.test(text)) {
      return "工作经历";
    }
    if (/绩效考核|考核等级|考核排名/.test(text)) {
      return "绩效考核";
    }
    if (/专业技术资格|职业资格|职称/.test(text)) {
      return "专业资格";
    }
    if (/社团|校园活动/.test(text)) {
      return "社团工作";
    }
    if (/学生工作|班委|学生会|干部任职|在校职务/.test(text)) {
      return "学生工作";
    }
    if (/奖|惩|荣誉|成果/.test(text)) {
      return "奖惩情况";
    }
    if (/外语能力|外语|英语|四六级|CET|IELTS|TOEFL|GRE|GMAT/i.test(text)) {
      return "外语能力";
    }
    if (/计算机技能|IT技能|计算机能力/.test(text)) {
      return "计算机技能";
    }
    if (/证书|技能|计算机/.test(text)) {
      return "证书技能";
    }
    if (/语言|语种/i.test(text)) {
      return "语言能力";
    }
    if (/家庭|亲属|父亲|母亲|社会关系/.test(text)) {
      return "家庭信息";
    }
    if (/培训/.test(text)) {
      return "培训经历";
    }
    if (/论文|著作|刊物/.test(text)) {
      return "论文著作";
    }
    if (/专利/.test(text)) {
      return "专利成果";
    }
    if (/自我描述|自我评价|自我介绍/.test(text)) {
      return "自我描述";
    }
    if (/声明|疾病|不良|居留|任职|持股|调剂/.test(text)) {
      return "有关声明";
    }
    if (/自定义|补充/.test(text)) {
      return "自定义资料";
    }

    return text;
  }

  function getCurrentProfileSections() {
    return profileV2ToProfileSections(currentProfileV2);
  }

  function getCurrentProfileEntries() {
    const entries = [];
    for (const section of getCurrentProfileSections()) {
      for (const item of section.items) {
        const itemIndex = entries.length;
        entries.push({
          ...item,
          itemId: item.itemId || `profileV2.unknown.items[${itemIndex}].value`,
          category: section.category,
          sectionKey: section.category,
          aliases: item.aliases || buildProfileItemAliases(section, item)
        });
      }
    }
    return entries;
  }

  function hasCurrentProfileData() {
    return getCurrentProfileSections().length > 0;
  }

  function profileV2ToProfileSections(profileV2) {
    if (!profileV2 || typeof profileV2 !== "object") {
      return [];
    }

    const sections = [];
    const sourceSections = profileV2.sections && typeof profileV2.sections === "object" ? profileV2.sections : {};
    for (const [sectionKey, section] of Object.entries(sourceSections)) {
      appendProfileV2Section(sections, sectionKey, section);
    }
    for (const [index, section] of (Array.isArray(profileV2.customSections) ? profileV2.customSections : []).entries()) {
      appendProfileV2Section(sections, section.key || `custom-${index}`, section);
    }

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.label)
      }))
      .filter((section) => section.items.length > 0);
  }

  function appendProfileV2Section(sections, sectionKey, section) {
    if (!section || typeof section !== "object") {
      return;
    }

    const category = normalizeProfileCategory(section.title || sectionKey || "其他信息");
    const target = ensureProfileSection(sections, category, section.title || category);
    if (section.kind === "repeat") {
      const items = Array.isArray(section.items) ? section.items : [];
      items.forEach((item, itemIndex) => {
        const baseSubsection = normalizeText(item?.title || `${section.title || category} ${itemIndex + 1}`, 120);
        const familyRelation = category === "家庭信息" ? getFamilyRelationFromProfileItem(item, baseSubsection) : "";
        const subsection = buildProfileItemSubsection(baseSubsection, familyRelation);
        appendProfileV2Values(target, item?.values, {
          sectionKey,
          subsection,
          familyRelation,
          prefix: `profileV2.sections.${sectionKey}.items[${itemIndex}].values`
        });
        appendProfileV2CustomRows(target, item?.custom, {
          sectionKey,
          subsection,
          familyRelation,
          prefix: `profileV2.sections.${sectionKey}.items[${itemIndex}].custom`
        });
      });
      return;
    }

    appendProfileV2Values(target, section.values, {
      sectionKey,
      subsection: "",
      familyRelation: "",
      prefix: `profileV2.sections.${sectionKey}.values`
    });
    appendProfileV2CustomRows(target, section.custom, {
      sectionKey,
      subsection: "",
      familyRelation: "",
      prefix: `profileV2.sections.${sectionKey}.custom`
    });
  }

  function getFamilyRelationFromProfileItem(item, fallbackText = "") {
    const titleRelation = getFamilyRelationFromText(fallbackText);
    if (titleRelation) {
      return titleRelation;
    }

    const values = item?.values && typeof item.values === "object" ? item.values : {};
    for (const [label, value] of Object.entries(values)) {
      if (/关系|与本人关系|亲属关系/.test(normalizeMatchKey(label))) {
        const relation = getFamilyRelationFromText(value);
        if (relation) {
          return relation;
        }
      }
    }
    return "";
  }

  function buildProfileItemSubsection(baseSubsection, familyRelation) {
    const base = normalizeText(baseSubsection, 120);
    const relation = normalizeText(familyRelation, 40);
    if (!base) {
      return relation;
    }
    if (!relation || getFamilyRelationFromText(base) === relation) {
      return base;
    }
    return normalizeText(`${base} ${relation}`, 120);
  }

  function ensureProfileSection(sections, category, sourceTitle) {
    let section = sections.find((item) => item.category === category);
    if (!section) {
      section = { category, sourceTitles: [], items: [] };
      sections.push(section);
    }
    if (sourceTitle && !section.sourceTitles.includes(sourceTitle)) {
      section.sourceTitles.push(sourceTitle);
    }
    return section;
  }

  function getProfileSectionTitle(section) {
    if (!section) {
      return "";
    }

    const sourceTitle = Array.isArray(section.sourceTitles)
      ? section.sourceTitles.find((title) => Boolean(normalizeText(title, 120)))
      : "";
    return normalizeText(sourceTitle || section.category || "", 120);
  }

  function appendProfileV2Values(section, values, context) {
    if (!values || typeof values !== "object") {
      return;
    }
    let index = 0;
    for (const [label, value] of Object.entries(values)) {
      appendProfileV2Entry(section, {
        label,
        value,
        subsection: context.subsection,
        familyRelation: context.familyRelation,
        itemId: `${context.prefix}[${index}]`
      });
      index += 1;
    }
  }

  function appendProfileV2CustomRows(section, rows, context) {
    if (!Array.isArray(rows)) {
      return;
    }
    rows.forEach((row, index) => {
      appendProfileV2Entry(section, {
        label: row?.label || "",
        value: row?.value || "",
        subsection: context.subsection,
        familyRelation: context.familyRelation,
        itemId: `${context.prefix}[${index}].value`
      });
    });
  }

  function appendProfileV2Entry(section, entry) {
    const label = normalizeText(entry.label || "", 120);
    const value = String(entry.value == null ? "" : entry.value).trim();
    if (!label || !value) {
      return;
    }

    const item = {
      label,
      value,
      preview: formatQuickCopyValue(value, 96),
      hasValue: true,
      subsection: normalizeText(entry.subsection || "", 120),
      familyRelation: normalizeText(entry.familyRelation || "", 40),
      itemId: entry.itemId || `profileV2.items[${section.items.length}].value`
    };
    item.aliases = buildProfileItemAliases(section, item);
    section.items.push(item);
  }

  function normalizeMatchKey(value) {
    return compactText(value)
      .replace(/[()（）[\]【】<>《》"'“”‘’、,，。．·•\s|:：/\\-]/g, "")
      .replace(/[0-9]/g, "");
  }

  function inferFieldLabel(field) {
    const candidates = [];
    for (const value of [field?.label, field?.nearbyText, field?.placeholder, field?.name, field?.id, field?.title]) {
      const text = normalizeText(value, 280);
      if (text) {
        candidates.push(text);
      }
    }

    for (const candidate of candidates) {
      const parts = candidate.split(/\s*\|\s*/).map((part) => normalizeText(part, 120)).filter(Boolean);
      for (const part of parts) {
        const cleaned = part
          .replace(/^[*•\s]+/, "")
          .replace(/^[（(]?(必填|选填)[)）]?\s*/, "")
          .replace(/^(请输入|请选择|请填写|请写明|点击选择)\s*/, "")
          .replace(/[:：]\s*(请输入|请选择|上传文件)?$/, "")
          .replace(/\s*(请输入|请选择|点击选择|选择)$/g, "")
          .trim();
        if (
          cleaned &&
          cleaned.length <= 80 &&
          /[\u4e00-\u9fa5A-Za-z]/.test(cleaned) &&
          !/请输入|请选择|上传文件|内容列表|搜索分类或内容|OpenJobAutofill/.test(cleaned)
        ) {
          return cleaned.replace(/^[*•\s]+/, "");
        }
      }
    }

    return normalizeText(field?.label || field?.nearbyText || "", 80);
  }

  function isFamilyRelationLabel(label) {
    const key = normalizeMatchKey(label);
    return /^(关系|与本人关系|亲属关系|家庭关系|社会关系)$/.test(key);
  }

  function isFamilyMemberDetailLabel(label) {
    const key = normalizeMatchKey(label);
    return /^(姓名|出生日期|出生年月|生日|性别|政治面貌|学历|工作单位|单位名称|公司|职务|职位|岗位|联系电话|电话|手机号码|是否退休|退休情况|备注|联系地址|通讯地址|地址|住址)$/.test(key);
  }

  function isFamilyMemberLabel(label) {
    return isFamilyRelationLabel(label) || isFamilyMemberDetailLabel(label);
  }

  function getFamilyContextKey(field) {
    return compactText([
      field?.groupText,
      getFieldOptionLabelsText(field, 180),
      field?.section,
      field?.nearbyText,
      field?.label,
      field?.placeholder
    ].join(" "));
  }

  function isLikelyFamilyMemberContext(field, label = "") {
    const key = getFamilyContextKey(field);
    const labelKey = normalizeMatchKey(label || field?.label || "");
    if (!key || /紧急联系人/.test(key)) {
      return false;
    }

    if (/是否存在亲属.*(应聘单位|本行|我行)|亲属在.*(应聘单位|本行|我行)|有关声明|电子签名/.test(key)) {
      return false;
    }

    if (/家庭情况|家庭信息|家庭及社会关系|社会关系|亲属信息|亲属情况|亲属关系|与本人关系|是否退休/.test(key)) {
      return true;
    }

    if (!isFamilyMemberLabel(labelKey)) {
      return false;
    }

    const indicators = [
      /关系|与本人关系|亲属关系/,
      /姓名/,
      /出生日期|出生年月/,
      /政治面貌/,
      /学历/,
      /工作单位|单位名称|公司/,
      /职务|职位|岗位/,
      /联系电话|手机号码|电话/,
      /是否退休|退休情况/
    ];
    const indicatorCount = indicators.reduce((count, pattern) => count + (pattern.test(key) ? 1 : 0), 0);
    return /关系|与本人关系|亲属关系/.test(key) && indicatorCount >= 4;
  }

  function isFamilyScopedField(field, fieldLabel, fieldCategory) {
    return fieldCategory === "家庭信息" || isLikelyFamilyMemberContext(field, fieldLabel);
  }

  function inferMatchSection(field) {
    const label = normalizeMatchKey(field?.inferredLabel || field?.label || "");
    if (isLikelyFamilyMemberContext(field, label)) {
      return "家庭信息";
    }

    const text = compactText([field?.groupText, getFieldOptionLabelsText(field, 180), field?.section, field?.nearbyText, field?.label].join(" "));
    if (!text) {
      return "";
    }

    if (/自我评价|自我描述|自我介绍|相关情况说明/.test(text)) {
      return "自我描述";
    }
    if (/近三年年度绩效考核|绩效考核|考核年度|考核等级/.test(text)) {
      return "绩效考核";
    }
    if (/证明人|联系方式|备注/.test(label) && /排名|考核|绩效|证明人/.test(text) && !/实习|实践|项目/.test(text)) {
      return "绩效考核";
    }
    if (/专业技术资格|职业资格|职称/.test(text)) {
      return "专业资格";
    }
    if (/有关声明|声明|永居权|永久居留|背景调查|事实完全相符|非法组织|重大疾病|传染病|行政处罚|失信被执行人|境外居留|第三方企业|任兼职|持有企业股权|用人单位辞退/.test(text)) {
      return "有关声明";
    }
    if (/家庭情况|家庭信息|家庭及社会关系|社会关系|亲属信息|亲属情况|亲属关系|与本人关系|是否退休/.test(text)) {
      return "家庭信息";
    }
    if (/求职意向|意向岗位|预计入职|期望工作城市|期望薪资|当前薪资|当前年收入|面试城市|意向城市|目标岗位|简历来源|目前工作地/.test(text)) {
      return "求职意向";
    }
    if (
      /个人信息|基本信息/.test(text) ||
      /^(姓名|性别|出生日期|民族|政治面貌|籍贯|户口所在地|现户口所在地|当前居住地|当前居住地详细地址|净身高cm|身高|体重kg|体重|血型|婚姻状况|电子邮箱|手机号码|电话)$/.test(label)
    ) {
      return "基本信息";
    }
    if (/证书信息|证书类别|证书名称|发证单位|证书编号/.test(text)) {
      return "证书技能";
    }
    if (/教育经历|学历|学校名称|学院名称|专业名称|培养方式|升学类型/.test(text)) {
      return "教育经历";
    }
    if (/工作经历|有无工作经历|现工作单位|当前工作单位|工作职责/.test(text)) {
      return "工作经历";
    }
    if (/工作实习经历|工作\/实习经历|实习经历|实践|单位名称|职位名称/.test(text)) {
      return "实习经历";
    }
    if (/在校职务|社团|学生工作|部门名称/.test(text)) {
      return /学生工作/.test(text) ? "学生工作" : "社团工作";
    }
    if (/奖惩信息|奖惩情况|奖惩名称|奖惩时间|奖励|荣誉|获奖|学术成果/.test(text)) {
      return "奖惩情况";
    }
    if (/技能|资格证书|证书|计算机水平|其它技能|语言能力|语言类型|四六级|六级|四级|TOEFL|IELTS|GRE|GMAT/i.test(text)) {
      if (/语言|外语|四六级|六级|四级|TOEFL|IELTS|GRE|GMAT/i.test(text)) {
        return "外语能力";
      }
      if (/计算机|IT技能|计算机水平|其它技能/.test(text)) {
        return "计算机技能";
      }
      return "证书技能";
    }
    if (/培训经历|培训名称|培训机构|培训课程/.test(text)) {
      return "培训经历";
    }
    if (/论文|著作|刊物名称|论文名称/.test(text)) {
      return "论文著作";
    }
    if (/专利|专利名称|专利编号/.test(text)) {
      return "专利成果";
    }
    if (/受到奖励|学术成果|社会校园活动|社会\/校园活动|校园活动|兴趣爱好|特长|爱好及专长/.test(text)) {
      return "其他信息";
    }
    if (/是否|有无|能否|同意|接受|服从/.test(text) && /亲属|调剂|背景|居留|疾病|处罚|任职|持股|股票/.test(text)) {
      return "有关声明";
    }
    if (/其他信息|其他个人情况|附加信息|附加问题/.test(text)) {
      return "其他信息";
    }
    return "";
  }

  function buildProfileItemAliases(section, item) {
    const aliases = new Set();
    const label = normalizeText(item?.label || "", 120);
    const subsection = normalizeText(item?.subsection || "", 120);
    const category = normalizeText(section?.category || "", 120);
    const labelKey = normalizeMatchKey(label);

    if (label) {
      aliases.add(label);
      aliases.add(labelKey);
    }
    if (subsection) {
      aliases.add(subsection);
      aliases.add(normalizeMatchKey(subsection));
    }
    if (category) {
      aliases.add(category);
      aliases.add(normalizeMatchKey(category));
    }

    const aliasList = PROFILE_LABEL_ALIASES[label] || PROFILE_LABEL_ALIASES[labelKey] || [];
    for (const alias of aliasList) {
      aliases.add(alias);
      aliases.add(normalizeMatchKey(alias));
    }

    return Array.from(aliases).filter(Boolean);
  }

  function buildProfileCatalogFromEntries(entries) {
    const sectionMap = new Map();
    const fields = [];

    for (const entry of entries) {
      if (!entry?.itemId || !entry?.label) {
        continue;
      }

      const field = {
        path: entry.itemId,
        label: [entry.category, entry.subsection, entry.label].filter(Boolean).join(" / "),
        aliases: Array.from(new Set([entry.label, entry.subsection, entry.category, ...(entry.aliases || [])].filter(Boolean)))
      };
      fields.push(field);

      const key = entry.category || "本地资料";
      if (!sectionMap.has(key)) {
        sectionMap.set(key, {
          key,
          title: key,
          fields: []
        });
      }
      sectionMap.get(key).fields.push(field);
    }

    return {
      sections: Array.from(sectionMap.values()),
      fields
    };
  }

  function getProfileEntryByPath(entries, path) {
    if (!path) {
      return null;
    }
    return entries.find((entry) => entry.itemId === path) || null;
  }

  function getScanFieldById(scan, fieldId) {
    const fields = Array.isArray(scan?.fields) ? scan.fields : [];
    return fields.find((field) => field.fieldId === fieldId) || null;
  }

  function getEntryCategoryBonus(fieldCategory, entryCategory) {
    if (!fieldCategory || !entryCategory) {
      return 0;
    }

    if (fieldCategory === entryCategory) {
      return 14;
    }

    const compatiblePairs = new Map([
      ["基本信息", ["其他信息", "教育经历"]],
      ["教育经历", ["基本信息"]],
      ["实习经历", ["项目经历"]],
      ["项目经历", ["实习经历"]],
      ["工作经历", ["实习经历"]],
      ["绩效考核", ["工作经历"]],
      ["社团工作", ["学生工作"]],
      ["学生工作", ["社团工作"]],
      ["专业资格", ["证书技能"]],
      ["外语能力", ["语言能力", "证书技能"]],
      ["语言能力", ["外语能力", "证书技能"]],
      ["计算机技能", ["证书技能", "其他信息"]],
      ["证书技能", ["外语能力", "计算机技能", "其他信息", "专业资格"]],
      ["自我描述", ["其他信息"]],
      ["有关声明", ["其他信息"]]
    ]);

    const compatible = compatiblePairs.get(fieldCategory) || [];
    return compatible.includes(entryCategory) ? 6 : -8;
  }

  function isExplanatoryField(text) {
    const key = normalizeMatchKey(text);
    if (/自我评价|自我描述|自我介绍|相关情况说明/.test(key)) {
      return false;
    }
    return /原因|说明|理由|备注/.test(key);
  }

  function isExplanatoryEntry(text) {
    return /原因|说明|理由|备注/.test(normalizeMatchKey(text));
  }

  function isCategoryCompatibleForMapping(fieldCategory, entryCategory) {
    if (!fieldCategory || !entryCategory) {
      return true;
    }

    if (fieldCategory === entryCategory) {
      return true;
    }

    const compatiblePairs = new Map([
      ["基本信息", ["其他信息", "教育经历"]],
      ["实习经历", ["项目经历", "工作经历"]],
      ["工作经历", ["实习经历"]],
      ["绩效考核", ["工作经历"]],
      ["项目经历", ["实习经历"]],
      ["社团工作", ["学生工作"]],
      ["学生工作", ["社团工作"]],
      ["专业资格", ["证书技能"]],
      ["外语能力", ["语言能力", "证书技能"]],
      ["语言能力", ["外语能力", "证书技能"]],
      ["计算机技能", ["证书技能", "其他信息"]],
      ["证书技能", ["外语能力", "语言能力", "计算机技能", "专业资格"]],
      ["有关声明", ["其他信息"]],
      ["自我描述", ["其他信息"]],
      ["其他信息", ["有关声明", "奖惩情况", "社团工作", "学生工作", "自我描述"]]
    ]);

    return (compatiblePairs.get(fieldCategory) || []).includes(entryCategory);
  }

  function isNameLikeLabel(labelKey) {
    return /姓名|联系人|证明人|推荐人|介绍人/.test(labelKey);
  }

  function isPhoneLikeLabel(labelKey) {
    return /电话|手机|联系方式|联系电话|手机号/.test(labelKey);
  }

  function isRoleLikeLabel(labelKey) {
    return /职务|职位|岗位|角色/.test(labelKey);
  }

  function isRelationLikeLabel(labelKey) {
    return /关系|与本人关系|亲属关系/.test(labelKey);
  }

  function hasRelationLikeOptions(optionText) {
    return /父亲|母亲|爸爸|妈妈|配偶|爱人|丈夫|妻子|兄弟|姐妹|哥哥|姐姐|弟弟|妹妹|儿子|女儿|朋友|同学|同事|亲属|关系/.test(optionText);
  }

  function getContextualAddressBucket(key, labelKey) {
    const provinceLike = /省|省份/.test(labelKey);
    const cityLike = /市|城市|地区/.test(labelKey);
    const addressLike = /地址|住址|详细地址|街道|门牌|通讯|通信|邮寄|收件/.test(labelKey);

    if (/籍贯/.test(key)) {
      if (provinceLike || /籍贯省/.test(key)) {
        return "nativeProvince";
      }
      if (cityLike || /籍贯市/.test(key)) {
        return "nativeCity";
      }
      return "nativePlace";
    }

    if (/生源地|生源户口|生源所在地/.test(key)) {
      if (provinceLike || /生源地省/.test(key)) {
        return "sourceProvince";
      }
      if (cityLike || /生源地市/.test(key)) {
        return "sourceCity";
      }
      return "sourcePlace";
    }

    if (/户口|户籍/.test(key)) {
      if (provinceLike || /户口所在地省|户籍所在地省/.test(key)) {
        return "hukouProvince";
      }
      if (cityLike || /户口所在地市|户籍所在地市/.test(key)) {
        return "hukouCity";
      }
      return "hukouPlace";
    }

    if (/通讯地址|通信地址|联系地址|邮寄地址|收件地址/.test(key)) {
      return "mailingAddress";
    }

    if (/当前居住|现居住|现居地|居住城市|居住地|现住址/.test(key)) {
      if (addressLike || /详细地址|地址|住址|街道|门牌/.test(key)) {
        return "currentResidenceAddress";
      }
      return "currentResidenceCity";
    }

    return "";
  }

  function getContextualSemanticBucket(field, fieldLabel, fieldCategory) {
    const labelKey = normalizeMatchKey(fieldLabel || field?.label || "");
    const optionText = getFieldOptionLabelsText(field, 200);
    const key = compactText([
      fieldCategory,
      field?.groupText,
      field?.section,
      field?.nearbyText,
      field?.label,
      field?.placeholder,
      field?.name,
      field?.id,
      optionText
    ].join(" "));

    if (!key) {
      return "";
    }

    if (
      /家庭信息|家庭情况|家庭及社会关系|社会关系|亲属信息|亲属情况|亲属关系/.test(key) &&
      !/是否存在亲属.*(应聘单位|本行|我行)|亲属在.*(应聘单位|本行|我行)|有关声明|电子签名/.test(key)
    ) {
      if (isRelationLikeLabel(labelKey) || hasRelationLikeOptions(optionText)) {
        return "familyRelation";
      }
      if (/姓名/.test(labelKey)) {
        return "familyName";
      }
      if (/出生日期|出生年月|生日/.test(labelKey)) {
        return "familyBirthDate";
      }
      if (/政治面貌/.test(labelKey)) {
        return "familyPoliticalStatus";
      }
      if (/学历/.test(labelKey)) {
        return "familyEducationLevel";
      }
      if (/工作单位|单位名称|公司/.test(labelKey)) {
        return "familyEmployer";
      }
      if (isRoleLikeLabel(labelKey)) {
        return "familyRole";
      }
      if (isPhoneLikeLabel(labelKey)) {
        return "familyPhone";
      }
      if (/联系地址|通讯地址|地址|住址/.test(labelKey)) {
        return "familyAddress";
      }
      if (/是否退休|退休情况/.test(labelKey)) {
        return "familyRetired";
      }
    }

    if (/绩效考核|考核年度|考核等级/.test(key)) {
      if (isPhoneLikeLabel(labelKey)) {
        return "performanceContact";
      }
      if (isNameLikeLabel(labelKey)) {
        return "performanceReference";
      }
      if (/排名/.test(labelKey) || /排名/.test(key)) {
        return "performanceRank";
      }
      if (/绩效考核等级|考核等级/.test(labelKey) || /绩效考核等级|考核等级/.test(key)) {
        return "performanceLevel";
      }
      if (/说明|评语|备注/.test(labelKey) || /说明|评语|备注/.test(key)) {
        return "performanceNote";
      }
    }

    if (/紧急联系人|紧急联系方式/.test(key)) {
      if (isRelationLikeLabel(labelKey) || hasRelationLikeOptions(optionText)) {
        return "emergencyRelation";
      }
      if (isPhoneLikeLabel(labelKey)) {
        return "emergencyPhone";
      }
      if (isNameLikeLabel(labelKey) || /紧急联系人/.test(labelKey)) {
        return "emergencyContact";
      }
    }

    if (/证明人|推荐人|介绍人/.test(key) && !/紧急联系人/.test(key)) {
      if (isPhoneLikeLabel(labelKey)) {
        return "referencePhone";
      }
      if (isRoleLikeLabel(labelKey)) {
        return "referenceRole";
      }
      if (isNameLikeLabel(labelKey)) {
        return "referenceName";
      }
    }

    return getContextualAddressBucket(key, labelKey);
  }

  function getSemanticBucket(text, category = "") {
    const key = normalizeMatchKey([category, text].join(" "));
    if (!key) {
      return "";
    }

    if (/是否存在亲属.*(应聘单位|本行|我行)|亲属在.*(应聘单位|本行|我行)/.test(key)) {
      return "declarationRelativeAtEmployer";
    }

    if (/家庭信息|家庭情况|家庭及社会关系|社会关系|亲属信息|亲属情况|亲属关系/.test(key)) {
      if (/与本人关系|亲属关系|^家庭信息关系$|关系/.test(key)) {
        return "familyRelation";
      }
      if (/姓名/.test(key)) {
        return "familyName";
      }
      if (/出生日期|出生年月|生日/.test(key)) {
        return "familyBirthDate";
      }
      if (/政治面貌/.test(key)) {
        return "familyPoliticalStatus";
      }
      if (/学历/.test(key)) {
        return "familyEducationLevel";
      }
      if (/工作单位|单位名称|公司/.test(key)) {
        return "familyEmployer";
      }
      if (/职务|职位|岗位/.test(key)) {
        return "familyRole";
      }
      if (/联系电话|手机号码|电话/.test(key)) {
        return "familyPhone";
      }
      if (/联系地址|通讯地址|地址|住址/.test(key)) {
        return "familyAddress";
      }
      if (/是否退休|退休情况/.test(key)) {
        return "familyRetired";
      }
      if (/备注/.test(key)) {
        return "familyNote";
      }
    }

    if (/是否患有|传染病|高血压|心脏病|糖尿病|肾炎|精神病|影响工作的疾病|重大疾病/.test(key)) {
      return "declarationDisease";
    }
    if (/第三方企业|任兼职|持有企业股权|私募股权/.test(key)) {
      return "declarationThirdPartyEquity";
    }
    if (/不良行为记录|犯罪记录|行政处罚|党纪处分|违纪违规|失信被执行人/.test(key)) {
      return "declarationBadRecord";
    }
    if (/用人单位辞退|曾被辞退|辞退情况/.test(key)) {
      return "declarationDismissed";
    }
    if (/金融机构营销|业务风险/.test(key)) {
      return "declarationFinancialMarketingRisk";
    }
    if (/境外.*(长期|永久)居留权|永久居留权|永居权/.test(key)) {
      return "declarationOverseasResidence";
    }
    if (/教育经历.*最高学历/.test(key)) {
      return "isHighestEducation";
    }
    if (/最高全日制学历/.test(key)) {
      return "highestFullTimeEducation";
    }
    if (/最高学历/.test(key)) {
      return "highestEducationLevel";
    }
    if (/是否海外学历|是否海外教育经历|是否为海外教育经历/.test(key)) {
      return "overseasEducation";
    }
    if (/毕（结、肆）业|毕结肆业|毕业状态|毕业结业肄业在读/.test(key)) {
      return "graduationStatus";
    }
    if (/学历证书号/.test(key)) {
      return "educationCertificate";
    }
    if (/^学历$|学历层次|教育经历学历/.test(key)) {
      return "educationLevel";
    }
    if (/^学位$|学位类型|教育经历学位/.test(key)) {
      return "degree";
    }
    if (/绩效考核|考核年度|考核等级/.test(key)) {
      if (/联系方式|联系电话|电话/.test(key)) {
        return "performanceContact";
      }
      if (/证明人|推荐人/.test(key)) {
        return "performanceReference";
      }
      if (/排名/.test(key)) {
        return "performanceRank";
      }
      if (/绩效考核等级|考核等级/.test(key)) {
        return "performanceLevel";
      }
      if (/说明|评语|备注/.test(key)) {
        return "performanceNote";
      }
    }
    if (/专业技术资格|职业资格|职称/.test(key)) {
      if (/有无|是否/.test(key)) {
        return "professionalQualificationAvailable";
      }
      if (/职业资格证书|资格证书/.test(key)) {
        return "professionalCertificate";
      }
      return "professionalQualification";
    }
    if (/学校所在国家|学校国家/.test(key)) {
      return "schoolCountry";
    }
    if (/姓拼音|姓氏拼音/.test(key)) {
      return "lastNamePinyin";
    }
    if (/名拼音|名字拼音/.test(key)) {
      return "firstNamePinyin";
    }
    if (/^姓名$|真实姓名/.test(key)) {
      return "fullName";
    }
    if (/^姓$|中文姓|姓氏/.test(key)) {
      return "lastName";
    }
    if (/^名$|中文名|名字/.test(key)) {
      return "firstName";
    }
    if (/国籍|国家或地区/.test(key) && !/学校/.test(key)) {
      return "nationality";
    }
    if (/证件类型|身份证件类型/.test(key)) {
      return "idType";
    }
    if (/证件号码|身份证号|身份证号码/.test(key)) {
      return "idNumber";
    }
    if (/民族/.test(key)) {
      return "ethnicity";
    }
    if (/政治面貌|政治身份/.test(key)) {
      return "politicalStatus";
    }
    if (/婚姻状况|婚姻状态/.test(key)) {
      return "maritalStatus";
    }
    if (/血型|血液类型/.test(key)) {
      return "bloodType";
    }
    if (/净身高|身高/.test(key)) {
      return "height";
    }
    if (/体重/.test(key)) {
      return "weight";
    }
    if (/确认邮箱|再次输入邮箱/.test(key)) {
      return "confirmEmail";
    }
    if (/电子邮箱|邮箱|email|mail/.test(key)) {
      return "email";
    }
    if (/qq/.test(key)) {
      return "qq";
    }
    if (/紧急联系人手机|紧急联系人电话/.test(key)) {
      return "emergencyPhone";
    }
    if (/与紧急联系人关系|紧急联系人关系/.test(key)) {
      return "emergencyRelation";
    }
    if (/紧急联系人/.test(key)) {
      return "emergencyContact";
    }
    if (/证明人联系方式|证明人电话|证明人手机号/.test(key)) {
      return "referencePhone";
    }
    if (/证明人职位|证明人职务/.test(key)) {
      return "referenceRole";
    }
    if (/证明人姓名|证明人|推荐人/.test(key)) {
      return "referenceName";
    }
    if (/手机号码|手机号|手机|联系电话|电话号码/.test(key)) {
      return "phone";
    }
    if (/微信|wechat/.test(key)) {
      return "wechat";
    }
    if (/预计入职时间|可入职时间|到岗时间/.test(key)) {
      return "availableDate";
    }
    if (/简历名称|简历标题/.test(key)) {
      return "resumeTitle";
    }
    if (/有无工作经历|是否有工作经历/.test(key)) {
      return "workExperienceAvailable";
    }
    if (/离职原因|离开原因/.test(key)) {
      return "leavingReason";
    }
    if (/意向岗位|目标岗位|应聘岗位|申请岗位/.test(key)) {
      return "targetPosition";
    }
    if (/当前薪资|目前薪资|现薪资/.test(key)) {
      return "currentSalary";
    }
    if (/当前年收入|目前年收入|现年收入/.test(key)) {
      return "currentAnnualIncome";
    }
    if (/期望薪资|期望年薪|期望月薪|期望年收入/.test(key)) {
      return "expectedSalary";
    }
    if (/期望工作城市|意向工作城市|期望城市|意向城市/.test(key)) {
      return "expectedCity";
    }
    if (/面试城市|可面试城市/.test(key)) {
      return "interviewCity";
    }
    if (/当前居住地详细地址|现居住详细地址|现居住地址|居住地址|现住址|当前地址/.test(key)) {
      return "currentResidenceAddress";
    }
    if (/当前居住地|现居住地|现居住城市|居住城市|现居地/.test(key)) {
      return "currentResidenceCity";
    }
    if (/通讯地址|通信地址|联系地址|邮寄地址|收件地址/.test(key)) {
      return "mailingAddress";
    }
    if (/出生日期|出生年月|生日/.test(key)) {
      return "birthDate";
    }
    if (/开始时间|入学时间|开始日期/.test(key)) {
      return "startDate";
    }
    if (/结束时间|毕业时间|取得毕业证时间|截止时间/.test(key)) {
      return "endDate";
    }
    if (/培养方式|学习形式|教育类型/.test(key)) {
      return "trainingMode";
    }
    if (/学制|学习年限/.test(key)) {
      return "studyLength";
    }
    if (/学号|学生证号/.test(key)) {
      return "studentId";
    }
    if (/学校名称|毕业院校|院校名称/.test(key)) {
      return "school";
    }
    if (/院系|学院名称/.test(key)) {
      return "department";
    }
    if (/专业类型|专业名称|所学专业|专业$/.test(key)) {
      return "major";
    }
    if (/现工作单位|当前工作单位/.test(key)) {
      return "currentEmployer";
    }
    if (/工作单位|单位名称|公司名称|^公司$|实习单位/.test(key)) {
      return "employer";
    }
    if (/部门/.test(key)) {
      return "department";
    }
    if (/职务|岗位|职位名称/.test(key)) {
      return "role";
    }
    if (/籍贯省/.test(key)) {
      return "nativeProvince";
    }
    if (/籍贯市/.test(key)) {
      return "nativeCity";
    }
    if (/^籍贯$|籍贯所在地/.test(key)) {
      return "nativePlace";
    }
    if (/生源地省/.test(key)) {
      return "sourceProvince";
    }
    if (/生源地市/.test(key)) {
      return "sourceCity";
    }
    if (/^生源地$|生源所在地|生源户口/.test(key)) {
      return "sourcePlace";
    }
    if (/现户口所在地省|户口所在地省|户籍所在地省/.test(key)) {
      return "hukouProvince";
    }
    if (/现户口所在地市|户口所在地市|户籍所在地市/.test(key)) {
      return "hukouCity";
    }
    if (/现户口所在地|户口所在地|户籍所在地/.test(key)) {
      return "hukouPlace";
    }
    if (/工作实习地点省|工作地点省|实习地点省/.test(key)) {
      return "workProvince";
    }
    if (/工作实习地点市|工作地点市|实习地点市/.test(key)) {
      return "workCity";
    }
    if (/工作实习地点|工作地点|实习地点/.test(key)) {
      return "workPlace";
    }
    if (/高考所在地省/.test(key)) {
      return "examProvince";
    }
    if (/高考所在地市/.test(key)) {
      return "examCity";
    }
    if (/高考所在地|高考省份/.test(key)) {
      return "examPlace";
    }
    if (/平均学分成绩gpa|有无gpa|是否有gpa/.test(key) && !/分数|满分|评价体系/.test(key)) {
      return "gpaAvailable";
    }
    if (/gpa分数|绩点分数|平均学分成绩.*分数|请输入gpa分数数字/.test(key)) {
      return "gpaScore";
    }
    if (/gpa满分|绩点满分|4分制|5分制|评价体系/.test(key)) {
      return "gpaScale";
    }
    if (/班级排名|专业排名/.test(key) && /原因/.test(key)) {
      return "rankReason";
    }
    if (/班级排名/.test(key)) {
      return "classRank";
    }
    if (/专业排名/.test(key)) {
      return "majorRank";
    }
    if (/高考总分|总分数/.test(key)) {
      return "examTotal";
    }
    if (/高考科目|文理科/.test(key)) {
      return "examSubject";
    }
    if (/高考时间/.test(key)) {
      return "examDate";
    }
    if (/六级获得时间|六级获取日期|六级取得时间/.test(key)) {
      return "cet6Date";
    }
    if (/六级有效期/.test(key)) {
      return "cet6ValidUntil";
    }
    if (/六级分数/.test(key)) {
      return "cet6Score";
    }
    if (/^六级$|大学英语六级|cet6/.test(key)) {
      return "cet6Taken";
    }
    if (/四级获得时间|四级获取日期|四级取得时间/.test(key)) {
      return "cet4Date";
    }
    if (/四级有效期/.test(key)) {
      return "cet4ValidUntil";
    }
    if (/四级分数/.test(key)) {
      return "cet4Score";
    }
    if (/^四级$|大学英语四级|cet4/.test(key)) {
      return "cet4Taken";
    }
    if (/toefl.*分数|托福.*分数/.test(key)) {
      return "toeflScore";
    }
    if (/ielts.*分数|雅思.*分数/.test(key)) {
      return "ieltsScore";
    }
    if (/gre.*分数/.test(key)) {
      return "greScore";
    }
    if (/gmat.*分数/.test(key)) {
      return "gmatScore";
    }
    if (/^toefl$|托福/.test(key)) {
      return "toeflTaken";
    }
    if (/^ielts$|雅思/.test(key)) {
      return "ieltsTaken";
    }
    if (/^gre$/.test(key)) {
      return "greTaken";
    }
    if (/^gmat$/.test(key)) {
      return "gmatTaken";
    }
    if (/外语种类|外语语种|语言类型|语种/.test(key)) {
      return "languageType";
    }
    if (/证书名称技能名称|证书名称|技能名称/.test(key) && /外语|语言|英语|六级|四级|cet|toefl|ielts|gre|gmat/i.test(key)) {
      return "languageCertificate";
    }
    if (/掌握程度|熟练程度|语言水平|外语水平/.test(key)) {
      return "proficiency";
    }
    if (/听说能力|听说/.test(key)) {
      return "listeningSpeaking";
    }
    if (/读写能力|读写/.test(key)) {
      return "readingWriting";
    }
    if (/证书类别|证书类型|资格证书类别/.test(key)) {
      return "certificateCategory";
    }
    if (/证书编号|证书号码/.test(key)) {
      return "certificateNumber";
    }
    if (/证书获得时间|证书取得时间|获得时间|获取日期|取得时间/.test(key) && /证书|技能|外语|语言|英语|六级|四级|cet|toefl|ielts|gre|gmat/i.test(key)) {
      return "certificateDate";
    }
    if (/授予单位|颁发单位|发证机构|证书颁发单位/.test(key)) {
      return "certificateIssuer";
    }
    if (/证书说明|证书描述|证书备注/.test(key)) {
      return "certificateNote";
    }
    if (/考试分数|高考分数|分数/.test(key)) {
      return "examScore";
    }
    if (/项目名称|实践名称/.test(key)) {
      return "projectName";
    }
    if (/参与人数|团队人数|项目人数/.test(key)) {
      return "projectPeople";
    }
    if (/项目内容|项目描述/.test(key)) {
      return "projectDescription";
    }
    if (/本人职责|个人职责|职责/.test(key)) {
      return "responsibility";
    }
    if (/项目成果|实践成果|工作成果|实习成果/.test(key)) {
      return "result";
    }
    if (/项目链接|项目地址|作品链接/.test(key)) {
      return "projectUrl";
    }
    if (/工作内容描述|工作内容|实践内容|职责描述/.test(key)) {
      return "description";
    }
    if (/奖惩解除时间|处分解除时间|解除时间/.test(key)) {
      return "awardReleaseDate";
    }
    if (/奖惩时间|获奖时间|奖励时间/.test(key)) {
      return "awardDate";
    }
    if (/奖惩名称|奖励名称|奖项名称|荣誉名称/.test(key)) {
      return "awardName";
    }
    if (/颁奖单位|授奖单位|奖惩单位/.test(key)) {
      return "awardIssuer";
    }
    if (/奖励等级|奖项等级|奖励级别|奖惩层级/.test(key)) {
      return "awardLevel";
    }
    if (/奖惩描述|获奖描述|奖励描述|奖惩原因/.test(key)) {
      return "awardDescription";
    }
    if (/培训名称|培训项目/.test(key)) {
      return "trainingName";
    }
    if (/培训机构|培训单位/.test(key)) {
      return "trainingOrg";
    }
    if (/培训地点|培训城市|培训地址/.test(key)) {
      return "trainingPlace";
    }
    if (/培训课程/.test(key)) {
      return "trainingCourse";
    }
    if (/培训获得证书|培训证书/.test(key)) {
      return "trainingCertificate";
    }
    if (/培训内容|培训描述/.test(key)) {
      return "trainingDescription";
    }
    if (/刊物名称|期刊名称|发表刊物/.test(key)) {
      return "publication";
    }
    if (/刊物层级|期刊层级/.test(key)) {
      return "publicationLevel";
    }
    if (/论文名称|论文题目|文章名称/.test(key)) {
      return "paperName";
    }
    if (/论文描述|论文摘要|论文说明/.test(key)) {
      return "paperDescription";
    }
    if (/专利名称|专利题目/.test(key)) {
      return "patentName";
    }
    if (/专利编号|专利号/.test(key)) {
      return "patentNumber";
    }
    if (/专利类型/.test(key)) {
      return "patentType";
    }
    if (/专利成果|专利描述|专利说明/.test(key)) {
      return "patentResult";
    }
    if (/是否退休|有无退休/.test(key)) {
      return "retired";
    }
    if (/爱好及专长|特长爱好/.test(key)) {
      return "hobby";
    }
    if (/社会校园活动|社会活动|校园活动/.test(key)) {
      return "activity";
    }
    if (/受到奖励|学术成果|奖励学术成果/.test(key)) {
      return "achievement";
    }
    if (/自我评价|个人评价/.test(key)) {
      return "selfEvaluation";
    }
    if (/招聘信息来源|简历来源|信息来源/.test(key)) {
      return "source";
    }
    return "";
  }

  function getFirstSemanticBucket(parts, category = "") {
    for (const part of parts || []) {
      const bucket = getSemanticBucket(part, category);
      if (bucket) {
        return bucket;
      }
    }
    return "";
  }

  function getFieldSemanticBucket(field, fieldLabel, fieldCategory) {
    const contextualBucket = getContextualSemanticBucket(field, fieldLabel, fieldCategory);
    if (contextualBucket) {
      return contextualBucket;
    }

    return getFirstSemanticBucket(
      [
        fieldLabel,
        field?.label,
        field?.placeholder,
        field?.name,
        field?.id,
        field?.nearbyText,
        field?.groupText,
        getFieldOptionLabelsText(field, 180)
      ],
      fieldCategory
    );
  }

  function getEntrySemanticBucket(entry) {
    return getFirstSemanticBucket(
      [
        entry?.label,
        entry?.subsection,
        ...(entry?.aliases || [])
      ],
      entry?.category
    );
  }

  function canProjectEntryValueToFieldBucket(fieldBucket, entryBucket) {
    const projectionMap = {
      nativeProvince: ["nativePlace"],
      nativeCity: ["nativePlace"],
      sourceProvince: ["sourcePlace"],
      sourceCity: ["sourcePlace"],
      hukouProvince: ["hukouPlace"],
      hukouCity: ["hukouPlace"],
      workProvince: ["workPlace"],
      workCity: ["workPlace"],
      examProvince: ["examPlace"],
      examCity: ["examPlace"],
      currentResidenceCity: ["currentResidenceAddress"]
    };
    return (projectionMap[fieldBucket] || []).includes(entryBucket);
  }

  function splitAdministrativeLocation(value) {
    const text = normalizeText(value, 160).replace(/\s+/g, "");
    if (!text) {
      return [];
    }

    const parts =
      text.match(
        /(?:香港特别行政区|澳门特别行政区|北京市|上海市|天津市|重庆市|[^省]+省|[^自治区]+自治区|[^特别行政区]+特别行政区|[^市]+市|[^区县旗州盟]+(?:区|县|旗|州|盟))/g
      ) || [];

    return parts.map((part) => normalizeText(part, 40)).filter(Boolean);
  }

  function isMunicipalityLike(value) {
    return /^(北京市|上海市|天津市|重庆市|香港特别行政区|澳门特别行政区)$/.test(normalizeText(value, 40));
  }

  function getProvinceLevelLocationPart(parts) {
    const first = normalizeText(parts?.[0] || "", 40);
    if (!first) {
      return "";
    }
    return /省|自治区|特别行政区|市$/.test(first) ? first : "";
  }

  function getCityLevelLocationPart(parts) {
    const first = normalizeText(parts?.[0] || "", 40);
    const second = normalizeText(parts?.[1] || "", 40);
    if (!first) {
      return "";
    }
    if (isMunicipalityLike(first)) {
      return first;
    }
    if (/省|自治区|特别行政区/.test(first)) {
      return second || first;
    }
    if (/市$/.test(first)) {
      return first;
    }
    return second || first;
  }

  function projectAdministrativeLocationValue(value, fieldBucket) {
    const parts = splitAdministrativeLocation(value);
    if (parts.length === 0) {
      return "";
    }

    if (/Province$/.test(fieldBucket)) {
      return getProvinceLevelLocationPart(parts);
    }
    if (/City$/.test(fieldBucket) || fieldBucket === "currentResidenceCity") {
      return getCityLevelLocationPart(parts) || getProvinceLevelLocationPart(parts);
    }
    return "";
  }

  function areSemanticBucketsCompatible(fieldBucket, entryBucket) {
    if (!fieldBucket || !entryBucket) {
      return true;
    }
    return fieldBucket === entryBucket || canProjectEntryValueToFieldBucket(fieldBucket, entryBucket);
  }

  function resolveEntryValueForField(field, entry, fieldLabel, fieldCategory) {
    let rawValue = "";
    if (typeof entry === "string") {
      rawValue = entry.trim();
    } else if (entry && typeof entry === "object") {
      rawValue = entry.value == null ? "" : String(entry.value).trim();
    }
    if (!rawValue) {
      return "";
    }

    const fieldBucket = getFieldSemanticBucket(field, fieldLabel, fieldCategory);
    const entryBucket = getEntrySemanticBucket(entry);
    if (fieldBucket === entryBucket || !canProjectEntryValueToFieldBucket(fieldBucket, entryBucket)) {
      return rawValue;
    }

    return projectAdministrativeLocationValue(rawValue, fieldBucket);
  }

  function getFamilyRelationFromText(value) {
    const text = compactText(value);
    if (!text) {
      return "";
    }
    if (/父亲|爸爸/.test(text)) {
      return "父亲";
    }
    if (/母亲|妈妈/.test(text)) {
      return "母亲";
    }
    if (/配偶|妻子|丈夫|爱人/.test(text)) {
      return "配偶";
    }
    if (/兄弟|姐妹|哥哥|姐姐|弟弟|妹妹/.test(text)) {
      return "兄弟姐妹";
    }
    if (/子女|儿子|女儿/.test(text)) {
      return "子女";
    }
    return "";
  }

  function getFieldFamilyRelation(field) {
    const textRelation = getFamilyRelationFromText([
      field?.nearbyText,
      field?.section,
      field?.groupText,
      field?.label,
      field?.placeholder
    ].join(" "));
    if (textRelation) {
      return textRelation;
    }

    const element = getElementByFieldRuntimeId(field);
    const siblingRelation = getNearbyLabeledControlValue(element, /关系|与本人关系|亲属关系/);
    return getFamilyRelationFromText(siblingRelation);
  }

  function getEntryFamilyRelation(entry) {
    return getFamilyRelationFromText([
      entry?.familyRelation,
      entry?.subsection,
      entry?.label,
      entry?.value,
      ...(entry?.aliases || [])
    ].join(" "));
  }

  function requiresFamilyRelationGate(fieldLabel) {
    return isFamilyMemberDetailLabel(fieldLabel) && !isFamilyRelationLabel(fieldLabel);
  }

  function isFamilyCandidateAllowed(field, entry, fieldLabel, fieldCategory) {
    if (!isFamilyScopedField(field, fieldLabel, fieldCategory)) {
      return true;
    }

    if (entry?.category !== "家庭信息") {
      return false;
    }

    if (!requiresFamilyRelationGate(fieldLabel)) {
      return true;
    }

    const fieldRelation = getFieldFamilyRelation(field);
    const entryRelation = getEntryFamilyRelation(entry);
    return Boolean(fieldRelation && entryRelation && fieldRelation === entryRelation);
  }

  function getFamilyRelationMatchBonus(field, entry, fieldCategory) {
    const fieldLabel = field?.inferredLabel || inferFieldLabel(field);
    if (!isFamilyScopedField(field, fieldLabel, fieldCategory)) {
      return 0;
    }

    if (entry?.category !== "家庭信息") {
      return -999;
    }

    if (!requiresFamilyRelationGate(fieldLabel)) {
      return 0;
    }

    const fieldRelation = getFieldFamilyRelation(field);
    const entryRelation = getEntryFamilyRelation(entry);
    if (!fieldRelation || !entryRelation) {
      return -999;
    }
    return fieldRelation === entryRelation ? 18 : -999;
  }

  function getElementByFieldRuntimeId(field) {
    if (!field?.fieldId) {
      return null;
    }
    try {
      return document.querySelector(`[${FIELD_ATTR}="${CSS.escape(field.fieldId)}"]`);
    } catch {
      return null;
    }
  }

  function getNearbyLabeledControlValue(element, labelPattern) {
    const root = findRepeatItemRoot(element);
    if (!root) {
      return "";
    }

    const controls = Array.from(root.querySelectorAll(CONTROL_SELECTOR))
      .filter((item, index, array) => array.indexOf(item) === index)
      .filter((item) => !item.closest(`#${PANEL_ID}`))
      .filter(isVisible);

    for (const control of controls) {
      if (control === element) {
        continue;
      }
      const container = findFieldContainer(control);
      const label = normalizeFieldLabelText(extractFieldContainerLabel(container) || getAdapterLabelText(control) || getNearbyText(control));
      if (labelPattern.test(label)) {
        const value = getControlCurrentValue(control);
        if (value) {
          return value;
        }
      }
    }

    return "";
  }

  function findRepeatItemRoot(element) {
    if (!element) {
      return null;
    }

    const { repeatItemSelector } = getAdapterSelectors();
    if (repeatItemSelector) {
      const adapterRoot = element.closest(repeatItemSelector);
      if (isRepeatItemRootCandidate(adapterRoot)) {
        return adapterRoot;
      }
    }

    let current = element.parentElement;
    let best = null;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      if (current.closest?.(`#${PANEL_ID}`)) {
        break;
      }

      const text = getTextWithoutControls(current);
      if (isRepeatItemRootCandidate(current)) {
        best = current;
      }
      if (/家庭|社会关系|亲属/.test(text) && isRepeatItemRootCandidate(current)) {
        return current;
      }
    }

    return best;
  }

  function isSemanticallyIncompatible(field, entry, fieldLabel, fieldCategory) {
    const fieldBucket = getFieldSemanticBucket(field, fieldLabel, fieldCategory);
    const entryBucket = getEntrySemanticBucket(entry);

    if (areSemanticBucketsCompatible(fieldBucket, entryBucket)) {
      return false;
    }

    return true;
  }

  function getEntryOccurrenceIndex(entry) {
    const text = normalizeText([entry?.subsection, entry?.category].filter(Boolean).join(" "), 120);
    const match = text.match(/(?:经历|信息|证书|奖惩|家庭|教育|工作\/实习|实习|项目|社团|学生工作)?\s*(\d+)/);
    if (!match) {
      return 0;
    }
    return Number(match[1]) || 0;
  }

  function getOccurrenceMatchBonus(field, entry) {
    const fieldIndex = Number(field?.fieldOccurrenceIndex || 0);
    const fieldTotal = Number(field?.fieldOccurrenceTotal || 0);
    const entryIndex = getEntryOccurrenceIndex(entry);

    if (!fieldIndex || fieldTotal <= 1 || !entryIndex) {
      return 0;
    }

    return fieldIndex === entryIndex ? 18 : -14;
  }

  function buildCandidateLabels(fieldLabel, fieldCategory) {
    const labels = new Set();
    const normalized = normalizeText(fieldLabel, 120);
    if (normalized) {
      labels.add(normalized);
      labels.add(normalizeMatchKey(normalized));
    }

    const base = normalizeMatchKey(normalized);
    const add = (values) => {
      for (const value of values || []) {
        const text = normalizeText(value, 120);
        if (text) {
          labels.add(text);
          labels.add(normalizeMatchKey(text));
        }
      }
    };

    const mapped = [];
    for (const [key, aliases] of Object.entries(PROFILE_LABEL_ALIASES)) {
      if (normalizeMatchKey(key) === base || key === normalized) {
        mapped.push(key, ...aliases);
      }
    }
    add(mapped);

    return Array.from(labels).filter(Boolean);
  }

  function shouldUseRepeatGroupContext(field, fieldLabel, fieldCategory) {
    if (!field?.groupText) {
      return false;
    }

    const labelKey = normalizeMatchKey(fieldLabel || field?.label || "");
    if (!labelKey || isGenericFieldLabel(fieldLabel) || isOptionOnlyLabel(fieldLabel)) {
      return true;
    }

    if (["家庭信息", "绩效考核", "教育经历", "实习经历", "工作经历", "项目经历"].includes(fieldCategory)) {
      return true;
    }

    return /^(姓名|电话|手机号|联系方式|工作单位|单位名称|公司|职务|职位|岗位|地址|住址|联系地址|通讯地址|关系|联系人|证明人|推荐人|学校|专业|学历|学位|部门|地点|城市|开始时间|结束时间)$/.test(labelKey);
  }

  function isCandidateExcludedByFkgNegativeOrScope(field, entry, fieldLabel, fieldCategory) {
    const combinedContext = [
      fieldLabel,
      field.nearbyText,
      field.placeholder,
      field.name,
      field.id,
      field.sectionHeading,
      field.section
    ].filter(Boolean).join(" ").toLowerCase();

    // 1. Negative rules for candidate personal basic info:
    if (entry.category === "基本信息") {
      const entryLabel = String(entry.label || "");
      if (/姓名|真实姓名/.test(entryLabel) && !/紧急|证明|推荐|关系/.test(entryLabel)) {
        if (/(?:紧急联系人|紧急联络人|证明人|推荐人|父亲|母亲|家长|监护人|配偶|担保人|子女|直属上级|主管|经理|emergency|reference|referee|father|mother|parent|guardian|spouse|guarantor|child|manager|supervisor)/i.test(combinedContext)) {
          return true;
        }
      }
      if (/电话|手机/.test(entryLabel) && !/紧急|证明|推荐/.test(entryLabel)) {
        if (/(?:紧急联系人|紧急联络人|证明人|推荐人|家庭电话|固定电话|办公电话|公司电话|座机|传真|父亲|母亲|家长|监护人|配偶|子女|主管|经理|emergency|reference|referee|father|mother|parent|guardian|spouse|manager|supervisor|home phone|office phone|work phone|fax)/i.test(combinedContext)) {
          return true;
        }
      }
      if (/邮箱|email/i.test(entryLabel) && !/紧急|证明/.test(entryLabel)) {
        if (/(?:紧急联系人|紧急联络人|证明人|推荐人|企业邮箱|公司邮箱|主管|经理|直属上级|父亲|母亲|家长|配偶|监护人|emergency|reference|referee|supervisor|manager|father|mother|parent|spouse|guardian)/i.test(combinedContext)) {
          return true;
        }
      }
      if (/身份证|证件号/i.test(entryLabel)) {
        if (/(?:紧急联系人|紧急联络人|证明人|推荐人|父亲|母亲|家长|配偶|监护人|子女|emergency|reference|referee|father|mother|parent|spouse|guardian)/i.test(combinedContext)) {
          return true;
        }
      }
    }

    // 2. Negative rules for work experience / internship entries:
    if (entry.category === "工作经历" || entry.category === "实习经历") {
      const entryLabel = String(entry.label || "");
      if (/职位|职务|岗位/.test(entryLabel)) {
        if (/(?:主管|经理|直属上级|直属领导|领导|证明人职位|证明人职务|推荐人职位|证明人|推荐人|supervisor|manager|reference|referee)/i.test(combinedContext)) {
          return true;
        }
      }
      if (/公司|单位/.test(entryLabel)) {
        if (/(?:证明人|推荐人|学校|院校|意向|期望|reference|referee|school|university|desired|target)/i.test(combinedContext)) {
          return true;
        }
      }
    }

    // 3. Repeater item isolation: Candidate personal basic info must not fill into experience cards
    if (field.isRepeaterItem && entry.category === "基本信息" && !/紧急|证明/.test(entry.label || "")) {
      return true;
    }

    // 4. Cross-section scope isolation based on inferred sectionHeading:
    const heading = String(field.sectionHeading || field.section || "").toLowerCase();
    if (heading) {
      const isEduHeading = /教育|学历|学业|学校|毕业|education|degree|academic/i.test(heading);
      const isWorkHeading = /工作|实习|履历|职业|就职|work|employment|experience|job/i.test(heading) && !/在校|社团/.test(heading);
      const isProjectHeading = /项目|project/i.test(heading);
      const isBasicHeading = /基本|个人信息|个人资料|联系方式|basic|personal|contact/i.test(heading);

      if (isEduHeading && (entry.category === "工作经历" || entry.category === "项目经历")) {
        return true;
      }
      if (isWorkHeading && (entry.category === "教育经历" || entry.category === "项目经历")) {
        return true;
      }
      if (isProjectHeading && (entry.category === "教育经历" || entry.category === "工作经历")) {
        return true;
      }
      if (isBasicHeading && field.isRepeaterItem && entry.category !== "基本信息") {
        return true;
      }
    }

    // 5. Strict paragraph / repeaterIndex isolation:
    if (field.isRepeaterItem && Number(field.repeaterIndex) >= 0) {
      let entryIndex = -1;
      if (entry.prefix) {
        const m = entry.prefix.match(/items\[(\d+)\]/);
        if (m) entryIndex = Number(m[1]);
      }
      if (entryIndex < 0 && entry.subsection) {
        const m = entry.subsection.match(/(\d+)/);
        if (m) entryIndex = Number(m[1]) - 1;
      }
      if (entryIndex >= 0 && entryIndex !== Number(field.repeaterIndex)) {
        return true;
      }
    }

    return false;
  }

  function scoreAutofillCandidate(field, entry, fieldLabel, fieldCategory) {
    if (!field || !entry) {
      return 0;
    }

    const familyScoped = isFamilyScopedField(field, fieldLabel, fieldCategory);
    if (familyScoped && entry.category !== "家庭信息") {
      return 0;
    }

    const optionText = getFieldOptionLabelsText(field, 180);
    const useGroupContext = shouldUseRepeatGroupContext(field, fieldLabel, fieldCategory);
    const fieldText = compactText([
      fieldLabel,
      field.nearbyText,
      field.placeholder,
      field.name,
      field.id,
      optionText,
      familyScoped || useGroupContext ? field.groupText : ""
    ].join(" "));
    const entryText = compactText([entry.label, entry.subsection, entry.category, ...(entry.aliases || [])].join(" "));
    if (!fieldText || !entryText) {
      return 0;
    }

    if (isExplanatoryField(fieldText) && !isExplanatoryEntry(entryText)) {
      return 0;
    }

    if (!isCategoryCompatibleForMapping(fieldCategory, entry.category)) {
      return 0;
    }

    if (isSemanticallyIncompatible(field, entry, fieldLabel, fieldCategory)) {
      return 0;
    }

    if (!isFamilyCandidateAllowed(field, entry, fieldLabel, fieldCategory)) {
      return 0;
    }

    if (isCandidateExcludedByFkgNegativeOrScope(field, entry, fieldLabel, fieldCategory)) {
      return 0;
    }

    const relationBonus = getFamilyRelationMatchBonus(field, entry, fieldCategory);
    if (relationBonus <= -999) {
      return 0;
    }

    const candidateLabels = buildCandidateLabels(fieldLabel, fieldCategory);
    let directScore = 0;

    directScore = Math.max(directScore, textMatchScore(fieldText, entry.label));
    directScore = Math.max(directScore, textMatchScore(fieldText, entry.subsection));
    directScore = Math.max(directScore, textMatchScore(fieldLabel, entry.label));
    directScore = Math.max(directScore, textMatchScore(fieldLabel, entry.subsection));

    for (const alias of entry.aliases || []) {
      directScore = Math.max(directScore, textMatchScore(fieldText, alias));
      directScore = Math.max(directScore, textMatchScore(fieldLabel, alias));
    }

    for (const candidateLabel of candidateLabels) {
      directScore = Math.max(directScore, textMatchScore(entryText, candidateLabel));
      directScore = Math.max(directScore, textMatchScore(entry.label, candidateLabel));
    }

    if (directScore <= 0) {
      return 0;
    }

    let score = directScore * 10;
    const fieldBucket = getFieldSemanticBucket(field, fieldLabel, fieldCategory);
    const entryBucket = getEntrySemanticBucket(entry);
    if (fieldBucket && entryBucket && fieldBucket === entryBucket) {
      score += 8;
    }
    score += relationBonus;
    score += textMatchScore(fieldText, entry.category) * 2;
    score += textMatchScore(fieldText, entry.subsection) * 8;

    if (fieldCategory === entry.category) {
      score += 4;
    } else {
      score += getEntryCategoryBonus(fieldCategory, entry.category);
    }

    score += getOccurrenceMatchBonus(field, entry);

    if (field.required) {
      score += 2;
    }

    if (field.hasCurrentValue) {
      score -= 5;
    }

    if (entry.hasValue) {
      score += 1;
    }

    if (/上传|附件|照片|证件照|简历附件/.test(fieldText)) {
      score = -999;
    }

    if (/是否|有无|能否|接受|服从/.test(fieldText) && entry.category === "有关声明") {
      score += 6;
    }

    if (/出生日期|出生年月|开始时间|结束时间|取得毕业证时间|获取日期|竞赛时间/.test(fieldText) && /日期|时间|年月/.test(entry.label)) {
      score += 5;
    }

    return score;
  }

  function guessAutofillValueFieldType(field) {
    const labelText = compactText([field?.inferredLabel || inferFieldLabel(field), field?.label, field?.placeholder].join(" "));
    const optionText = getFieldOptionLabelsText(field, 160);
    const contextText = compactText([field?.nearbyText, field?.section, field?.groupText, optionText].join(" "));
    if (/开始时间|结束时间|出生日期|出生年月|取得毕业证时间|获取日期|取得时间|竞赛时间|获得时间|有效期/.test(labelText)) {
      return "date";
    }
    if (/是否|有无|能否|接受|服从|未参加|参加过|长期有效|填写有效期/.test(labelText)) {
      return "choice";
    }
    if (/性别/.test(labelText)) {
      return "choice";
    }
    if (/男|女|是|否|有|无|未婚|已婚|离婚|丧偶|本科|硕士|博士|父亲|母亲|配偶|党员|团员|群众/.test(optionText)) {
      return "choice";
    }
    if (
      !labelText &&
      /开始时间|结束时间|出生日期|出生年月|取得毕业证时间|获取日期|取得时间|竞赛时间|获得时间|有效期/.test(contextText)
    ) {
      return "date";
    }
    if (
      !labelText &&
      /是否|有无|能否|接受|服从|未参加|参加过|长期有效|填写有效期|性别/.test(contextText)
    ) {
      return "choice";
    }
    if (/证书|语言|学历|学位|民族|政治面貌|生源地|居住地|地址|院校|院系|学校|单位|部门|职务|岗位/.test(labelText)) {
      return "text";
    }
    return "text";
  }

  function normalizeControlKind(currentType, aiKind) {
    const type = String(currentType || "").toLowerCase();
    const kind = String(aiKind || "").toLowerCase();

    if (!kind || kind === "unknown") {
      return type || "text";
    }

    if (["text", "textarea", "select", "search-select", "radio", "checkbox", "date", "file"].includes(kind)) {
      return kind === "search-select" ? "combobox" : kind;
    }

    if (kind.includes("select")) {
      return "select";
    }
    if (kind.includes("radio")) {
      return "radio";
    }
    if (kind.includes("checkbox")) {
      return "checkbox";
    }
    if (kind.includes("date")) {
      return "date";
    }
    if (kind.includes("search")) {
      return "combobox";
    }

    return type || "text";
  }

  function getAutoFillScoreThreshold(field, fieldLabel, fieldCategory) {
    if (isFamilyScopedField(field, fieldLabel, fieldCategory) && requiresFamilyRelationGate(fieldLabel)) {
      return field.hasCurrentValue ? 90 : 62;
    }
    return field.hasCurrentValue ? 84 : 55;
  }

  function createAutofillCandidate(field, entry, score) {
    const fieldLabel = field?.inferredLabel || inferFieldLabel(field);
    const fieldCategory = field?.inferredCategory || inferMatchSection(field);
    const value = resolveEntryValueForField(field, entry, fieldLabel, fieldCategory);
    const normalizedScore = (score > 0 && score <= 1) ? score * 100 : score;
    const confidence = normalizedScore >= 40 ? Math.max(0, Math.min(0.99, 0.45 + normalizedScore / 100)) : Math.max(0, normalizedScore / 120);
    const text = compactText([fieldLabel, fieldCategory, field.nearbyText, field.placeholder, field.name, field.id].join(" "));
    const writeMode = guessAutofillValueFieldType(field);
    const autoFillScoreThreshold = getAutoFillScoreThreshold(field, fieldLabel, fieldCategory);
    const alreadyMatches = typedValuesLookEquivalent(field.currentValue, value, writeMode, field);
    const hasValue = Boolean(field.hasCurrentValue || (field.currentValue && String(field.currentValue).trim() !== ""));
    // Product default: only auto-fill empty fields! Differing non-empty fields require confirmation.
    const shouldAutoFill =
      (alreadyMatches || (!hasValue && normalizedScore >= autoFillScoreThreshold)) &&
      value !== "" &&
      field.canFill !== false &&
      !/上传|附件|照片|证件照|简历附件/.test(text);

    return {
      id: `candidate_${field.fieldId}`,
      fieldId: field.fieldId,
      field,
      fieldLabel,
      fieldCategory,
      snapshotValue: String(field.currentValue || "").trim(),
      snapshotType: field.type || "text",
      snapshotLabel: fieldLabel,
      snapshotSection: fieldCategory,
      sourceLabel: entry?.label || "",
      sourceCategory: entry?.category || "",
      sourceSubsection: entry?.subsection || "",
      sourceItemId: entry?.itemId || "",
      value,
      preview: formatCandidateValue(value, 140),
      confidence,
      writeMode,
      mappingSource: "本地规则",
      reason: "",
      shouldAutoFill,
      canAutoFill: Boolean(value) && field.canFill !== false && (alreadyMatches || normalizedScore >= 32),
      alreadyMatches,
      warning: buildCandidateWarning(field, entry, normalizedScore, writeMode),
      score: normalizedScore
    };
  }

  function createAiAutofillCandidate(mapping, scan, entries) {
    const field = getScanFieldById(scan, mapping?.fieldId);
    const entry = getProfileEntryByPath(entries, mapping?.sourcePath);
    if (!field || !entry?.hasValue) {
      return null;
    }

    const fieldLabel = field?.inferredLabel || inferFieldLabel(field);
    const fieldCategory = field?.inferredCategory || inferMatchSection(field);
    if (!isCategoryCompatibleForMapping(fieldCategory, entry.category)) {
      return null;
    }
    if (isSemanticallyIncompatible(field, entry, fieldLabel, fieldCategory)) {
      return null;
    }
    if (!isFamilyCandidateAllowed(field, entry, fieldLabel, fieldCategory)) {
      return null;
    }

    const confidence = Math.max(0, Math.min(1, Number(mapping.confidence || 0)));
    const score = Math.round(confidence * 100);
    const candidate = createAutofillCandidate(field, entry, Math.max(score, 35));
    if (!candidate.value) {
      return null;
    }
    const hasValue = Boolean(field.hasCurrentValue || (field.currentValue && String(field.currentValue).trim() !== ""));
    candidate.confidence = confidence;
    candidate.score = score;
    candidate.mappingSource = "AI 优先匹配";
    candidate.reason = normalizeText(mapping.reason || "", 160);
    candidate.shouldAutoFill = (candidate.alreadyMatches || (!hasValue && confidence >= 0.68)) && Boolean(candidate.value) && field.canFill;
    candidate.canAutoFill = (candidate.alreadyMatches || confidence >= 0.42) && Boolean(candidate.value) && field.canFill;
    candidate.warning = buildAiCandidateWarning(candidate, mapping);
    return candidate;
  }

  function buildAiCandidateWarning(candidate, mapping) {
    const notes = [];
    if (candidate.field?.hasCurrentValue) {
      notes.push(candidate.shouldAutoFill ? "当前字段已有内容，自动填写时会覆盖" : "当前字段已有内容，已转为待处理");
    }
    if (candidate.writeMode !== "text") {
      notes.push(candidate.writeMode === "date" ? "日期字段需要核对格式" : "选择控件需要核对选项");
    }
    if (candidate.confidence < 0.68) {
      notes.push("AI 判断不够确定，已转为待处理");
    }
    if (mapping?.reason) {
      notes.push(`原因：${normalizeText(mapping.reason, 120)}`);
    }
    return notes.join("；");
  }

  function buildCandidateWarning(field, entry, score, writeMode) {
    const notes = [];
    if (!field.canFill) {
      notes.push("当前控件暂不支持自动填写");
    }
    if (field.hasCurrentValue) {
      notes.push(score >= 84 ? "当前字段已有内容，自动填写时会覆盖" : "当前字段已有内容，已转为待处理");
    }
    if (writeMode !== "text") {
      if (writeMode === "date") {
        notes.push("日期字段需要核对格式");
      } else {
        notes.push("可能需要手动点开选择，已转为待处理");
      }
    }
    if (score < 40) {
      notes.push("匹配不够确定，已转为待处理");
    }
    if (!entry?.hasValue) {
      notes.push("本地资料未填写");
    }
    return notes.join("；");
  }

  function formatCandidateValue(value, maxLength = 120) {
    if (value == null || value === "") {
      return "";
    }
    if (typeof value === "string") {
      return normalizeText(value, maxLength);
    }
    if (typeof value === "object") {
      try {
        return normalizeText(JSON.stringify(value), maxLength);
      } catch {
        return normalizeText(String(value), maxLength);
      }
    }
    return normalizeText(String(value), maxLength);
  }

  const CONTROLLED_SYNONYM_GROUPS = [
    ["博士", "博士研究生", "博士生", "doctor", "phd"],
    ["硕士", "硕士研究生", "硕士生", "研究生", "master"],
    ["本科", "大学本科", "学士", "bachelor"],
    ["大专", "专科", "大学专科", "高职"],
    ["高中", "高中及以下", "中专", "中职"],
    ["男", "男性", "male", "m"],
    ["女", "女性", "female", "f"],
    ["是", "yes", "true", "1", "checked", "on", "有", "同意", "接受", "支持"],
    ["否", "no", "false", "0", "off", "无", "不同意", "拒绝", "反对"],
    ["未婚", "单身"],
    ["已婚"],
    ["离异", "离婚"],
    ["丧偶"],
    ["中共党员", "党员"],
    ["共青团员", "团员"],
    ["群众", "普通公民"],
    ["校级", "学校级"],
    ["院级", "学院级"]
  ];

  const SYNONYM_CANONICAL_MAP = new Map();
  for (const group of CONTROLLED_SYNONYM_GROUPS) {
    const canonical = group[0];
    for (const item of group) {
      SYNONYM_CANONICAL_MAP.set(String(item).trim().toLowerCase(), canonical);
    }
  }

  function getCanonicalSynonym(val) {
    if (val == null) return "";
    const clean = String(val).trim().toLowerCase();
    return SYNONYM_CANONICAL_MAP.get(clean) || clean;
  }

  function normalizePhoneDigits(phoneStr) {
    if (!phoneStr) return "";
    let cleaned = String(phoneStr).trim().replace(/[\s\-().（）]/g, "");
    if (cleaned.startsWith("+86") || cleaned.startsWith("0086")) {
      cleaned = cleaned.replace(/^(?:\+86|0086)/, "");
    } else if (cleaned.length === 13 && cleaned.startsWith("86")) {
      cleaned = cleaned.slice(2);
    }
    return cleaned;
  }

  function stripRegionSuffix(str) {
    if (!str || typeof str !== "string" || str.length < 2) return str || "";
    const clean = str.trim();
    const stripped = clean.replace(/(?:维吾尔自治区|壮族自治区|回族自治区|自治区|特别行政区|市辖区|省|市|区|县)$/, "");
    return stripped.length >= 2 ? stripped : clean;
  }

  function typedValuesLookEquivalent(left, right, writeMode = "text", field = null) {
    if (left == null && right == null) return true;
    if (left == null || right == null) return false;
    const s1 = String(left).trim();
    const s2 = String(right).trim();
    if (!s1 && !s2) return true;
    if (!s1 || !s2) return false;
    if (s1 === s2) return true;
    if (s1.toLowerCase() === s2.toLowerCase()) return true;

    const labelContext = String(field?.label || field?.inferredLabel || "").toLowerCase();
    const mode = writeMode || (field ? guessAutofillValueFieldType(field) : "text");

    // 1. Phone numbers
    if (
      mode === "tel" ||
      mode === "telephone" ||
      mode === "phone" ||
      /电话|手机|phone|mobile/i.test(labelContext) ||
      (/^\+?[\d\s\-().（）]{7,}$/.test(s1) && /^\+?[\d\s\-().（）]{7,}$/.test(s2))
    ) {
      const p1 = normalizePhoneDigits(s1);
      const p2 = normalizePhoneDigits(s2);
      if (p1 && p2 && p1 === p2) {
        return true;
      }
      return false;
    }

    // 2. Email
    if (mode === "email" || /邮箱|email/i.test(labelContext) || (s1.includes("@") && s2.includes("@"))) {
      return s1.toLowerCase() === s2.toLowerCase();
    }

    // 3. ID / Certificate
    if (mode === "id" || /身份证|证件号|passport/i.test(labelContext)) {
      const id1 = s1.replace(/[\s\-]/g, "").toUpperCase();
      const id2 = s2.replace(/[\s\-]/g, "").toUpperCase();
      return id1 === id2;
    }

    // 4. Date
    if (mode === "date" || /日期|时间|date|year|month/i.test(labelContext) || /\d{4}[年./-]/.test(s1)) {
      const d1 = normalizeDateValue(s1);
      const d2 = normalizeDateValue(s2);
      if (d1 && d2) {
        return d1 === d2;
      }
    }

    // 5. Choices / Enumerations
    const syn1 = getCanonicalSynonym(s1);
    const syn2 = getCanonicalSynonym(s2);
    if (syn1 && syn2 && syn1 === syn2) {
      return true;
    }

    // 5b. Administrative region normalization (e.g. 北京市 vs 北京, 广东省 vs 广东)
    const isRegionField =
      mode === "region" ||
      mode === "address" ||
      mode === "city" ||
      /城市|地区|省份|籍贯|户籍|地址|生源地|期望城市|工作地点|location|city|province|region/i.test(labelContext);

    const isNameField = /姓名|名字|name/i.test(labelContext) && !/城市|地区|省份|籍贯|户籍|地址/i.test(labelContext);
    const hasRegionSuffix = /(?:维吾尔自治区|壮族自治区|回族自治区|自治区|特别行政区|市辖区|省|市|区|县)$/;
    if (!isNameField && (isRegionField || mode === "choice") && (hasRegionSuffix.test(s1) || hasRegionSuffix.test(s2))) {
      const reg1 = stripRegionSuffix(s1);
      const reg2 = stripRegionSuffix(s2);
      if (reg1 && reg2 && reg1 === reg2) {
        return true;
      }
    }

    // 6. Number with units (e.g. 180cm vs 180, 50kg vs 50)
    const stripped1 = s1.replace(/厘米|cm|CM|千克|公斤|kg|KG|万元|万/g, "").trim();
    const stripped2 = s2.replace(/厘米|cm|CM|千克|公斤|kg|KG|万元|万/g, "").trim();
    if (stripped1 && stripped2 && stripped1 === stripped2 && !isNaN(Number(stripped1))) {
      return true;
    }

    return false;
  }

  function valuesLookEquivalent(left, right) {
    return typedValuesLookEquivalent(left, right);
  }

  function summarizeDebugField(field) {
    const label = field?.inferredLabel || inferFieldLabel(field);
    const category = field?.inferredCategory || inferMatchSection(field);
    return {
      fieldId: field?.fieldId || "",
      label: normalizeText(label || "", 120),
      category: normalizeText(category || "", 80),
      type: normalizeText(field?.type || "", 40),
      canFill: Boolean(field?.canFill),
      hasCurrentValue: Boolean(field?.hasCurrentValue),
      required: Boolean(field?.required),
      placeholder: normalizeText(field?.placeholder || "", 80),
      section: normalizeText(field?.section || "", 120),
      groupText: normalizeText(field?.groupText || "", 160)
    };
  }

  function summarizeDebugCandidate(candidate) {
    return {
      fieldId: candidate.fieldId,
      fieldLabel: normalizeText(candidate.fieldLabel || "", 120),
      fieldCategory: normalizeText(candidate.fieldCategory || "", 80),
      sourceLabel: normalizeText(candidate.sourceLabel || "", 120),
      sourceCategory: normalizeText(candidate.sourceCategory || "", 80),
      sourceSubsection: normalizeText(candidate.sourceSubsection || "", 120),
      score: Number(candidate.score || 0),
      confidence: Number(candidate.confidence || 0),
      writeMode: candidate.writeMode || "",
      mappingSource: candidate.mappingSource || "",
      shouldAutoFill: Boolean(candidate.shouldAutoFill),
      canAutoFill: Boolean(candidate.canAutoFill),
      alreadyMatches: Boolean(candidate.alreadyMatches),
      hasCurrentValue: Boolean(candidate.field?.hasCurrentValue),
      warning: normalizeText(candidate.warning || "", 180),
      reason: normalizeText(candidate.reason || "", 180)
    };
  }

  function summarizeDebugResult(result) {
    return {
      id: result?.id || "",
      ok: Boolean(result?.ok),
      note: normalizeText(result?.note || "", 180)
    };
  }

  function updateAutofillDebugPlan(plan, meta = {}) {
    if (!plan) {
      return;
    }

    const candidates = Array.isArray(plan.candidates) ? plan.candidates.map(summarizeDebugCandidate) : [];
    const fields = Array.isArray(plan.scan?.fields) ? plan.scan.fields.map(summarizeDebugField) : [];
    const autoFillCount = candidates.filter((candidate) => candidate.shouldAutoFill).length;
    const confirmCount = candidates.filter((candidate) => !candidate.shouldAutoFill && candidate.canAutoFill).length;
    const ignoredCount = Math.max(0, candidates.length - autoFillCount - confirmCount);
    const aiUsage = sanitizeAutofillAiUsage(meta.aiUsage || getAutofillAiSnapshot());

    lastAutofillDebug = {
      version: SCRIPT_VERSION,
      page: {
        url: plan.page?.url || location.href,
        title: plan.page?.title || document.title,
        hostname: plan.page?.hostname || location.hostname
      },
      generatedAt: new Date().toISOString(),
      mappingSource: plan.mappingSource || "",
      aiStatus: normalizeText(meta.aiStatus || aiUsage.message || "", 300),
      aiUsage,
      scan: {
        fieldCount: fields.length,
        expandedEditCards: Number(plan.scan?.expandedEditCards || 0),
        siteAdapter: plan.scan?.siteAdapter || null,
        fields
      },
      counts: {
        candidates: candidates.length,
        autoFill: autoFillCount,
        needsConfirm: confirmCount,
        ignored: ignoredCount
      },
      candidates,
      summary: null,
      results: []
    };
  }

  function updateAutofillDebugResults(summary, results) {
    if (!lastAutofillDebug) {
      lastAutofillDebug = {
        version: SCRIPT_VERSION,
        page: {
          url: location.href,
          title: document.title,
          hostname: location.hostname
        },
        generatedAt: new Date().toISOString(),
        counts: {},
        candidates: [],
        results: []
      };
    }

    lastAutofillDebug.summary = {
      attempted: Number(summary?.attempted || 0),
      filled: Number(summary?.filled || 0),
      failed: Number(summary?.failed || 0),
      skipped: Number(summary?.skipped || 0),
      pending: Number(summary?.pending ?? Number(summary?.failed || 0) + Number(summary?.skipped || 0)),
      total: Number(summary?.total || 0),
      message: normalizeText(summary?.message || "", 160),
      aiUsage: sanitizeAutofillAiUsage(summary?.aiUsage || getAutofillAiSnapshot())
    };
    lastAutofillDebug.aiUsage = sanitizeAutofillAiUsage(summary?.aiUsage || lastAutofillDebug.aiUsage || getAutofillAiSnapshot());
    lastAutofillDebug.aiStatus = lastAutofillDebug.aiUsage.message;
    lastAutofillDebug.results = Array.isArray(results) ? results.map(summarizeDebugResult) : [];
    lastAutofillDebug.finishedAt = new Date().toISOString();
  }

  function getAutofillCandidateSectionRank(category) {
    const index = AUTO_FILL_SECTION_ORDER.indexOf(category);
    return index === -1 ? 999 : index;
  }

  function compareAutofillCandidates(leftCandidate, rightCandidate) {
    const leftRank = getAutofillCandidateSectionRank(leftCandidate.fieldCategory);
    const rightRank = getAutofillCandidateSectionRank(rightCandidate.fieldCategory);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return Number(rightCandidate.score || 0) - Number(leftCandidate.score || 0);
  }

  function buildAutofillPlan(scan) {
    const entries = getCurrentProfileEntries();
    const visibleFields = Array.isArray(scan?.fields) ? scan.fields.filter((field) => field && field.canFill) : [];
    const fieldCounters = new Map();
    const fieldTotals = new Map();
    const enrichedFields = visibleFields.map((field) => {
      const fieldLabel = inferFieldLabel(field);
      const fieldCategory = inferMatchSection(field);
      const occurrenceKey = `${fieldCategory || "未分类"}|${normalizeMatchKey(fieldLabel) || field.fieldId}`;
      fieldTotals.set(occurrenceKey, (fieldTotals.get(occurrenceKey) || 0) + 1);
      return {
        ...field,
        inferredLabel: fieldLabel,
        inferredCategory: fieldCategory,
        occurrenceKey
      };
    });
    const candidates = [];

    for (const field of enrichedFields) {
      const fieldLabel = field.inferredLabel || inferFieldLabel(field);
      const fieldCategory = field.inferredCategory || inferMatchSection(field);
      const nextOccurrenceIndex = (fieldCounters.get(field.occurrenceKey) || 0) + 1;
      fieldCounters.set(field.occurrenceKey, nextOccurrenceIndex);
      field.fieldOccurrenceIndex = nextOccurrenceIndex;
      field.fieldOccurrenceTotal = fieldTotals.get(field.occurrenceKey) || 1;
      let bestEntry = null;
      let bestScore = -9999;

      for (const entry of entries) {
        if (!entry?.hasValue) {
          continue;
        }

        const score = scoreAutofillCandidate(field, entry, fieldLabel, fieldCategory);
        if (score > bestScore) {
          bestScore = score;
          bestEntry = entry;
        }
      }

      if (!bestEntry || bestScore < 18) {
        continue;
      }

      const candidate = createAutofillCandidate(field, bestEntry, bestScore);
      if (!candidate.value) {
        continue;
      }
      candidates.push(candidate);
    }

    candidates.sort(compareAutofillCandidates);

    return {
      createdAt: new Date().toISOString(),
      mappingSource: "本地规则",
      page: {
        url: scan?.url || "",
        title: scan?.title || "",
        hostname: scan?.hostname || ""
      },
      scan,
      entries,
      candidates,
      autoFillIds: new Set(candidates.filter((candidate) => candidate.shouldAutoFill).map((candidate) => candidate.id))
    };
  }

  function sortAutofillCandidates(candidates) {
    return candidates.slice().sort(compareAutofillCandidates);
  }

  function cloneLocalFallbackCandidate(candidate) {
    return {
      ...candidate,
      mappingSource: "本地规则兜底"
    };
  }

  function shouldFallbackToLocalCandidate(aiCandidate, localCandidate) {
    if (!aiCandidate || !localCandidate) {
      return false;
    }
    if (aiCandidate.shouldAutoFill) {
      return false;
    }
    if (aiCandidate.confidence >= 0.58) {
      return false;
    }
    if (localCandidate.shouldAutoFill && localCandidate.score >= 55) {
      return true;
    }
    if (!aiCandidate.canAutoFill && localCandidate.canAutoFill && localCandidate.score >= 45) {
      return true;
    }
    return false;
  }

  function buildAiFirstPlan(localPlan, aiCandidates, notes = []) {
    if (!localPlan || !Array.isArray(aiCandidates) || aiCandidates.length === 0) {
      return localPlan;
    }

    const selectedByFieldId = new Map();
    const localByFieldId = new Map((localPlan.candidates || []).map((candidate) => [candidate.fieldId, candidate]));
    let aiPrimaryCount = 0;
    let localFallbackCount = 0;

    for (const aiCandidate of aiCandidates) {
      const localCandidate = localByFieldId.get(aiCandidate.fieldId);
      if (shouldFallbackToLocalCandidate(aiCandidate, localCandidate)) {
        selectedByFieldId.set(aiCandidate.fieldId, cloneLocalFallbackCandidate(localCandidate));
        localFallbackCount += 1;
        continue;
      }
      selectedByFieldId.set(aiCandidate.fieldId, aiCandidate);
      aiPrimaryCount += 1;
    }

    for (const localCandidate of localPlan.candidates || []) {
      if (selectedByFieldId.has(localCandidate.fieldId)) {
        continue;
      }
      selectedByFieldId.set(localCandidate.fieldId, cloneLocalFallbackCandidate(localCandidate));
      localFallbackCount += 1;
    }

    const candidates = sortAutofillCandidates(Array.from(selectedByFieldId.values()));
    return {
      ...localPlan,
      mappingSource: localFallbackCount > 0 ? "AI 优先 + 本地规则兜底" : "AI 优先匹配",
      aiNotes: notes,
      aiPrimaryCount,
      localFallbackCount,
      candidates,
      autoFillIds: new Set(candidates.filter((candidate) => candidate.shouldAutoFill).map((candidate) => candidate.id))
    };
  }

  function buildPlanMatchSummary(plan) {
    const aiPrimaryCount = Number(plan?.aiPrimaryCount || 0);
    const localFallbackCount = Number(plan?.localFallbackCount || 0);
    if (plan?.mappingSource === "AI 优先 + 本地规则兜底") {
      return `AI 优先匹配 ${aiPrimaryCount} 项，本地规则兜底 ${localFallbackCount} 项`;
    }
    if (plan?.mappingSource === "AI 优先匹配") {
      return `AI 优先匹配 ${aiPrimaryCount} 项`;
    }
    if (plan?.mappingSource === "AI 表单字段识别 + 本地规则") {
      return "AI 已识别表单结构，本地规则完成字段匹配";
    }
    return "本地规则完成字段匹配";
  }

  async function enhancePlanWithAi(scan, localPlan, options = {}) {
    const entries = Array.isArray(localPlan?.entries) ? localPlan.entries : getCurrentProfileEntries();
    const profileCatalog = buildProfileCatalogFromEntries(entries);
    if (profileCatalog.fields.length === 0) {
      return { plan: localPlan };
    }

    setAutofillAiTrying("字段理解");
    setAutofillProgress("AI 匹配字段", 76, "正在用 AI 优先匹配页面字段，本地规则会兜底剩余字段");
    setProfilePanelStatus("正在用 AI 优先匹配页面字段，只发送字段名称，不发送资料值...");
    const response = await sendRuntimeMessage({
      type: "OJAF_MAP_FIELDS",
      payload: {
        scan,
        profileCatalog,
        taskDeadline: options.taskDeadline
      }
    });

    const mappings = Array.isArray(response?.mappings) ? response.mappings : [];
    const aiCandidates = mappings
      .map((mapping) => createAiAutofillCandidate(mapping, scan, entries))
      .filter(Boolean);
    if (aiCandidates.length === 0) {
      setAutofillAiNoResult("字段理解", "AI 未返回可用字段匹配");
      setAutofillProgress("本地兜底匹配", 82, "AI 未返回可用匹配，正在切换本地规则兜底");
      return {
        plan: localPlan
      };
    }

    const enhancedPlan = buildAiFirstPlan(localPlan, aiCandidates, response?.notes || []);
    setAutofillAiUsed("字段理解");
    setAutofillProgress("AI 匹配字段", 86, buildPlanMatchSummary(enhancedPlan));

    return {
      plan: enhancedPlan
    };
  }

  async function enhanceScanWithAi(scan, options = {}) {
    try {
      setAutofillAiTrying("表单字段识别");
      setAutofillProgress("AI 识别表单字段", 50, "正在识别字段名称和控件类型");
      setProfilePanelStatus("正在用 AI 识别表单结构，只发送字段信息...");
      const response = await sendRuntimeMessage({
        type: "OJAF_ANALYZE_PAGE_STRUCTURE",
        payload: {
          scan,
          taskDeadline: options.taskDeadline
        }
      });

      const hints = Array.isArray(response?.fieldHints) ? response.fieldHints : [];
      if (hints.length === 0) {
        setAutofillAiNoResult("表单字段识别", "AI 未返回可用字段建议");
        setAutofillProgress("整理表单字段", 60, "AI 没有提供可用建议，继续使用本地规则兜底");
        return { scan };
      }

      const fieldMap = new Map((scan.fields || []).map((field) => [field.fieldId, field]));
      for (const hint of hints) {
        const field = fieldMap.get(hint.fieldId);
        if (!field) {
          continue;
        }
        field.aiHint = {
          label: hint.label || "",
          section: hint.section || "",
          controlKind: hint.controlKind || "",
          confidence: hint.confidence || 0,
          note: hint.note || ""
        };
      }

      setAutofillAiUsed("表单字段识别");
      setAutofillProgress("AI 识别表单字段", 60, `已识别 ${hints.length} 项`);

      return {
        scan: {
          ...scan,
          fields: Array.from(fieldMap.values()),
          aiStructure: {
            siteType: response.siteType || "generic",
            confidence: response.confidence || 0,
            notes: response.notes || []
          }
        }
      };
    } catch (error) {
      setAutofillAiFallback("表单字段识别", error);
      setAutofillProgress("整理表单字段", 58, "AI 不可用，已使用本地规则继续");
      setProfilePanelStatus("AI 不可用，已使用本地规则继续识别表单字段。");
      return {
        scan
      };
    }
  }

  async function generateAutofillPlan(options = {}) {
    const ownsRun = !options.continueRun;
    let runId = Number(options.runId || 0);

    if (ownsRun) {
      runId = startAutofillRun("扫描页面并准备填写");
      if (!runId) {
        setProfilePanelStatus("当前已有扫描任务在运行，请稍候。", true);
        return { ok: false, reason: "busy" };
      }
    } else if (!isCurrentAutofillRun(runId)) {
      return { ok: false, reason: "busy" };
    }

    try {
      setAutofillProgress("准备简历资料", 8, "加载已保存的简历资料");
      await refreshCurrentProfile({ force: true });
      setAutofillProgress("扫描当前页面", 24, "本地扫描页面字段并展开可编辑区域");
      setProfilePanelStatus("正在本地扫描当前页面并准备自动填写...");
      const baseScan = await scanForm();
      setAutofillProgress("整理表单字段", 42, `本地已发现 ${baseScan.fields.length} 个可见字段`);
      const aiTaskDeadline = Date.now() + 25000;
      const aiStructure = await enhanceScanWithAi(baseScan, { taskDeadline: aiTaskDeadline });
      const scan = aiStructure.scan || baseScan;
      const localPlan = buildAutofillPlan(scan);
      let plan = localPlan;

      try {
        const aiResult = await enhancePlanWithAi(scan, localPlan, { taskDeadline: aiTaskDeadline });
        plan = aiResult.plan || plan;
      } catch (error) {
        setAutofillAiFallback("字段理解", error);
        setAutofillProgress("本地兜底匹配", 84, `AI 不可用，正在用本地规则兜底 ${scan.fields.length} 个字段`);
      }

      if (plan.mappingSource === "本地规则" && (autofillAiState.usedPhases || []).includes("表单字段识别")) {
        plan = {
          ...plan,
          mappingSource: "AI 表单字段识别 + 本地规则"
        };
      }

      const aiUsage = getAutofillAiSnapshot();
      const aiStatus = aiUsage.message;
      setAutofillProgress("整理匹配结果", 90, `${buildPlanMatchSummary(plan)}，共匹配 ${plan.candidates.length} 项`);
      updateAutofillDebugPlan(plan, { aiStatus, aiUsage });

      const autoFillCount = plan.autoFillIds.size;
      setProfilePanelStatus(
        plan.candidates.length > 0
          ? `${aiStatus} ${buildPlanMatchSummary(plan)}，共匹配 ${plan.candidates.length} 项，将自动填写 ${autoFillCount} 项。`
          : `${aiStatus} 没有找到可自动匹配的字段。`
      );
      setAutofillProgress("匹配完成", 90, `${buildPlanMatchSummary(plan)}，准备自动填写当前网页`);
      return {
        ok: true,
        plan,
        aiStatus,
        aiUsage,
        aiUsed: aiUsage.used,
        aiFallbackReason: aiUsage.fallbackReason,
        autoFillCount
      };
    } catch (error) {
      renderProfilePanel();
      setProfilePanelStatus(`准备填写失败：${error.message}`, true);
      return { ok: false, reason: error.message };
    } finally {
      if (ownsRun) {
        clearAutofillProgress();
      }
    }
  }

  async function runOneClickAutofill() {
    const runId = startAutofillRun("开始填写");
    if (!runId) {
      setProfilePanelStatus("当前已有填写任务在运行，请稍候。", true);
      return { ok: false, reason: "busy" };
    }

    try {
      clearMarks();
      setProfilePanelStatus("正在扫描页面并准备一键填写...");
      const planResult = await generateAutofillPlan({ runId, continueRun: true });
      if (!planResult?.ok) {
        return planResult || { ok: false, reason: "plan failed" };
      }

      const plan = planResult.plan;
      const aiUsage = sanitizeAutofillAiUsage(planResult.aiUsage || getAutofillAiSnapshot());
      const autoFillIds = plan?.autoFillIds instanceof Set
        ? plan.autoFillIds
        : new Set(Array.isArray(plan?.autoFillIds) ? plan.autoFillIds : []);

      if (!plan || autoFillIds.size === 0) {
        setProfilePanelStatus("本页没有自动填写项，橙色字段需要手动处理。可以打开资料面板查看和复制资料。", true);
        const skippedCount = await markDeferredPlanCandidates(plan, autoFillIds);
        const summary = {
          attempted: 0,
          filled: 0,
          failed: 0,
          skipped: skippedCount || plan?.candidates?.length || 0,
          total: plan?.candidates?.length || 0,
          message: "没有找到可自动填写的字段，橙色标记需要手动处理。",
          aiUsage
        };
        setAutofillSummary(summary);
        updateAutofillDebugResults(summary, []);
        return {
          ok: false,
          reason: "no candidates",
          aiUsage,
          aiUsed: aiUsage.used,
          aiFallbackReason: aiUsage.fallbackReason
        };
      }

      setAutofillProgress("填写匹配项", 94, `本地准备填写 ${autoFillIds.size} 项`);
      const beforeCount = autoFillIds.size;
      const fillResult = await applyAutofillPlan(plan, autoFillIds, { runId });
      if (profilePanelVisible) {
        renderProfilePanel();
      }
      if (!fillResult?.ok) {
        return fillResult || { ok: false, reason: "fill failed" };
      }
      return {
        ok: true,
        autoFilled: beforeCount,
        filled: fillResult.filled || 0,
        failed: fillResult.failed || 0,
        skipped: fillResult.skipped || 0,
        total: fillResult.total || 0,
        aiUsage,
        aiUsed: aiUsage.used,
        aiFallbackReason: aiUsage.fallbackReason
      };
    } catch (error) {
      setProfilePanelStatus(`一键填写失败：${error.message}`, true);
      throw error;
    } finally {
      clearAutofillProgress();
    }
  }

  async function applyAutofillPlan(plan, autoFillIds, options = {}) {
    const runId = Number(options.runId || 0);
    if (autofillInProgress && !isCurrentAutofillRun(runId)) {
      setProfilePanelStatus("当前正在处理其他填写任务，请稍候。", true);
      return { ok: false, reason: "busy" };
    }

    const autoFillSet = autoFillIds instanceof Set ? autoFillIds : new Set(autoFillIds || []);
    if (!plan || autoFillSet.size === 0) {
      setProfilePanelStatus("没有找到可自动填写的匹配项。", true);
      return { ok: false, reason: "no autofill candidates" };
    }

    const autoFillCandidates = plan.candidates.filter((candidate) => autoFillSet.has(candidate.id));
    if (autoFillCandidates.length === 0) {
      setProfilePanelStatus("没有找到可自动填写项。", true);
      return { ok: false, reason: "empty autofill candidates" };
    }

    setProfilePanelStatus("正在把匹配项填写到当前网页...");
    if (isCurrentAutofillRun(runId)) {
      setAutofillProgress("填写匹配项", 94, `本地准备填写 ${autoFillCandidates.length} 项`);
    }
    logDiagnostic("Autofill Applying Candidates", { runId, candidatesCount: autoFillCandidates.length });
    const results = [];

    for (let index = 0; index < autoFillCandidates.length; index += 1) {
      const candidate = autoFillCandidates[index];
      const field = candidate.field;
      let element = await resolveFieldElement(field);
      let status = "pending";
      let ok = false;
      let note = "";

      if (element) {
        if (!element.isConnected) {
          status = "stale";
          ok = false;
          note = "控件已从页面断开";
        } else if (!isWritableTarget(element)) {
          status = "skipped";
          ok = false;
          note = "目标控件只读或不可编辑";
        } else {
          const currentDomValue = getControlCurrentValue(element);
          const alreadyMatchesNow = typedValuesLookEquivalent(currentDomValue, candidate.value, candidate.writeMode, field);
          const snapshotVal = candidate.snapshotValue != null ? String(candidate.snapshotValue).trim() : "";
          const currentCleanVal = String(currentDomValue == null ? "" : currentDomValue).trim();

          if (alreadyMatchesNow) {
            status = "verified";
            ok = true;
            note = "当前值已匹配简历资料";
          } else if (snapshotVal !== currentCleanVal) {
            status = "stale";
            ok = false;
            note = "当前控件已被用户修改，避免覆盖";
          } else {
            const fillResult = await fillElementSmart(element, candidate.value, field, candidate);
            status = fillResult?.status || (fillResult?.ok ? "verified" : "failed");
            ok = status === "verified";
            note = fillResult?.reason || fillResult?.warning || "";
          }
        }
      } else {
        status = "failed";
        note = "未找到可自动填写控件";
      }

      if (element) {
        markElement(element, ok ? "filled" : "uncertain", `${ok ? "自动填写" : "待处理"}: ${candidate.fieldLabel || candidate.sourceLabel || candidate.id}`);
      }

      if (isCurrentAutofillRun(runId)) {
        const percent = 94 + Math.round(((index + 1) / autoFillCandidates.length) * 6);
        setAutofillProgress("填写匹配项", percent, `本地已处理 ${index + 1}/${autoFillCandidates.length} 项`);
      }

      logDiagnostic("Field Attempt", {
        id: candidate.id,
        fieldLabel: candidate.fieldLabel || candidate.sourceLabel || "",
        ok,
        status,
        note,
        writeMode: candidate.writeMode || "",
        hasValue: Boolean(candidate.value)
      });

      results.push({
        id: candidate.id,
        ok,
        status,
        note
      });
    }

    const filledCount = results.filter((result) => result.status === "verified").length;
    const failedCount = results.filter((result) => result.status === "failed").length;
    const staleCount = results.filter((result) => result.status === "stale").length;
    const skippedCount = await markDeferredPlanCandidates(plan, autoFillSet);
    const pendingCount = results.filter((result) => result.status === "pending" || result.status === "failed" || result.status === "stale").length + skippedCount;
    const summary = {
      attempted: results.length,
      filled: filledCount,
      failed: failedCount,
      stale: staleCount,
      skipped: skippedCount,
      pending: pendingCount,
      total: plan?.candidates?.length || results.length,
      message: `页面已标记：绿色为已填写，橙色为待处理。`,
      aiUsage: getAutofillAiSnapshot()
    };
    logDiagnostic("Autofill Run Completed", {
      runId,
      attempted: results.length,
      filled: filledCount,
      failed: failedCount,
      skipped: skippedCount,
      pending: summary.pending
    });
    setProfilePanelStatus(`已自动填写 ${filledCount} 项，待处理 ${summary.pending} 项。`);
    setAutofillSummary(summary);
    updateAutofillDebugResults(summary, results);
    await persistProfilePanelState(getProfilePanelStateSnapshot());
    return {
      ok: true,
      attempted: results.length,
      filled: filledCount,
      failed: failedCount,
      skipped: skippedCount,
      total: plan?.candidates?.length || results.length,
      aiUsage: summary.aiUsage,
      results
    };
  }

  async function markDeferredPlanCandidates(plan, autoFillIds) {
    if (!plan || !Array.isArray(plan.candidates)) {
      return 0;
    }

    const autoFillSet = autoFillIds instanceof Set ? autoFillIds : new Set(autoFillIds || []);
    let count = 0;
    for (const candidate of plan.candidates) {
      if (autoFillSet.has(candidate.id)) {
        continue;
      }
      if (!candidate.canAutoFill) {
        continue;
      }
      const element = findFieldElement(candidate.field);
      if (!element) {
        continue;
      }
      markElement(element, "uncertain", `待处理: ${candidate.fieldLabel || candidate.sourceLabel || candidate.id}`);
      count += 1;
      if (count % 12 === 0) {
        await sleep(0);
      }
    }
    return count;
  }

  async function fillElementSmart(element, value, field, candidate) {
    if (!element) {
      return { ok: false, status: "failed", reason: "field not found" };
    }

    if (!isWritableTarget(element)) {
      return { ok: false, status: "skipped", reason: "field read-only or disabled" };
    }

    const type = getControlType(element);
    const editableTarget = resolveEditableTarget(element);
    if (editableTarget && editableTarget !== element) {
      element = editableTarget;
    }

    if (!isWritableTarget(element)) {
      return { ok: false, status: "skipped", reason: "resolved target is not writable" };
    }

    const text = compactText([candidate?.fieldLabel, field?.nearbyText, field?.placeholder, field?.name, field?.id, field?.section].join(" "));
    const isChoiceField = candidate?.writeMode === "choice" || /选择|请选择|下拉|选择项|单选/.test(text);

    if (candidate?.writeMode === "date" || element.type === "date" || element.type === "month") {
      let dateVal = normalizeDateValue(value);
      if (element.type === "month") {
        const ym = dateVal.match(/^(\d{4}-\d{2})/);
        dateVal = ym ? ym[1] : dateVal;
      } else if (element.type === "date") {
        if (/^\d{4}-\d{2}$/.test(dateVal)) {
          return { ok: false, status: "pending", reason: "日期控件需要完整年月日，简历资料仅含年月，避免补造未知日" };
        }
      }

      setNativeValue(element, dateVal);
      await sleep(30);
      const readBack = getControlCurrentValue(element);
      const matches = typedValuesLookEquivalent(readBack, dateVal, "date", field);
      return { ok: matches, status: matches ? "verified" : "failed", reason: matches ? "" : "日期写入后校验失败" };
    }

    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      return fillBooleanOrRadioChoice(element, value, field, candidate);
    }

    if (element.getAttribute("role") === "radio" || element.getAttribute("role") === "checkbox") {
      return fillRoleChoice(element, value, field, candidate);
    }

    if (type === "combobox" || element.getAttribute?.("role") === "combobox" || element.closest?.('[role="combobox"]')) {
      const choiceResult = await tryFillCustomChoiceField(element, value, field);
      if (choiceResult.ok) {
        return { ok: true, status: "verified" };
      }

      let wroteInnerInput = false;
      const textInput = element.querySelector?.('input:not([type="hidden"]),textarea,[contenteditable="true"]');
      if (textInput && textInput !== element && isWritableTarget(textInput)) {
        setNativeValue(textInput, value);
        wroteInnerInput = true;
      }

      const virtualDisplay = element.querySelector?.(
        '.ant-select-selection-item, .el-select__selected-item, .arco-select-view-value, [class*="selection-item"], [class*="select-value"], [class*="selected-item"]'
      );
      if (virtualDisplay) {
        if (virtualDisplay.tagName === "INPUT" || virtualDisplay.tagName === "TEXTAREA") {
          setNativeValue(virtualDisplay, value);
        } else {
          virtualDisplay.textContent = String(value);
        }
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        if (candidate?.writeMode === "direct") {
          return { ok: true, status: "verified", warning: wroteInnerInput ? "combobox virtual display and inner input updated" : "combobox virtual display updated" };
        }
        return { ok: false, status: "pending", reason: "combobox 未能匹配选中实际下拉选项，已转入待处理" };
      }

      if (wroteInnerInput) {
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return { ok: false, status: "pending", reason: "combobox 仅在搜索输入框填写了文本，尚未选中具体选项" };
      }

      return { ok: false, status: "pending", reason: choiceResult.reason || "下拉控件无匹配选项" };
    }

    if (element instanceof HTMLSelectElement) {
      const selectResult = setSelectValue(element, value);
      if (selectResult.ok) {
        return { ok: true, status: "verified" };
      }
      return { ok: false, status: selectResult.status || "pending", reason: selectResult.reason || "下拉选项无匹配" };
    }

    if (element.isContentEditable) {
      setContentEditableValue(element, value);
      await sleep(30);
      const readBack = element.textContent || "";
      const matches = typedValuesLookEquivalent(readBack, value, "text", field);
      return { ok: matches, status: matches ? "verified" : "failed" };
    }

    if (isChoiceField) {
      const choiceResult = await tryFillCustomChoiceField(element, value, field);
      if (choiceResult.ok) {
        return { ok: true, status: "verified" };
      }
    }

    element.focus();
    setNativeValue(element, value);
    await sleep(30);
    const readBack = getControlCurrentValue(element);
    const matches = typedValuesLookEquivalent(readBack, value, candidate?.writeMode || type, field);
    return { ok: matches, status: matches ? "verified" : "failed", reason: matches ? "" : "控件设置后读回不一致" };
  }

  function resolveEditableTarget(element) {
    if (!element || !(element instanceof Element)) {
      return null;
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element.isContentEditable
    ) {
      return isWritableTarget(element) ? element : null;
    }

    const role = element.getAttribute("role");
    if (role === "radio" || role === "checkbox" || role === "combobox" || element.matches?.('[role="combobox"]')) {
      return isWritableTarget(element) ? element : null;
    }

    const input = element.querySelector?.('input:not([type="hidden"]),textarea,[contenteditable="true"]');
    if (input && isWritableTarget(input)) {
      return input;
    }
    return isWritableTarget(element) ? element : null;
  }

  function fillRoleChoice(element, value, field, candidate) {
    const role = element.getAttribute("role");
    const target = normalizeChoiceValue(value, candidate?.fieldLabel || field?.label || "");
    const root = findChoiceFieldContainer(element);
    const options = Array.from(root.querySelectorAll('[role="radio"],[role="checkbox"],label,button,[class*="radio"],[class*="checkbox"]'));
    const matched = options.find((option) => {
      const text = getElementText(option);
      return choiceTextMatches(text, target) || choiceTextMatches(option.getAttribute("aria-label") || "", target);
    });

    if (matched) {
      clickActionElement(matched);
      return { ok: true, status: "verified" };
    }

    if (role === "checkbox") {
      const isCurrentlyChecked = element.getAttribute("aria-checked") === "true" || element.checked === true;
      const shouldCheck = /^(是|yes|true|1|on|checked)$/i.test(target);
      if (isCurrentlyChecked !== shouldCheck) {
        clickActionElement(element);
      }
      const postChecked = element.getAttribute("aria-checked") === "true" || element.checked === true;
      const verified = postChecked === shouldCheck;
      return { ok: verified, status: verified ? "verified" : "failed", reason: verified ? "" : "角色复选框状态未能正确更新" };
    }

    if (role === "radio") {
      return { ok: false, status: "pending", reason: "未找到匹配的单选按钮选项" };
    }

    return { ok: false, status: "pending", reason: "no matching role choice found" };
  }

  function fillBooleanOrRadioChoice(element, value, field, candidate) {
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      setCheckboxOrRadio(element, value);
      const normalized = String(value).trim().toLowerCase();
      const shouldCheck = ["true", "yes", "是", "1", "checked", "on"].includes(normalized);
      const verified = element.checked === shouldCheck;
      return { ok: verified, status: verified ? "verified" : "failed", reason: verified ? "" : "原生复选框状态未能正确更新" };
    }

    if (!(element instanceof HTMLInputElement) || element.type !== "radio") {
      return { ok: false, status: "failed", reason: "unsupported choice field" };
    }

    const target = normalizeChoiceValue(value, candidate?.fieldLabel || field?.label || "");
    const group = element.name
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`))
      : [element];
    let matched = null;

    for (const radio of group) {
      const radioLabel = getChoiceLabelText(radio);
      if (radioLabel && choiceTextMatches(radioLabel, target)) {
        matched = radio;
        break;
      }
    }

    if (!matched) {
      matched = group.find((radio) => String(radio.value || "").trim() === target || choiceTextMatches(radio.value || "", target)) || null;
    }

    if (!matched) {
      return { ok: false, status: "pending", reason: "未找到匹配的单选选项" };
    }

    matched.click();
    matched.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, status: "verified" };
  }

  function getChoiceLabelText(element) {
    if (!element) {
      return "";
    }

    const parent = element.closest("label") || element.parentElement;
    const siblings = [];
    if (parent) {
      siblings.push(getElementText(parent));
      if (parent.nextElementSibling) {
        siblings.push(getElementText(parent.nextElementSibling));
      }
      if (parent.previousElementSibling) {
        siblings.push(getElementText(parent.previousElementSibling));
      }
    }

    return normalizeText(siblings.filter(Boolean).join(" "), 120);
  }

  function normalizeChoiceLabel(value) {
    return normalizeMatchKey(value)
      .replace(/大学本科/g, "本科")
      .replace(/学校级/g, "校级")
      .replace(/学院级/g, "院级")
      .replace(/离异/g, "离婚");
  }

  function normalizeChoiceValue(value, fallback = "") {
    const text = normalizeText(value == null ? fallback : value, 80);
    if (!text) {
      return "";
    }
    if (/^(是|yes|true|1|on)$/i.test(text)) {
      return "是";
    }
    if (/^(否|no|false|0|off)$/i.test(text)) {
      return "否";
    }
    return text;
  }

  function normalizeDateValue(value) {
    const text = normalizeText(value, 80);
    if (!text) {
      return "";
    }

    const yearMonthDay = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (yearMonthDay) {
      const [, year, month, day] = yearMonthDay;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    const yearMonth = text.match(/(\d{4})[./-](\d{1,2})/);
    if (yearMonth) {
      const [, year, month] = yearMonth;
      return `${year}-${String(month).padStart(2, "0")}`;
    }

    const chineseYearMonthDay = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
    if (chineseYearMonthDay) {
      const [, year, month, day] = chineseYearMonthDay;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    const chineseYearMonth = text.match(/(\d{4})年(\d{1,2})月/);
    if (chineseYearMonth) {
      const [, year, month] = chineseYearMonth;
      return `${year}-${String(month).padStart(2, "0")}`;
    }

    return text;
  }

  function choiceTextMatches(label, target) {
    if (!label || !target) {
      return false;
    }
    const cleanLabel = normalizeText(label, 120);
    const cleanTarget = normalizeText(target, 120);
    if (!cleanLabel || !cleanTarget) {
      return false;
    }
    return typedValuesLookEquivalent(cleanLabel, cleanTarget, "choice");
  }

  function findOwnedChoicePopup(element, container) {
    if (!element && !container) {
      return null;
    }

    // 1. Explicit ARIA references (aria-controls / aria-owns)
    const controlsId = element?.getAttribute?.("aria-controls") || container?.getAttribute?.("aria-controls");
    if (controlsId) {
      const el = document.getElementById(controlsId);
      if (el && isVisible(el)) return el;
    }

    const ownsId = element?.getAttribute?.("aria-owns") || container?.getAttribute?.("aria-owns");
    if (ownsId) {
      const el = document.getElementById(ownsId);
      if (el && isVisible(el)) return el;
    }

    // 2. Adapter popup selector if present
    const adapterSelectors = getAdapterSelectors();
    if (adapterSelectors.popupSelector) {
      const popup = document.querySelector(adapterSelectors.popupSelector);
      if (popup && isVisible(popup)) return popup;
    }

    // 3. Child popup inside container
    if (container && container.querySelector) {
      const innerPopup = container.querySelector('[role="listbox"], [class*="dropdown-menu"], [class*="select-dropdown"], [class*="picker"]');
      if (innerPopup && isVisible(innerPopup)) return innerPopup;
    }

    // 4. Open/visible top-level overlay containers in document (strictly bounded to popup containers)
    const overlaySelectors = [
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      '.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)',
      '.el-select-dropdown:not([style*="display: none"]):not([style*="display:none"])',
      '.el-cascader__dropdown:not([style*="display: none"]):not([style*="display:none"])',
      '[role="listbox"]:not([data-ojaf-hidden])',
      '.select-dropdown:not([style*="display: none"]):not([style*="display:none"])',
      '.dropdown-menu.show'
    ];
    for (const sel of overlaySelectors) {
      try {
        const foundList = Array.from(document.querySelectorAll(sel)).filter((el) => isVisible(el) && !el.closest(`#${PANEL_ID}`));
        if (foundList.length === 1) {
          return foundList[0];
        }
      } catch {}
    }

    return null;
  }

  function findVisibleChoiceOptions(container, element) {
    const ownedPopup = findOwnedChoicePopup(element, container);
    const roots = [];
    if (ownedPopup) {
      roots.push(ownedPopup);
    }
    if (container && container !== ownedPopup && container.querySelectorAll) {
      roots.push(container);
    }

    // Strictly bounded option selectors: NEVER include bare global 'li'
    const selectors = [
      '[role="option"]',
      '.ant-select-item-option',
      '.el-select-dropdown__item',
      '.rc-select-item-option',
      '.ant-cascader-menu-item',
      '.el-cascader-node',
      '[class*="option-item"]',
      '[class*="select-item"]',
      '[class*="dropdown-item"]',
      'ul[role="listbox"] > li',
      '.ant-select-dropdown li',
      '.el-select-dropdown li'
    ].join(",");

    const seen = new Set();
    const options = [];

    for (const scope of roots) {
      for (const option of Array.from(scope.querySelectorAll(selectors))) {
        if (!(option instanceof Element) || seen.has(option)) {
          continue;
        }
        seen.add(option);
        if (option.closest(`#${PANEL_ID}`)) {
          continue;
        }
        if (!isVisible(option)) {
          continue;
        }
        const text = getElementText(option);
        if (text && text.length <= 120) {
          options.push(option);
        }
      }
    }

    return options;
  }

  async function tryFillCustomChoiceField(element, value, field) {
    const container = findChoiceFieldContainer(element);
    if (!container) {
      return { ok: false, reason: "no choice container found" };
    }

    try {
      container.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {}
    clickActionElement(element instanceof Element ? element : container);
    if (container !== element) {
      clickActionElement(container);
    }
    await sleep(220);

    const target = normalizeChoiceValue(value, inferFieldLabel(field));
    const hierarchicalResult = await tryFillHierarchicalChoiceOptions(value, target, element, container);
    if (hierarchicalResult.ok) {
      return hierarchicalResult;
    }

    const options = findVisibleChoiceOptions(container, element);
    const matching = options.filter((option) => choiceTextMatches(getElementText(option), target) || choiceTextMatches(option.getAttribute("aria-label") || "", target));

    if (matching.length > 1) {
      return { ok: false, status: "pending", reason: `下拉浮层存在多个等价选项（存在歧义）: ${target}` };
    }
    if (matching.length === 1) {
      clickActionElement(matching[0]);
      await sleep(120);
      return { ok: true, status: "verified" };
    }

    const searchInput =
      element instanceof HTMLInputElement
        ? element
        : container.querySelector?.('input:not([type="hidden"]),textarea,[contenteditable="true"]');
    if (searchInput) {
      setNativeValue(searchInput, value);
      await sleep(160);
      const retryOptions = findVisibleChoiceOptions(container, element);
      const retryMatching = retryOptions.filter((option) => choiceTextMatches(getElementText(option), target) || choiceTextMatches(option.getAttribute("aria-label") || "", target));
      if (retryMatching.length > 1) {
        return { ok: false, status: "pending", reason: `重试搜索后下拉浮层存在多个等价选项（存在歧义）: ${target}` };
      }
      if (retryMatching.length === 1) {
        clickActionElement(retryMatching[0]);
        await sleep(120);
        return { ok: true, status: "verified" };
      }
    }

    return { ok: false, status: "pending", reason: "no matching option found" };
  }

  async function tryFillHierarchicalChoiceOptions(value, target, element, container) {
    const parts = splitHierarchicalChoiceValue(value);
    if (parts.length < 2) {
      return { ok: false, reason: "not hierarchical" };
    }

    for (const part of parts) {
      const options = findVisibleChoiceOptions(container, element);
      const matchedList = options.filter((option) => {
        const text = getElementText(option);
        return choiceTextMatches(text, part);
      });
      if (matchedList.length > 1) {
        return { ok: false, status: "pending", reason: `级联选项在层级 ${part} 存在多个匹配项（存在歧义）` };
      }
      if (matchedList.length === 0) {
        // Multi-tier MUST match all levels. Partial match is strictly pending/failed!
        return { ok: false, status: "pending", reason: `级联选项未能完整匹配所有层级 (${part} 未找到)` };
      }

      clickActionElement(matchedList[0]);
      await sleep(180);
    }

    await sleep(120);
    const finalDomVal = getControlCurrentValue(element);
    const lastTier = parts[parts.length - 1];
    const isVerified = Boolean(
      finalDomVal &&
      (typedValuesLookEquivalent(finalDomVal, value, "choice") ||
       finalDomVal.includes(lastTier) ||
       typedValuesLookEquivalent(finalDomVal, lastTier, "choice"))
    );
    if (isVerified) {
      return { ok: true, status: "verified" };
    }
    return { ok: false, status: "pending", reason: "级联选择后读回校验不一致或未就绪" };
  }

  function splitHierarchicalChoiceValue(value) {
    const text = normalizeText(value, 120);
    if (!/(省|自治区|北京市|上海市|天津市|重庆市|市|区|县)/.test(text)) {
      return [];
    }

    const parts = text.match(/[^省市区县]+(?:省|市|区|县)|[^自治区]+自治区/g) || [];
    const normalized = parts.map((part) => normalizeText(part, 40)).filter(Boolean);
    return normalized.length >= 2 ? normalized : [];
  }

  function findChoiceFieldContainer(element) {
    const adapterSelectors = getAdapterSelectors();
    if (adapterSelectors.containerSelector) {
      const container = element.closest(adapterSelectors.containerSelector);
      if (container) {
        return container;
      }
    }

    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (
        current.matches?.("[role='combobox'],[role='listbox'],[role='radio'],[role='checkbox'],[class*='select'],[class*='picker'],[class*='dropdown'],label") ||
        /select|picker|dropdown|combobox|radio|checkbox|ant-select|el-select|rc-select|cascader|picker/i.test(String(current.className || ""))
      ) {
        return current;
      }
    }
    return element.parentElement || element;
  }

  function renderQuickCopyList(panel) {
    const list = panel.querySelector('[data-role="quick-copy-list"]');
    if (!list) {
      return;
    }

    list.textContent = "";
    const notice = document.createElement("div");
    notice.className = "arf-privacy-notice";
    notice.style.padding = "14px";
    notice.style.color = "#555";
    notice.style.fontSize = "13px";
    notice.style.lineHeight = "1.6";
    notice.textContent = "【隐私隔离保护】为防止目标网站脚本读取个人信息，简历数据严格隔离在扩展内部存储中，不再注入当前网页 DOM。查看或编辑完整简历请点击下方“设置”。";
    list.appendChild(notice);
  }

  function renderProfilePanel() {
    const panel = ensureProfilePanel();
    const status = panel.querySelector('[data-role="status"]');
    const collapseBtn = panel.querySelector('[data-action="collapse"]');
    const progress = panel.querySelector('[data-role="progress"]');
    const progressFill = panel.querySelector('[data-role="progress-fill"]');
    const progressStage = panel.querySelector('[data-role="progress-stage"]');
    const progressDetail = panel.querySelector('[data-role="progress-detail"]');

    panel.setAttribute(PANEL_COLLAPSED_ATTR, profilePanelCollapsed ? "true" : "false");
    if (collapseBtn) {
      collapseBtn.textContent = profilePanelCollapsed ? "展开" : "收起";
      collapseBtn.title = profilePanelCollapsed ? "展开 OpenJobAutofill 状态面板" : "收起 OpenJobAutofill 状态面板";
    }

    if (progress && progressFill && progressStage && progressDetail) {
      progress.hidden = !autofillProgress.active;
      progressFill.style.width = `${getDisplayedProgressPercent()}%`;
      progressStage.textContent = autofillProgress.active
        ? getAutofillProgressTitle() || "处理中"
        : "";
      progressDetail.textContent = autofillProgress.active ? getAutofillProgressDetail() : "";
    }

    if (status) {
      status.style.color = "#6f6a60";
      const adapter = getActiveSiteAdapter();
      const adapterLabel = adapter ? `${adapter.name || adapter.id || "通用"} · ` : "";
      if (autofillProgress.active) {
        status.textContent = `${adapterLabel}${getAutofillProgressDetail() || getAutofillProgressTitle() || autofillProgress.stage || "正在处理"}`;
      } else if (autofillSummary) {
        status.textContent = `${adapterLabel}填表完成：${autofillSummary.verified || 0} 项已填，${getPendingCount(autofillSummary)} 项待处理。`;
      } else {
        status.textContent = `${adapterLabel}就绪。点击插件图标或快捷键开始自动填写。`;
      }
    }

    renderQuickCopyList(panel);
    if (!currentProfileV2 && !currentProfileLoadPromise) {
      void refreshCurrentProfile();
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.documentElement.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    textarea.remove();
    if (!success) {
      throw new Error("Clipboard unavailable.");
    }
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.profileV2) {
        return;
      }

      currentProfileV2 = changes.profileV2.newValue || null;
      if (profilePanelVisible) {
        renderProfilePanel();
      }
    });
  }

  void restoreProfilePanelState();

  function setNativeValue(element, value) {
    const stringValue = value == null ? "" : String(value);

    // 1. Dispatch Focus (ensuring exactly one focus event)
    let focusFired = false;
    const onFocus = () => { focusFired = true; };
    try {
      element.addEventListener?.("focus", onFocus, { once: true });
      if (typeof element.focus === "function") {
        element.focus();
      }
    } catch {}
    try {
      element.removeEventListener?.("focus", onFocus);
    } catch {}

    if (!focusFired) {
      try {
        const FocusEvt = typeof FocusEvent !== "undefined" ? FocusEvent : CustomEvent;
        element.dispatchEvent(new FocusEvt("focus", { bubbles: true, composed: true }));
      } catch {
        element.dispatchEvent(new Event("focus", { bubbles: true, composed: true }));
      }
    }

    // 2. React 16+ _valueTracker bypass & reset
    try {
      const tracker = element._valueTracker;
      if (tracker && typeof tracker.setValue === "function") {
        tracker.setValue(stringValue === "" ? "__ojaf_reset__" : "");
      }
    } catch {}

    // 3. Prototype setter execution
    let prototype = null;
    if (element instanceof HTMLTextAreaElement) {
      prototype = HTMLTextAreaElement.prototype;
    } else if (element instanceof HTMLSelectElement) {
      prototype = HTMLSelectElement.prototype;
    } else if (element instanceof HTMLInputElement) {
      prototype = HTMLInputElement.prototype;
    } else if (element && typeof element === "object") {
      prototype = Object.getPrototypeOf(element);
    }

    let descriptor = null;
    let proto = prototype;
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && (desc.set || desc.get)) {
        descriptor = desc;
        break;
      }
      proto = Object.getPrototypeOf(proto);
    }

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, stringValue);
    } else {
      element.value = stringValue;
    }

    if (element.setAttribute && (element instanceof HTMLInputElement || element.tagName === "INPUT")) {
      try {
        element.setAttribute("value", stringValue);
      } catch {}
    }

    // 4. Input event with composed: true
    try {
      const inputEvt = typeof InputEvent !== "undefined"
        ? new InputEvent("input", { bubbles: true, cancelable: true, composed: true, data: stringValue, inputType: "insertText" })
        : new Event("input", { bubbles: true, composed: true });
      element.dispatchEvent(inputEvt);
    } catch {
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }

    // 5. Change event with composed: true
    try {
      element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    } catch {}

    // 6. Dispatch Blur (ensuring exactly one blur event)
    let blurFired = false;
    const onBlur = () => { blurFired = true; };
    try {
      element.addEventListener?.("blur", onBlur, { once: true });
      if (typeof element.blur === "function") {
        element.blur();
      }
    } catch {}
    try {
      element.removeEventListener?.("blur", onBlur);
    } catch {}

    if (!blurFired) {
      try {
        const FocusEvt = typeof FocusEvent !== "undefined" ? FocusEvent : CustomEvent;
        element.dispatchEvent(new FocusEvt("blur", { bubbles: true, composed: true }));
      } catch {
        element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
      }
    }
  }

  function setCheckboxOrRadio(element, value) {
    if (element instanceof HTMLInputElement && element.type === "radio") {
      const target = normalizeChoiceValue(value, getChoiceLabelText(element));
      const group = element.name ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`)) : [element];
      const matched = group.find((radio) => choiceTextMatches(getChoiceLabelText(radio), target) || choiceTextMatches(radio.value || "", target));
      if (matched) {
        let focusFired = false;
        const onFocus = () => { focusFired = true; };
        try {
          matched.addEventListener?.("focus", onFocus, { once: true });
          matched.focus?.();
          matched.removeEventListener?.("focus", onFocus);
        } catch {}
        if (!focusFired) {
          try {
            matched.dispatchEvent(new Event("focus", { bubbles: true, composed: true }));
          } catch {}
        }

        if (matched._valueTracker && typeof matched._valueTracker.setValue === "function") {
          matched._valueTracker.setValue(false);
        }
        matched.click();
        matched.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        matched.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        let blurFired = false;
        const onBlur = () => { blurFired = true; };
        try {
          matched.addEventListener?.("blur", onBlur, { once: true });
          matched.blur?.();
          matched.removeEventListener?.("blur", onBlur);
        } catch {}
        if (!blurFired) {
          try {
            matched.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
          } catch {}
        }
      }
      return;
    }

    const normalized = String(value).trim().toLowerCase();
    const shouldCheck = ["true", "yes", "是", "1", "checked", "on"].includes(normalized);

    let focusFired = false;
    const onFocus = () => { focusFired = true; };
    try {
      element.addEventListener?.("focus", onFocus, { once: true });
      element.focus?.();
      element.removeEventListener?.("focus", onFocus);
    } catch {}
    if (!focusFired) {
      try {
        element.dispatchEvent(new Event("focus", { bubbles: true, composed: true }));
      } catch {}
    }

    if (element._valueTracker && typeof element._valueTracker.setValue === "function") {
      element._valueTracker.setValue(!shouldCheck);
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, shouldCheck);
    } else {
      element.checked = shouldCheck;
    }

    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    let blurFired = false;
    const onBlur = () => { blurFired = true; };
    try {
      element.addEventListener?.("blur", onBlur, { once: true });
      element.blur?.();
      element.removeEventListener?.("blur", onBlur);
    } catch {}
    if (!blurFired) {
      try {
        element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
      } catch {}
    }
  }

  function isSelectionPlaceholder(text) {
    if (!text) return true;
    const clean = String(text).trim().toLowerCase();
    return /^(?:请选择|选择|请选择一项|不限|全部|select|choose|please select|none|-{2,}|—{2,})/i.test(clean);
  }

  function setSelectValue(element, value) {
    if (!(element instanceof HTMLSelectElement)) {
      return { ok: false, status: "failed", reason: "目标元素不是 select 元素" };
    }

    const stringValue = String(value == null ? "" : value).trim();
    if (!stringValue) {
      return { ok: false, status: "skipped", reason: "目标选项值为空" };
    }

    // Filter valid options: exclude disabled options and placeholder options (empty value/placeholder text)
    const validOptions = Array.from(element.options).filter((option) => {
      if (option.disabled) return false;
      const optVal = String(option.value || "").trim();
      const optText = String(option.textContent || "").trim();
      if (!optVal && isSelectionPlaceholder(optText)) return false;
      if (!optVal && !optText) return false;
      return true;
    });

    let matchingOptions = [];

    // 1. Exact value match
    matchingOptions = validOptions.filter((opt) => String(opt.value || "").trim() === stringValue);

    // 2. Exact label match
    if (matchingOptions.length === 0) {
      matchingOptions = validOptions.filter((opt) => String(opt.textContent || "").trim() === stringValue);
    }

    // 3. Controlled synonym & normalized match (NO substring .includes())
    if (matchingOptions.length === 0) {
      matchingOptions = validOptions.filter((opt) => {
        const optVal = String(opt.value || "").trim();
        const optText = String(opt.textContent || "").trim();
        return typedValuesLookEquivalent(optText, stringValue, "choice", { label: stringValue }) ||
               typedValuesLookEquivalent(optVal, stringValue, "choice", { label: stringValue });
      });
    }

    if (matchingOptions.length > 1) {
      return { ok: false, status: "pending", reason: `下拉选项存在多个等价匹配项（存在歧义）: ${stringValue}` };
    }

    if (matchingOptions.length === 1) {
      const matchedOption = matchingOptions[0];
      setNativeValue(element, matchedOption.value);
      const isVerified = element.value === matchedOption.value ||
        Array.from(element.selectedOptions || []).some((opt) => opt === matchedOption || opt.value === matchedOption.value);
      if (isVerified) {
        return { ok: true, status: "verified", matchedOption };
      }
      return { ok: false, status: "failed", reason: "select 设置后读回校验不一致" };
    }

    // CRITICAL: On mismatch, do NOT mutate element.value, return pending
    return { ok: false, status: "pending", reason: `未在下拉选项中找到匹配项: ${stringValue}` };
  }

  function setContentEditableValue(element, value) {
    try {
      element.focus?.();
    } catch {}
    element.textContent = value == null ? "" : String(value);
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    try {
      element.blur?.();
    } catch {}
  }

  function isControlTypeCompatible(controlType, expectedType) {
    if (!controlType || !expectedType) return true;
    const c = String(controlType).toLowerCase();
    const e = String(expectedType).toLowerCase();
    if (c === e) return true;
    if (["text", "textarea", "contenteditable"].includes(c) && ["text", "textarea", "contenteditable"].includes(e)) return true;
    if (["select", "combobox"].includes(c) && ["select", "combobox", "choice"].includes(e)) return true;
    if (["radio", "checkbox"].includes(c) && ["radio", "checkbox", "choice"].includes(e)) return true;
    if (["date", "month"].includes(c) && ["date", "month"].includes(e)) return true;
    return false;
  }

  function findElementByCssPath(cssPath, field = null) {
    if (!cssPath) {
      return null;
    }

    try {
      const elements = Array.from(document.querySelectorAll(cssPath)).filter((el) => isVisible(el));
      if (elements.length === 1 && isWritableTarget(elements[0])) {
        const el = elements[0];
        if (field) {
          const elType = getControlType(el);
          const fieldType = field.type || field.snapshotType;
          if (fieldType && elType && !isControlTypeCompatible(elType, fieldType)) {
            return null;
          }
        }
        return el;
      }
      return null;
    } catch {
      return null;
    }
  }

  function scoreControlForField(element, field) {
    if (!field || !element) {
      return 0;
    }

    const nearbyText = getNearbyText(element);
    const sectionText = getSectionText(element);
    const currentValue = normalizeText(element.value || element.textContent || "", 180);
    let score = 0;

    score += textMatchScore(nearbyText, field.label) * 4;
    score += textMatchScore(nearbyText, field.nearbyText) * 2;
    score += textMatchScore(sectionText, field.section) * 2;
    score += textMatchScore(element.getAttribute("placeholder"), field.placeholder) * 3;
    score += textMatchScore(element.getAttribute("name"), field.name) * 3;
    score += textMatchScore(element.getAttribute("id"), field.id) * 3;
    score += textMatchScore(currentValue, field.value) * 2;

    if (field.type && getControlType(element) === field.type) {
      score += 2;
    }

    return score;
  }

  function findControlByMetadata(field) {
    const controls = collectVisibleControls().filter((el) => isWritableTarget(el));
    let best = null;
    let bestScore = 0;
    let secondBestScore = 0;

    for (const element of controls) {
      const score = scoreControlForField(element, field);
      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        best = element;
      } else if (score === bestScore) {
        secondBestScore = score;
      }
    }

    if (bestScore >= 8 && bestScore > secondBestScore) {
      const elType = getControlType(best);
      const fieldType = field?.type || field?.snapshotType;
      if (fieldType && elType && !isControlTypeCompatible(elType, fieldType)) {
        return null;
      }
      return best;
    }
    return null;
  }

  function findFieldElement(field) {
    if (!field) {
      return null;
    }

    if (field.fieldId) {
      const direct = document.querySelector(`[${FIELD_ATTR}="${CSS.escape(field.fieldId)}"]`);
      if (direct && isVisible(direct)) {
        return direct;
      }
    }

    const cssPathMatch = findElementByCssPath(field.cssPath, field);
    if (cssPathMatch && cssPathMatch.matches(CONTROL_SELECTOR)) {
      return cssPathMatch;
    }

    return findControlByMetadata(field);
  }

  function scoreRootForField(root, field) {
    const text = getTextWithoutControls(root);
    let score = 0;

    score += textMatchScore(text, field?.label) * 4;
    score += textMatchScore(text, field?.nearbyText) * 2;
    score += textMatchScore(text, field?.section) * 3;
    score += textMatchScore(text, field?.placeholder) * 2;
    score += textMatchScore(text, field?.value) * 1;

    if (looksLikeEditableSummary(text)) {
      score += 2;
    }

    return score;
  }

  function findEditButtonForField(field) {
    const buttons = Array.from(
      document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')
    ).filter((button) => isActionControl(button, getAdapterActionLabels("edit")));

    let best = null;
    let bestScore = 0;

    for (const button of buttons) {
      const root = findActionRoot(button);
      if (!root) {
        continue;
      }

      const score = scoreRootForField(root, field);
      if (score > bestScore) {
        best = button;
        bestScore = score;
      }
    }

    return bestScore >= 8 ? best : null;
  }

  async function openEditScopeForField(field) {
    const button = findEditButtonForField(field);
    if (!button) {
      return false;
    }

    button.setAttribute(EDIT_ATTEMPT_ATTR, "true");
    clickActionElement(button);
    await sleep(180);
    return true;
  }

  function fieldNeedsEditMode(element) {
    if (!element) {
      return true;
    }

    return Boolean(element.disabled || element.readOnly || element.getAttribute("aria-readonly") === "true");
  }

  async function resolveFieldElement(field) {
    let element = findFieldElement(field);

    if (!element || fieldNeedsEditMode(element)) {
      const opened = await openEditScopeForField(field);
      if (opened) {
        element = findFieldElement(field);
      }
    }

    return element;
  }

  const processedRequestIds = new Map();

  async function handleContentMessage(message) {
    const requestId = message?.requestId;
    if (requestId && processedRequestIds.has(requestId)) {
      const cached = processedRequestIds.get(requestId);
      if (Date.now() - cached.timestamp < 60000) {
        return cached.result;
      }
    }

    let result;
    if (message.type === "OJAF_SHOW_PROFILE_PANEL") {
      showProfilePanel();
      renderProfilePanel();
      result = { visible: true };
    } else if (message.type === "OJAF_START_AUTOFILL") {
      result = await runOneClickAutofill();
    } else if (message.type === "OJAF_GET_RUNTIME_STATE") {
      result = getAutofillRuntimeState();
    } else if (message.type === "OJAF_GET_DEBUG_SNAPSHOT") {
      result = getAutofillDebugSnapshot();
    } else if (message.type === "OJAF_CLEAR_MARKS") {
      clearMarks();
      result = {};
    }

    if (requestId && result !== undefined) {
      processedRequestIds.set(requestId, { timestamp: Date.now(), result });
      if (processedRequestIds.size > 100) {
        const now = Date.now();
        for (const [id, entry] of processedRequestIds.entries()) {
          if (now - entry.timestamp > 60000) {
            processedRequestIds.delete(id);
          }
        }
      }
    }

    return result;
  }

  const messageHandler = (message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string" || !message.type.startsWith("OJAF_")) {
      return undefined;
    }

    handleContentMessage(message)
      .then((data) => {
        if (data === undefined) {
          sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
          return;
        }
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });

    return true;
  };

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage?.addListener) {
    if (window.__OJAF_AUTOFILL_MESSAGE_HANDLER__) {
      chrome.runtime.onMessage.removeListener(window.__OJAF_AUTOFILL_MESSAGE_HANDLER__);
    }
    window.__OJAF_AUTOFILL_MESSAGE_HANDLER__ = messageHandler;
    chrome.runtime.onMessage.addListener(messageHandler);
  }

  if (typeof globalThis !== "undefined") {
    globalThis.__OJAF_TEST_EXPORTS__ = {
      setNativeValue,
      setCheckboxOrRadio,
      setSelectValue,
      setContentEditableValue,
      fillElementSmart,
      inferSectionHeading,
      getRepeaterIndex,
      isCandidateExcludedByFkgNegativeOrScope,
      buildFieldMeta,
      scoreAutofillCandidate,
      typedValuesLookEquivalent,
      isWritableTarget,
      findElementByCssPath,
      findControlByMetadata,
      ensureProfilePanel,
      renderProfilePanel,
      createAutofillCandidate,
      findOwnedChoicePopup,
      findVisibleChoiceOptions,
      tryFillHierarchicalChoiceOptions,
      handleContentMessage
    };
  }
})();
