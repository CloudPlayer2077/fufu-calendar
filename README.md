# FURINA CALENDAR · 在线版

四款游戏（原神 / 绝区零 / 崩坏：星穹铁道 / 终末地）的活动日程在线查看站。

纯静态 + Cloudflare Pages Functions，**零服务器成本**，全球 CDN 加速。

---

## 这是什么

桌面版 FURINA CALENDAR 的网页分支。**只读**：可以查看月历、时间轴、死线看板，
但不能添加/编辑/导入活动——那些功能需要本地文件系统和 Windows OCR，只有桌面版能做。

网页版的定位是「分享给别人看」：把链接发出去，对方不用装任何东西就能看到全部活动排期。

---

## 目录结构

```
FURINA CALENDAR Website/
├── public/                  # 静态站点（构建产物，不要手改）
│   ├── index.html
│   ├── css/
│   ├── js/
│   ├── img/
│   ├── data/
│   │   └── calendar.json    # 导出给外部用的数据副本
│   └── _routes.json         # Cloudflare 路由规则
├── functions/
│   └── api/
│       └── [[path]].js      # Pages Functions 入口，处理 /api/*
├── lib/
│   ├── handler.mjs          # API 路由逻辑（纯函数，可单测）
│   ├── online-mode.js       # 前端只读补丁（顶栏徽标 / 拦截写操作）
│   └── data.generated.mjs   # 构建时生成的数据模块
├── scripts/
│   ├── build.cjs            # 构建：桌面版 web/ + 数据 → public/
│   ├── dev-server.cjs       # 本地预览服务器
│   └── test-handler.cjs     # 接口单测（31 项）
├── data/
│   └── calendar.json        # 构建生成的数据
├── package.json
├── wrangler.toml
└── .gitignore
```

---

## 本地预览

```bash
# 1. 首次构建
node scripts/build.cjs

# 2. 启动本地服务
node scripts/dev-server.cjs
# → http://127.0.0.1:8788
```

`dev-server.cjs` 会同时服务静态文件和 `/api/*`，行为和线上基本一致。

跑接口测试：

```bash
node scripts/test-handler.cjs
```

---

## 更新数据

项目设计成**自包含**：前端源和数据快照都在 `_source/` 里，
所以换任何机器、Cloudflare 构建机都能直接跑，不依赖桌面版目录。

桌面版同步或导入了新活动后，更新流程：

```bash
# 1. 从桌面版重新同步源（默认找 ../game-calendar）
node scripts/sync-source.cjs

# 2. 重新构建
node scripts/build.cjs

# 3. 提交并推送
git add -A
git commit -m "update: 同步最新活动数据"
git push
```

Cloudflare 如果配了自动部署，推送后约 30 秒生效。

> **`_source/` 里是什么？**
> `web/`（前端页面）、`db.json`（活动数据）、`games.js`（游戏与分类定义）。
> 这些是从桌面版复制过来的快照，让网页项目不依赖桌面版就能独立构建。

> **为什么数据要打进 JS 模块？**
> Functions 运行时不需要读文件或数据库，冷启动快、零依赖、零成本。
> 数据量在几十 KB 级别，完全没问题。

---

## 部署到 Cloudflare Pages

### 前置准备

- 一个 GitHub 账号
- 一个 Cloudflare 账号（免费版够用，不需要绑卡）

### 第一步：推到 GitHub

```bash
cd "E:\FUFU CALENDAR\FURINA CALENDAR Website"
git init
git add .
git commit -m "init: FURINA CALENDAR 在线版"
git branch -M main
git remote add origin https://github.com/<你的用户名>/fufu-calendar.git
git push -u origin main
```

仓库建议设为 **Public**（私有仓库 Cloudflare 也能连，但公开更省事）。

### 第二步：Cloudflare 连接仓库

1. 登录 https://dash.cloudflare.com
2. 左侧菜单 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 授权 GitHub，选中 `fufu-calendar` 仓库
4. 构建设置填：

   | 字段 | 值 |
   | --- | --- |
   | Framework preset | `None` |
   | Build command | **留空**（不要填） |
   | Build output directory | `public` |

   > 构建命令留空是有意的：`public/` 已经在仓库里准备好了，
   > Cloudflare 直接上传静态文件即可，省去云端跑构建的环节，更快也更不容易出错。

5. 点 **Save and Deploy**

首次部署约 1 分钟。完成后会拿到一个域名：

```
https://fufu-calendar.pages.dev
```

这个地址可以直接分享，全球可访问，不需要备案。

### 第三步（可选）：绑定自己的域名

如果你有域名并托管在 Cloudflare：

1. 进入 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 填入 `calendar.你的域名.com`
3. Cloudflare 会自动配好 DNS 和 SSL 证书

---

## 接口一览

网页版实现了这些只读接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/bootstrap` | 页面初始化数据（游戏/分类/活动/设置） |
| GET | `/api/events` | 活动列表，支持 `games` / `categories` / `from` / `to` 筛选 |
| GET | `/api/events/:id` | 单个活动 |
| GET | `/api/reminders/due` | 恒返回空数组（网页版无本地通知） |
| GET | `/api/settings` | 设置 |
| GET | `/api/sources` | 恒返回空列表 |

所有写操作（POST/PUT/DELETE）统一返回 `403` 和中文提示：

```json
{ "ok": false, "error": "这是在线预览版，只支持查看。添加/编辑/导入请使用桌面版。", "readonly": true }
```

---

## 常见问题

**Q：为什么网页版不能添加活动？**
添加需要写本地文件、跑 Windows OCR、发系统通知，这些浏览器里做不到。
网页版的定位就是「看」，要完整功能请用桌面版。

**Q：数据多久更新一次？**
取决于你什么时候重跑构建并推送。桌面版同步了新活动后，
执行一次 `node scripts/build.cjs` + `git push` 就行。

**Q：Cloudflare 免费额度够吗？**
够。Pages 免费版每天 10 万次请求、无限带宽。
这个站点的数据量小，即使几千人访问也远远用不完。

**Q：能改成可编辑的吗？**
可以，但要引入数据库（Cloudflare D1 或 KV）和鉴权，工作量会大不少。
如果只是自己想改数据，改桌面版再重新构建更快。

**Q：构建报错说找不到 game-calendar 目录？**
`scripts/build.cjs` 里的 `SRC` 是指向桌面版的路径。
换机器部署时，要么把桌面版一起带上，要么直接把 `lib/data.generated.mjs` 提交进仓库、
在 Cloudflare 的构建命令里跳过 `build.cjs`（改成 `echo skip`）。

---

## 许可

代码 MIT。界面主视觉来自《原神》芙宁娜角色立绘，版权归米哈游所有，仅作个人欣赏用途。

活动数据来自玩家社区维护的 wiki（BWIKI / fz.wiki），非官方数据，具体时间请以游戏内公告为准。
