package com.openmusic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.LruCache
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max

object NativePlaybackBridge {
    @Volatile
    var channel: MethodChannel? = null

    fun dispatch(action: String, time: Long? = null) {
        val payload = mutableMapOf<String, Any>("action" to action)
        if (time != null) payload["time"] = time.toDouble() / 1000.0
        channel?.invokeMethod("playbackAction", payload)
    }
}

class NativePlaybackService : Service() {
    private data class MetadataSnapshot(
        val title: String,
        val artist: String,
        val lyric: String,
        val durationMs: Long,
        val cover: Bitmap?,
    )

    private data class NotificationSnapshot(
        val title: String,
        val artist: String,
        val lyric: String,
        val playing: Boolean,
        val canPause: Boolean,
        val canSkip: Boolean,
        val canChangeMode: Boolean,
        val playMode: String,
        val playModeLabel: String,
        val favorited: Boolean,
        val cover: Bitmap?,
    )

    private data class PlaybackStateSnapshot(
        val playing: Boolean,
        val actions: Long,
        val canChangeMode: Boolean,
        val playMode: String,
        val playModeLabel: String,
        val favorited: Boolean,
        val positionMs: Long,
        val publishedAtMs: Long,
    )

    private lateinit var mediaSession: MediaSession
    private var title = "OpenMusic"
    private var artist = ""
    private var playing = false
    private var durationMs = 0L
    private var positionMs = 0L
    private var positionUpdatedAtMs = 0L
    private var canPause = false
    private var canSkip = false
    private var canSeek = false
    private var lyric = ""
    private var playMode = "order"
    private var playModeLabel = "顺序"
    private var canChangeMode = false
    private var favorited = false
    private var coverUrl = ""
    private var cover: Bitmap? = null
    private var artworkRequestId = 0L
    private var artworkLoadingUrl = ""
    private var lastArtworkAttemptAtMs = 0L
    private val artworkCache = LruCache<String, Bitmap>(MAX_ARTWORK_CACHE_ENTRIES)
    private var foregroundStarted = false
    private var lastMetadata: MetadataSnapshot? = null
    private var lastNotification: NotificationSnapshot? = null
    private var lastPlaybackState: PlaybackStateSnapshot? = null
    private var pendingPlaying: Boolean? = null
    private var pendingPlayingUntilMs = 0L
    private var pendingPositionMs: Long? = null
    private var pendingPositionUntilMs = 0L
    private var lastControlAction = ""
    private var lastControlAtMs = 0L
    private var lyricsOverlayView: View? = null
    private var lyricsOverlayTextView: TextView? = null
    private var lyricsOverlayLockView: TextView? = null
    private var lyricsOverlayCloseView: TextView? = null
    private var lyricsOverlayControlsView: View? = null
    private var lyricsOverlayParams: WindowManager.LayoutParams? = null
    private var lyricsOverlayLocked = false
    private var overlayTouchStartX = 0
    private var overlayTouchStartY = 0
    private var overlayRawStartX = 0f
    private var overlayRawStartY = 0f
    private val mainHandler = Handler(Looper.getMainLooper())
    private val hideLyricsOverlayControlsRunnable = Runnable {
        lyricsOverlayControlsView?.visibility = View.GONE
    }
    private val artworkExecutor = Executors.newSingleThreadExecutor()
    @Volatile
    private var isDestroyed = false

