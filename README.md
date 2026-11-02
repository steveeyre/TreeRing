# 小年轮 TreeRing

> AI 育儿记录 PWA：随手记一句「今天会扶着沙发站起来了」，AI 自动整理成结构化记录；时间线、里程碑、生长曲线、健康、清单在一处归档。

当前版本：**1.0.0** · 许可证：[MIT](LICENSE)

## 功能

- **记录（`/`）**：文字、语音、照片混合记录，保存即返回；AI 只做异步结构化（摘要、分类、标签、里程碑匹配），失败不影响存档
- **时间线**：按天分组，支持按记录人 / 孩子 / 关键词筛选；草稿与未同步队列在本机排队，联网后自动补传
- **档案（`/archive`）**：概览、印记、生长、健康、清单、统计六个页签
- **印记与分享卡片**：成长条目可标记为里程碑，生成可长按保存的图片卡片
- **健康与生长**：疫苗 / 生病 / 过敏 / 体检 / 牙齿事件，身高体重曲线带参考值
- **清单**：待办式清单（出行包、绘本、动画片单等），支持 PC 端用脚本批量同步
- **每日提醒**：21:15 检查当天是否已记录，未记录则提醒（可关）
- **备份 / 恢复 / 回收站**：JSON 全量导出导入、含音频的 ZIP 备份、删除保留可恢复
- **安装到主屏**：标准 PWA，离线可读，写入先落本机再同步

## 技术栈

- 前端：React 18 + TypeScript、Vite 5、Tailwind CSS 3、Zustand、Recharts、vite-plugin-pwa（Workbox）
- 后端：Cloudflare Pages（静态）+ Pages Functions 转发到 `workers/api.ts`（`/api/*`）+ D1（SQLite）
- 语音/音频：可选 R2 绑定；未开通时上传接口返回 503，其余功能不受影响
- AI：浏览器直连任意 OpenAI 兼容端点（`/chat/completions`），Key 只存本机

## 目录

```
src/                      React 应用
  pages/                  记录、档案、里程碑、设置
  components/             编辑器、记录卡、曲线、分享卡、语音录制等
  lib/                    数据层（data/store/api/outbox）、AI、解析、导入导出
  hooks/                  登录态、待同步、每日提醒、表格查询
workers/api.ts            API 入口：鉴权、行级读写、音频、CORS
workers/schema.sql        D1 表结构（users/sessions/members/children/entries/
                          milestones/list_items/growth_records/health_events）
functions/api/[[path]].ts Pages Functions → Worker 的转发层
scripts/                  测试、图标生成、PC 端清单与印记同步
PRD.md                   设计文档（含早期 Supabase 方案，接口以源码为准）
footprints.md            成长印记清单的权威来源
```

## 本地开发

需要 Node.js 18+。

```bash
npm install
npm run dev          # 前端 http://localhost:5173，/api 代理到 wrangler dev
npm run dev:api      # Worker + D1 本地模拟，127.0.0.1:8787
```

前置：把 `wrangler.worker.toml` 里的 `database_id` 换成自己账号的 D1，并执行一次
`npx wrangler d1 execute mengya-db --file=workers/schema.sql --local`。

可选配置见 `.env.example`（`VITE_API_BASE_URL`、默认模型名）。`MENGYA_*` 三个变量只给
PC 端同步脚本用，不存在前端构建产物里。

## 测试与检查

```bash
npm test         # 纯函数、解析、AI 载荷、导入导出等
npm run typecheck
```

## 部署

```bash
npm run deploy        # Cloudflare Pages（主入口）
npm run deploy:worker # Workers（备用入口，--config wrangler.worker.toml）
```

首次部署后需在宿主机执行 `workers/schema.sql` 建表；R2 开通后再取消
`wrangler.toml` 里 `[[r2_buckets]]` 的注释并重新部署即可启用语音存储。

## 隐私与安全

- 记录默认存在自己的 D1 实例里，没有第三方分析脚本
- AI API Key 保存在浏览器本地，仅发往你在设置里填写的 Base URL；不填 Key 时 AI 功能关闭，记录仍可正常保存
- 所有 `/api/*` 请求按登录会话校验 `user_id`，行级读写都带归属条件
- 孩子姓名、照片、录音属于敏感数据，导出备份时请自行妥善保管

## 已知限制

- 单账号共享模型（两位家长共用一个账号），不做按记录人的权限隔离
- 语音上传依赖 R2；未开通时录音不可用，其余记录方式正常
- `PRD.md` 是最初的设计文档（其中后端为 Supabase），实际实现已迁移到 Cloudflare D1，接口以 `workers/api.ts` 为准

## 许可证

[MIT](LICENSE) © 2026 steveeyre
