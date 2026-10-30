# OpenMusic iOS

此目录为正式 iOS 工程，不需要重新执行 `flutter create` 覆盖工程

## 系统音乐控件

- WKWebView 的网页 Media Session 是唯一的歌曲信息与系统播控入口，复用网页现有封面、进度、房间权限和媒体中断处理
- AppDelegate 复用 `com.openmusic.app/native` 通道，仅管理 `AVAudioSession.playback`，不建立第二套音频播放器或 Now Playing 中心
- `UIBackgroundModes` 保留 `audio`，`UIApplicationSceneManifest` 对应现有 `SceneDelegate` 和隐式 Flutter 引擎初始化
- 不申请推送通知权限，不放宽 ATS、证书校验、导航域名或账户鉴权
- 系统中断不自动抢回焦点，用户恢复播放时重新激活音频会话

需要真机验证：首次授权、锁屏和控制中心曲目信息、封面、暂停与恢复、拖动进度、无权限控制、蓝牙耳机、通话中断、后台切歌、退出房间清理媒体信息及 iPad 布局

不提供 iOS 安装包构建与下载，保留现有工程和音频兼容能力