    override fun onCreate() {
        super.onCreate()
        createChannel()
        mediaSession = MediaSession(this, "OpenMusicPlayback").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = handleControlAction("play")
                override fun onPause() = handleControlAction("pause")
                override fun onSkipToNext() = handleControlAction("next")
                override fun onCustomAction(action: String, extras: android.os.Bundle?) {
                    when (action) {
                        ACTION_TOGGLE_FAVORITE -> handleControlAction("toggleFavorite")
                        ACTION_LYRICS -> handleLyricsAction()
                        ACTION_TOGGLE_MODE -> handleControlAction("toggleMode")
                    }
                }
                override fun onSeekTo(pos: Long) {
                    if (!canSeek) return
                    setPendingPosition(pos.coerceAtLeast(0L))
                    publish(forcePosition = true)
                    NativePlaybackBridge.dispatch("seek", pos.coerceAtLeast(0L))
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE -> update(intent.extras?.keySet()?.associateWith { intent.extras?.get(it) } ?: emptyMap())
            ACTION_CLEAR -> {
                foregroundStarted = false
                lastMetadata = null
                lastNotification = null
                lastPlaybackState = null
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
                else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                stopSelf()
            }
            ACTION_PLAY -> handleControlAction("play")
            ACTION_PAUSE -> handleControlAction("pause")
            ACTION_NEXT -> handleControlAction("next")
            ACTION_LYRICS -> handleLyricsAction()
            ACTION_SHOW_LYRICS_OVERLAY -> showLyricsOverlay()
            ACTION_TOGGLE_MODE -> handleControlAction("toggleMode")
            ACTION_TOGGLE_FAVORITE -> handleControlAction("toggleFavorite")
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isDestroyed = true
        mainHandler.removeCallbacksAndMessages(null)
        removeLyricsOverlay()
        artworkExecutor.shutdownNow()
        artworkCache.evictAll()
        mediaSession.release()
        super.onDestroy()
    }

    private fun update(values: Map<String, Any?>) {
        title = values["title"]?.toString()?.take(160)?.ifBlank { "OpenMusic" } ?: "OpenMusic"
        artist = values["artist"]?.toString()?.take(160).orEmpty()
        val reportedPlaying = values["playing"] == true
        durationMs = secondsToMillis(values["duration"])
        val reportedPositionMs = secondsToMillis(values["position"])
        val now = SystemClock.elapsedRealtime()
        if (pendingPlaying != null) {
            if (reportedPlaying == pendingPlaying || now >= pendingPlayingUntilMs) {
                pendingPlaying = null
            }
        }
        playing = pendingPlaying ?: reportedPlaying
        if (pendingPositionMs != null) {
            if (kotlin.math.abs(reportedPositionMs - pendingPositionMs!!) <= POSITION_ACK_TOLERANCE_MS || now >= pendingPositionUntilMs) {
                pendingPositionMs = null
            }
        }
        positionMs = pendingPositionMs ?: reportedPositionMs
        positionUpdatedAtMs = now
        canPause = values["canPause"] == true
        canSkip = values["canSkip"] == true
        canSeek = values["canSeek"] == true
        lyric = values["lyric"]?.toString()?.take(180).orEmpty()
        playMode = values["playMode"]?.toString()?.take(32)?.ifBlank { "order" } ?: "order"
        playModeLabel = values["playModeLabel"]?.toString()?.take(32)?.ifBlank { "顺序" } ?: "顺序"
        canChangeMode = values["canChangeMode"] == true
        favorited = values["favorited"] == true
        val nextCoverUrl = values["cover"]?.toString().orEmpty()
        if (nextCoverUrl != coverUrl) {
            coverUrl = nextCoverUrl
            cover = null
            loadArtwork(nextCoverUrl)
        } else if (cover == null && nextCoverUrl.isNotBlank()) {
            retryArtworkIfIdle(nextCoverUrl)
        }
        updateLyricsOverlayText()
        publish()
    }

    private fun publish(forcePosition: Boolean = false) {
        val now = SystemClock.elapsedRealtime()
        val currentPos = currentPositionMs()
        val actions = (if (canPause) PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE else 0L) or
            (if (canSkip) PlaybackState.ACTION_SKIP_TO_NEXT else 0L) or
            (if (canSeek) PlaybackState.ACTION_SEEK_TO else 0L)
        val prevPlayback = lastPlaybackState
        val playbackDrift = if (prevPlayback == null) {
            Long.MAX_VALUE
        } else {
            val expected = if (prevPlayback.playing) {
                prevPlayback.positionMs + (now - prevPlayback.publishedAtMs).coerceAtLeast(0L)
            } else {
                prevPlayback.positionMs
            }
            abs(currentPos - expected)
        }
        val playbackChanged = forcePosition || prevPlayback == null ||
            prevPlayback.playing != playing ||
            prevPlayback.actions != actions ||
            prevPlayback.canChangeMode != canChangeMode ||
            prevPlayback.playMode != playMode ||
            prevPlayback.playModeLabel != playModeLabel ||
            prevPlayback.favorited != favorited ||
            playbackDrift >= PLAYBACK_STATE_DRIFT_MS
        if (playbackChanged) {
            val playbackState = PlaybackState.Builder()
                .setActions(actions)
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    currentPos,
                    if (playing) 1f else 0f,
                )
            playbackState.addCustomAction(ACTION_LYRICS, "歌词", R.drawable.ic_notify_lyrics)
            if (canChangeMode) {
                playbackState.addCustomAction(ACTION_TOGGLE_MODE, playModeLabel, playModeIconRes())
            }
            playbackState.addCustomAction(
                ACTION_TOGGLE_FAVORITE,
                if (favorited) "取消收藏" else "收藏",
                favoriteIconRes(),
            )
            mediaSession.setPlaybackState(playbackState.build())
            lastPlaybackState = PlaybackStateSnapshot(
                playing = playing,
                actions = actions,
                canChangeMode = canChangeMode,
                playMode = playMode,
                playModeLabel = playModeLabel,
                favorited = favorited,
                positionMs = currentPos,
                publishedAtMs = now,
            )
        }
        val nextMetadata = MetadataSnapshot(
            title = title,
            artist = artist,
            lyric = lyric,
            durationMs = durationMs,
            cover = cover,
        )
        if (nextMetadata != lastMetadata) {
            val metadata = MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, lyric.ifBlank { artist })
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
            cover?.let {
                metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
                metadata.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, it)
            }
            mediaSession.setMetadata(metadata.build())
            lastMetadata = nextMetadata
        }
        val nextNotification = NotificationSnapshot(
            title = title,
            artist = artist,
            lyric = lyric,
            playing = playing,
            canPause = canPause,
            canSkip = canSkip,
            canChangeMode = canChangeMode,
            playMode = playMode,
            playModeLabel = playModeLabel,
            favorited = favorited,
            cover = cover,
        )
        if (!foregroundStarted || nextNotification != lastNotification) {
            startForeground(NOTIFICATION_ID, buildNotification())
            foregroundStarted = true
            lastNotification = nextNotification
        }
    }

    private fun loadArtwork(rawUrl: String) {
        val requestId = ++artworkRequestId
        if (rawUrl.isBlank()) {
            artworkLoadingUrl = ""
            return
        }
        val cached = artworkCache.get(rawUrl)
        if (cached != null && !cached.isRecycled) {
            artworkLoadingUrl = ""
            cover = cached
            return
        }
        artworkLoadingUrl = rawUrl
        lastArtworkAttemptAtMs = SystemClock.elapsedRealtime()
        artworkExecutor.execute {
            if (isDestroyed) return@execute
            val bitmap = runCatching { downloadArtwork(rawUrl) }.getOrNull()
            mainHandler.post {
                if (isDestroyed) return@post
                if (bitmap != null) artworkCache.put(rawUrl, bitmap)
                if (requestId != artworkRequestId) return@post
                if (artworkLoadingUrl == rawUrl) artworkLoadingUrl = ""
                if (bitmap == null) return@post
                cover = bitmap
                publish()
            }
        }
    }

    private fun retryArtworkIfIdle(rawUrl: String) {
        if (artworkLoadingUrl == rawUrl) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastArtworkAttemptAtMs < ARTWORK_RETRY_INTERVAL_MS) return
        loadArtwork(rawUrl)
    }

    private fun downloadArtwork(rawUrl: String): Bitmap? {
        var url = runCatching { URL(rawUrl) }.getOrNull() ?: return null
        repeat(3) {
            if (!isAllowedArtworkUrl(url)) return null
            val connection = runCatching { url.openConnection() as HttpURLConnection }.getOrNull() ?: return null
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = ARTWORK_CONNECT_TIMEOUT_MS
                connection.readTimeout = ARTWORK_READ_TIMEOUT_MS
                connection.setRequestProperty("Accept", "image/*")
                when (connection.responseCode) {
                    in 200..299 -> {
                        val contentLength = connection.contentLengthLong
                        if (contentLength > MAX_ARTWORK_BYTES) return null
                        val data = readArtworkBytes(connection.inputStream) ?: return null
                        return decodeSampledArtwork(data)
                    }
                    in 300..399 -> {
                        val location = connection.getHeaderField("Location") ?: return null
                        url = runCatching { URL(url, location) }.getOrNull() ?: return null
                    }
                    else -> return null
                }
            } catch (_: Exception) {
                return null
            } finally {
                connection.disconnect()
            }
        }
        return null
    }

    private fun isAllowedArtworkUrl(url: URL): Boolean {
        if (url.protocol != "https" && url.protocol != "http") return false
        val host = url.host.lowercase()
        if (host == "localhost" || host.endsWith(".local")) return false
        val addresses = runCatching { InetAddress.getAllByName(host) }.getOrNull() ?: return false
        return addresses.isNotEmpty() && addresses.all { address ->
            !address.isAnyLocalAddress && !address.isLoopbackAddress &&
                !address.isLinkLocalAddress && !address.isSiteLocalAddress
        }
    }

    private fun readArtworkBytes(input: java.io.InputStream): ByteArray? {
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                if (output.size().toLong() + count > MAX_ARTWORK_BYTES) return null
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }

    private fun decodeSampledArtwork(data: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sampleSize = 1
        while (max(bounds.outWidth / sampleSize, bounds.outHeight / sampleSize) > MAX_ARTWORK_EDGE * 2) {
            sampleSize *= 2
        }
        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        return BitmapFactory.decodeByteArray(data, 0, data.size, options)?.let(::scaleArtwork)
    }

    private fun scaleArtwork(bitmap: Bitmap): Bitmap {
        val longest = max(bitmap.width, bitmap.height)
        if (longest <= MAX_ARTWORK_EDGE) return bitmap
        val scale = MAX_ARTWORK_EDGE.toFloat() / longest
        val scaled = Bitmap.createScaledBitmap(
            bitmap,
            max(1, (bitmap.width * scale).toInt()),
            max(1, (bitmap.height * scale).toInt()),
            true,
        )
        if (scaled !== bitmap) bitmap.recycle()
        return scaled
    }

    private fun buildNotification(): Notification {
        val playPauseAction = if (playing) ACTION_PAUSE else ACTION_PLAY
        val playPauseIcon = if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseLabel = if (playing) "暂停" else "播放"
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(lyric.ifBlank { artist })
            .setSubText(if (lyric.isNotBlank() && artist.isNotBlank()) artist else null)
            .setContentIntent(activityPendingIntent())
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        cover?.let { builder.setLargeIcon(it) }

        val compactActionIndexes = mutableListOf<Int>()
        var actionIndex = 0
        if (canChangeMode) {
            builder.addAction(playModeIconRes(), playModeLabel, servicePendingIntent(ACTION_TOGGLE_MODE))
            compactActionIndexes += actionIndex
            actionIndex += 1
        }
        builder.addAction(R.drawable.ic_notify_lyrics, "词", servicePendingIntent(ACTION_LYRICS))
        compactActionIndexes += actionIndex
        actionIndex += 1
        if (canPause) {
            builder.addAction(playPauseIcon, playPauseLabel, servicePendingIntent(playPauseAction))
            compactActionIndexes += actionIndex
            actionIndex += 1
        }
        if (canSkip) {
            builder.addAction(android.R.drawable.ic_media_next, "下一首", servicePendingIntent(ACTION_NEXT))
            actionIndex += 1
        }
        builder.addAction(favoriteIconRes(), if (favorited) "已收藏" else "收藏", servicePendingIntent(ACTION_TOGGLE_FAVORITE))
        actionIndex += 1
        builder.setStyle(
            Notification.MediaStyle()
                .setMediaSession(mediaSession.sessionToken)
                .setShowActionsInCompactView(*compactActionIndexes.take(3).toIntArray()),
        )
        return builder.build()
    }

    private fun dispatchIfAllowed(action: String, allowed: Boolean) {
        if (allowed) NativePlaybackBridge.dispatch(action)
    }

    private fun handleControlAction(action: String) {
        val now = SystemClock.elapsedRealtime()
        if (action == lastControlAction && now - lastControlAtMs < CONTROL_DEBOUNCE_MS) return
        lastControlAction = action
        lastControlAtMs = now
        when (action) {
            "play" -> {
                if (!canPause) return
                positionMs = currentPositionMs()
                positionUpdatedAtMs = now
                playing = true
                pendingPlaying = true
                pendingPlayingUntilMs = now + LOCAL_ACTION_CONFIRM_TIMEOUT_MS
                publish(forcePosition = true)
                NativePlaybackBridge.dispatch("play")
            }
            "pause" -> {
                if (!canPause) return
                positionMs = currentPositionMs()
                positionUpdatedAtMs = now
                playing = false
                pendingPlaying = false
                pendingPlayingUntilMs = now + LOCAL_ACTION_CONFIRM_TIMEOUT_MS
                publish(forcePosition = true)
                NativePlaybackBridge.dispatch("pause")
            }
            "next" -> dispatchIfAllowed("next", canSkip)
            "toggleMode" -> dispatchIfAllowed("toggleMode", canChangeMode)
            "toggleFavorite" -> NativePlaybackBridge.dispatch("toggleFavorite")
        }
    }

    private fun handleLyricsAction() {
        if (!canDrawOverlays()) {
            requestOverlayPermission()
            return
        }
        if (lyricsOverlayView == null) {
            showLyricsOverlay()
        } else if (!lyricsOverlayLocked) {
            removeLyricsOverlay()
        }
    }

    private fun showLyricsOverlay() {
        if (!canDrawOverlays()) {
            requestOverlayPermission()
            return
        }
        if (lyricsOverlayView != null) {
            updateLyricsOverlayText()
            return
        }
        val overlayTouchListener = View.OnTouchListener { v, event ->
            val params = lyricsOverlayParams ?: return@OnTouchListener false
            showLyricsOverlayControls()
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    overlayTouchStartX = params.x
                    overlayTouchStartY = params.y
                    overlayRawStartX = event.rawX
                    overlayRawStartY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (!lyricsOverlayLocked) {
                        params.x = overlayTouchStartX + (event.rawX - overlayRawStartX).toInt()
                        params.y = overlayTouchStartY + (event.rawY - overlayRawStartY).toInt()
                        runCatching { windowManager().updateViewLayout(lyricsOverlayView ?: v, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> true
                else -> false
            }
        }
        val lyricView = TextView(this).apply {
            text = lyricsOverlayText()
            setTextColor(Color.rgb(168, 85, 247))
            setTypeface(Typeface.DEFAULT_BOLD)
            textSize = 20f
            gravity = Gravity.CENTER
            maxLines = 2
            setPadding(32, 18, 32, 8)
            setOnTouchListener(overlayTouchListener)
        }
        val lockView = overlayActionView("锁定").apply {
            setOnClickListener {
                showLyricsOverlayControls()
                lyricsOverlayLocked = !lyricsOverlayLocked
                updateLyricsOverlayLockState()
            }
        }
        val closeView = overlayActionView("关闭").apply {
            setOnClickListener {
                showLyricsOverlayControls()
                if (!lyricsOverlayLocked) removeLyricsOverlay()
            }
        }
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(lockView)
            addView(closeView)
        }
        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 8)
            setBackgroundColor(Color.TRANSPARENT)
            setOnTouchListener(overlayTouchListener)
            addView(lyricView)
            addView(controls)
        }
        val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            windowType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = 120
        }
        runCatching {
            windowManager().addView(view, params)
            lyricsOverlayView = view
            lyricsOverlayTextView = lyricView
            lyricsOverlayLockView = lockView
            lyricsOverlayCloseView = closeView
            lyricsOverlayControlsView = controls
            lyricsOverlayParams = params
            lyricsOverlayLocked = false
            updateLyricsOverlayLockState()
            showLyricsOverlayControls()
        }.onFailure {
            lyricsOverlayView = null
            lyricsOverlayTextView = null
            lyricsOverlayLockView = null
            lyricsOverlayCloseView = null
            lyricsOverlayControlsView = null
            lyricsOverlayParams = null
            lyricsOverlayLocked = false
            requestOverlayPermission()
        }
    }

    private fun removeLyricsOverlay() {
        val view = lyricsOverlayView ?: return
        mainHandler.removeCallbacks(hideLyricsOverlayControlsRunnable)
        runCatching { windowManager().removeView(view) }
        lyricsOverlayView = null
        lyricsOverlayTextView = null
        lyricsOverlayLockView = null
        lyricsOverlayCloseView = null
        lyricsOverlayControlsView = null
        lyricsOverlayParams = null
        lyricsOverlayLocked = false
    }

    private fun updateLyricsOverlayText() {
        val view = lyricsOverlayTextView ?: return
        val nextText = lyricsOverlayText()
        if (view.text?.toString() != nextText) {
            view.text = nextText
        }
    }

    private fun updateLyricsOverlayLockState() {
        lyricsOverlayLockView?.text = if (lyricsOverlayLocked) "解锁" else "锁定"
        lyricsOverlayCloseView?.setTextColor(
            if (lyricsOverlayLocked) Color.rgb(156, 163, 175) else Color.rgb(168, 85, 247)
        )
    }

    private fun showLyricsOverlayControls() {
        val controls = lyricsOverlayControlsView ?: return
        controls.visibility = View.VISIBLE
        mainHandler.removeCallbacks(hideLyricsOverlayControlsRunnable)
        mainHandler.postDelayed(hideLyricsOverlayControlsRunnable, 3000L)
    }

    private fun overlayActionView(label: String): TextView {
        return TextView(this).apply {
            text = label
            setTextColor(Color.rgb(168, 85, 247))
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(18, 8, 18, 8)
            isClickable = true
            isFocusable = true
        }
    }

    private fun lyricsOverlayText(): String {
        return lyric.ifBlank {
            if (artist.isBlank()) title else "$title - $artist"
        }
    }

    private fun canDrawOverlays(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    private fun favoriteIconRes(): Int {
        return if (favorited) R.drawable.ic_notify_heart_filled else R.drawable.ic_notify_heart
    }

    private fun playModeIconRes(): Int {
        return when (playMode) {
            "shuffle" -> R.drawable.ic_notify_shuffle
            "shuffle-loop" -> R.drawable.ic_notify_dices
            "loop-one" -> R.drawable.ic_notify_repeat_one
            "loop-all" -> R.drawable.ic_notify_repeat
            else -> R.drawable.ic_notify_order
        }
    }

    private fun requestOverlayPermission() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_REQUEST_OVERLAY_PERMISSION, true)
        }
        startActivity(intent)
    }

    private fun windowManager(): WindowManager {
        return getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    private fun setPendingPosition(position: Long) {
        val now = SystemClock.elapsedRealtime()
        positionMs = position
        positionUpdatedAtMs = now
        pendingPositionMs = position
        pendingPositionUntilMs = now + LOCAL_ACTION_CONFIRM_TIMEOUT_MS
    }

    private fun currentPositionMs(): Long {
        val elapsed = if (playing) SystemClock.elapsedRealtime() - positionUpdatedAtMs else 0L
        val position = positionMs + elapsed.coerceAtLeast(0L)
        return if (durationMs > 0) position.coerceAtMost(durationMs) else position
    }

    private fun secondsToMillis(value: Any?): Long {
        val seconds = (value as? Number)?.toDouble() ?: value?.toString()?.toDoubleOrNull() ?: 0.0
        if (!seconds.isFinite() || seconds <= 0.0) return 0L
        return max(0L, (seconds * 1000).toLong())
    }

    private fun servicePendingIntent(action: String): PendingIntent {
        return PendingIntent.getService(
            this,
            action.hashCode(),
            Intent(this, NativePlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun activityPendingIntent(): PendingIntent {
        return activityPendingIntent(null)
    }

    private fun activityPendingIntent(nativeAction: String?): PendingIntent {
        return PendingIntent.getActivity(
            this,
            nativeAction?.hashCode() ?: 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                if (nativeAction != null) putExtra(MainActivity.EXTRA_NATIVE_PLAYBACK_ACTION, nativeAction)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
    }

    companion object {
        private const val CHANNEL_ID = "openmusic_playback"
        private const val NOTIFICATION_ID = 27001
        private const val ACTION_UPDATE = "com.openmusic.app.UPDATE_PLAYBACK"
        private const val ACTION_CLEAR = "com.openmusic.app.CLEAR_PLAYBACK"
        private const val ACTION_PLAY = "com.openmusic.app.PLAY"
        private const val ACTION_PAUSE = "com.openmusic.app.PAUSE"
        private const val ACTION_NEXT = "com.openmusic.app.NEXT"
        private const val ACTION_LYRICS = "com.openmusic.app.LYRICS"
        private const val ACTION_SHOW_LYRICS_OVERLAY = "com.openmusic.app.SHOW_LYRICS_OVERLAY"
        private const val ACTION_TOGGLE_MODE = "com.openmusic.app.TOGGLE_MODE"
        private const val ACTION_TOGGLE_FAVORITE = "com.openmusic.app.TOGGLE_FAVORITE"
        private const val MAX_ARTWORK_BYTES = 5L * 1024 * 1024
        private const val MAX_ARTWORK_EDGE = 512
        private const val MAX_ARTWORK_CACHE_ENTRIES = 12
        private const val ARTWORK_CONNECT_TIMEOUT_MS = 5_000
        private const val ARTWORK_READ_TIMEOUT_MS = 8_000
        private const val ARTWORK_RETRY_INTERVAL_MS = 5_000L
        private const val PLAYBACK_STATE_DRIFT_MS = 2_000L
        private const val LOCAL_ACTION_CONFIRM_TIMEOUT_MS = 2_500L
        private const val POSITION_ACK_TOLERANCE_MS = 1_500L
        private const val CONTROL_DEBOUNCE_MS = 500L

        fun show(context: Context, data: Map<String, Any?>) {
            val intent = Intent(context, NativePlaybackService::class.java).setAction(ACTION_UPDATE)
            data.forEach { (key, value) ->
                when (value) {
                    is String -> intent.putExtra(key, value)
                    is Boolean -> intent.putExtra(key, value)
                    is Double -> intent.putExtra(key, value)
                    is Int -> intent.putExtra(key, value)
                    is Long -> intent.putExtra(key, value)
                }
            }
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            }
        }

        fun clear(context: Context) {
            runCatching {
                context.startService(Intent(context, NativePlaybackService::class.java).setAction(ACTION_CLEAR))
            }
        }

        fun showLyricsOverlay(context: Context) {
            runCatching {
                context.startService(Intent(context, NativePlaybackService::class.java).setAction(ACTION_SHOW_LYRICS_OVERLAY))
            }
        }
    }
}
