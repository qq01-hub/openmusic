import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NavigationDecision, NavigationPolicy } from '../security/NavigationPolicy';
import { createNavigationPolicy } from '../security/ArkWebPolicy';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { HarmonyMediaService, createHarmonyMediaService, releaseHarmonyMedia } from '../media/HarmonyMediaService';
import { PlayerProxy } from '../media/PlayerProxy';
import { NativeMediaWebAttributes } from '../media/NativeMediaWebAttributes';
import { decodePlayerMessage, PlayerAction } from '../media/MediaProtocol';

interface NativeCommand {
  source: string;
  token: string;
  trackId: string;
  action: PlayerAction;
  time?: number;
}

@Entry
@Component
struct Index {
  @State private serverOrigin: string = '';
  @State private loading: boolean = true;
  @State private progress: number = 0;
  @State private errorMessage: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private policy: NavigationPolicy = createNavigationPolicy('');
  private loadTimer: number = -1;
  private media: HarmonyMediaService | undefined;
  private mediaToken: string = '';
  private mediaSequence: number = 0;
  private mediaReady: boolean = false;
  private lastMediaReportAt: number = 0;
  private lastMediaErrorAt: number = 0;
  private playerProxy: PlayerProxy = new PlayerProxy((payload: string): string => this.receivePlayerState(payload));
  private nativeMediaAttributes: NativeMediaWebAttributes = new NativeMediaWebAttributes();

