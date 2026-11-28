# 巨型文件拆分方案（批 5 评估，未动工）

> 状态：**仅评估**。本文只给拆分边界、顺序与验证方式，不含代码变更。
> 背景：批 5 审计确认三个巨型文件占各自层的大头——`server/index.js` 8,121 行、
> `server/roomManager.js` 7,239 行、`client/src/pages/Room.tsx` 5,329 行。
> 拆分必须单独立项、逐个文件分多步做，禁止与其他批次混做，禁止一次性大爆炸重写。

## 通用原则

1. **行为不变**：拆分只搬代码，不改协议（HTTP 路径、Socket 事件名/字段、Redis 键、错误码）、不改执行顺序语义。
2. **沿用既有先例**：server 侧已有 `mountSetupApi(app)`、`mountAdminApi(app, deps)` 两个成功的挂载式拆分先例，新模块一律采用 `mountX(app, deps)` / `registerXHandlers(ctx)` 形态，依赖以参数注入，不新增全局单例。
3. **每步可独立回滚**：一步只搬一个职责块；每步完成后跑该文件对应验证（见各节末），绿了才进下一步。
4. **先补测试再拆**：批 5 已补 adminApi/setupApi/roomStorage/accountTokens 测试；拆到哪块，先确认那块有回归测试或冒烟脚本再动。

---

## 一、server/index.js（8,121 行）

### 现有职责块（按行号）

| 行段 | 内容 |
|---|---|
| 1–465 | 约 90 条 import、环境/常量（ALLOWED_ORIGINS、静态目录、信任代理判定）、OAuth 回调分发约定注释（L332） |
| 466–650 | `createServer(app)`、CORS、JSON body、账户请求守卫中间件、`mountSetupApi(app)`（L623） |
| 651–1445 | 基础设施 helper：clientIp/设备身份解析、限流器族（`createRateLimiter` 与 20+ 个实例）、Meting URL 构造、媒体签名/缓存 helper |
| 1446–1655 | 公共 HTTP 路由：health、site-announcement、donations、site-seo、app-version、music-account-contribution（扫码贡献/绑定/撤销/共享） |
| 1656–2768 | 音乐 HTTP 路由：hot/suggestions/toplist、netease 歌单、sources、quality、lyrics translate、`/api/meting`、qishui-source、media-proxy、kugou、song-link、playlist/import |
| 2769–4044 | 会话与账户 HTTP 路由：session/bootstrap、device-login/migrate、human-challenge、邮箱验证码/注册/改密/登录/绑定（2963–3205）、auth session/refresh/logout/delete、nickname、OAuth 三套（linuxdo 3493–3692、github 3695–3890、wechat/wechat-uin 3398–3967）、error-reports、permanent-decisions |
| 4045–4507 | 房间与账户资产 HTTP 路由：rooms 列表/随机匹配/创建、account/rooms claim、account/music-accounts、favorites/sync、rooms/:id/cover、chat 配置/贴纸搜索/上传 token |
| 4508–4776 | 下载与静态托管：downloads（apk/exe）、robots/sitemap、SPA index、预压缩静态（/assets、/vendor）、express.static、SPA splat fallback |
| 4777–5430 | 管理入口页托管、Socket 会话缓存 sweep 定时器（L4985）、`mountAdminApi`（L4992，返回值解构出 OAuth 回调处理器）、`io.use` 会话校验中间件（L5391） |
| 5431–8004 | `io.on('connection')` 单个巨型处理函数，内含 **84 个 `socket.on`**：join/成员（1–9）、房间设置（10–44）、队列与播放（45–61）、聊天（62–69）、收藏（70–81）、播放控制（82–83）、disconnect（84） |
| 8005–8121 | 全局定时器（500ms checkAutoAdvance 等）、账户删除重试定时器、gracefulShutdown、启动 listen |

### 建议拆出模块

