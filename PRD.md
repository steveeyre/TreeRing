# TreeRing（小年轮） — AI 育儿秘书 · PRD & 技术栈


## 0. 产品一句话

面向中国家长、两位家长共用同账号的育儿记录 PWA：随时随手记录孩子成长，AI 自动结构化归档并给出正面管教建议，长期沉淀为成长档案（时间线 + 印记 + 生长/健康 + 童书/游戏/动画/纪录片/电影清单 等）。

## 1. 已锁定的核心决策（勿再推翻）

| 决策 | 内容 |
|---|---|
| 形态 | PWA：React + TS + Vite + vite-plugin-pwa，在支持的浏览器上可安装至 iOS/Android/PC 主屏。首版为离线壳 + 本机草稿保护，正式保存需联网；大陆稳定性与低时延为需实测的目标，不作跨网络保证 |
| 语言 | 界面文案全部中文；代码/注释/技术术语用英文 |
| 账号 | **单一共享账号**（邮箱+密码，Supabase Auth）。移动端/PC 端同一账号，一次登录长期保持（正常情况下由 Supabase session 自动续期；撤销会话、清理浏览器数据或续期失败后需重新登录）。**伪协同**：无权限模型，只有"记录人"切换器 |
| 录音 | **只录音、可播放、可存储。**有录音必须填文字简介**（保存时强制校验） |
| 数据源 | 自由记录以 `entries.body` 为原始事实来源；睡眠/活动/饮水量统计从有效的 `entries.parsed` 计算，不建重复统计表。生长/健康表同时容纳手工记录和有来源的 AI 派生记录，统一去重；直接填写档案表单不再制造第二条自由记录 |
| 数据编辑 | 不在 App 内做"印记/清单"等的导入导出。用户在 **PC 后台编辑**：`scripts/sync-lists.mjs` 同步 `data/lists.json` → Supabase；`scripts/sync-footprints.mjs` 同步 `data/footprints.md`（印记）→ Supabase；或用设置页"备份/恢复"JSON 兜底 |
| 导航 | 底部菜单栏只有 3 项，**"记录"在正中间**：`档案 | 记录 | 设置` |
| 每日提醒 | 应用内 21:15 检查当天有无记录，无则提醒；可选系统通知（需授权） |
| 快捷唤起 | 添加到主屏；不承诺浏览器或 PWA 常驻后台；深链 `/#/new` 直达记录页（供 FV 悬浮球/主屏图标秒开） |
| AI | **首版纯前端直连** OpenAI 兼容端点（`/chat/completions`），API Key 与配置存 localStorage（设备级），后续再改后端代理；首版不得把用户 Key 上传至数据库或函数 |
| AI 任务 | 首版数据库持久化状态、前台异步处理、重新打开后续跑；关闭页面后可靠执行属于后端代理阶段 |
| 恢复 | 重要记录软删除并提供回收站；首版无自动到期清空、无 App 内永久删除 |
| 备份 | JSON 全量备份 + 可单独导出的音频 ZIP；支持 JSON 与音频 ZIP 分步恢复 |
| 部署约束 | **不办理 ICP 备案、不购买域名**，使用平台提供的 HTTPS 子域名；不默认加入付费基础设施。托管、数据库、存储和流量受平台配额约束，不承诺只有 AI 会产生费用 |

## 2. 页面与信息架构

路由基于 hash：`/#/`（记录）、`/#/archive`（档案）、`/#/settings`（设置）、`/#/new`（记录，独立入口）。

布局 Shell：
- 顶部 header：`🌱 萌芽` 标题 + 孩子切换（select，多孩时显示）
- 主区：可滚动内容
- 右下角：FAB「＋」→ 打开记录弹层
- 底部 Tab（3 个，记录居中）：档案 / 记录 / 设置

### 2.1 记录（时间线 `/`）
- 按天分组：组头 = 「今天 / 昨天 / M月D日 周X」+ 该天条数
- EntryCard（每条）：
  - 记录人头像（emoji + 彩色圆）+ 孩子名 + 相对时间（刚刚/x 分钟前/x 小时前/完整时间）
  - 正文（原文）
  - AI 结构化事实摘要（睡眠/饮食/户外/身高体重/饮水/牙齿/阅读/游戏/影视/新词/语录/完成印记/生病），仅显示有值的部分
  - 分类 chips（彩色）、标签 `#标签`
  - 录音附件：可播放 + **可下载源文件**（`<audio>` + 下载按钮）
  - 「✨ AI 建议」折叠块（已保存在本条记录上，可重新生成）
  - 操作：分享（社交卡片）、编辑、删除（两段确认，软删除）
- 顶部工具：搜索框（正文 ilike + 标签）、分类过滤、记录人过滤（横向滚动 chips）
- 空状态：「还没有记录，点右下角 + 开始吧」；加载中、加载失败与空数据使用不同状态
- AI 显示待解析/解析中/解析失败/待配置；失败可重试。正文修改后旧摘要与建议标为过期，过期事实不计入统计
- 有录音但无文字 → 不可保存（强制简介）

