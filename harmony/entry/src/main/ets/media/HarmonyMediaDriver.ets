import { avSession } from '@kit.AVSessionKit';
import { common, wantAgent, WantAgent } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { image } from '@kit.ImageKit';
import { NativeMediaDriver } from './MediaCoordinator';
import { NativePlayerState, PlayerAction } from './MediaProtocol';

export class HarmonyMediaDriver implements NativeMediaDriver {
  private session: avSession.AVSession | undefined;
  private agent: WantAgent | undefined;
  private cover: image.PixelMap | undefined;
  private activated: boolean = false;
  private metadataKey: string = '';
  private controlsKey: string = '';
  private context: common.UIAbilityContext;
  private command: (action: PlayerAction, time?: number) => void;
  private ready: Promise<void>;

  constructor(context: common.UIAbilityContext, command: (action: PlayerAction, time?: number) => void,
    ready: Promise<void> = Promise.resolve()) {
    this.context = context;
    this.command = command;
    this.ready = ready;
  }

  private async getAgent(): Promise<WantAgent> {
    if (!this.agent) {
      this.agent = await wantAgent.getWantAgent({
        wants: [{ bundleName: this.context.abilityInfo.bundleName, abilityName: this.context.abilityInfo.name }],
        operationType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      });
    }
    return this.agent;
  }

  async updateSession(state: NativePlayerState, audible: boolean): Promise<void> {
    await this.ready;
    if (!this.session) {
      this.session = await avSession.createAVSession(this.context, 'OpenMusic', 'audio');
      // 系统后台媒体接入要求订阅播放和暂停，执行前仍由服务与网页检查权限
      this.session.on('play', () => this.command('play'));
      this.session.on('pause', () => this.command('pause'));
      this.session.on('stop', () => this.command('stopLocal'));
    }
    const session = this.session;
    if (!this.cover) {
      // 首版复用本地品牌封面，不从原生请求带签名或 Cookie 的远端图片
      const bytes = await this.context.resourceManager.getMediaContent($r('app.media.app_icon').id);
      const source = image.createImageSource(bytes.buffer);
      try {
        this.cover = await source.createPixelMap();
      } finally {
        await source.release();
      }
    }
    const metadataKey = JSON.stringify([state.trackId, state.title, state.artist, state.duration]);
    if (metadataKey !== this.metadataKey) {
      await session.setAVMetadata({
        assetId: state.trackId, title: state.title, artist: state.artist,
        duration: Math.round(state.duration * 1000), mediaImage: this.cover
      });
      this.metadataKey = metadataKey;
    }
    const controlsKey = `${state.canSkip}:${state.canSeek}`;
    if (controlsKey !== this.controlsKey) {
      session.off('playNext');
      session.off('seek');
      if (state.canSkip) session.on('playNext', () => this.command('next'));
      if (state.canSeek) session.on('seek', (time: number) => this.command('seek', time / 1000));
      this.controlsKey = controlsKey;
    }
    await session.setAVPlaybackState({
      state: state.playing && audible ? avSession.PlaybackState.PLAYBACK_STATE_PLAY : avSession.PlaybackState.PLAYBACK_STATE_PAUSE,
      speed: 1,
      position: { elapsedTime: Math.round(state.position * 1000), updateTime: Date.now() }
    });
    if (!this.activated) {
      await session.setLaunchAbility(await this.getAgent());
      await session.activate();
      this.activated = true;
    }
  }

  async startBackground(): Promise<void> {
    await this.ready;
    await backgroundTaskManager.startBackgroundRunning(this.context,
      backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK, await this.getAgent());
  }

  async stopBackground(): Promise<void> {
    await this.ready;
    await backgroundTaskManager.stopBackgroundRunning(this.context);
  }

  async clearSession(): Promise<void> {
    await this.ready;
    if (this.session) {
      await this.session.destroy();
      this.session = undefined;
      this.activated = false;
      this.metadataKey = '';
      this.controlsKey = '';
    }
    if (this.cover) {
      await this.cover.release();
      this.cover = undefined;
    }
  }
}
