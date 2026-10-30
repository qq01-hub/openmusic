# WebView Shell

此移动端已是纯 WebView 容器，启动后直接加载 Web 页面：

首页及公开房间列表可在未登录时浏览，加入房间、点歌和播放默认要求先登录 OpenMusic 账户；后台开启「允许匿名登录」后，网页通过现有 HttpOnly 设备 Cookie 和 Redis 绑定建立游客身份，可使用房间、点歌、播放及 Redis 收藏，原生端不能自报身份或绕过服务端权限，账户受限时仅音乐 URL 取链返回指定替代曲，其他业务仍拒绝，桥接命令名和字段不变，升级后刷新网页资源，不要清除 Cookie、WebView 存储或应用数据

匿名开关默认关闭，`GET /api/auth/session` 在未登录响应中追加可选 `anonymousAllowed` 布尔值，`authenticated` 仍为 `false`；开启后 bootstrap 可返回当前游客 `clientId` 和公开音源能力，不返回账户凭据或登录私钥，旧网页可继续要求账户登录，原生壳无需新增命令

匿名身份仍受站点封禁、房间权限、风控额度和异常访问验证约束，关闭开关后服务端拒绝匿名请求并在下一次 Socket 操作或最长 30 秒的会话检查时断开；匿名昵称不写入账户记录，匿名收藏由 Redis 持久化，清除设备 Cookie 或换设备不自动找回，跨设备同步仍需账户登录

旧游客首次登录时，服务端通过仍有效的签名身份或 HttpOnly 设备 Cookie 对应的 Redis 绑定恢复可验证的归属，再迁移收藏与房间，本地收藏和分类在登录后补导入，成功前保留缓存，原生端不能用缓存 clientId/deviceId 作为身份恢复授权

网页登录改用服务端非对称签名的三天访问令牌，刷新凭证在首次登录 30 天内通过 HttpOnly Cookie 无感轮换，原生端不得获取、保存或通过桥接传递私钥和刷新凭证，续期后的 Socket 重新握手仍由网页完成，超过刷新期限必须重新登录

服务端会断开访问令牌过期的空闲 Socket，并周期复核会话撤销与账户限制，网页先静默恢复有效登录和房间连接，临时网络失败不清除原房间，原生端无需新增命令或自行重传凭据

微信通用代理同样要求账户登录，未登录微信首登仅允许专用 `/api/auth/wechat/start`、`/qr`、`/poll`、`/account` 链路，文件传输助手 UIN 由服务端向微信核验，不接受原生桥接或网页自报 UIN/openid，历史微信身份索引保持不变

新增接口盒子聚合扫码登录使用独立 `/api/auth/social/{wechat_scan|qq_scan}/{start|poll|complete}` POST 链路，请求体包含 `action: login|bind`，轮询与完成还须包含 `flowId`，凭据保存在服务端 Redis 与 HttpOnly Cookie，绑定请求复用现有设备签名校验，不接受客户端自报 openid

展示顺序为微信扫码登录、QQ扫码登录、微信文件传输助手登录，前两项由后台独立开关控制，新微信 `wechat_scan` 的 openid 与历史 `wechat` 的 UIN 独立，已有账户须在账户管理中显式绑定，原生桥接命令不变，二维码内嵌展示不依赖外部回调唤起

聚合微信与 QQ 二维码显示后不再定时查询，手机确认后由用户点击「我已完成扫码，检查登录」，检查期间禁用重复操作，普通检查间隔至少 7 秒，上游限流冷却 60 秒，恢复按钮与二维码到期提示仅使用本地计时，不自动发起网络请求，原生壳无需新增命令

首页封面通过受限的 `GET /api/meting?type=pic` 公开读取，普通歌曲信息、歌词、播放地址和通用媒体代理继续鉴权，原生端无需新增桥接命令
微信扫码轮询遇到短暂网络故障由网页有限重试，完成登录的确认凭证仅在服务端写入成功后消费，过期或拒绝仍需重新扫码

