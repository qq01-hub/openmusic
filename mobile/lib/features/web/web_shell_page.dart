import 'dart:collection';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:material_ui/material_ui.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/features/web/web_navigation_policy.dart';

const _background = Color(0xFF121212);
const _accent = Color(0xFFEC4141);
const _bridgeTokenProperty = '__OPENMUSIC_NATIVE_BRIDGE_TOKEN__';

String _newBridgeToken() {
  final random = Random.secure();
  final bytes = List<int>.generate(32, (_) => random.nextInt(256));
  return base64UrlEncode(bytes);
}

String _bridgeTokenBootstrapScript(String token) => '''
(() => {
  if (window.top !== window ||
      Object.prototype.hasOwnProperty.call(window, '$_bridgeTokenProperty')) {
    return;
  }
  Object.defineProperty(window, '$_bridgeTokenProperty', {
    value: ${jsonEncode(token)},
    enumerable: false,
    configurable: false,
    writable: false,
  });
})();
''';

class WebPlayerState {
  const WebPlayerState(
      {this.title = '',
      this.artist = '',
      this.cover = '',
      this.playing = false,
      this.position = 0,
      this.duration = 0,
      this.canPause = false,
      this.canSkip = false,
      this.canSeek = false,
      this.lyric = '',
      this.playMode = 'order',
      this.playModeLabel = '顺序',
      this.canChangeMode = false,
      this.favorited = false});

  final String title;
  final String artist;
  final String cover;
  final bool playing;
  final double position;
  final double duration;
  final bool canPause;
  final bool canSkip;
  final bool canSeek;
  final String lyric;
  final String playMode;
  final String playModeLabel;
  final bool canChangeMode;
  final bool favorited;

  WebPlayerState copyWith(
          {String? title,
          String? artist,
          String? cover,
          bool? playing,
          double? position,
          double? duration,
          bool? canPause,
          bool? canSkip,
          bool? canSeek,
          String? lyric,
          String? playMode,
          String? playModeLabel,
          bool? canChangeMode,
          bool? favorited}) =>
      WebPlayerState(
        title: title ?? this.title,
        artist: artist ?? this.artist,
        cover: cover ?? this.cover,
        playing: playing ?? this.playing,
        position: position ?? this.position,
        duration: duration ?? this.duration,
        canPause: canPause ?? this.canPause,
        canSkip: canSkip ?? this.canSkip,
        canSeek: canSeek ?? this.canSeek,
        lyric: lyric ?? this.lyric,
        playMode: playMode ?? this.playMode,
        playModeLabel: playModeLabel ?? this.playModeLabel,
        canChangeMode: canChangeMode ?? this.canChangeMode,
        favorited: favorited ?? this.favorited,
      );
}

/// Web-first app shell. The web app owns its data/session; Flutter owns the
/// native surface and the small playback bar at the bottom.
class WebShellPage extends StatefulWidget {
  const WebShellPage({super.key, this.path = '/'});
  final String path;

  @override
  State<WebShellPage> createState() => _WebShellPageState();
}

class _WebShellPageState extends State<WebShellPage> {
  InAppWebViewController? _controller;
  var _loading = true;
  String? _error;
  var _player = const WebPlayerState();
  DateTime? _oauthExpiresAt;
  Uri? _lastTrustedUrl;
  var _restoringTrustedPage = false;
  late final String _bridgeToken = _newBridgeToken();

  Uri get _url => Uri.parse(
      '${AppConfig.serverUrl}${widget.path.startsWith('/') ? widget.path : '/${widget.path}'}');
  Uri get _trustedOrigin => Uri.parse(AppConfig.serverUrl);
  bool get _oauthActive => _oauthExpiresAt?.isAfter(DateTime.now()) == true;