  aboutToAppear(): void {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      this.policy = createNavigationPolicy(context.resourceManager.getStringSync($r('app.string.server_url').id));
      this.serverOrigin = this.policy.origin;
      if (!this.serverOrigin) {
        this.fail('请先配置有效的 HTTPS 站点地址，再重新构建应用');
      } else {
        this.media = createHarmonyMediaService(context,
          (action: PlayerAction, trackId: string, time?: number) => this.sendPlayerCommand(action, trackId, time),
          (operation: string) => this.reportMediaFailure(operation));
        this.startLoading();
      }
    } catch {
      this.fail('无法读取站点配置，请检查应用资源后重新构建');
    }
  }

  aboutToDisappear(): void {
    this.clearLoadTimer();
    this.policy.reset();
    this.resetPlayerBridge();
    releaseHarmonyMedia();
    this.media = undefined;
  }

  private isTrustedPlayerPage(): boolean {
    try {
      return this.policy.isTrustedOrigin(this.controller.getUrl());
    } catch {
      return false;
    }
  }

  private resetPlayerBridge(): void {
    this.mediaReady = false;
    this.mediaToken = '';
    this.mediaSequence = 0;
    this.lastMediaReportAt = 0;
    this.media?.update(null);
  }

  private attachPlayerBridge(): void {
    if (!this.media || !this.isTrustedPlayerPage()) return;
    try {
      const bytes = cryptoFramework.createRandom().generateRandomSync(32).data;
      let token = '';
      for (let index = 0; index < bytes.length; index++) token += bytes[index].toString(16).padStart(2, '0');
      this.mediaToken = token;
      this.mediaSequence = 0;
      this.mediaReady = false;
      // runJavaScript 仅对主框架注入，外站和 iframe 不获得令牌
      const script = `if(window===window.top && location.origin===${JSON.stringify(this.serverOrigin)}) {
        Object.defineProperty(window,'__OPENMUSIC_HARMONY_TOKEN__',{value:${JSON.stringify(token)},configurable:true});
      }`;
      this.controller.runJavaScript(script).then(() => {
        if (this.mediaToken === token && this.isTrustedPlayerPage()) this.mediaReady = true;
      }).catch(() => this.reportMediaFailure('bridge-attach'));
    } catch {
      this.reportMediaFailure('bridge-attach');
    }
  }

  private receivePlayerState(payload: string): string {
    if (!this.mediaReady || !this.media || !this.isTrustedPlayerPage()) return 'untrusted';
    const message = decodePlayerMessage(payload, this.mediaToken, this.mediaSequence);
    if (!message) return 'invalid';
    const now = Date.now();
    // 清理消息不受节流影响，避免离房后卡片遗留
    if (message.state && now - this.lastMediaReportAt < 100) return 'rate-limited';
    this.lastMediaReportAt = now;
    this.mediaSequence = message.seq;
    this.media.update(message.state);
    return 'ok';
  }

  private sendPlayerCommand(action: PlayerAction, trackId: string, time?: number): void {
    if (!this.mediaReady || !this.isTrustedPlayerPage()) return;
    const detail: NativeCommand = { source: 'harmony', token: this.mediaToken, trackId, action, time };
    const script = `if(window===window.top && location.origin===${JSON.stringify(this.serverOrigin)} &&
      window.__OPENMUSIC_HARMONY_TOKEN__===${JSON.stringify(this.mediaToken)}) {
      window.dispatchEvent(new CustomEvent('omNativePlayerCommand',{detail:${JSON.stringify(detail)}}));
    }`;
    try {
      this.controller.runJavaScript(script).catch(() => this.reportMediaFailure('command'));
    } catch {
      this.reportMediaFailure('command');
    }
  }

  private reportMediaFailure(operation: string): void {
    const now = Date.now();
    if (now - this.lastMediaErrorAt < 5000) return;
    this.lastMediaErrorAt = now;
    hilog.warn(0x0000, 'OpenMusic', 'Media operation failed: %{public}s', operation);
    try {
      const message = operation === 'command-denied' ? '当前房间未授权该操作' : '系统媒体或后台播放能力不可用，锁屏播放可能中断';
      this.getUIContext().getPromptAction().showToast({ message });
    } catch {
      hilog.warn(0x0000, 'OpenMusic', 'Media failure prompt is unavailable');
    }
  }

  onBackPress(): boolean {
    if (!this.serverOrigin) return false;
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch {
      hilog.warn(0x0000, 'OpenMusic', 'Web history is unavailable');
    }
    return false;
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== -1) {
      clearTimeout(this.loadTimer);
      this.loadTimer = -1;
    }
  }

  private startLoading(): void {
    this.clearLoadTimer();
    this.loading = true;
    this.progress = 0;
    this.errorMessage = '';
    this.loadTimer = setTimeout(() => {
      this.fail('加载超时，请检查网络后重试');
      this.stopLoading();
    }, 30000);
  }

  private stopLoading(): void {
    try {
      this.controller.stop();
    } catch {
      hilog.warn(0x0000, 'OpenMusic', 'Web controller could not stop loading');
    }
  }

  private fail(message: string): void {
    this.clearLoadTimer();
    this.resetPlayerBridge();
    this.loading = false;
    this.errorMessage = message;
  }

  private retry(): void {
    this.policy.reset();
    this.startLoading();
    // 返回配置的首页，避免重放失败的 OAuth code 或其他一次性请求
    try {
      this.controller.loadUrl(this.serverOrigin);
    } catch {
      this.fail('网页尚未就绪，请稍后重试或重新打开应用');
    }
  }

  private openExternal(raw: string): void {
    // 同步异常也必须留在此处处理，不能打断导航拦截回调
    try {
      const context = getContext(this) as common.UIAbilityContext;
      context.startAbility({
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: raw
      }).catch(() => this.reportExternalFailure());
    } catch {
      this.reportExternalFailure();
    }
  }

  private reportExternalFailure(): void {
    // URL 可能包含私人信息，不写入日志或错误提示
    hilog.warn(0x0000, 'OpenMusic', 'External browser could not be opened');
    try {
      this.getUIContext().getPromptAction().showToast({ message: '无法打开外部浏览器' });
    } catch {
      hilog.warn(0x0000, 'OpenMusic', 'Browser failure prompt is unavailable');
    }
  }

  build() {
    Stack({ alignContent: Alignment.Top }) {
      if (this.serverOrigin !== '') {
        Web({ src: this.serverOrigin, controller: this.controller })
          .attributeModifier(this.nativeMediaAttributes)
          .javaScriptOnDocumentStart([{ script: `if(window===window.top && location.origin===${JSON.stringify(this.serverOrigin)}) {
            Object.defineProperty(window,'__OPENMUSIC_HARMONY_APP__',{value:true});
          }`, scriptRules: ['*'] }])
          .javaScriptProxy({ object: this.playerProxy, name: '__OPENMUSIC_HARMONY_PLAYER__',
            methodList: ['updateState'], controller: this.controller })
          .width('100%')
          .height('100%')
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(false)
          .mixedMode(MixedMode.None)
          .mediaPlayGestureAccess(true)
          .multiWindowAccess(false)
          .onAudioStateChanged((event) => {
            if (event && this.isTrustedPlayerPage()) this.media?.setAudible(event.playing);
          })
          .onLoadIntercept((event) => {
            if (!event) return true;
            const request = event.data;
            const decision = this.policy.decide(request.getRequestUrl(), request.isMainFrame(),
              request.isRequestGesture(), Date.now());
            if (decision === NavigationDecision.External) {
              this.openExternal(request.getRequestUrl());
            }
            return decision !== NavigationDecision.Allow;
          })
          .onPageBegin((event) => {
            if (!event) return;
            this.resetPlayerBridge();
            if (!this.policy.observe(event.url, Date.now())) {
              this.stopLoading();
              this.fail('已阻止不受信任的页面跳转，请返回首页');
              return;
            }
            this.startLoading();
          })
          .onPageEnd((event) => {
            if (!event) return;
            if (!this.policy.observe(event.url, Date.now())) {
              this.stopLoading();
              this.fail('登录跳转已过期或页面不受信任，请返回首页重试');
              return;
            }
            this.clearLoadTimer();
            this.loading = false;
            if (this.errorMessage === '') this.attachPlayerBridge();
          })
          .onProgressChange((event) => {
            if (event) this.progress = event.newProgress;
          })
          .onErrorReceive((event) => {
            if (event && event.request.isMainFrame()) {
              this.fail('网页加载失败，请检查网络后重试');
            }
          })
          .onHttpErrorReceive((event) => {
            if (event && event.request.isMainFrame()) {
              this.fail('站点暂时无法访问，请稍后重试');
            }
          })
          .onSslErrorEventReceive((event) => {
            if (event) event.handler.handleCancel();
            this.fail('站点证书验证失败，请联系站点管理员');
          })
      }
      if (this.loading && this.errorMessage === '') {
        Progress({ value: this.progress, total: 100, type: ProgressType.Linear })
          .width('100%')
          .color('#A78BFA')
      }
      if (this.errorMessage !== '') {
        Column({ space: 20 }) {
          Text('OpenMusic')
            .fontSize(28)
            .fontWeight(FontWeight.Bold)
            .fontColor('#F5F3FF')
          Text(this.errorMessage)
            .fontSize(16)
            .fontColor('#D1CFE0')
            .textAlign(TextAlign.Center)
          if (this.serverOrigin !== '') {
            Button('返回首页重试')
              .backgroundColor('#A78BFA')
              .fontColor('#181321')
              .onClick(() => this.retry())
          }
        }
        .width('100%')
        .height('100%')
        .padding(28)
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#14121C')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#14121C')
  }
}
