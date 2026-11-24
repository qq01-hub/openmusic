package com.openmusic.app

import io.flutter.embedding.android.FlutterActivity
import android.content.Intent
import android.net.Uri
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.content.pm.PackageManager
import android.provider.Settings
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var notificationPermissionRequested = false
    private var waitingForOverlayPermission = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.openmusic.app/native")
        NativePlaybackBridge.channel = channel
        channel
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "vibrate" -> {
                        val vibrator = if (android.os.Build.VERSION.SDK_INT >= 31) {
                            getSystemService(VibratorManager::class.java)?.defaultVibrator
                        } else {
                            @Suppress("DEPRECATION")
                            getSystemService(VIBRATOR_SERVICE) as? Vibrator
                        }
                        if (vibrator != null && vibrator.hasVibrator()) {
                            if (android.os.Build.VERSION.SDK_INT >= 26) {
                                vibrator.vibrate(
                                    VibrationEffect.createOneShot(
                                        24,
                                        VibrationEffect.DEFAULT_AMPLITUDE,
                                    ),
                                )
                            } else {
                                @Suppress("DEPRECATION")
                                vibrator.vibrate(24)
                            }
                        }
                        result.success(mapOf("ok" to true))
                    }
                    "share" -> {
                        val text = call.argument<String>("text")?.take(2000).orEmpty()
                        val launched = runCatching {
                            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, text)
                            }, "分享"))
                        }.isSuccess
                        if (launched) result.success(mapOf("ok" to true))
                        else result.error("SHARE_UNAVAILABLE", "当前设备无可用分享应用", null)
                    }
                    "openExternal" -> {
                        val raw = call.argument<String>("url").orEmpty()
                        val uri = runCatching { Uri.parse(raw) }.getOrNull()
                        val scheme = uri?.scheme?.lowercase()
                        if (uri == null || scheme !in setOf("https", "http")) {
                            result.error("INVALID_URL", "仅允许 http/https", null)
                        } else {
                            val launched = runCatching {
                                startActivity(Intent(Intent.ACTION_VIEW, uri))
                            }.isSuccess
                            if (launched) result.success(mapOf("ok" to true))
                            else result.error("OPEN_EXTERNAL_UNAVAILABLE", "当前设备未安装可用浏览器", null)
                        }
                    }
                    "updatePlaybackNotification" -> {
                        val data = call.arguments<Map<String, Any?>>() ?: emptyMap()
                        requestNotificationPermissionIfNeeded()
                        NativePlaybackService.show(this, data)
                        result.success(mapOf("ok" to true))
                    }
                    "requestNotificationPermission" -> {
                        requestNotificationPermissionIfNeeded()
                        result.success(mapOf("ok" to true))
                    }
                    "clearPlaybackNotification" -> {
                        NativePlaybackService.clear(this)
                        result.success(mapOf("ok" to true))
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onResume() {
        super.onResume()
        requestNotificationPermissionIfNeeded()
        consumeOverlayPermissionRequest(intent)
        if (waitingForOverlayPermission && canDrawOverlays()) {
            waitingForOverlayPermission = false
            NativePlaybackService.showLyricsOverlay(this)
        }
        consumeNativePlaybackAction(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeOverlayPermissionRequest(intent)
        consumeNativePlaybackAction(intent)
    }

    override fun onDestroy() {
        if (isFinishing) NativePlaybackBridge.channel = null
        super.onDestroy()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT < 33) return
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        if (notificationPermissionRequested) return
        notificationPermissionRequested = true
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATION_PERMISSION)
    }

    private fun consumeNativePlaybackAction(intent: Intent?) {
        val action = intent?.getStringExtra(EXTRA_NATIVE_PLAYBACK_ACTION)?.takeIf { it.isNotBlank() } ?: return
        intent.removeExtra(EXTRA_NATIVE_PLAYBACK_ACTION)
        window.decorView.post {
            NativePlaybackBridge.dispatch(action)
        }
    }

    private fun consumeOverlayPermissionRequest(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_REQUEST_OVERLAY_PERMISSION, false) != true) return
        intent.removeExtra(EXTRA_REQUEST_OVERLAY_PERMISSION)
        if (canDrawOverlays()) {
            NativePlaybackService.showLyricsOverlay(this)
            return
        }
        waitingForOverlayPermission = true
        val uri = Uri.parse("package:$packageName")
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, uri))
    }

    private fun canDrawOverlays(): Boolean {
        return android.os.Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this)
    }

    companion object {
        const val EXTRA_NATIVE_PLAYBACK_ACTION = "com.openmusic.app.EXTRA_NATIVE_PLAYBACK_ACTION"
        const val EXTRA_REQUEST_OVERLAY_PERMISSION = "com.openmusic.app.EXTRA_REQUEST_OVERLAY_PERMISSION"
        private const val REQUEST_NOTIFICATION_PERMISSION = 1101
    }
}
