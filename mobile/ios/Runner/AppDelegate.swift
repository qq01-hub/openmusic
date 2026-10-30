import Flutter
import UIKit
import AVFAudio

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var nativeChannel: FlutterMethodChannel?
  private var audioSessionActive = false
  private var reportedPlaying = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let channel = FlutterMethodChannel(
      name: "com.openmusic.app/native",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    nativeChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return result(FlutterMethodNotImplemented) }
      do {
        switch call.method {
        case "requestNotificationPermission":
          // iOS 锁屏媒体由 WKWebView Media Session 管理，不申请推送通知权限
          result(nil)
        case "updatePlaybackNotification":
          guard let state = call.arguments as? [String: Any] else {
            return result(FlutterError(code: "invalid_payload", message: nil, details: nil))
          }
          // 只在开始播放时激活，不因周期上报或系统中断反复抢占音频焦点
          let playing = state["playing"] as? Bool == true
          if playing && !self.reportedPlaying {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            self.audioSessionActive = true
          }
          self.reportedPlaying = playing
          result(nil)
        case "clearPlaybackNotification":
          self.reportedPlaying = false
          if self.audioSessionActive {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            self.audioSessionActive = false
          }
          result(nil)
        case "openExternal":
          guard let arguments = call.arguments as? [String: Any],
                let raw = arguments["url"] as? String,
                let url = URL(string: raw), url.scheme?.lowercased() == "https",
                url.host != nil, url.user == nil, url.password == nil else {
            return result(FlutterError(code: "invalid_url", message: nil, details: nil))
          }
          UIApplication.shared.open(url, options: [:]) { opened in result(opened) }
        default:
          result(FlutterMethodNotImplemented)
        }
      } catch {
        result(FlutterError(code: "audio_session_unavailable", message: nil, details: nil))
      }
    }
  }
}