| 新文件 | 搬入内容 | 注入依赖 |
|---|---|---|
| `server/httpRateLimits.js` | L651–1445 中的限流器族与 `createRateLimiter` | 无（纯工厂） |
| `server/routes/publicRoutes.js` | health/announcement/donations/seo/version + downloads + robots/sitemap | runtimeConfig、seoFiles |
| `server/routes/musicRoutes.js` | 1656–2768 全部音乐路由 + Meting/media helper 中仅路由用到的部分 | metingUpstream、mediaProxy、customMusicApi、限流器 |
| `server/routes/authRoutes.js` | 2769–4044 会话/邮箱/OAuth/error-reports | accountAuth、accountTokens、各 OAuth 模块、riskControl |
| `server/routes/roomRoutes.js` | 4045–4507 房间与账户资产路由 | roomManager、accountRooms、favorites 系列 |
| `server/staticHosting.js` | 4508–4776 静态/SPA/预压缩托管与管理入口页 | adminConfig、seoIndexHtml |
| `server/socket/roomSettingsHandlers.js` | connection 内事件 10–44（房间设置类） | ctx（见下） |
| `server/socket/queuePlaybackHandlers.js` | 事件 45–61、82–83（队列/播放/控制） | ctx |
| `server/socket/chatFavoriteHandlers.js` | 事件 62–81（聊天/收藏） | ctx |
| `server/socket/joinHandlers.js` | 事件 1–9 + disconnect（进房/成员/通知 ack） | ctx |

Socket 侧统一上下文对象 `ctx = { io, socket, socketToRoom, socketToUserId, getClientIp, broadcastRoomUpdate, … }`，
由 connection 回调组装后传给各 `registerXHandlers(ctx)`；`io.use` 中间件与会话 sweep 留在 index.js 不动。

### 拆分顺序与验证

1. **限流器族**（纯工厂、零状态共享）→ 验证：`npm test --prefix server` 全绿 + ESLint。
2. **静态托管 + 公共路由**（不触碰会话）→ 验证：全绿 + `GET /api/health`、`/robots.txt`、SPA 首页冒烟。
3. **音乐路由** → 验证：全绿 + `/api/music/sources`、`/api/meting` 冒烟（需 Redis/Meting 的环境手测一次）。
4. **账户/OAuth 路由** → 验证：全绿（含批 5 新增 accountTokens/adminApi 测试）+ 登录/刷新/登出冒烟。
5. **房间 HTTP 路由** → 验证：全绿 + 建房/列表/claim 冒烟。
6. **Socket 处理函数按域拆分**（最后、最险）→ 验证：全绿 + Socket 冒烟脚本覆盖 join_room → add_song → send_chat → seek → disconnect 全链路，并核对事件注册顺序与拆分前一致（打印 `socket.eventNames()` 对比）。

### 风险点

- **循环依赖**：路由模块需要 index.js 中的 helper（如 clientIp、限流器）时只走参数注入或先下沉到独立模块，禁止反向 import index.js。
- **共享可变状态**：`socketToRoom`/`socketToUserId` 两张 Map 被 HTTP 路由（adminApi 注入）与 Socket 处理函数共用，拆分时必须保持同一实例引用传递，不许模块内复制。
- **注册顺序**：`mountAdminApi` 的返回值（OAuth 回调处理器）被后续 auth 路由依赖，挂载顺序不可变；`io.use` 必须在任何 connection 处理前注册。
- **限流器实例唯一性**：限流器族是进程内状态，拆出后仍须单例（模块级单例或注入同一实例），拆成多实例会让限额成倍放大（与审计 L1 同类问题）。

---

## 二、server/roomManager.js（7,239 行）

### 现有职责块（按行号）

