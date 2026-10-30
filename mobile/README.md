# OpenMusic Mobile

这是一个 Android / iOS WebView 容器，不再实现 Flutter 原生房间、Socket.IO 或音频播放逻辑，网页负责业务与媒体播放，Flutter 提供 WebView、Android 通知栏媒体控件、iOS 后台音频会话和受限原生工具调用

Android 13 及以上首次播放时需要允许通知权限，才能显示通知栏/锁屏媒体控件。

## 本地启动

```powershell
cd mobile
flutter pub get
flutter run --dart-define=OM_FLAVOR=local --dart-define=OM_SERVER_URL=http://10.0.2.2:4000
```

详细的模拟器与真机地址配置见 [LOCAL.md](./LOCAL.md)，桥接事件和原生工具见 [WEB_SHELL.md](./WEB_SHELL.md)。

## 构建

```powershell
node scripts/build-flutter-apk.mjs --release --server-url=https://your-host
```

脚本会在 release 打包前仅递增本机 `.android-version.local`（已被 Git 忽略）中的可见版本号和 Android 构建号，并将 APK 复制到 `../server/downloads/openmusic.apk`。仓库内的 `pubspec.yaml` 始终保持基线 `1.0.0+1`，新拉取项目会从该版本开始。仅临时重打同一版本时可加 `--no-version-bump`。

## iOS 系统媒体兼容

iOS 沿用 WKWebView 中的网页 Media Session，同步曲名、歌手、封面、播放状态和进度，播放、暂停、上一段、下一首及进度拖动按现有网页权限与浏览器能力处理，不额外注册一套原生媒体中心，避免重复或相互覆盖

原生侧配置 `AVAudioSession.playback` 并保留 `UIBackgroundModes: audio`，仅在本机播放状态从暂停切换为播放时激活会话，周期状态上报不反复抢焦点，iOS 不申请 Android 式通知权限，不读取账户 Cookie 或额外请求封面

首次播放仍需按网页提示完成声音授权，系统中断只影响本机，不自动恢复或暂停整个房间，按钮不代表拥有服务端控制权限

兼容基线沿用工程的 iOS 15，锁屏／控制中心的实际显示、蓝牙耳机操作、通话中断与恢复、后台连续播放及切歌必须用 iPhone / iPad 真机验收，当前 Windows 环境无法验证这些系统行为

## 纯血鸿蒙版本

独立的 ArkTS + ArkWeb 工程位于 `../harmony`，配置、签名、构建与验收步骤见 [鸿蒙工程说明](../harmony/README.md)

鸿蒙壳复用现有网页与服务端，不使用 Flutter APK，也不模拟 Android 原生桥接，已接入独立 AVSession 音乐卡片与音频长时任务，后台／锁屏播放仍需鸿蒙编译和真机验收，悬浮歌词尚未接入
