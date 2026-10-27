# WebView Shell

此移动端已是纯 WebView 容器，启动后直接加载 Web 页面：

首页及公开房间列表可在未登录时浏览，加入房间、点歌和播放仍要求先登录 OpenMusic 账户，未登录时不能通过通知栏、桥接或旧游客身份请求房间与音乐服务，账户受限时仅音乐 URL 取链返回指定替代曲，其他业务仍拒绝，桥接命令名和字段不变，升级后刷新网页资源，不要清除 Cookie、WebView 存储或应用数据

旧游客首次登录时，服务端通过仍有效的签名身份或 HttpOnly 设备 Cookie 对应的 Redis 绑定恢复可验证的归属，再迁移收藏与房间，本地收藏和分类在登录后补导入，成功前保留缓存，原生端不能用缓存 clientId/deviceId 作为身份恢复授权

网页登录改用服务端非对称签名的三天访问令牌，刷新凭证在首次登录 30 天内通过 HttpOnly Cookie 无感轮换，原生端不得获取、保存或通过桥接传递私钥和刷新凭证，续期后的 Socket 重新握手仍由网页完成，超过刷新期限必须重新登录

服务端会断开访问令牌过期的空闲 Socket，并周期复核会话撤销与账户限制，网页先静默恢复有效登录和房间连接，临时网络失败不清除原房间，原生端无需新增命令或自行重传凭据

微信通用代理同样要求账户登录，未登录微信首登仅允许专用 `/api/auth/wechat/start`、`/qr`、`/poll`、`/account` 链路，文件传输助手 UIN 由服务端向微信核验，不接受原生桥接或网页自报 UIN/openid，历史微信身份索引保持不变

```bash
flutter run --dart-define=OM_SERVER_URL=https://your-host
```

当前房间页通过 `flutter_inappwebview` bridge 自动报送 Android 通知栏媒体状态，并响应 `play`、`pause`、`seek`、`next`、`lyrics`、`toggleMode`、`toggleFavorite`。通知栏的按钮、进度拖动与模式切换都依赖网页同步的权限字段；网页和服务端仍负责最终权限校验。Android 13 及以上首次播放需允许通知权限；悬浮歌词还需要系统悬浮窗权限。

正式版只接受 HTTPS `OM_SERVER_URL`，且 Android Manifest 禁止明文流量；debug/profile 使用 local flavor 时仍可连接本机或局域网 HTTP 服务。配置值必须是纯 Origin，不能包含账号、路径、查询参数或片段。

WebView 只把配置的站点 Origin 视为可信页面。普通外链交给系统浏览器，非 HTTP(S) 导航会被拒绝；Linux.do / GitHub OAuth 只能从本站既有 `/api/auth/*/start` 或后台授权起点进入短时 HTTPS 流程。任何非本站顶层页面都不能调用下列桥接，也不能接收原生通知栏发出的播放命令。原生端会在受信**顶层**页面文档开始时注入一次性 `window.__OPENMUSIC_NATIVE_BRIDGE_TOKEN__`；所有桥接 payload 必须携带 `bridgeToken`。跨域 iframe 不会获得该令牌；本站的 Sonic Workshop iframe 额外以 `sandbox="allow-scripts"` 运行，形成 opaque origin，因而不能读取顶层页面令牌。新增同源 iframe 时也必须采用等效隔离，或改为独立 Origin。

汽水二次验证 iframe 同样以 `sandbox="allow-scripts"` 隔离；完成消息只接受对应 iframe 的 `contentWindow`，不能仅按 Origin 信任。Sonic Workshop 的 ES module 静态资源需精确返回 `Access-Control-Allow-Origin: null`（不允许凭据）。

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