### 2.2 档案 `/archive`（6 个页签，顶部横向滚动）
1. **概览**：孩子卡片（头像、姓名、出生日期、年龄）、编辑按钮；记录条数 / 印记完成 / 最新身高体重 统计卡
2. **印记**：进度环（完成/总数 + %）；过滤：全部/未完成/已完成；列表（勾选完成、编辑 ✏️、删除 ✕）；「＋ 添加印记」modal（名称/描述/适宜月龄 min-max/分类）
3. **生长**：身高/体重折线图（recharts）；新增测量表单（日期/身高 cm/体重 kg）
4. **健康**：类型过滤（全部/疫苗/生病/过敏/体检/牙齿）；新增表单（类型/名称/日期/备注）；列表 + 删除
5. **清单**：6 个页签（童书/游戏/动画/纪录片/电影/清单）；添加、勾选完成、删除；提示「AI 解析记录时也会自动把书名、游戏名等加入对应清单」
6. **统计**：近 7 天睡眠 / 活动时长柱状图（从 parsed 计算，无该数据的天不计入平均）

> 注意：档案页**不显示"记录人：爸爸/妈妈"**；记录人只在时间线 EntryCard 显示。

### 2.3 设置 `/settings`
- **账号**：当前登录邮箱、退出登录
- **AI**：Base URL / API Key / 对话模型名 / 「自动 AI 解析」开关（存 localStorage `mengya-prefs`）；提供连接测试与清除 Key。需兼容 HTTPS、浏览器 CORS 和指定模型；仅接入用户选择的可信服务，不预设未经验证的第三方中转
- **孩子管理**：添加 / 编辑 / 删除（姓名、生日、性别、头像色）
- **成员管理**：添加 / 编辑 / 删除（记录人：名称、emoji、颜色）
- **数据**：导出 JSON 备份（7 张业务表，默认含回收站）、导出音频 ZIP、导入 JSON、恢复音频 ZIP、回收站；无独立印记/清单导入导出按钮。导出与恢复显示进度、失败明细和重试入口
- **每日提醒**：开关；明确仅在应用打开或重新进入时检查，不承诺关闭应用后 21:15 准时提醒
- **安装 / FV 悬浮球说明**：添加到主屏步骤、深链 `/#/new` 用法

### 2.4 记录页（Composer，`/new` 或 FAB 弹层）
- 记录人切换器（RecorderSwitcher，横排选择 爸爸/妈妈…）
- 孩子选择（>1 个孩子时显示）
- 正文 textarea（占位：`记录此刻…例如：晚上 9 点睡了，讲了《猜猜我有多爱你》，陪睡玩偶是小熊。`）
- 录音器（VoiceRecorder）：开始/停止/重录；录完显示"已附加一段录音（保存时一起上传）。保存前请填一句文字简介。"（无简介时）
- 分类 chips（可选，多选，AI 也会自动识别）
- 标签输入（引导语固定为：`标签，可选，AI 也会自动识别。用逗号分隔，例如：睡眠，亲子阅读。`）
- 底部：保存（服务器确认写入后再关闭，上传中显示进度）、「✨ AI 建议」（先保存条目 → 取建议 → 存回 → 折叠展示）

## 3. 数据模型（Supabase / PostgreSQL）

> RLS：7 张业务表的读写均校验 `auth.uid() = user_id`，包含 `WITH CHECK`。共享账号内不做记录人权限区分，不同账号仍严格隔离。外键通过复合约束或数据库校验保证同账号，禁止跨账号关联。Storage 也独立配置策略。
> Realtime 仅对当前界面需要的表订阅，以刷新数据为用途；断连后 REST 重查。不是保存成功的判据。
> 迁移规划：基础 7 表、软删除扩展、来源与唯一约束、解析状态与原子 RPC。文件名为实现规划，不表示已有代码。

### 表结构
1. **members** — 记录人：`id uuid PK, user_id, name, emoji, color, sort_order, created_at`
2. **children** — 孩子：`id, user_id, name(default '宝宝'), birth_date date, gender, avatar_color, created_at`
3. **entries** — 核心时间线：`id uuid PK, user_id, child_id FK, recorder_id FK, body text(原文), categories text[](9种可选，AI最多3种), tags text[], occurred_at timestamptz, created_at, updated_at(trigger), parsed jsonb, parse_status('none'|'pending'|'running'|'done'|'failed'), ai_advice text, transcript text(弃用), audio_path text, audio_duration_sec real, deleted_at(软删除)`
4. **milestones** — 印记：`id, user_id, child_id, title, description, age_min_months int, age_max_months int, category, status('todo'|'doing'|'done'), completed_at, note, sort_order, created_at`
5. **list_items** — 清单：`id, user_id, child_id, list_type('book'|'game'|'animation'|'documentary'|'movie'|'custom'), title, meta jsonb, status('todo'|'doing'|'done'), source_entry_id, created_at`
6. **growth_records** — 生长：`id, user_id, child_id, measured_at date, height_cm real, weight_kg real, head_cm real, created_at`
7. **health_events** — 健康：`id, user_id, child_id, event_type('vaccine'|'illness'|'allergy'|'checkup'|'tooth'), title, data jsonb, occurred_at date, note, created_at`