| 行段 | 内容 |
|---|---|
| 1–253 | 常量与归一化：播放速率/模式、聊天上限、房间/用户结构默认值 |
| 254–566 | 回调注册（setOnRoomPrefetchReady 等）、音乐账号归一/合并、房间密码校验规则 |
| 567–857 | 密码验证与房主找回（设备恢复）、访问封禁判定 |
| 858–1255 | 快照与持久化：snapshotRoomForStorage、persistRoom（L1115，合并写）、initRooms/restore、空房清扫定时器（L1209） |
| 1256–1891 | 播放状态构建：buildQueueSnapshot/buildPlaybackState、共享播放媒体、封面资产、预取 |
| 1892–2302 | 播放参数：速率/汽水代理归一、FM 与选歌辅助 |
| 2303–2599 | 房间生命周期：createRoom、空房复用、listRooms、随机匹配 |
| 2600–2983 | 管理侧与查询：listRoomsForAdmin/Detailed、常驻申请审核、adminDestroyRoom、广播、getRoom/getRoomPublic、addUser 起始 |
| 2984–4193 | 成员与房间设置：rename/lock/admin/roaming/FM/音乐账号缓存/playMode/tier/AI 设置/公告/封面/禁歌/违禁词等约 30 个 setX |
| 4194–4641 | 成员管理：改名/头像/踢人/转让/找回/移除 + addToQueue 入队 |
| 4642–4948 | 队列操作：like/dislike/remove/clear、随机与漫游选歌（selectRandomFavoriteSong/selectPlaylistRoamingSong） |
| 4949–5440 | 播放推进核心：playNext/ensurePlayback/随机装载重试 |
| 5441–6257 | 切歌与审批流：skipSong、AI 代操作族（OnBehalfOf）、finish/advance、setPlaying/seekTo、jump/skip 申请-审批 |
| 6258–7033 | 聊天：reaction/addChatMessage/share/bot 消息、AI 快照、recall、history、时长上报 |
| 7034–7239 | 广播与序列化：prepareRoomBroadcast/roomUpdateForViewer/presence、serializeRoomForViewer、getRoomInternal、persistRoomById、账户认领 |

### 建议拆出模块

核心约束：全文件围绕单个 `rooms` Map（L554）与 `persistRoom` 写合并管线运转，
直接按函数搬家必成循环依赖网。先建底层，再逐域上移：

| 顺序 | 新文件 | 搬入内容 | 说明 |
|---|---|---|---|
| 1 | `server/roomCore.js` | `rooms` Map、persistRoom/快照/initRooms（858–1255）、getRoomInternal、序列化（7034–7239） | 只依赖 roomStorage/roomChatStorage，成为唯一底层；其余模块单向 import 它 |
| 2 | `server/roomPlayback.js` | 1256–2302 状态构建与播放参数 + 4949–5440 推进核心 + 5441–6257 切歌/审批/AI 代操作 | 播放域自洽，依赖 roomCore |
| 3 | `server/roomQueue.js` | 4642–4948 队列操作与选歌 | 依赖 roomCore，选歌函数为纯函数可先行 |
| 4 | `server/roomMembers.js` | 2984–4641 设置与成员管理 | setX 函数形态统一，批量搬 |
| 5 | `server/roomChat.js` | 6258–7033 聊天域 | 已有 roomChatStorage 分层，搬家成本最低，可与第 2 步对调 |
| 6 | `server/roomLifecycle.js` | 2303–2983 建房/列表/管理侧 | 最后搬，此时 roomManager.js 只剩 re-export 兼容层，观察一版后删除 |

兼容策略：拆分期间 `roomManager.js` 保留为**转发层**（`export { … } from './roomPlayback.js'`），
index.js/adminApi.js 等十余个调用方的 import 路径不变；全部搬完再统一改路径。

### 拆分顺序与验证

每步：`npm test --prefix server` 全绿（现有 roomOwnership/playbackOrder/roomStorageChat/roomChatStorage 等测试是主要回归网）
+ 建房 → 入队 → 切歌 → 聊天 → 重启恢复 的手测冒烟（需 Redis 环境）。
纯函数（选歌/归一化）先搬，带状态的（persist/推进）后搬。

### 风险点

- **循环依赖**：播放推进会回调聊天（系统消息）、成员（权限判定）；用 roomCore 做唯一底层 + 事件回调注册（沿用现有 setOnRoomPrefetchReady 模式）解耦，禁止域模块互相 import。
- **persist 时序**：persistRoom 的合并写与快照时点是并发正确性的一部分，搬家时不得改变调用点与 await 关系；restore/initRooms 的启动顺序（index.js 启动链）不可变。
- **状态同一性**：`rooms` Map 只能有一份；转发层期间尤其要防双份模块实例（路径写法不一导致 Node 加载两份）。

