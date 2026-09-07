/**
 * OpenJobAutofill - Field Knowledge Graph (FKG)
 *
 * Deterministic standard recruitment field knowledge graph covering basic info,
 * education, work experience, project experience, and emergency/reference isolation.
 * Provides deterministic confidence scoring (0.0 ~ 1.0) and 100% negative exclusion.
 */

export const FIELD_KNOWLEDGE_GRAPH = Object.freeze([
  // ==========================================
  // 1. Basic Information (个人基本信息)
  // ==========================================
  {
    id: "basic.name",
    target: "basic.name",
    label: "姓名",
    sectionScope: "basic",
    aliases: [
      "姓名", "名字", "真实姓名", "候选人姓名", "申请人姓名", "中文名", "应聘者姓名", "本人姓名",
      "name", "full name", "fullname", "applicant name", "candidate name", "legal name", "your name"
    ],
    negative: [
      "紧急联系人", "紧急联络人", "证明人", "推荐人", "父亲", "母亲", "家长", "监护人", "配偶",
      "联系人", "主管", "经理", "直属上级", "担保人", "子女", "emergency", "reference", "father", "mother",
      "parent", "guardian", "spouse", "manager", "supervisor", "referee", "guarantor", "child", "children",
      "first name", "last name", "given name", "family name", "surname"
    ]
  },
  {
    id: "basic.firstName",
    target: "basic.firstName",
    label: "名",
    sectionScope: "basic",
    aliases: [
      "名", "名字", "名(英文)", "first name", "given name", "forename", "legal first name", "legal given name"
    ],
    negative: [
      "姓", "姓氏", "last name", "family name", "surname", "紧急联系人", "证明人", "emergency", "reference"
    ]
  },
  {
    id: "basic.lastName",
    target: "basic.lastName",
    label: "姓",
    sectionScope: "basic",
    aliases: [
      "姓", "姓氏", "姓(英文)", "last name", "family name", "surname", "legal last name", "legal family name", "legal surname"
    ],
    negative: [
      "名", "名字", "first name", "given name", "紧急联系人", "证明人", "emergency", "reference"
    ]
  },
  {
    id: "basic.gender",
    target: "basic.gender",
    label: "性别",
    sectionScope: "basic",
    aliases: [
      "性别", "生理性别", "性別", "gender", "sex"
    ],
    negative: [
      "紧急联系人", "证明人", "推荐人", "emergency", "reference"
    ]
  },
  {
    id: "basic.birthDate",
    target: "basic.birthDate",
    label: "出生日期",
    sectionScope: "basic",
    aliases: [
      "出生日期", "生日", "出生年月", "出生年月日", "出生年", "生辰",
      "birth date", "birthday", "birthdate", "date of birth", "dob"
    ],
    negative: [
      "毕业时间", "入职时间", "入学时间", "开始时间", "结束时间", "graduation", "enrollment"
    ]
  },
  {
    id: "basic.phone",
    target: "basic.phone",
    label: "电话",
    sectionScope: "basic",
    aliases: [
      "电话", "手机", "手机号", "手机号码", "联系电话", "联系方式", "移动电话", "电话号码", "本人电话",
      "phone", "mobile", "cell phone", "cellphone", "telephone", "phone number", "mobile number", "contact number"
    ],
    negative: [
      "紧急联系人", "紧急联络人", "证明人", "推荐人", "家庭电话", "固定电话", "办公电话", "公司电话", "座机", "传真",
      "父亲", "母亲", "家长", "配偶", "监护人", "子女", "主管", "经理", "直属上级",
      "emergency", "reference", "referee", "father", "mother", "parent", "guardian", "spouse", "manager", "supervisor",
      "home phone", "office phone", "work phone", "fax"
    ]
  },
  {
    id: "basic.email",
    target: "basic.email",
    label: "邮箱",
    sectionScope: "basic",
    aliases: [
      "邮箱", "电子邮箱", "电子信箱", "个人邮箱", "联系邮箱", "E-mail", "Email",
      "email", "mail", "e_mail", "email address", "personal email"
    ],
    negative: [
      "紧急联系人", "紧急联络人", "证明人", "企业邮箱", "公司邮箱", "推荐人",
      "主管", "经理", "直属上级", "父亲", "母亲", "家长", "配偶", "监护人",
      "emergency", "reference", "referee", "supervisor", "manager", "father", "mother", "parent", "spouse", "guardian"
    ]
  },
  {
    id: "basic.idNumber",
    target: "basic.idNumber",
    label: "证件号码",
    sectionScope: "basic",
    aliases: [
      "证件号码", "证件号", "身份证", "身份证号", "身份证号码", "居民身份证号", "身份证件号",
      "id number", "national id", "id card", "identity number", "id no", "identification number", "ssn"
    ],
    negative: [
      "紧急联系人", "紧急联络人", "证明人", "推荐人", "父亲", "母亲", "家长", "配偶", "监护人", "子女",
      "emergency", "reference", "referee", "father", "mother", "parent", "spouse", "guardian"
    ]
  },
  {
    id: "basic.politicalStatus",
    target: "basic.politicalStatus",
    label: "政治面貌",
    sectionScope: "basic",
    aliases: [
      "政治面貌", "政治面貌类型", "党派", "党派面貌", "political status", "party"
    ],
    negative: [
      "紧急联系人", "证明人", "推荐人"
    ]
  },
  {
    id: "basic.maritalStatus",
    target: "basic.maritalStatus",
    label: "婚姻状况",
    sectionScope: "basic",
    aliases: [
      "婚姻状况", "婚姻情况", "婚育情况", "婚育状况", "是否已婚", "marital status", "marriage status"
    ],
    negative: [
      "紧急联系人", "证明人", "推荐人"
    ]
  },
  {
    id: "basic.currentCity",
    target: "basic.currentCity",
    label: "现居住城市",
    sectionScope: "basic",
    aliases: [
      "现居住城市", "现居城市", "现居住地", "现住址", "居住城市", "常住地", "目前所在地", "当前城市", "所在地", "现居地",
      "current city", "current location", "residence", "present address", "city", "location"
    ],
    negative: [
      "期望", "意向", "目标", "首选", "学校", "大学", "公司", "工作地点偏好",
      "expected", "desired", "target", "preferred", "school", "company", "emergency", "reference"
    ]
  },
  {
    id: "basic.nativePlace",
    target: "basic.nativePlace",
    label: "籍贯",
    sectionScope: "basic",
    aliases: [
      "籍贯", "户籍", "户籍所在地", "生源地", "祖籍", "户口所在地",
      "native place", "hometown", "domicile", "household register", "place of origin"
    ],
    negative: [
      "现居", "当前", "居住", "期望", "current", "present", "expected"
    ]
  },
  {
    id: "basic.ethnicity",
    target: "basic.ethnicity",
    label: "民族",
    sectionScope: "basic",
    aliases: [
      "民族", "族别", "名族", "ethnicity", "ethnic group", "race"
    ],
    negative: [
      "国籍", "国家", "country", "citizenship", "nationality"
    ]
  },
  {
    id: "basic.country",
    target: "basic.country",
    label: "国籍（国家或地区）",
    sectionScope: "basic",
    aliases: [
      "国籍", "国家", "国家/地区", "国家或地区", "国籍（国家或地区）",
      "nationality", "citizenship", "country", "region", "country of citizenship"
    ],
    negative: [
      "籍贯", "民族", "省份", "城市", "province", "city"
    ]
  },
  {
    id: "basic.highestDegree",
    target: "basic.highestDegree",
    label: "最高学历",
    sectionScope: "basic",
    aliases: [
      "最高学历", "最高文化程度", "最高全日制学历", "学历水平", "文化程度",
      "highest degree", "highest education", "highest level of education", "education level", "degree level"
    ],
    negative: [
      "初中", "高中", "中专", "小学", "middle school", "high school"
    ]
  },
  {
    id: "basic.workYears",
    target: "basic.workYears",
    label: "工作年限",
    sectionScope: "basic",
    aliases: [
      "工作年限", "工作经验", "工龄", "相关工作年限", "工作年资", "经验年限",
      "years of experience", "work experience years", "total experience", "experience"
    ],
    negative: [
      "紧急联系人", "证明人", "emergency", "reference"
    ]
  },
  {
    id: "basic.emergencyContact",
    target: "basic.emergencyContact",
    label: "紧急联系人",
    sectionScope: "basic",
    aliases: [
      "紧急联系人", "紧急联系人姓名", "紧急联络人", "应急联系人", "应急联系人姓名",
      "emergency contact", "emergency contact name", "in case of emergency", "ice contact"
    ],
    negative: [
      "证明人", "推荐人", "电话", "手机", "phone", "mobile", "邮箱", "email",
      "身份证", "证件号", "id", "passport", "关系", "relation", "reference", "referee"
    ]
  },
  {
    id: "basic.emergencyPhone",
    target: "basic.emergencyPhone",
    label: "紧急联系人电话",
    sectionScope: "basic",
    aliases: [
      "紧急联系人电话", "紧急联系人手机", "紧急联络人电话", "应急联系电话", "紧急联系人联系方式",
      "emergency contact phone", "emergency phone", "emergency contact number"
    ],
    negative: [
      "证明人", "推荐人", "姓名", "name", "邮箱", "email", "身份证", "证件号", "id",
      "关系", "relation", "reference", "referee"
    ]
  },
  {
    id: "basic.emergencyEmail",
    target: "basic.emergencyEmail",
    label: "紧急联系人邮箱",
    sectionScope: "basic",
    aliases: [
      "紧急联系人邮箱", "紧急联络人邮箱", "应急联系人邮箱",
      "emergency contact email", "emergency email", "ice email"
    ],
    negative: [
      "本人", "候选人", "电话", "手机", "phone", "关系", "relation"
    ]
  },
  {
    id: "basic.emergencyRelation",
    target: "basic.emergencyRelation",
    label: "与紧急联系人关系",
    sectionScope: "basic",
    aliases: [
      "与紧急联系人关系", "紧急联系人关系", "与应急联系人关系", "关系",
      "relationship to emergency contact", "emergency relationship", "relationship"
    ],
    negative: [
      "证明人", "reference"
    ]
  },
  {
    id: "basic.expectedCity",
    target: "basic.expectedCity",
    label: "期望工作城市",
    sectionScope: "intention",
    aliases: [
      "期望工作城市", "意向城市", "期望城市", "期望地点", "工作地点偏好", "目标城市", "期望工作地点",
      "preferred city", "desired location", "target city", "preferred location", "desired city"
    ],
    negative: [
      "现居", "当前", "籍贯", "学校", "current", "present", "native"
    ]
  },
  {
    id: "basic.expectedSalary",
    target: "basic.expectedSalary",
    label: "期望薪资",
    sectionScope: "intention",
    aliases: [
      "期望薪资", "期望薪酬", "期望月薪", "期望年薪", "期望工资", "意向薪资",
      "expected salary", "desired salary", "salary expectation", "target salary"
    ],
    negative: [
      "当前", "现薪", "目前薪资", "current salary"
    ]
  },
  {
    id: "basic.summary",
    target: "basic.summary",
    label: "自我描述",
    sectionScope: "self",
    aliases: [
      "自我描述", "自我评价", "个人总结", "个人简介", "自我介绍", "关于我", "个人优势",
      "self description", "summary", "about me", "personal summary", "bio", "cover letter", "profile summary"
    ],
    negative: []
  },
  {
    id: "basic.homepage",
    target: "basic.homepage",
    label: "个人主页",
    sectionScope: "basic",
    aliases: [
      "个人主页", "个人网站", "社交主页", "领英", "领英主页", "作品链接", "个人博客",
      "github", "linkedin", "personal website", "portfolio", "website", "blog", "portfolio url"
    ],
    negative: []
  },

  // ==========================================
  // 2. Education (教育经历)
  // ==========================================
  {
    id: "education.school",
    target: "education.school",
    label: "学校",
    sectionScope: "education",
    aliases: [
      "学校", "院校", "毕业院校", "院校名称", "毕业学校", "就读院校", "大学", "本科院校", "研究生院校", "学校名称",
      "school", "university", "college", "institution", "school name", "academy"
    ],
    negative: [
      "工作", "公司", "项目", "雇主", "证明人", "company", "employer", "work", "project", "reference"
    ]
  },
  {
    id: "education.major",
    target: "education.major",
    label: "专业",
    sectionScope: "education",
    aliases: [
      "专业", "就读专业", "主修专业", "专业名称", "所学专业", "专业方向",
      "major", "field of study", "discipline", "subject", "specialization", "area of study"
    ],
    negative: []
  },
  {
    id: "education.degree",
    target: "education.degree",
    label: "学历",
    sectionScope: "education",
    aliases: [
      "学历", "学位", "获得学历", "所获学位", "就读学历",
      "degree", "education level", "qualification", "diploma", "academic degree"
    ],
    negative: [
      "最高学历", "highest degree", "highest education"
    ]
  },
  {
    id: "education.startDate",
    target: "education.startDate",
    label: "入学时间",
    sectionScope: "education",
    aliases: [
      "开始时间", "入学时间", "入学年月", "起始时间", "入读日期", "入学年份",
      "start date", "from date", "enrollment date", "start year", "from"
    ],
    negative: [
      "工作", "公司", "项目", "实习", "入职", "company", "work", "job", "project", "hire"
    ]
  },
  {
    id: "education.endDate",
    target: "education.endDate",
    label: "毕业时间",
    sectionScope: "education",
    aliases: [
      "结束时间", "毕业时间", "毕业年月", "终止时间", "毕业日期", "毕业年份",
      "end date", "to date", "graduation date", "graduation year", "to"
    ],
    negative: [
      "工作", "公司", "项目", "实习", "离职", "company", "work", "job", "project", "leave"
    ]
  },
  {
    id: "education.gpa",
    target: "education.gpa",
    label: "GPA/成绩",
    sectionScope: "education",
    aliases: [
      "GPA", "绩点", "平均绩点", "成绩排名", "专业排名", "平均分",
      "gpa", "grade", "score", "academic ranking", "rank"
    ],
    negative: []
  },
  {
    id: "education.description",
    target: "education.description",
    label: "主修课程/经历描述",
    sectionScope: "education",
    aliases: [
      "主修课程", "在校经历", "专业课程", "学术表现", "教育经历描述", "在校职务",
      "courses", "relevant coursework", "activities", "education description"
    ],
    negative: [
      "工作内容", "项目内容", "responsibilities", "job description"
    ]
  },

  // ==========================================
  // 3. Work Experience (工作经历/实习经历)
  // ==========================================
  {
    id: "work.company",
    target: "work.company",
    label: "公司",
    sectionScope: "work",
    aliases: [
      "公司", "工作单位", "雇主", "就职企业", "就职单位", "公司名称", "企业名称", "单位名称", "实习单位",
      "company", "company name", "employer", "organization", "workplace", "firm"
    ],
    negative: [
      "学校", "大学", "证明人", "推荐人", "院校", "意向", "期望", "school", "university", "college", "reference", "referee", "desired", "target"
    ]
  },
  {
    id: "work.role",
    target: "work.role",
    label: "职位",
    sectionScope: "work",
    aliases: [
      "职位", "岗位", "职务", "担任职务", "工作岗位", "职位名称", "担任职位",
      "title", "job title", "role", "position", "designation", "job role"
    ],
    negative: [
      "学校", "证明人职位", "证明人职务", "推荐人职位", "证明人", "推荐人", "主管", "经理", "直属上级", "领导", "意向", "期望",
      "school", "reference", "referee", "emergency", "supervisor", "manager", "desired"
    ]
  },
  {
    id: "work.department",
    target: "work.department",
    label: "部门",
    sectionScope: "work",
    aliases: [
      "部门", "所在部门", "所属部门", "业务线", "团队",
      "department", "division", "team", "business unit"
    ],
    negative: [
      "学校", "学院", "系", "院系", "school", "faculty", "college"
    ]
  },
  {
    id: "work.startDate",
    target: "work.startDate",
    label: "入职时间",
    sectionScope: "work",
    aliases: [
      "开始时间", "入职时间", "入职年月", "起始时间", "工作起始日期", "工作开始时间",
      "start date", "from date", "joined date", "hire date", "from"
    ],
    negative: [
      "入学", "学校", "教育", "项目", "school", "university", "education", "project"
    ]
  },
  {
    id: "work.endDate",
    target: "work.endDate",
    label: "离职时间",
    sectionScope: "work",
    aliases: [
      "结束时间", "离职时间", "离职年月", "终止时间", "工作截止日期", "工作结束时间",
      "end date", "to date", "leave date", "to"
    ],
    negative: [
      "毕业", "学校", "教育", "项目", "school", "university", "education", "project"
    ]
  },
  {
    id: "work.description",
    target: "work.description",
    label: "工作内容",
    sectionScope: "work",
    aliases: [
      "工作内容", "工作描述", "岗位职责", "主要职责", "工作业绩", "工作成果", "业绩描述",
      "responsibilities", "job description", "duties", "achievements", "work summary", "experience description"
    ],
    negative: [
      "主修课程", "项目内容", "coursework", "project"
    ]
  },
  {
    id: "work.salary",
    target: "work.salary",
    label: "薪资",
    sectionScope: "work",
    aliases: [
      "薪资", "月薪", "年薪", "目前薪资", "底薪", "基本薪资",
      "current salary", "salary", "compensation", "base pay"
    ],
    negative: [
      "期望", "意向", "目标", "expected", "desired", "target"
    ]
  },
  {
    id: "work.leaveReason",
    target: "work.leaveReason",
    label: "离职原因",
    sectionScope: "work",
    aliases: [
      "离职原因", "离开原因", "离职缘由", "离职说明",
      "reason for leaving", "departure reason"
    ],
    negative: [
      "期望", "意向", "目标", "expected", "desired"
    ]
  },
  {
    id: "work.referenceName",
    target: "work.referenceName",
    label: "证明人姓名",
    sectionScope: "work",
    aliases: [
      "证明人", "证明人姓名", "推荐人", "推荐人姓名", "背调联系人", "上级姓名",
      "reference name", "referee", "reference", "supervisor name", "referee name"
    ],
    negative: [
      "本人", "候选人", "申请人", "邮箱", "email", "电话", "手机", "phone", "mobile",
      "职位", "职务", "title", "role", "applicant", "candidate", "yourself"
    ]
  },
  {
    id: "work.referencePhone",
    target: "work.referencePhone",
    label: "证明人联系方式",
    sectionScope: "work",
    aliases: [
      "证明人电话", "证明人联系方式", "证明人手机", "推荐人电话", "推荐人联系方式",
      "reference phone", "referee phone", "reference contact", "supervisor phone"
    ],
    negative: [
      "本人电话", "candidate phone", "姓名", "name", "邮箱", "email", "职位", "职务", "title", "role"
    ]
  },
  {
    id: "work.referenceTitle",
    target: "work.referenceTitle",
    label: "证明人职位",
    sectionScope: "work",
    aliases: [
      "证明人职位", "证明人职务", "推荐人职位", "上级职位",
      "reference title", "reference position", "supervisor title"
    ],
    negative: [
      "本人", "候选人", "申请人", "姓名", "name", "邮箱", "email", "电话", "手机", "phone", "applicant", "candidate"
    ]
  },
  {
    id: "work.referenceEmail",
    target: "work.referenceEmail",
    label: "证明人邮箱",
    sectionScope: "work",
    aliases: [
      "证明人邮箱", "证明人电子信箱", "推荐人邮箱", "推荐人电子信箱", "背调邮箱", "上级邮箱",
      "reference email", "referee email", "supervisor email"
    ],
    negative: [
      "本人", "候选人", "申请人", "电话", "手机", "phone", "applicant", "candidate"
    ]
  },

  // ==========================================
  // 4. Project Experience (项目经历)
  // ==========================================
  {
    id: "project.name",
    target: "project.name",
    label: "项目名称",
    sectionScope: "project",
    aliases: [
      "项目名称", "项目名", "实践名称", "工程名称", "项目",
      "project name", "project title", "project"
    ],
    negative: [
      "公司", "学校", "就职单位", "毕业院校", "company", "school", "university", "employer"
    ]
  },
  {
    id: "project.role",
    target: "project.role",
    label: "项目角色",
    sectionScope: "project",
    aliases: [
      "项目角色", "担任角色", "项目职位", "负责内容/角色", "本人职责", "项目职务",
      "project role", "role in project", "my role"
    ],
    negative: [
      "公司职位", "证明人", "job title", "supervisor"
    ]
  },
  {
    id: "project.startDate",
    target: "project.startDate",
    label: "开始时间",
    sectionScope: "project",
    aliases: [
      "开始时间", "项目开始时间", "起始时间", "项目起始日期",
      "start date", "from date", "project start", "project start date"
    ],
    negative: [
      "入学", "入职", "enrollment", "hire date"
    ]
  },
  {
    id: "project.endDate",
    target: "project.endDate",
    label: "结束时间",
    sectionScope: "project",
    aliases: [
      "结束时间", "项目结束时间", "终止时间", "项目截止日期",
      "end date", "to date", "project end", "project end date"
    ],
    negative: [
      "毕业", "离职", "graduation", "leave date"
    ]
  },
  {
    id: "project.description",
    target: "project.description",
    label: "项目内容",
    sectionScope: "project",
    aliases: [
      "项目内容", "项目描述", "项目简介", "项目背景", "主要工作", "项目职责",
      "project description", "project details", "project summary", "project overview"
    ],
    negative: [
      "工作内容", "主修课程"
    ]
  },
  {
    id: "project.achievement",
    target: "project.achievement",
    label: "项目成果",
    sectionScope: "project",
    aliases: [
      "项目业绩", "项目成果", "项目成就", "个人产出", "项目亮点",
      "project achievements", "project outcomes", "key results", "project results"
    ],
    negative: []
  },
  {
    id: "project.link",
    target: "project.link",
    label: "项目链接",
    sectionScope: "project",
    aliases: [
      "项目链接", "项目网址", "作品链接", "代码仓库", "演示地址", "在线演示",
      "project url", "project link", "demo url", "repository", "github repo"
    ],
    negative: []
  }
]);