### 补充字段与一致性约束
- 7 表统一具有 `updated_at` 与 `deleted_at`（nullable）。`members`、`children` 的删除语义是归档；恢复前校验父对象有效，保留历史关联，不级联销毁数据。
- `entries` 增加 `content_version int`、`parsed_version int`、`parse_attempts int`、`parse_error text`、`next_retry_at timestamptz`、`parse_lease_until timestamptz`、`parse_token uuid`、`advice_version int`。正文、记录日期或孩子变化时递增内容版本；仅 AI 回写不递增。编辑以版本检查防止两设备静默覆盖。
- `growth_records`、`health_events` 增加 `source_entry_id`（手工创建为 null）、`source_fact_key text`、`source_version int`、`manual_override boolean`（默认 false）。非空来源唯一键为 `(user_id, source_entry_id, source_fact_key)`；首版解析结构每条记录至多一个 growth、illness、tooth，事实键使用这些稳定种类，不使用易变日期或标题。
- `list_items` 增加 `normalized_title`、`origin('manual'|'script'|'ai')`。`(user_id, child_id, list_type, normalized_title)` 全表唯一，包含软删除项，防重解析使已删除清单复活。规范化仅处理 Unicode、首尾空白、连续空白及拉丁字母大小写；不做模糊书名合并。
- 清单的 `source_entry_id` 仅记录首次来源，不是所有引用集合；后续记录不覆盖它，也不覆盖用户的状态、备注。清单作为独立长期档案保留，删除/改写来源不自动删除清单；界面可标示原始来源已失效。
- AI 来源唯一约束是数据库约束，不能以“先查后插”代替。RPC 内执行归属、版本、租约与来源校验；优先使用 `SECURITY INVOKER` 并保留 RLS。

### 枚举/常量
- **分类 9 种**（`src/lib/constants.ts`）：
  `schedule 日程 🕐 #E0A500` / `health 健康 🩺 #2FA36B` / `habit 习惯 🔁 #6E7BF2` / `development 能力发展 🌱 #D9534F` / `learning 学习 📚 #E07B39` / `entertainment 娱乐 🎮 #9C6ADE` / `event 大事记 🎉 #C14679` / `parent 家长专区 🧭 #4A90E2` / `other 其他 📌 #8A8F98`
- **清单类型**：book 童书 / game 游戏 / animation 动画 / documentary 纪录片 / movie 电影 / custom 清单
- **健康类型**：vaccine 疫苗 / illness 生病 / allergy 过敏 / checkup 体检 / tooth 牙齿；身高/体重属于 `growth_records`，不另设 health 的 growth 枚举

### Storage
- bucket `audio`（private），路径 `{user_id}/{entryId}/{audioId}.{ext}`；版本化文件名避免覆盖旧录音。Storage 按已登录账号与路径首段校验读写；播放用 createSignedUrl（1h），过期后按需更新，不长期缓存签名链接
- 软删除条目时保留关联录音；重录替换的旧附件和上传失败遗留文件列为运维清理候选，确认无有效引用后才能清理，首版不自动清空
- 录音格式：iOS Safari `audio/mp4`→扩展名 `m4a`；Chrome 等 `audio/webm`；按 feature detect 选容器

### 索引 / trigger
- 每表 user_id 索引；entries 额外 `(user_id, occurred_at desc)`
- `set_updated_at` trigger 覆盖 7 表；按孩子、删除状态与时间建立常用查询索引
- 时间线每页 50 条，按 `(occurred_at desc, id desc)` 游标分页；不以 500 条作为总数据上限。搜索与筛选在数据库执行；统计分页读取目标日期范围有效数据，不能仅统计当前页；备份分页拉取所有行

### 种子数据
- 成员：爸爸 👨 #4A90E2、妈妈 👩 #E05A8A
- **印记：权威来源为用户维护的 `data/footprints.md`**（每条 `- [ ]` / `- [x]` 待办即为一条印记）。不再内置硬编码清单，也不在首次登录时写死种子。PC 端编辑该文件后运行 `scripts/sync-footprints.mjs`（`npm run footprints:dry` 预览 / `npm run footprints:sync` 执行）同步到 Supabase：按「账号+标题」幂等新增缺失项、只更新描述/分类/排序；绝不删除、绝不动 `status`/`completed_at`（完成状态由 App 内维护，md 的 `[x]` 仅在首次插入时生效）。App 通过 `useMilestones()` 实时读取。已实现并写入 379 条。`data/footprints.md` 已是唯一权威来源，无虚构种子。

## 4. AI 角色

> 实现：`src/lib/ai.ts`（chatCompletion，OpenAI 兼容 `/chat/completions`）、`parser.ts`、`advice.ts`。