```bash
flutter run --dart-define=OM_SERVER_URL=https://your-host
```

当前房间页通过 `flutter_inappwebview` bridge 自动报送 Android 通知栏媒体状态，并响应 `play`、`pause`、`seek`、`next`、`lyrics`、`toggleMode`、`toggleFavorite`。通知栏的按钮、进度拖动与模式切换都依赖网页同步的权限字段；网页和服务端仍负责最终权限校验。Android 13 及以上首次播放需允许通知权限；悬浮歌词还需要系统悬浮窗权限。

系统音频焦点中断只暂停本机跟播，不修改房间 `isPlaying`，也不由后台同步、回到前台或系统媒体 `stop` 自动抢回音频输出；浏览器后台收到的媒体 `pause` 无法可靠区分外部抢占与耳机暂停，因此仅中断本机，需点击网页开启声音或有权限的系统播放键主动恢复

iOS 网页配置音频时尝试将 `navigator.audioSession.type` 设为 `playback`，普通直链播放使用原生 audio；iOS 酷狗播放链使用现有同源媒体代理后，才在用户手势唤醒 `AudioContext` 后接入增益输出。房主开启汽水同源代理且浏览器本地解密得到 blob 后，同样接入增益输出；普通汽水本地解密、跨源兜底和其他直链不接入 Web Audio。现有沉浸频谱模式仍按同源代理接入，音量与频谱复用同一媒体源，加载前设置 `crossOrigin=anonymous`，仅接入同源或本地 blob 音频

iOS 增益输出下本机静音保持媒体元素未静音，以极小非零增益维持输出管线；关闭系统播放绑定或没有暂停权限时，网页系统媒体的 `play` 和 `pause` 只切换本机静音与恢复原音量，房间正在播放时刷新系统媒体播放状态，房间暂停时不因此续播或更改房间状态；切歌时已授权或已正常播放的音频跳过解锁探测，探测成功不再额外暂停，metadata 到达后立即刷新待处理进度快照，桥接字段和命令名不变

网页上报原生媒体状态的 `playing` 同时考虑房间状态与本机焦点中断，桥接字段和命令名不变，已有权限校验仍然生效

搜索点歌沿用 Socket `add_song`，可选布尔字段 `jump: true` 表示点歌并插队，省略时保持原行为；服务端一次校验点歌规则、连接归属及房间 `memberJumpEnabled`，默认仅房主和管理员可用，普通成员需在房间设置中开启「允许成员插队」；服务端生成可选队列标记 `jumpNext` 并持久化，消费时清除，使本次下一首请求优先于单曲循环或收藏随机但不切换原播放模式，旧队列缺省为无此请求，客户端不得自行提供该标记

当前曲点赞复用 `toggle_queue_like` 与 `queueId`，仅在房间成员身份下操作；新增可选快照字段 `currentLikedByIds` 单独计数，不影响待播 `likedByIds` 排序，循环回收时清空，旧快照缺省为空，旧客户端可忽略该字段

房间快照和 `set_room_song_request` 追加可选布尔字段 `queueLikeSortEnabled`，缺省为开启，仅房主或正式管理员可修改；关闭时待播点赞仍计数，服务端排序忽略点赞，插队和手动排序继续优先，原生桥接命令不变

漫游由服务端向音乐接口请求，网页经 Socket 接收结果；快照追加可选 `randomError` 提示，失败等待重试时 `randomLoading` 为 `false`，网页显示失败提示，服务端约 30 秒后自动重试，旧网页可忽略该字段，原生端无需自行请求或重试

正式版只接受 HTTPS `OM_SERVER_URL`，且 Android Manifest 禁止明文流量；debug/profile 使用 local flavor 时仍可连接本机或局域网 HTTP 服务。配置值必须是纯 Origin，不能包含账号、路径、查询参数或片段。

