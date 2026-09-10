<h1 align="center">🎵 OpenMusic</h1>

<p align="center">
  <strong>多人实时在线点歌</strong><br/>
  多音源搜索 · 同步听歌 · 聊天互动 · 3D 视觉 / 沉浸模式
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-MIT%20with%20Attribution-blue" alt="MIT with Attribution" />
  <img src="https://img.shields.io/badge/Deploy-Docker%20%7C%20PM2%20%7C%20宝塔-ff6b6b" alt="Deploy" />
</p>

<p align="center">
  <a href="#-快速开始">🚀 快速开始</a> ·
  <a href="#-功能概览">✨ 功能</a> ·
  <a href="#-ai-功能">🤖 AI</a> ·
  <a href="#-站点管理后台">🛡️ 管理后台</a> ·
  <a href="#-文档">📖 文档</a> ·
  <a href="#-交流群">👥 交流群</a> ·
  <a href="#-请作者喝一杯咖啡">☕ 请喝咖啡</a> ·
  <a href="docs/DEPLOY.md">📖 部署文档</a> ·
  <a href="deploy/DEPLOY-BAOTA.md">🛠️ 宝塔部署</a>
</p>

---

## 📸 项目截图

<p align="center">
  <a href="docs/screenshots/home.png">
    <img src="docs/screenshots/home.png" alt="首页大厅" width="78%" />
  </a>
  <br/>
  <sub><b>首页大厅</b></sub>
</p>

<table>
  <tr>
    <td align="center" width="50%">
      <a href="docs/screenshots/room.png"><img src="docs/screenshots/room.png" alt="房间点歌" width="100%" /></a>
      <br/><sub><b>房间点歌</b></sub>
    </td>
    <td align="center" width="50%">
      <a href="docs/screenshots/admin.png"><img src="docs/screenshots/admin.png" alt="管理后台" width="100%" /></a>
      <br/><sub><b>管理后台</b></sub>
    </td>
  </tr>
</table>

---

## 🚀 快速开始

### 前置依赖