### 4.1 解析器（自动、异步、非阻塞）
- 保存原文后，如自动解析开启、正文非空，则持久化 `pending`；前台调度器在配置完整且联网时执行，不阻塞保存。无 Key 显示“待配置 AI”，不持续调用或报错。
- 通过数据库 RPC 原子领取任务，写入租约、任务 token 与内容版本。首版每设备并发 1、租约建议 120 秒、请求超时 60 秒；参数可调整。两个设备抢同一条时仅一个取得当前有效租约。
- 前端调用 `chatCompletion`，校验 JSON schema、分类白名单、数值和日期后，再通过单个数据库事务提交解析结果与派生事实；全部成功才标记 `done`。AI 请求本身不放在数据库事务中。
- 提交必须匹配有效租约 token、内容版本、未删除状态与账号；过期任务返回不能覆盖新正文、新解析或已删除条目。网络不确定时先读取任务状态，不能直接再次付费解析。
- 断网、429、5xx 使用有限重试（建议每版本自动最多 3 次，指数退避并尊重 Retry-After）；401/403、模型不存在、CORS 或 JSON 校验失败提示处理原因，不无限重试。应用启动、恢复联网或切回前台时检查 pending 与租约过期任务；达到重试上限提供手动重试。
- 页面关闭、系统杀后台时不保证继续；下次打开由有 Key 的设备接续。数据库幂等保证不会重复落库，但无法保证外部 AI 请求“恰好一次计费”。后续引入代理、服务端密钥与队列后才实现无人打开页面也能执行。
- 系统提示词要求输出**单个 JSON 对象**（结构见 `parser.ts` SYSTEM_PROMPT）：
  ```json
  {
    "categories": ["schedule","learning"],
    "tags": ["简短中文标签"],
    "facts": {
      "summary": "一句话摘要",
      "sleep": {"start":"HH:mm","end":"HH:mm","durationMin":90,"bedtimeStory":"…","comfortToy":"…"},
      "meals": [{"type":"早餐|午餐|晚餐|加餐","time":"HH:mm","content":"…"}],
      "outdoor": {"type":"…","durationMin":60},
      "growth": {"heightCm":95,"weightKg":14.2},
      "waterMl": 300,
      "teeth": "…",
      "books": [{"title":"…","author":"…"}],
      "games": [{"title":"…","platform":"…"}],
      "media": [{"title":"…","kind":"动画|电影|纪录片"}],
      "newWords": ["…"], "quotes": ["…"],
      "milestones": [{"title":"…"}],
      "illness": {"name":"…","onset":"…","symptoms":"…","medication":"…","recovery":"…"}
    }
  }
  ```
- 分类最多 3 个；无法推出的字段省略；时间统一 HH:mm；tags 3–6 个中文标签
- 分类规则：日程=作息/吃饭/睡眠/户外时长；健康=身高体重/饮水/饮食/牙齿/疫苗/疾病过敏；习惯=运动/如厕/规则执行；能力发展=新词汇/语录/动作/社交；学习=童书/动画电影/桌游电子游戏；**娱乐=休闲游乐/玩具/纯玩乐（非学习向内容）**；大事记=过节/生日/旅行/完成清单；家长专区=家长困惑/反思/购物/育儿书摘录
- **自动归档**：书名→book；游戏→game；影视→animation/documentary/movie；身高体重→growth_records；生病→illness；牙齿→tooth。通过 `apply_parse` RPC 原子提交，不用分散的 `Promise.allSettled` 将部分失败隐藏为成功。
- 重解析按稳定来源键更新，不能新增重复测量/疾病记录；新解析已不含的旧派生事实标为失效并排除统计，保留回收与来源信息。手工修改的派生记录设置 manual_override，自动解析不覆盖，提示用户核对；手工删除的派生行也不自动复活。
- 删除来源 entries 后，其未人工接管的派生事实在查询与统计时随来源失效；恢复来源且版本有效后重新可见。人工接管事实和独立清单保持自己的生命周期，避免误删家长修改。
- 生长日期按记录所属时区从 occurred_at 转为 date；事实明确另一测量日时使用明确日期。跨午夜睡眠增加可选 startAt/endAt（带日期与时区）；仅有 HH:mm 且无法判断日期时不猜时长。多条记录同一时间段不得盲目累加，重叠或矛盾时提示核对；缺失与数值 0 区分。
- AI 标签/分类与用户手工值分开存储（entries 增加 manual_categories、manual_tags；有效展示做合并），重解析不覆盖手工标注。印记匹配仅给出完成建议，由家长确认，不按模糊同名自动勾选。
- 上下文注入：孩子名字 + 事件发生时月龄 + 记录日期及 IANA 时区（children.timezone 默认 Asia/Shanghai）。补记历史记录不使用今天月龄。AI 建议以支持家长为主，不作疾病诊断或生成用药剂量