WebView 只把配置的站点 Origin 视为可信页面。普通外链交给系统浏览器，非 HTTP(S) 导航会被拒绝；Linux.do / GitHub OAuth 只能从本站既有 `/api/auth/*/start` 或后台授权起点进入短时 HTTPS 流程。任何非本站顶层页面都不能调用下列桥接，也不能接收原生通知栏发出的播放命令。原生端会在受信**顶层**页面文档开始时注入一次性 `window.__OPENMUSIC_NATIVE_BRIDGE_TOKEN__`；所有桥接 payload 必须携带 `bridgeToken`。跨域 iframe 不会获得该令牌；本站的 Sonic Workshop iframe 额外以 `sandbox="allow-scripts"` 运行，形成 opaque origin，因而不能读取顶层页面令牌。新增同源 iframe 时也必须采用等效隔离，或改为独立 Origin。

汽水二次验证的完成消息只接受对应 iframe 的 `contentWindow`，不能仅按 Origin 信任；鸿蒙媒体桥接模式下移除 `allow-same-origin`，形成 opaque origin；其他环境保留既有 sandbox 权限，不能视为与 opaque 隔离等效，相关 Android 隔离风险需另行审计；Sonic Workshop 的 ES module 静态资源需精确返回 `Access-Control-Allow-Origin: null`（不允许凭据）

```js
window.flutter_inappwebview.callHandler('omPlayerState', {
  bridgeToken: window.__OPENMUSIC_NATIVE_BRIDGE_TOKEN__,
  title: song.name,
  artist: song.artist,
  cover: song.pic,
  playing: player.playing,
  position: player.currentTime,
  duration: player.duration,
  canPause: permissions.canPause,
  canSkip: permissions.canSkip,
  canSeek: permissions.canSeek,
  lyric: currentLyric,
  playMode: room.playMode,
  playModeLabel: playModeLabel,
  canChangeMode: permissions.canChangeMode,
  favorited: isFavorite,
});

window.addEventListener('omNativePlayerCommand', ({ detail }) => {
  if (detail.action === 'play') player.play();
  if (detail.action === 'pause') player.pause();
  if (detail.action === 'seek') player.seek(detail.time);
  if (detail.action === 'next') nextTrack();
  if (detail.action === 'lyrics') openPlayerLyrics();
  if (detail.action === 'toggleMode') changePlayMode();
  if (detail.action === 'toggleFavorite') toggleFavorite();
});
```

`lyrics` 仅是当前可显示的歌词文本；没有歌词时传空字符串。`toggleMode` 必须由网页先检查控播权限，`toggleFavorite` 只操作当前用户自己的收藏。原生端的「词」按钮会在未授权时引导到悬浮窗权限页，获准后显示紫色桌面歌词浮窗；浮窗可拖动，点击歌词时显示「锁定 / 解锁 / 关闭」按钮并在无操作 3 秒后自动隐藏，可通过「锁定 / 解锁」切换位置锁定，锁定后必须先解锁才能移动或关闭。

网页可调用的 Android 原生工具是受限白名单，避免把任意 Intent 暴露给不可信页面：

```js
const bridgeToken = window.__OPENMUSIC_NATIVE_BRIDGE_TOKEN__;
await window.flutter_inappwebview.callHandler('omNative', { action: 'vibrate', bridgeToken });
await window.flutter_inappwebview.callHandler('omNative', { action: 'share', text: '...', bridgeToken });
await window.flutter_inappwebview.callHandler('omNative', { action: 'openExternal', url: 'https://...', bridgeToken });
```

`openExternal` 只允许 `http` 或 `https` URL；分享文本最长 2000 个字符。

## HarmonyOS ArkWeb 壳

`harmony/` 为独立 ArkTS + ArkWeb Stage 工程，上文的 Flutter 及 Android 原生工具契约继续只适用于 Android 壳，鸿蒙不模拟 Flutter 接口，而是新增受限的媒体状态接口

鸿蒙壳使用打包资源 `server_url` 配置 HTTPS 纯 Origin，默认留空并显示配置提示，复用网页与服务端的登录、房间、队列、聊天、收藏和前台播放，不另建身份或收藏存储，也不读取刷新凭据