  @override
  void initState() {
    super.initState();
    _lastTrustedUrl = _url;
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarIconBrightness: Brightness.light,
      systemStatusBarContrastEnforced: false,
      systemNavigationBarContrastEnforced: false,
    ));
    _android.setMethodCallHandler(_handleNativeMethodCall);
  }

  @override
  void dispose() {
    _android.setMethodCallHandler(null);
    super.dispose();
  }

  Future<dynamic> _handleNativeMethodCall(MethodCall call) async {
    if (call.method != 'playbackAction') {
      throw MissingPluginException('Unsupported native method: ${call.method}');
    }
    if (!await _hasTrustedTopLevel()) {
      return {'ok': false, 'error': 'untrusted_origin'};
    }
    final raw = call.arguments;
    if (raw is! Map) return {'ok': false, 'error': 'invalid_payload'};
    final payload = Map<String, dynamic>.from(raw);
    final action = '${payload.remove('action') ?? ''}';
    if (action.isEmpty) return {'ok': false, 'error': 'invalid_action'};
    final dispatched = await _command(
      action,
      payload: payload,
    );
    return dispatched
        ? {'ok': true}
        : {'ok': false, 'error': 'untrusted_origin'};
  }

  Future<bool> _command(
    String action, {
    Map<String, dynamic>? payload,
  }) async {
    if (!await _hasTrustedTopLevel()) return false;
    final body = <String, dynamic>{'action': action, ...?payload};
    await _controller?.evaluateJavascript(
        source:
            'window.dispatchEvent(new CustomEvent("omNativePlayerCommand", { detail: ${jsonEncode(body)} }));');
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _background,
      resizeToAvoidBottomInset: false,
      body: SafeArea(
        top: true,
        bottom: false,
        child: Stack(children: [
          InAppWebView(
            initialUrlRequest: URLRequest(url: WebUri(_url.toString())),
            initialUserScripts: UnmodifiableListView([
              UserScript(
                source: _bridgeTokenBootstrapScript(_bridgeToken),
                injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
                forMainFrameOnly: true,
                allowedOriginRules: {_trustedOrigin.origin},
              ),
            ]),
            initialSettings: InAppWebViewSettings(
              javaScriptEnabled: true,
              mediaPlaybackRequiresUserGesture: false,
              allowsInlineMediaPlayback: true,
              allowBackgroundAudioPlaying: true,
              thirdPartyCookiesEnabled: true,
              supportMultipleWindows: true,
              useShouldOverrideUrlLoading: true,
            ),
            onWebViewCreated: (controller) {
              _controller = controller;
              controller.addJavaScriptHandler(
                handlerName: 'omPlayerState',
                callback: (args) async {
                  final raw = args.isNotEmpty ? args.first : null;
                  if (!hasTrustedBridgeToken(
                        payload: raw,
                        expectedToken: _bridgeToken,
                      ) ||
                      !await _hasTrustedTopLevel()) {
                    return {'ok': false, 'error': 'untrusted_origin'};
                  }
                  final m = Map<String, dynamic>.from(raw as Map)
                    ..remove('bridgeToken');
                  if (!mounted) return null;
                  final next = _player.copyWith(
                    title: '${m['title'] ?? ''}',
                    artist: '${m['artist'] ?? ''}',
                    cover: '${m['cover'] ?? ''}',
                    playing: m['playing'] == true,
                    position: (m['position'] as num?)?.toDouble() ?? 0,
                    duration: (m['duration'] as num?)?.toDouble() ?? 0,
                    canPause: m['canPause'] == true,
                    canSkip: m['canSkip'] == true,
                    canSeek: m['canSeek'] == true,
                    lyric: '${m['lyric'] ?? ''}',
                    playMode: '${m['playMode'] ?? 'order'}',
                    playModeLabel: '${m['playModeLabel'] ?? '顺序'}',
                    canChangeMode: m['canChangeMode'] == true,
                    favorited: m['favorited'] == true,
                  );
                  setState(() => _player = next);
                  await _syncMediaNotification(next);
                  return {'ok': true};
                },
              );
              controller.addJavaScriptHandler(
                handlerName: 'omNative',
                callback: (args) async {
                  final raw = args.isNotEmpty ? args.first : null;
                  if (!hasTrustedBridgeToken(
                        payload: raw,
                        expectedToken: _bridgeToken,
                      ) ||
                      !await _hasTrustedTopLevel()) {
                    return {'ok': false, 'error': 'untrusted_origin'};
                  }
                  final payload = Map<String, dynamic>.from(raw as Map)
                    ..remove('bridgeToken');
                  return _nativeCommand(payload);
                },
              );
            },
            shouldOverrideUrlLoading: (controller, navigationAction) async {
              if (navigationAction.isForMainFrame == false) {
                return NavigationActionPolicy.ALLOW;
              }
              final candidate = _parseWebUri(navigationAction.request.url);
              final decision = decideWebNavigation(
                candidate: candidate,
                trustedOrigin: _trustedOrigin,
                oauthActive: _oauthActive,
                hasUserGesture: navigationAction.hasGesture == true,
              );
              if (decision == WebNavigationDecision.allowTrusted) {
                _recordTrustedNavigation(candidate);
                return NavigationActionPolicy.ALLOW;
              }
              if (decision == WebNavigationDecision.allowOauth) {
                return NavigationActionPolicy.ALLOW;
              }
              if (decision == WebNavigationDecision.openExternal &&
                  candidate != null) {
                await _openExternal(candidate);
              }
              return NavigationActionPolicy.CANCEL;
            },
            onCreateWindow: (controller, createWindowAction) async {
              final candidate = _parseWebUri(createWindowAction.request.url);
              final decision = decideWebNavigation(
                candidate: candidate,
                trustedOrigin: _trustedOrigin,
                oauthActive: _oauthActive,
                hasUserGesture: createWindowAction.hasGesture == true,
              );
              if ((decision == WebNavigationDecision.allowTrusted ||
                      decision == WebNavigationDecision.allowOauth) &&
                  candidate != null) {
                _recordTrustedNavigation(candidate);
                await controller.loadUrl(
                    urlRequest: URLRequest(url: WebUri(candidate.toString())));
              } else if (decision == WebNavigationDecision.openExternal &&
                  candidate != null) {
                await _openExternal(candidate);
              }
              return false;
            },
            onLoadStart: (controller, url) async {
              if (!await _acceptObservedNavigation(controller, url)) return;
              if (mounted) {
                setState(() {
                  _loading = true;
                  _error = null;
                });
              }
            },
            onLoadStop: (controller, url) async {
              if (!await _acceptObservedNavigation(controller, url)) return;
              if (mounted) setState(() => _loading = false);
            },
            onUpdateVisitedHistory: (controller, url, _) async {
              await _acceptObservedNavigation(controller, url);
            },
            onReceivedError: (_, request, error) {
              if (!mounted || request.isForMainFrame != true) return;
              setState(() {
                _loading = false;
                _error = error.description;
              });
            },
          ),
          if (_loading)
            const Center(child: CircularProgressIndicator(color: _accent)),
          if (_error != null)
            Center(
                child: Text('网页加载失败：$_error',
                    style: const TextStyle(color: Colors.white70))),
        ]),
      ),
    );
  }

  Future<void> _syncMediaNotification(WebPlayerState state) async {
    try {
      if (state.title.isEmpty) {
        await _android.invokeMethod('clearPlaybackNotification');
        return;
      }
      await _android.invokeMethod('requestNotificationPermission');
      await _android.invokeMethod('updatePlaybackNotification', {
        'title': state.title,
        'artist': state.artist,
        'cover': state.cover,
        'playing': state.playing,
        'position': state.position,
        'duration': state.duration,
        'canPause': state.canPause,
        'canSkip': state.canSkip,
        'canSeek': state.canSeek,
        'lyric': state.lyric,
        'playMode': state.playMode,
        'playModeLabel': state.playModeLabel,
        'canChangeMode': state.canChangeMode,
        'favorited': state.favorited,
      });
    } on PlatformException {
      // The web player remains usable when the Android notification fails.
    }
  }

  Uri? _parseWebUri(WebUri? value) {
    final text = value?.toString() ?? '';
    return text.isEmpty ? null : Uri.tryParse(text);
  }

  void _recordTrustedNavigation(Uri? candidate) {
    if (!isTrustedWebOrigin(candidate, _trustedOrigin)) return;
    _lastTrustedUrl = candidate;
    if (isOauthStartUrl(candidate, _trustedOrigin)) {
      _oauthExpiresAt = DateTime.now().add(const Duration(minutes: 5));
    } else if (_oauthActive) {
      _oauthExpiresAt = null;
    }
  }

  Future<bool> _acceptObservedNavigation(
      InAppWebViewController controller, WebUri? value) async {
    final candidate = _parseWebUri(value);
    if (isTrustedWebOrigin(candidate, _trustedOrigin)) {
      _recordTrustedNavigation(candidate);
      return true;
    }
    if (_oauthActive && isHttpUri(candidate) && candidate!.scheme == 'https') {
      return true;
    }
    if (_restoringTrustedPage) return false;
    _restoringTrustedPage = true;
    try {
      await controller.stopLoading();
      await _clearNativePlaybackState();
      final fallback = _lastTrustedUrl ?? _url;
      await controller.loadUrl(
          urlRequest: URLRequest(url: WebUri(fallback.toString())));
    } finally {
      _restoringTrustedPage = false;
    }
    return false;
  }

  Future<bool> _hasTrustedTopLevel() async {
    final controller = _controller;
    if (controller == null) return false;
    final current = await controller.getUrl();
    final trusted = isTrustedWebOrigin(_parseWebUri(current), _trustedOrigin);
    if (!trusted) await _clearNativePlaybackState();
    return trusted;
  }

  Future<void> _clearNativePlaybackState() async {
    if (mounted && (_player.title.isNotEmpty || _player.playing)) {
      setState(() => _player = const WebPlayerState());
    }
    try {
      await _android.invokeMethod('clearPlaybackNotification');
    } on PlatformException {
      // WebView 安全边界不依赖通知栏是否可用。
    }
  }

  Future<void> _openExternal(Uri uri) async {
    try {
      await _android.invokeMethod('openExternal', {'url': uri.toString()});
    } on PlatformException {
      // 外链无法打开时保持在可信页面，不回退到 WebView 内加载。
    }
  }

  Future<dynamic> _nativeCommand(dynamic raw) async {
    if (raw is! Map) return {'ok': false, 'error': 'invalid_payload'};
    final action = '${raw['action'] ?? ''}';
    if (action == 'vibrate') return _android.invokeMethod('vibrate');
    if (action == 'share') {
      return _android.invokeMethod('share', {'text': '${raw['text'] ?? ''}'});
    }
    if (action == 'openExternal') {
      return _android
          .invokeMethod('openExternal', {'url': '${raw['url'] ?? ''}'});
    }
    return {'ok': false, 'error': 'unsupported_action'};
  }
}

const _android = MethodChannel('com.openmusic.app/native');