### 4.2 建议器（按需，按钮触发）
- 「AI 建议」：**先保存条目**（未保存会先 ensureSaved）→ `requestAdvice(entryId)`（带正文 + 孩子上下文，正面管教风格）→ 存回 `entries.ai_advice` → 折叠展示；可重复请求刷新；同样校验内容版本，正文变化后原建议标为过期，失败保留上一版
- AI 配置：`baseUrl`（使用 `VITE_OPENAI_BASE_URL` 或由用户填写，不预设大陆不可验证的默认服务）、`apiKey`（留空则不可用）、`chatModel`（使用 `VITE_CHAT_MODEL` 或用户填写，与端点服务匹配）、`autoParse`（默认 true）

## 5. 关键流程

### 5.1 登录
`useAuth`：启动 `getSession` + `onAuthStateChange`；`authLoaded` 标志防止未加载完先闪出登录表单。登录后 `loadBootstrap`（members 空则灌种子；children 加载）→ `booted=true` 进入主界面。印记不在此处播种（见「种子数据」）。

### 5.2 记录（保存与离线分级）
- **首版 L0**：已在线加载过的应用壳可离线打开；未联网首次访问不保证可用。离线显示“当前离线，内容仅保存在本机草稿，联网后请保存”。不承诺离线读取完整历史、离线正式保存、跨设备冲突自动合并。
- Composer 的文本、分类、标签及停止录制后的 Blob 存 IndexedDB 本机草稿，按账号隔离；写入失败（配额/浏览器限制）明确提示，不能显示已保护。断网或刷新后可恢复草稿，恢复联网仍由用户点击保存，不自动补交。浏览器清理数据会丢失本机草稿。
- 保存先校验简介与正文 → 固定 entryId 和本次 audioId → 上传录音 → 写入条目 → 服务器确认后关闭 Composer 并清除草稿 → 调度 AI。纯文字不等待录音逻辑。按钮防连点；网络结果不确定时按固定 id 查询确认，不生成新 id 重复写入。
- 上传成功而条目明确写入失败时，确认无引用后尝试删除本次新音频；网络超时不能直接删除，先核对条目。回滚失败保留待清理路径及重试提示。无录音简介报“录音记录需填写文字简介”；完全空白报“请写点什么；如需录音，也请添加一句简介”。
- 后续 **L1**：可选缓存最近档案供只读；**L2**：离线正式写入队列、自动补交及冲突处理，需单独确认，不纳入本轮开发范围。
- Service Worker 只缓存自有静态资源，不通用缓存 Auth、AI 请求、私有录音或带认证的数据接口。用户数据仅在明确设计的账号隔离本地层存储；退出前提示未提交草稿并清除该账号本地敏感内容。

### 5.3 每日提醒（21:15）
`useDailyReminder`：开关 `dailyRemind`（默认开，存 prefs）。到达 21:15 后检查当天（occurred_at 在本地 0 点至次日 0 点）有无记录；无则弹应用内提醒 + （已授权时）系统 Notification。防重复：localStorage key `mengya-reminded-YYYY-MM-DD`。页面 focus / visibilitychange 时复查。以当前孩子时区判断当天，防重复键包含账号和孩子。应用不在前台时不承诺执行；通知按浏览器能力检测，系统权限不足不影响应用内提醒。

### 5.4 备份 / 恢复 / 回收站（设置页）
- **JSON**：分页导出 7 张业务表全部行，默认包含软删除数据；头部包含 `app:'mengya'`、`schema_version:2`、`backup_id`、`exported_at`、表计数和音频清单。排除账号密码、会话、API Key、签名 URL、本机草稿。长备份检测 updated_at 变化并提示重试；首版非跨 Storage/数据库的全局快照，导出期间建议另一设备暂停修改。
- **音频 ZIP**：单独按钮导出音频原文件与 manifest.json，可与选定 JSON 的 backup_id 配套，也可独立导出。清单记录 entryId、audioId、原路径、ZIP 内相对路径、MIME、大小及 SHA-256；默认包含回收站引用的音频。保留原始 m4a/webm，不转码，不把短期签名 URL 当备份。
- 使用按需加载的 ZIP 库（暂定 fflate）、有限下载并发和分卷策略控制内存；首版建议每卷音频原始字节合计不超过 50 MiB，阈值须经手机测试调整。每卷独立 manifest，支持取消、失败重试与缺失列表；有缺失只能标记“部分完成”。大批量建议 PC 操作，不能整库 Blob 一次性塞进手机内存。
- **JSON 恢复**：支持旧版 `{data:{...}}` 和平铺格式，先转换、校验 schema/字段/大小/归属与外键并预览新增、覆盖、删除状态。按 members/children → entries → milestones/list_items/growth_records/health_events 顺序分批 upsert；强制 user_id 为当前账号。数据库唯一键冲突先给出解决预览，不能直接覆盖另一条不同 id 的记录。记录每批结果，可中断重试；不宣称跨多批原子恢复。建议恢复前先生成当前备份。
- 新备份保留 deleted_at；旧格式未含该字段时，更新已有记录须保留现有删除状态，防止静默复活。租约/token 必须清空，running 转 pending，恢复不能直接触发付费 AI；待用户检查后再恢复解析。跨账号恢复重写资源 owner 路径，不保留外账号访问引用。
- **音频恢复**：先恢复 JSON，再选择 ZIP（含全部分卷）；检查备份标识、路径安全、文件大小和哈希，仅恢复当前账号有对应条目的附件。上传至当前账号路径，再更新 audio_path；已存在同哈希对象可跳过，不同内容采用新 audioId，不能覆盖未确认文件。失败列为缺失附件，可重试，正文仍能正常读取。
- **回收站**：展示 entries、milestones、list_items、growth_records、health_events 的删除项；支持查看与恢复，默认不计入档案、搜索和统计。首版无限期保留，受存储配额约束；不提供自动清空或 App 内永久删除。
- **孩子/记录人归档**：从选择器隐藏但保留历史名称和关联；可在设置恢复归档。恢复子记录时先恢复所属孩子。有关来源级联显示规则遵循第 4.1 节，删除与恢复不会额外触发 AI 计费。