普通顶层导航限定本站，主框架用户手势触发的外部 HTTPS 链接交系统浏览器，GitHub / Linux.do OAuth 仅从本站既有授权起点开启五分钟 HTTPS 导航窗口，返回本站后关闭，iframe 不得开启 OAuth 窗口或拉起系统应用

只向受信顶层页面注入 `__OPENMUSIC_HARMONY_TOKEN__`，每次主框架导航撤销旧令牌并清理媒体，加载完成后重新握手，令牌不代表用户身份，不进入 URL、日志、服务端或持久化存储

网页通过 `window.__OPENMUSIC_HARMONY_PLAYER__.updateState(JSON.stringify({ v: 1, token, seq, state }))` 上报，`seq` 在当前令牌内严格递增，单条消息最多 4096 字符，非清理消息最多每 100 毫秒接受一次

`state` 为 `null` 表示离房清理，否则只接受 `trackId`、`title`、`artist`、`playing`、`position`、`duration`、`canPause`、`canSkip`、`canSeek`，网页时间单位为秒，原生转换为毫秒，标题和歌手各不超过 256 字符，原生不获取音频 URL、账户 Cookie 或远端封面

鸿蒙进度上报优先读取当前队列项的房间播放时钟，不依赖界面动画帧缓存；没有匹配的播放时钟时保留原有回退，避免切歌时使用上一队列项的时间轴，暂停与拖动遵循既有播放状态

原生音乐卡片回传 `omNativePlayerCommand`，附带 `source: 'harmony'`、`token`、`trackId` 及 `action`，动作包括 `play`、`pause`、`next`、`seek`、`stopLocal`，网页复核当前令牌、歌曲和即时权限，前三类播控与进度仍走现有网页及服务端校验，`stopLocal` 仅停止本机播放，不广播整房暂停

Android 原有事件字段与动作保持兼容，鸿蒙不注入 `flutter_inappwebview` 或 Android 令牌，普通浏览器和 Android 不发送鸿蒙状态

`__OPENMUSIC_HARMONY_APP__` 是文档开始时注入的公开平台标识，不是认证凭据，仅用于让鸿蒙环境的同源汽水验证 iframe 去掉 `allow-same-origin`，保持 opaque origin，Sonic Workshop 的既有隔离不变，新同源 iframe 也必须隔离，不能依靠桥接令牌代替 DOM 同源隔离

音乐卡片由 AVSession 管理，切歌复用会话，后台任务仅在网页报告播放且 ArkWeb 音频事件确认播放时申请，暂停或音频中断释放后台任务但保留会话，离房、导航和销毁清理会话，系统回收任务与用户主动取消分别处理，不强制对抗用户关闭卡片

播放和暂停保持系统要求的事件订阅，但权限不足时拒绝执行并提示，下一首和进度拖动按权限注册，系统显示了按钮不代表拥有房间控制权

保留正常 Cookie 和网页存储，拒绝混合内容和无效证书，网络重试返回首页而非重放授权回调，不清除账户数据，本版不支持桌面悬浮歌词，实际音乐卡片展示和熄屏连续播放必须完成真机验收

构建前置条件与尚待完成的鸿蒙设备验收见 [鸿蒙工程说明](../harmony/README.md)，已同步更新 `client/src/lib/userGuide.ts` 的播放器指引，发布顺序为先兼容网页、再鸿蒙包，无服务端数据迁移

### 账户昵称兼容

账户昵称由服务端账户记录保存，登录和会话响应追加可选 `account.nickname`，`join_room` 和 `rename_user` 成功响应追加可选 `accountNickname`，原事件名、字段和桥接命令保持兼容

网页在首页编辑结束或房间内改名时保存昵称，重连与换设备以账户昵称恢复，房间内重名的数字后缀仅用于展示，WebView 不以本地昵称缓存作为账户权威数据，无需新增原生命令