| 依赖 | 必填 | 说明 |
|------|:----:|------|
| Node.js | 源码部署 | `>=20 <25`（见 `.nvmrc`） |
| Redis | 是 | 房间、收藏、凭据、公告、封禁 |
| [Meting-API](https://github.com/qq01-hub/Meting-API) | 是 | 搜索 / 播放 / 歌词 / 封面 / 歌单；提供 Docker 镜像 |
| 七牛 OSS | 否 | 聊天发图；可在管理后台配置 |

> Docker 全量版已内置 Redis 与 Meting，打开站点后填域名即可。

### Docker 一键部署（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/qq01-hub/openmusic/main/install.sh | bash
```

**访问地址：**
- OpenMusic：`http://<服务器IP>:4000`（首次进入部署向导）
- Meting 管理后台：`http://127.0.0.1:3000/<管理路径>`（仅本机，凭据保存在部署目录的 `.env`）

**常用命令：**
```bash
# 查看日志
docker compose --env-file .env -f docker-compose.full.yml logs -f

# 停止服务
docker compose --env-file .env -f docker-compose.full.yml down

# 重启服务
docker compose --env-file .env -f docker-compose.full.yml restart

# 更新到最新版
docker compose --env-file .env -f docker-compose.full.yml pull && docker compose --env-file .env -f docker-compose.full.yml up -d
```

**远程管理 Meting：**
```bash
ssh -L 3000:127.0.0.1:3000 user@server
# 然后在本机浏览器访问 http://127.0.0.1:3000/<管理路径>
```

> 💡 **提示：** 不要把 Meting 管理端口直接暴露到公网。已有部署升级时，脚本会保留原有的 `ROOM_CREDENTIAL_ENCRYPTION_KEY` 和 Meting 数据。

**手动部署或自定义配置：** 见 [详细部署文档](docs/DEPLOY.md) 或 [宝塔部署指南](deploy/DEPLOY-BAOTA.md)。

### 源码部署

```bash
git clone https://github.com/qq01-hub/openmusic.git && cd openmusic
npm run install:all && npm run build && npm start
```

打开 `http://<IP>:4000` 进入部署向导。生产环境请配置 Nginx 反代，详见 [部署文档](docs/DEPLOY.md)。

```bash
# 开发：前端 :5173，后端 :4000
npm run dev
```

---

## ✨ 功能概览

### 🎧 听歌

- 多音源搜索：网易云音乐、QQ 音乐、汽水音乐、酷狗音乐
- **账号与漫游**：网易、QQ、汽水、酷狗支持账号状态与个性化漫游；房间账号优先，否则走共享会员池；无可用汽水账号时自动锁定汽水漫游
- **本机音质**：自选偏好（含无损 / 臻音等档位，受平台与 SVIP 开关约束）；弱设备可自动降档；切换后当前曲继续播放，下一首起生效
- 多人实时同步播放；顺序 / 随机 / 按用户轮流 / 收藏随机 / 单曲循环 / 列表循环 / 列表内随机等播放模式；可授权成员暂停与拖进度
- 网易云热歌榜（服务端缓存每 3 小时刷新）、推荐歌单、音乐电台
- 歌单导入（网易 / QQ / 汽水 / 酷狗链接或 ID）；支持多歌单漫游、按歌名去重（网易云 > QQ > 汽水 > 酷狗），每个指定歌单最多保留 5000 首歌曲；个人收藏与点歌历史支持 JSON 导入 / 导出
- 队列拖拽排序、插队、清空；系统媒体键（可分别开关，防误触）
- 移动端后台播放（Android Flutter WebView 容器，见 [`mobile/`](mobile/)）

### 🏠 房间

- 大厅、随机匹配、密码房、最近访问、分享链接
- **自定义封面**：房主可上传房间封面，大厅卡片同步；取消后恢复跟随当前歌曲
- 站点公告 / 房间公告（进房弹窗）、网易 / QQ / 汽水 / 酷狗漫游、主题色
- 房主转让、正式管理员、房主离线时临时控播；房间分享支持复制链接与二维码
- 可自定义贵宾等级：角标、颜色、边框、欢迎语、礼花与迎宾冷却；成员归属地
- 点歌规则、禁播、踩歌切歌
- **新房间沿用常用规则**：同一浏览器内，房主再次创建房间时会自动应用最近一次创建房间的点歌、队列与聊天设置
- **纯净模式**：隐藏动效与热榜；聊天图/贴纸可遮罩；浏览器标签页标题与图标可伪装
- **常驻房**：房主申请 → 站点管理员审核，避免空闲被自动销毁
- **身份找回（可选）**：绑定 Linux.do / GitHub，换设备或清 Cookie 后找回房主身份
- **可选账户登录**：首页可选择游客，或使用邮箱、Linux Do、GitHub 登录；一个账户可绑定多种身份，微信入口暂时预留

### 💬 互动

- 实时聊天：贴纸、发图、回复 / @ / @全体、撤回（本人限时；房主 / 管理可撤他人）
- 全员禁言 / 单人禁言；踢人、任命管理、贵宾管理
- 房间违禁词（可自定义，含默认可删词表）
- 微信表情包采集 / 表情包搜索

### 🤖 AI 功能

- **房间 AI 助手**：在聊天中 `@` 机器人或使用触发词提问，支持连续对话和按用户隔离的上下文
- **音乐操作**：可根据自然语言搜索歌曲、查看当前播放状态、管理队列，并执行房间允许的点歌与播放操作
- **图片理解**：发送歌单截图、专辑封面等图片后，AI 可先识别图片内容，再结合音乐工具继续处理
- **房间级开关**：房主或管理员可在房间设置中启用 / 停用 AI，并自定义机器人名称
- **多模型池**：管理员可配置 OpenAI 兼容接口，分别设置文本模型和视觉模型；支持模型池切换、限流与故障降级
- **可选启用**：AI 默认关闭，不配置模型 API Key 不会影响点歌、播放、聊天等基础功能

### 🌌 视觉与客户端

- 星河 / 声波地形 3D 背景、封面模糊背景、桌面沉浸模式（舞台歌词）
- Android（Flutter WebView 容器）：网页负责房间、登录与播放，原生提供通知栏 / 锁屏控件、悬浮歌词和受限工具调用
- 静默 / 强制更新提示

### ⚙️ 点歌规则（房主 / 管理员）

| 规则 | 说明 |
|------|------|
| 允许成员点歌 | 关闭后仅房主与管理员可点 |
| 允许成员插队 | 成员可对自己的点歌插队 |
| 允许拖进度 / 暂停 | 可授权成员控制播放 |
| 进房等待时间 | 新成员停留满时长后才能点歌 |
| 每人最多点歌 | 队列中每人上限，`0` = 不限 |
| 点歌冷却 | 不限制 / 10s / 30s / 60s / 120s |
| 队列长度上限 | 50 / 100 / 200 |
| 禁播歌曲 | 按歌名，跨平台均不可点 |
| 踩歌切歌 | 按人数或在线比例 |
| 退出后清除已点 | 离房超时后清除其待播 |

---

## 🛡️ 站点管理后台

部署向导会生成**随机管理员账号**和**随机管理入口**（不是固定 `/admin`），仅在完成页展示一次，请立即保存。

| 场景 | 处理 |
|------|------|
| 忘记密码 | `redis-cli DEL openmusic:admin:credentials` → 重启 → 恢复默认 `admin` / `123456` |
| 忘记入口 | 查看 `server/adminConfig.json`（Docker：`data/adminConfig.json`）的 `entryPath` |

主要能力：

- 运行配置在线生效：音源 / Meting / SVIP 音质 / 共享会员 / OAuth / 七牛 / SEO 等
- AI 配置：启用房间 AI、设置机器人名称、配置文本 / 视觉模型池、API 协议、限流参数，并提供连通性测试
- 房间管理：搜索、查看密码、解散、常驻申请审核、违规重置昵称、成员拉黑
- 全站封禁（IP / 设备）、站点公告与全局广播、错误上报、操作审计
- 管理员可额外绑定 Linux.do / GitHub 作备用登录

安全要点：扫码会话服务端托管，房间 Cookie 加密存储，Meting 强制校验 HTTPS 证书。

### AI 配置说明

1. 进入管理后台 → 运行时配置 → **AI**。
2. 开启 AI，填写 OpenAI 兼容接口地址、API Key 和模型 ID；需要图片理解时，同时配置视觉模型。
3. 使用后台的文本 / 视觉连通性测试确认配置有效。
4. 进入房间设置，开启房间 AI 并设置机器人名称；之后可在聊天中 `@机器人名称` 或使用命令菜单。

API Key 仅用于服务端请求，运行配置会进行加密存储；AI 未启用或模型不可用时，房间基础功能仍可正常使用。

### 🛠️ 首页管理入口快捷方式

首页默认不展示管理入口。本机浏览器成功访问过真实入口后，会在 `localStorage` 记住路径，顶栏出现盾牌图标便于快速进入；其他访客不可见，也不会泄露路径。

---

## 🔗 账户登录与第三方身份（可选）

首页提供“登录或创建账户”和“以游客身份继续”两种入口。账户支持邮箱密码，以及 **Linux Do、GitHub** 两种第三方身份。

1. 第三方首次登录会创建独立 OpenMusic 账户，不会按第三方邮箱自动合并已有账户。
2. 登录后可在首页“账户与安全”中绑定多个身份提供方。
3. 已绑定其他账户的第三方身份不能被抢绑；解绑时必须保留至少一种登录方式。
4. 原有房主身份找回和管理员备用登录继续保留，旧绑定不会自动迁移到账户体系。

游客仍可使用原有建房、加房和点歌功能。微信账户登录入口目前仅作预留并显示“暂未开放”；原有文件传输助手表情采集、房主微信 UIN 绑定与身份找回能力不受影响。

### 配置步骤

1. **申请 OAuth 应用**
   - Linux.do：[connect.linux.do](https://connect.linux.do) → 回调 `https://你的域名/api/auth/linuxdo/callback`（授权 / 令牌 / 用户信息地址须按官方文档填写，项目无默认值）
   - GitHub：[OAuth Apps](https://github.com/settings/developers) → Authorization callback URL 填 `https://你的域名/api/auth/github/callback`（接口地址固定，无需额外配置）
2. **填写配置**：管理后台 → 运行时配置 →「身份登录」→ 保存即时生效
3. **绑定**
   - 普通账户：首页 → 登录 → 登录后再次点击首页账户入口 →「账户与安全」
   - 房主：房间设置 →「身份」
   - 管理员：先用密码登录 → 系统设置 →「安全与账号」（接入参数在「身份登录」，绑定按钮在「安全与账号」）

> **排查**：OAuth 应用后台与本站配置中的 `redirect_uri` 须逐字符一致（协议、域名、路径、尾斜杠）。路径错误会导致回调失败或 404。

---

## 📱 Android 应用

Android 端是 **Flutter WebView 容器**，加载 OpenMusic 网页；房间、登录、播放和权限统一由网页及服务端处理

### 构建 APK

```powershell
cd mobile
flutter pub get
node scripts/build-flutter-apk.mjs --release --server-url=https://your-host
```

脚本会在打包前仅递增本机的 `mobile/.android-version.local`（已被 Git 忽略）中的可见版本号和 Android 构建号；仓库内的 `mobile/pubspec.yaml` 始终保持基线 `1.0.0+1`，新拉取项目会从该版本开始。APK 输出位置：`mobile/build/app/outputs/flutter-apk/app-release.apk`，并复制到 `server/downloads/openmusic.apk`。

### 通知栏播放

- Android 13+ 需允许通知权限，通知栏和锁屏播放控件才会显示。
- 支持播放 / 暂停、下一首和拖动进度；有控播权限时还可切换播放模式。收藏操作会同步到网页收藏。
- 通知栏会显示当前歌词。点「词」后允许悬浮窗权限，可显示可拖动的悬浮歌词；轻点歌词即可关闭。
- 所有原生操作都会回传网页，并由网页与服务端按房间权限最终裁决。
- 详情见 [`mobile/README.md`](mobile/README.md)。

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React · Vite · Tailwind CSS · Socket.IO Client · Three.js / R3F |
| 移动端 | Flutter · WebView · just_audio · audio_service |
| 后端 | Node.js · Express · Socket.IO · Redis（必需） |

---

## 📖 文档

| 文档 | 说明 |
|------|------|
| [AI 协作指南](AGENTS.md) | **开发或交给 AI 修改前必读**：项目边界、高风险区域、验证流程与禁止事项 |
| [部署文档](docs/DEPLOY.md) | 环境变量、Nginx、Docker 细节、API 速查 |
| [Meting-API](https://github.com/qq01-hub/Meting-API) | 音源 API（网易 / QQ / 汽水等），含 Docker 镜像 |
| [宝塔部署](deploy/DEPLOY-BAOTA.md) | 面板 Docker / 源码部署步骤 |
| [移动端](docs/MOBILE.md) | Flutter 工程结构与本地运行 |
| [Nginx 示例](deploy/nginx.conf.example) | 通用反代配置 |
| [宝塔 Nginx 示例](deploy/nginx.baota-optimized.conf.example) | 宝塔优化版 |

常用命令：

```bash
npm run install:all   # 安装根 / server / client 依赖
npm run build         # 构建前端 → client/dist
npm start             # 启动后端（生产）
npm run dev           # 前后端同时开发
npm run dev:electron  # 启动 Electron 客户端（需先启动前端）
npm run desktop:build # 首次输入站点地址后，单独构建 Windows 安装包 → server/downloads/
# 本机地址保存在 desktop-build.local.json（已忽略，不会上传 GitHub）
# 如需无交互构建：$env:OPENMUSIC_DESKTOP_URL='https://music.example.com'; npm run desktop:build
npm run electron:dist # desktop:build 的兼容别名
npm run package:build # 组装发版包
```

健康检查：`GET /api/health`

---

## 👥 交流群

欢迎加入 OpenMusic QQ 交流群，交流使用体验、部署问题与功能建议：

<p align="center">
  <img src="docs/community/qq.jpg" alt="OpenMusic QQ 交流群二维码" width="360" />
</p>

---

## ☕ 请作者喝一杯咖啡

如果 OpenMusic 对你有帮助，欢迎请作者喝杯咖啡，支持持续维护。

<table>
  <tr>
    <td align="center" width="50%" valign="top">
      <a href="docs/donate/wechat.png">
        <img src="docs/donate/wechat.png" alt="微信赞赏码" width="300" />
      </a>
      <br/><sub><b>微信</b></sub>
    </td>
    <td align="center" width="50%" valign="top">
      <a href="docs/donate/alipay.png">
        <img src="docs/donate/alipay.png" alt="支付宝赞赏码" width="300" />
      </a>
      <br/><sub><b>支付宝</b></sub>
    </td>
  </tr>
</table>

---

## 🙏 致谢

| 项目 | 作者 | 说明 |
|------|------|------|
| [Mineradio](https://github.com/XxHuberrr/Mineradio) | [@XxHuberrr](https://github.com/XxHuberrr) | 星河粒子、沉浸玻璃质感、舞台歌词等 |

## 🔗 友情链接

- [Linux.do](https://linux.do/) — 新的理想型社区

## ⚠️ 免责声明

本项目仅供学习与技术交流。不存储音频文件，音乐版权归相关权利人所有。请遵守法律法规及平台协议，不得用于商业用途。

## 📄 License

[MIT（附注明出处条款）](LICENSE)：可自由使用、修改、分发；公开分发或部署时须注明出处（项目名「OpenMusic」及原始仓库链接）。