### 5.5 PC 后台编辑清单
- 编辑 `data/lists.json`（`{book:[{title,meta?,status?}], game:[...], animation:[...], documentary:[...], movie:[...], custom:[...]}`）
- `.env` 配 `MENGYA_EMAIL/MENGYA_PASSWORD`（共享账号）
- `npm run lists:dry` 预览 / `npm run lists:sync` 同步（脚本 `scripts/sync-lists.mjs`：直接调 Supabase REST `/auth/v1/token?grant_type=password` 登录 → 按 `账号+child_id+type+normalized_title` 幂等 新增/更新，**绝不删除**任何条目，也不自动恢复软删除项；多孩必须显式指定 child_id）
- 孩子档案 / 印记等其它表：直接在 Supabase 控制台 SQL Editor / Table Editor 编辑（控制台管理操作可能具有高权限，不等同于 App 的 owner RLS；更新仍需遵守来源与唯一约束）

## 6. 技术栈清单

| 层 | 选型 |
|---|---|
| 框架 | React + TypeScript + Vite；不因大陆网络问题切换框架。React 18 为原稿基线，开工时统一选相互兼容的受支持稳定版本并锁定依赖，避免混装不同主版本示例 |
| 样式 | Tailwind CSS（自定义 tokens：`--brand:#e60012; --paper:#faf7f2; --ink:#1b1b1b; --muted:#8a8f98; --line:#ece7de`）+ index.css（`.btn` `.card` `.chip` `.touch-target`(≥44pt) `.safe-top/bottom` `.no-scrollbar`，prefers-reduced-motion） |
| 路由 | react-router-dom（HashRouter） |
| 状态 | zustand：`useAppStore`(session/members/children/authLoaded/booted) + `usePrefs`(currentChildId/currentRecorderId/dailyRemind/AI配置，persist `mengya-prefs`) |
| 后端 | @supabase/supabase-js：Auth + PostgREST + PostgreSQL RPC + 按需 Realtime；新项目先比较新加坡/东京区域。非 AI 的数据库 RPC 不改变首版纯前端直连 AI 决策 |
| 图表 | recharts（生长/睡眠/活动统计） |
| 卡片导出 | html-to-image（SocialCard 1080×1440 PNG） |
| AI | 原生 fetch + AbortController → 用户选定 OpenAI 兼容端点；schema 校验暂定 Zod；transport 层预留后端代理接口，首版实现 direct |
| PWA | vite-plugin-pwa + Workbox；版本化静态预缓存、导航短超时回退离线壳、提示更新；IndexedDB（轻量 idb 封装）用于本机草稿 |
| 录音 | 原生 `navigator.mediaDevices.getUserMedia` + MediaRecorder，无三方库 |
| 部署 | 平台自带 HTTPS 子域名，不绑自购域名；Cloudflare Workers Static Assets / workers.dev 保留为原方案候选，Netlify / netlify.app 为独立对照候选，实测通过后选主入口，不预先宣称任一在大陆稳定 |
| 备份压缩 | fflate（暂定，按需加载）+ 浏览器文件下载/分卷；不依赖 Chromium 专有保存 API |
| 后台脚本 | Node ESM（scripts/），读 .env + Supabase REST |

目录结构（重建参考）：
```
src/lib:      supabase.ts, ai.ts, parser.ts, advice.ts, types.ts, constants.ts, store.ts, format.ts, seedData.ts, data.ts(CRUD门面), repositories/, backup.ts, audioBackup.ts, draftStore.ts, parseScheduler.ts, validation.ts
src/hooks:    useAuth, useTable(useEntries/useMilestones/useListItems/useGrowth/useHealth…), useDailyReminder
src/components: Composer, Timeline, EntryCard, RecorderSwitcher, VoiceRecorder, BottomTabs, FAB, Modal, SocialCard, …
src/pages:    TimelinePage(记录), ArchivePage(6页签), SettingsPage
```

## 7. 环境与部署