音乐会员在已登录账户中加密保存，新建或复用房间时从账户恢复为私有账号，绑定保存失败返回 `ACCOUNT_MUSIC_SAVE_FAILED`，创建时恢复失败返回 HTTP 503 和 `ACCOUNT_MUSIC_RESTORE_FAILED`，不得视为创建成功后清空本机设置，重试创建可复用已创建的空房间；开启匿名登录时沿用原设备 Cookie 身份和房间扫码、绑定、列表、解绑接口，会员凭证仅在服务端加密缓存，同一身份重建房间可恢复，清除 Cookie 或换设备不能自动找回，匿名解绑会清理该平台缓存，关闭匿名登录后拒绝后续匿名操作；匿名保存失败返回 `MUSIC_COOKIE_CACHE_SAVE_FAILED`，恢复失败返回 HTTP 503 和 `MUSIC_COOKIE_CACHE_RESTORE_FAILED`，登录正式账户时可迁移已核验的旧设备缓存，不覆盖账户已有或主动删除的会员，旧房间补存不复活删除记录，无新增桥接命令或原生包迁移

### iOS 网页音量兼容

iPhone 和 iPad 的房间播放、试听和聊天音乐卡片统一使用 Web Audio 输出链路，共享音频在首次创建与重建时立即接入，不依赖曲目响度、主题或切歌钩子，用户音量与曲目响度补偿只相乘一次，音量为零时同步设置媒体静音，调高后解除静音，试听和聊天音乐卡片各自使用独立增益

iOS 普通音乐外链保留原生直链播放，酷狗和已启用的视觉代理按既有媒体代理规则取链，本站地址和 blob 保持原样；直链模式下音量调节受 iOS 系统限制，音量为零使用媒体元素静音；汽水继续在浏览器 Worker 本地解密为 blob，房主启用汽水同源代理时仅通过媒体代理转发密文并在解密后的本地播放链路接入 Web Audio，服务端不参与解密，代理鉴权、限流和目标限制保持不变

首次播放仍遵守用户手势授权，暂停待播时的用户点击也会恢复已创建的音频上下文，首次创建试听输出时在异步取链前发起恢复，兼容标准与 webkit 前缀的 AudioContext，iPad 桌面 UA 按触摸设备识别，Android、鸿蒙与桌面普通播放保留原有元素音量控制，无新增桥接字段或原生命令

发布需升级网页资源，服务端沿用现有代理接口与配置，注意 iOS 代理流量增加，iOS 27.2 Safari 真机的静音、切歌、锁屏与蓝牙输出仍需验收，回滚网页版本恢复原音量路径


### iOS 系统媒体

iOS 继续使用同一 WebView、可信顶层来源和桥接令牌校验，不新增网页事件、账户凭据或服务端字段，原有 Android 和鸿蒙协议保持兼容

`com.openmusic.app/native` 在 iOS 隐式 Flutter 引擎初始化时注册，`requestNotificationPermission` 无操作返回，`updatePlaybackNotification` 只在本机播放状态由暂停变为播放时激活 `AVAudioSession.playback`，不根据周期上报持续抢焦点，`clearPlaybackNotification` 释放原生会话，外部链接仍限定用户手势及 HTTPS

歌曲信息、封面、进度与锁屏／控制中心操作由现有网页 Media Session 提供，不在原生侧重复注册 MPRemoteCommandCenter 或播放远端音频，不额外请求封面或获取 Cookie，权限裁决继续由网页及服务端完成

保留 `UIBackgroundModes: audio`，补齐现有 SceneDelegate 的场景声明，最低系统版本仍为 iOS 15，后台音频能力不等于保证网页永不被系统挂起，不增加静音保活或自动抢音频焦点逻辑

iOS 系统媒体能力仍需在真机验收锁屏、控制中心、耳机、通话中断、权限拒绝、离房清理及后台切歌，Windows 检查不能替代此验收，无服务端或 Redis 迁移，回滚移动端包和对应网页资源即可

## 异常访问人机验证兼容性

待验证时服务端断开该账户的现有 Socket 并拒绝新握手，网页暂停自动重连与入房重试；验证通过后恢复连接，管理员放行后可点击刷新验证状态恢复，切回页面也会复核待验证状态，断线期间的修改请求不自动补发