/**
 * Section normalization dictionary to classify section headings into standard scopes.
 */
const SECTION_SCOPE_PATTERNS = Object.freeze([
  { scope: "education", pattern: /教育|学历|就读|毕业|院校|学校|academic|education/i },
  { scope: "work", pattern: /工作|实习|就职|职业|履历|雇佣|employment|work|experience|job/i },
  { scope: "project", pattern: /项目|实践|作品|project|portfolio/i },
  { scope: "intention", pattern: /意向|期望|目标|求职|preference|intention/i },
  { scope: "self", pattern: /自我|评价|简介|描述|summary|about/i },
  { scope: "basic", pattern: /基本|个人|联系|联系方式|通讯|basic|personal|contact/i }
]);

/**
 * Clean and normalize text for lexical comparison.
 */
export function normalizeFkgText(val) {
  if (!val) return "";
  return String(val)
    .toLowerCase()
    .replace(/[*:：\-_/()[\]{}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects section scope from section heading or container text.
 * @param {string} heading 
 * @returns {string|null}
 */
export function inferSectionScopeFromHeading(heading) {
  if (!heading) return null;
  const norm = String(heading).toLowerCase();
  for (const item of SECTION_SCOPE_PATTERNS) {
    if (item.pattern.test(norm)) {
      return item.scope;
    }
  }
  return null;
}

/**
 * Checks if any negative term is matched in descriptor texts.
 * Uses exact / word-boundary token matching for English, substring for Chinese.
 * 
 * @param {string[]} negativeList 
 * @param {string} text 
 * @returns {string|null} The matched negative keyword or null
 */
export function checkNegativeMatch(negativeList, text) {
  if (!negativeList || !negativeList.length || !text) {
    return null;
  }
  const cleanText = normalizeFkgText(text);

  for (const neg of negativeList) {
    const cleanNeg = normalizeFkgText(neg);
    if (!cleanNeg) continue;

    // Check if neg contains Chinese characters
    if (/[\u4e00-\u9fa5]/.test(cleanNeg)) {
      if (cleanText.includes(cleanNeg)) {
        return neg;
      }
    } else {
      // English word boundary match
      const regex = new RegExp(`\\b${cleanNeg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(cleanText)) {
        return neg;
      }
    }
  }
  return null;
}

/**
 * Compute lexical similarity between a candidate text and an alias.
 * 
 * @param {string} source Clean source text from form field
 * @param {string} alias Clean alias from knowledge graph
 * @returns {number} Score from 0.0 to 1.0
 */
function scoreTextAgainstAlias(source, alias) {
  if (!source || !alias) return 0;
  if (source === alias) return 1.0;

  // Space-stripped comparison for Chinese (e.g. "姓 名" vs "姓名")
  const sourceNoSpace = source.replace(/\s+/g, "");
  const aliasNoSpace = alias.replace(/\s+/g, "");
  if (sourceNoSpace === aliasNoSpace) return 0.98;

  if (sourceNoSpace.includes(aliasNoSpace)) {
    // Alias is contained in source (e.g. source="您的真实姓名", alias="真实姓名")
    return 0.70 + 0.25 * (aliasNoSpace.length / sourceNoSpace.length);
  }

  if (aliasNoSpace.includes(sourceNoSpace) && sourceNoSpace.length >= 2) {
    // Source is prefix or subpart of alias (e.g. source="电话", alias="联系电话")
    return 0.65 + 0.25 * (sourceNoSpace.length / aliasNoSpace.length);
  }

  // English token overlap
  const sourceTokens = source.split(/\s+/).filter(Boolean);
  const aliasTokens = alias.split(/\s+/).filter(Boolean);
  if (aliasTokens.length > 0 && sourceTokens.length > 0) {
    const common = aliasTokens.filter(t => sourceTokens.includes(t));
    if (common.length === aliasTokens.length) {
      return 0.85; // All alias tokens present in source
    }
    if (common.length > 0) {
      return 0.50 * (common.length / aliasTokens.length);
    }
  }

  return 0;
}

/**
 * Matches a FormFieldDescriptor against the Field Knowledge Graph.
 *
 * Evaluates label, ariaLabel, placeholder, nearbyText, name, id, and sectionHeading.
 * Enforces 100% negative keyword exclusion and section scope boundaries.
 * 
 * @param {object} descriptor 
 * @param {object} [options]
 * @param {number} [options.threshold=0.40] Minimum confidence score to consider matched
 * @returns {{
 *   matched: boolean,
 *   target: string|null,
 *   label: string|null,
 *   sectionScope: string|null,
 *   confidence: number,
 *   rule: object|null,
 *   rejectionReason?: string,
 *   candidates: Array<{ rule: object, confidence: number, target: string }>
 * }}
 */
export function matchFieldKnowledge(descriptor, options = {}) {
  const threshold = options.threshold != null ? options.threshold : 0.40;

  if (!descriptor || typeof descriptor !== "object") {
    return {
      matched: false,
      target: null,
      label: null,
      sectionScope: null,
      confidence: 0.0,
      rule: null,
      rejectionReason: "invalid_descriptor",
      candidates: []
    };
  }

  const rawLabel = descriptor.label || "";
  const rawAriaLabel = descriptor.ariaLabel || "";
  const rawPlaceholder = descriptor.placeholder || "";
  const rawNearby = descriptor.nearbyText || "";
  const rawName = descriptor.name || "";
  const rawId = descriptor.id || "";
  const rawHeading = descriptor.sectionHeading || descriptor.section || "";
  const controlType = (descriptor.controlType || descriptor.type || "").toLowerCase();
  const isRepeaterItem = Boolean(descriptor.isRepeaterItem);

  const labelNorm = normalizeFkgText(rawLabel);
  const ariaNorm = normalizeFkgText(rawAriaLabel);
  const placeholderNorm = normalizeFkgText(rawPlaceholder);
  const nearbyNorm = normalizeFkgText(rawNearby);
  const nameNorm = normalizeFkgText(rawName);
  const idNorm = normalizeFkgText(rawId);
  const headingNorm = normalizeFkgText(rawHeading);

  // Aggregated text for checking negative keywords
  const combinedContextText = [labelNorm, ariaNorm, placeholderNorm, nearbyNorm, nameNorm, idNorm, headingNorm].join(" ");

  // Infer section scope
  const detectedScope = inferSectionScopeFromHeading(headingNorm) || (isRepeaterItem ? "experience" : null);

  const scoredCandidates = [];

  for (const rule of FIELD_KNOWLEDGE_GRAPH) {
    // 1. Strict Negative Check: Check combined field and container text
    const matchedNegative = checkNegativeMatch(rule.negative, combinedContextText);
    if (matchedNegative) {
      // 100% Exclude rule if negative match detected
      continue;
    }

    // 2. Repeater Item vs Basic Info Check:
    // Candidate's personal basic fields (e.g. name, phone, email, idNumber) should not match inside repeater items
    if (isRepeaterItem && rule.sectionScope === "basic" && !rule.id.includes("emergency")) {
      continue;
    }

    // 3. Section Scope Compatibility Check
    let sectionMultiplier = 1.0;
    let sectionBonus = 0.0;

    if (detectedScope && detectedScope !== "experience") {
      if (rule.sectionScope === detectedScope) {
        sectionBonus = 0.15; // Positive boost for matching section
      } else if (
        (detectedScope === "education" && (rule.sectionScope === "work" || rule.sectionScope === "project")) ||
        (detectedScope === "work" && (rule.sectionScope === "education" || rule.sectionScope === "project")) ||
        (detectedScope === "project" && (rule.sectionScope === "education" || rule.sectionScope === "work"))
      ) {
        // Disqualify cross-experience section collisions (e.g. school inside work or company inside education)
        continue;
      } else if (detectedScope !== "basic" && rule.sectionScope === "basic") {
        // Severe penalty for basic fields appearing in specific non-basic sections
        sectionMultiplier = 0.3;
      }
    }

    // 4. Match against aliases
    let bestAliasScore = 0;
    for (const alias of rule.aliases) {
      const aliasNorm = normalizeFkgText(alias);

      // Score against primary field label
      if (labelNorm) {
        const s = scoreTextAgainstAlias(labelNorm, aliasNorm);
        if (s > bestAliasScore) bestAliasScore = s;
      }
      // Score against aria-label
      if (ariaNorm) {
        const s = scoreTextAgainstAlias(ariaNorm, aliasNorm);
        if (s > bestAliasScore) bestAliasScore = s;
      }
      // Score against name / id attribute
      if (nameNorm || idNorm) {
        const s = Math.max(scoreTextAgainstAlias(nameNorm, aliasNorm), scoreTextAgainstAlias(idNorm, aliasNorm)) * 0.85;
        if (s > bestAliasScore) bestAliasScore = s;
      }
      // Score against placeholder
      if (placeholderNorm) {
        const s = scoreTextAgainstAlias(placeholderNorm, aliasNorm) * 0.75;
        if (s > bestAliasScore) bestAliasScore = s;
      }
      // Score against nearby text
      if (nearbyNorm) {
        const s = scoreTextAgainstAlias(nearbyNorm, aliasNorm) * 0.60;
        if (s > bestAliasScore) bestAliasScore = s;
      }
    }

    if (bestAliasScore <= 0) {
      continue;
    }

    // 5. Control Type Affinity Boost
    let typeBoost = 0.0;
    if (rule.id.includes("email") && (controlType === "email" || rawName.includes("email"))) {
      typeBoost = 0.10;
    } else if (rule.id.includes("Date") && (controlType === "date" || controlType === "month" || controlType.includes("picker"))) {
      typeBoost = 0.10;
    } else if (rule.id.includes("phone") && (controlType === "tel" || rawName.includes("phone") || rawName.includes("mobile"))) {
      typeBoost = 0.10;
    }

    // 6. Calculate Final Confidence Score
    let confidence = (bestAliasScore * sectionMultiplier) + sectionBonus + typeBoost;
    confidence = Math.min(1.0, Math.max(0.0, confidence));
    confidence = Math.round(confidence * 100) / 100;

    if (confidence >= threshold) {
      scoredCandidates.push({
        rule,
        target: rule.target,
        label: rule.label,
        sectionScope: rule.sectionScope,
        confidence
      });
    }
  }

  // Sort candidates by descending confidence
  scoredCandidates.sort((a, b) => b.confidence - a.confidence);

  if (scoredCandidates.length === 0) {
    return {
      matched: false,
      target: null,
      label: null,
      sectionScope: null,
      confidence: 0.0,
      rule: null,
      rejectionReason: "below_threshold_or_negative_excluded",
      candidates: []
    };
  }

  const best = scoredCandidates[0];
  return {
    matched: true,
    target: best.target,
    label: best.label,
    sectionScope: best.sectionScope,
    confidence: best.confidence,
    rule: best.rule,
    candidates: scoredCandidates
  };
}