### `.env`（见 `.env.example`）
```
VITE_SUPABASE_URL=          # 从 Supabase 项目设置复制
VITE_SUPABASE_ANON_KEY=     # 同上
VITE_OPENAI_BASE_URL=       # Optional HTTPS endpoint, verified from target networks
VITE_CHAT_MODEL=            # Model supported by the selected endpoint
MENGYA_EMAIL= / MENGYA_PASSWORD= # 仅供 scripts/sync-lists.mjs 使用，不进前端构建产物
```
> AI 的 apiKey **不写 .env**，在应用内「设置 → AI」填写，存浏览器 localStorage（设备级）。换设备或换站点域名需重新填；不纳入备份、不记入日志、不进入分享卡片。Key 遮罩显示，AI 输出按文本渲染，不注入未经净化的 HTML。首次使用说明将把所选记录及孩子上下文发送给配置服务。

### 7.1 部署决策：不备案、不购买域名

**判断：优化部署与数据访问层，保留 React/Vite/Supabase 主体。当前约束下不能保证大陆所有运营商长期稳定低时延；免费子域名也不意味着自带大陆加速。** 以下为 2026-09-09 文档核查，尚无用户所在地实测结果。

| 方案 | 约束匹配与取舍 | 规划结论 |
|---|---|---|
| Cloudflare Workers Static Assets + workers.dev | 无需先接入自有域名；官方将 workers.dev 定位于个人/非关键项目，不等同于中国网络 | 保留为候选与测试入口，取消原稿唯一正式入口的预设 |
| Netlify + netlify.app | 官方提供默认站点子域名，可承载同一份静态构建；大陆可达性尚未验证 | 作为独立供应商对照候选，不保证比 workers.dev 快 |
| Cloudflare China Network | 企业附加订阅，并要求接入域名具有有效 ICP 备案/许可 | 不符合本项目约束，不选 |
| 香港等近岸自建服务器 | 仅更换服务器位置不解决 HTTPS 入口、路由质量、运维与成本；不能假设托管 Supabase 存在香港区 | 首版不引入，若候选全失败再评估有合法有效 HTTPS 入口的方案 |