---

## 三、client/src/pages/Room.tsx（5,329 行）

### 现有职责块（按行号）

| 行段 | 内容 |
|---|---|
| 1–129 | 约 94 条 import |
| 130–302 | 懒加载组件注册表（约 25 个 `lazyWithRetry`：PlayerPage/ChatPanel/QueuePanel/各 Modal/沉浸壳等）、收藏导入解析工具（207–258）、两个 memo 桥组件（RoomOnlineUsersBridge/RoomOnlineCountBadge，276–302） |
| 303–~1500 | 主组件前半：进房与密码流（311–417 的 useState 群、URL 密码处理）、roomStore 订阅（useShallow 快照）、socket/播放器 hook 接线、收藏导入与试听收尾 effects |
| ~1500–3575 | 主组件后半：队列/播放/聊天事件处理回调群、纯净模式与视觉效果 effects、键盘快捷键、各类派生状态（约 134 处 hook 调用密集分布于 303–3575） |
| 3576–5329 | 主 JSX：顶栏/播放器区/队列-聊天-成员面板布局、全部 Modal/Drawer 条件挂载、沉浸模式壳 |

### 建议拆出模块

先抽 hook（状态逻辑），后拆 JSX（展示），顺序不可反：

| 顺序 | 新文件 | 搬入内容 |
|---|---|---|
| 1 | `src/hooks/useRoomPasswordJoin.ts` | 密码进房状态机（passwordDraft/needsPasswordPrompt/URL 密码消费） |
| 2 | `src/hooks/useFavoritesImport.ts` | 收藏 JSON 解析与批量导入（207–258 工具 + 组件内导入回调），工具函数先落回 `src/lib/favoritesImport.ts` |
| 3 | `src/hooks/useRoomShortcuts.ts` / `usePureModeGuard.ts` | 键盘快捷键、纯净模式自动关闭等自洽 effects |
| 4 | `src/components/room/RoomModals.tsx` | JSX 中全部 Modal/Drawer 挂载段，props 只传开关与回调 |
| 5 | `src/components/room/RoomLayout.tsx` | 主布局 JSX（顶栏+三面板），数据仍走 roomStore 选择器订阅，不做 props 钻取 |

懒加载注册表（130–302）保持在 Room.tsx 内不动——它是代码分割的静态锚点，搬动会改变 chunk 边界。

### 拆分顺序与验证

每步：`npm run typecheck` + `npm test`（含 check:room-visuals、antd 边界）+ `npm run build:check`，
并对比 dist 总体积与首屏 modulepreload 不回升（批 4 基线：dist 9.3M、首屏 7 项无 antd）；
UI 步另加桌面/窄屏各一次手测（进房、点歌、切歌、开设置弹窗、沉浸模式进出）。

### 风险点

- **hook 顺序与闭包**：主组件 134 处 hook 调用存在隐含顺序依赖，抽 hook 时必须整段搬移同一状态簇，禁止跨步拆一半。
- **zustand 选择器同一性**：useShallow 快照与 memo 桥组件（276–302）依赖引用稳定，拆 JSX 时不得改订阅粒度，否则重渲染面扩大。
- **懒加载边界**：Modal/Drawer 拆到 RoomModals 后仍须保持 `lazyWithRetry` 动态导入，不许变成静态 import 把 antd 邻接组件或大组件拉回首屏。

---

## 总排期建议

index.js（6 步）→ roomManager.js（6 步）→ Room.tsx（5 步），三者串行、互不并行；
每完成一个文件的一步就发一个独立 PR，标题注明「拆分第 N 步：搬 X 到 Y」，diff 应以纯搬移为主，
评审时用 `git diff --color-moved` 核对无逻辑改动。总预估每个文件 2–4 个 PR。