站点开启异常访问验证后，受保护资源可能返回 `403 ACCOUNT_HUMAN_CHECK_REQUIRED`，Socket 操作可能收到同名错误码及 `account_human_check_required` 通知，网页使用 Turnstile `risk_challenge` 完成验证，原生桥接不获取令牌、不代替服务端判定，也不自动重放被拒的点歌或其他修改操作

原生桥接命令与播放状态字段不变，刷新凭证仅用于恢复网页会话，不清除待验证轮次，旧网页缺少验证界面时仍被服务端安全拒绝，更新网页后再完成验证，Android/iOS/鸿蒙 WebView 的 Cloudflare 可达性和交互仍需真机验收


### 设备持有证明

网页使用安全上下文中的 WebCrypto P-256 不可导出私钥，并由 IndexedDB 持久化，原生桥接不得导出或代传私钥
取链、歌曲信息、搜索、续期、风险验证码及 Socket 握手由网页签名，新协议错误为 ACCOUNT_DEVICE_PROOF_REQUIRED、ACCOUNT_DEVICE_PROOF_REPLAY、ACCOUNT_DEVICE_RATE_LIMITED
设备证明失败先复核会话，旧未绑定会话自动迁移；已绑定密钥失配或重放仍拒绝，限流错误等待后重试，已绑定会话不得降级为只携带 Cookie
旧有效会话未绑定公钥时自动迁移，同一公钥重复迁移幂等成功，已绑定公钥不得覆盖；清除 WebView 站点存储会失去设备密钥并需要重新登录
旧网页无设备证明能力时，未绑定会话仍可按原登录、续期和 Socket 协议使用，最长不超过首次登录后的 30 天绝对期限，刷新与重启不延长；新版网页自动绑定后强制设备证明，旧版本不能对已绑定会话降级
原生媒体播放和 /api/media-proxy 仍使用现有账户鉴权与额度，不携带设备签名，已取得的媒体地址不属于本轮可收回范围
Android、Harmony WebView 的密钥持久化、后台恢复与第三方授权返回仍需真机验收，本轮浏览器测试不能替代真机结果

取 URL、汽水源信息和歌曲详情共用账户级取链额度，HTTP 429 / ACCOUNT_RATE_LIMITED 时按 Retry-After 等待，不清除会话，不立即循环重试；音频下载与桥接字段不变

GitHub / Linux.do 账户登录由网页签名请求授权入口后再跳转，不依赖临时设备 Cookie，仍必须保留 OAuth state Cookie；微信 WECHAT_OFFICIAL_INIT_UNAVAILABLE 表示确认后初始化重试耗尽，应重新获取二维码，不能自动重放旧扫码票据，原生桥接不变

微信 start 新增非凭据 flowId，网页在二维码图片、poll 与 account 完成请求中传递；WECHAT_LOGIN_REPLACED / 409 表示轮次被刷新或其他页面替换，停止旧轮次并提示重新获取二维码，不自动重试，不改变原生桥接

一键点歌使用 add_songs Socket 事件，payload 为 {songs: Song[]}，每批 1–100 首，ack 返回 success / added / skipped / failed，先发布服务端再更新网页，旧 add_song 保留；禁止超时后自动重放批次，重试前由当前队列去重，原生桥接不变
Socket 每次握手前恢复账户会话及身份 Cookie，服务重启或网络暂不可用时保留房间入口并退避重试，真实撤销、封禁和失效仍按服务端处理

设备密钥在 IndexedDB 中按当前 origin（协议、主机、端口）保存，升级时复用该 origin 下的旧 primary 密钥；登录方式列表独立于会话校验读取，昵称保存失败不改变已核验登录状态，桥接命令无变化
不同端口的设备密钥隔离不代表 Cookie 按端口隔离，同主机多套部署须使用不同域名并保留 host-only Cookie，不能共用一套 Redis 账户命名空间作为独立租户