Cloudflare 提供默认 workers.dev 子域名，但它不是大陆网络服务；大陆网络另有准入条件。[workers.dev 官方说明](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[China Network 官方说明](https://developers.cloudflare.com/china-network/)。Netlify 默认站点域名见[官方文档](https://docs.netlify.com/manage/domains/domains-fundamentals/understand-domains/)。

### 7.2 分链路优化

1. **页面入口**：发布资源均自托管（图标、字体与脚本不依赖外部 CDN）；首屏只加载记录页必需资源，图表、分享与 ZIP 按需加载。入口必须为有效 HTTPS；不能用普通 HTTP 裸 IP 替代，否则麦克风安全上下文等能力无法成立。[getUserMedia 文档](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
2. **数据库/Auth/Storage**：Supabase 保留。官方可选区域含新加坡和东京，不列中国大陆或香港；新项目先比这两个区域，地理近只是候选依据，实测决定。已有项目迁区需单独制定数据迁移计划，不能只改环境变量。[Supabase 区域文档](https://supabase.com/docs/guides/platform/regions)
3. **数据请求**：首屏分页 50 条、只取所需字段；并行加载独立小请求，避免加载全部档案才能进入记录页。Realtime 按需订阅，断线后在前台有限轮询/手动刷新（建议 30–60 秒退避），恢复正常后停止轮询；保存成功由 REST/RPC 返回确认。
4. **录音**：上传显示进度与失败重试；只按需获取播放签名链接，不预下载全部音频。列表加载和文本保存不依赖录音播放可用。
5. **AI**：单独测试用户选定服务的大陆访问、HTTPS、CORS、模型与 JSON 能力；前端托管变快不会使浏览器直连的 AI 自动变快。无可用服务时记录和档案照常使用。后端代理留待后续，不能借本次优化提前部署代理。
6. **入口切换**：不同平台域名是不同 origin；登录状态、API Key、本机草稿、Service Worker 及安装图标不会自动迁移。主入口选定后尽量稳定，备用地址用于手动切换；禁止 URL 携带 Key/session，不把镜像描述为无感故障转移。

### 7.3 联网验收（建议门槛，待开发规划确认）

- 开始功能开发后的第一项工作是最小连接验证，不等完整 App 做完再测网络。本轮仅形成验证计划，不建项目或部署探针。
- 在实际常用所在地、家中宽带和手机移动网络、不同时间段（含晚高峰）测试，不使用 VPN；每条链路每网络每时段建议至少 30 次，并记录样本数、成功率、中位数、p95、失败原因。不能用本工作环境请求速度代替大陆实测。
- 分别测：首次 HTTPS 页面加载与可操作时间；登录/续期；读取 50 条；纯文本保存；相同 1 MiB 音频上传、下载；Realtime 断连后的数据刷新；AI 连接单列，不并入原文保存耗时。
- 初始目标：样本内核心非 AI 请求成功率 ≥99%，冷启动可操作 p95 ≤5 秒、热启动壳 p95 ≤1.5 秒、纯文字读写 p95 ≤2 秒；1 MiB 音频传输 p95 ≤10 秒。属于产品验收目标，不是平台 SLA；小样本通过不代表长期可用保证。
- 页面不通先换静态托管候选；页面通但 Auth/CRUD/Storage 不达标先比较数据库区域；AI 单独失败仅降级 AI。两个候选均不满足时，明确报告当前约束下未达目标，再评估其他提供长期 HTTPS 子域名的服务；不得自动要求购买域名、办理备案或伪造“保证可用”。

### 7.4 发布流程（后续实施）
1. 用户确认开发规划后，创建项目、锁定依赖、准备环境变量与数据库迁移。
2. 通过上述连接验证确定主入口与数据库区域；实际部署地址以创建结果为准。原稿 `https://cold-meadow-7936.steveeyre.workers.dev` 仅为历史参考，未验证所有权和可用性，不硬编码。
3. `npm run build` 生成 dist；若选 Cloudflare，配置 Static Assets 后用 wrangler 发布；若选 Netlify，发布同一静态构建并使用其默认 HTTPS 子域名。
4. 配置 Supabase Auth 的实际站点地址与允许重定向地址、RLS、Storage 策略；初始化共享账号和种子数据。首次启用脚本前提供 footprints.md / lists.json 或明确留空。
5. 通过双设备、录音、回收站、幂等、备份恢复与 PWA 更新验证后交付；设置主屏图标与 `/#/new` 深链。

## 8. 设计系统（前端设计语言，P6 定稿）

- 主题：Nintendo 式活力撞色（主色砖红 `#E60012`）+ 平静暖中性底色（纸感 `#FAF7F2`）
- 时间线即签名元素：Linear/Slack 式留白、结构化分组的"成长账本"
- 每个可交互目标 ≥ 44×44pt（`.touch-target`）；底部 Tab 拇指区；Composer 在拇指可及位置
- Apple HIG 间距与动效；`prefers-reduced-motion` 降级
- 社交卡片（分享导出）：3:4（1080×1440），tokens：paper `#FAF7F2` / ink `#1B1B1B` / muted `#8A8F98` / line `#E4DED2`，含大标题、正文、分类标签、底部品牌
- 所有 app 内文案为中文

## 9. 实施顺序与验收要点

### 9.1 实施顺序
1. **连接与项目基线**：大陆连接验证、依赖锁定、迁移/RLS/Storage、登录续期、基础 Shell。
2. **核心记录**：孩子/记录人、时间线、分页搜索、文本、录音、本机草稿、编辑冲突、软删除与回收站。
3. **档案与备份**：6 个档案页签、统计有效性、JSON 与分卷音频导出及恢复、PC 清单脚本。
4. **AI**：纯前端配置、任务租约与续跑、版本检查、事务化幂等归档、建议与重试。
5. **体验与交付**：安装、提醒、分享卡、弱网处理、版本更新、跨设备验证。分阶段是交付顺序，不是删除录音/恢复等首版已确认需求。
6. **后续另立项**：后端 AI 代理 + 服务端可靠队列；完整离线写入同步。首版只预留接口与数据结构。

### 9.2 必测边界
- 同一条记录重复保存/重复解析、两个设备同时领取任务，均不产生重复条目和派生事实；正文改动后旧任务不能回写。
- 保存后立刻关闭页面，重新打开能识别未完成解析；提示可能发生的外部 AI 重复计费，不承诺 exactly-once。
- 上传成功但数据库失败、上传超时但实际成功、签名 URL 过期，均可恢复且不误删有效录音。
- 删除和恢复带音频记录、来源派生记录与手工修改记录；统计排除删除、过期、失效事实；归档孩子不丢历史。
- 超过 500 条数据的分页与备份；两个孩子同名清单互不合并；JSON+音频在空测试账号恢复，文件哈希一致；缺失 ZIP 分卷给出明细，不能显示完整成功。
- iOS Safari/主屏 PWA、Android Chrome、PC 的录音、下载、ZIP 内存、安装和提醒降级；均按 feature detection 选择 MIME，不能只按浏览器名称判断。
- 断网打开离线壳、草稿刷新恢复、配额不足与退出清理；未联网数据不显示“云端保存成功”。
- 新 Service Worker 就绪时先保护草稿，再提示更新；不强制刷新打断录音，不默认要求清站点数据。缓存版本需匹配构建资源，导航失败回退壳。
- “保存后空状态”需同时检查请求、账号/孩子筛选、状态刷新和 SW；不能预先认定一定是缓存。加载错误不能伪装成没有记录。
- 分类 chips 使用 flex-wrap；所有点击目标至少 44×44 CSS px；档案不展示记录人，时间线展示记录人。

### 9.3 开发前确认状态
- **用户已确认**：先规划后编程；首版前端直连 AI；离线能力分级；音频 ZIP；重要记录恢复；解析幂等；前台持久化任务与后续可靠后端；不备案、不购买域名。
- **本稿建议待确认**：部署候选实测后定主入口、数据库区域比较及验收目标。未完成真实大陆网络验证，不宣称任何候选已满足稳定性目标。
- **材料待补**：印记源文件、清单源文件（若需预置）；后续开发所需平台项目配置。个人 API Key 在应用设置中填写，不要求在聊天提供。
