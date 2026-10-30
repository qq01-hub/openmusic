import { common } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { HarmonyMediaDriver } from './HarmonyMediaDriver';
import { MediaCoordinator } from './MediaCoordinator';
import { NativePlayerState, PlayerAction, canDispatch } from './MediaProtocol';

export class HarmonyMediaService {
  private coordinator: MediaCoordinator;
  private current: NativePlayerState | null = null;
  private suspended: boolean = false;
  private observedPause: boolean = false;
  private audible: boolean = false;
  private foreground: boolean = true;
  private closed: boolean = false;
  private listening: boolean = false;
  private dispatch: (action: PlayerAction, trackId: string, time?: number) => void;
  private report: (operation: string) => void;
  private cancelled: (info: backgroundTaskManager.ContinuousTaskCancelInfo) => void = (info) => {
    if (info.reason === backgroundTaskManager.ContinuousTaskCancelReason.USER_CANCEL) this.stopFromSystem();
    this.audible = false;
    void this.coordinator.backgroundCancelled();
    this.report('background-cancelled');
  };

  constructor(context: common.UIAbilityContext,
    dispatch: (action: PlayerAction, trackId: string, time?: number) => void,
    report: (operation: string) => void, ready: Promise<void>) {
    this.dispatch = dispatch;
    this.report = report;
    this.coordinator = new MediaCoordinator(new HarmonyMediaDriver(context, (action: PlayerAction, time?: number) => {
      if (action === 'stopLocal') this.stopFromSystem();
      else if (canDispatch(this.current, action, time) && this.current) this.dispatch(action, this.current.trackId, time);
      else this.report('command-denied');
    }, ready), report);
    if (deviceInfo.sdkApiVersion >= 15) {
      try {
        backgroundTaskManager.on('continuousTaskCancel', this.cancelled);
        this.listening = true;
      } catch {
        this.report('cancel-listener');
      }
    }
  }

  update(state: NativePlayerState | null): void {
    if (this.closed) return;
    if (!state) {
      this.suspended = false;
      this.observedPause = false;
      this.audible = false;
    } else if (this.suspended) {
      if (!state.playing) this.observedPause = true;
      if (!state.playing || !this.observedPause || !this.foreground) return;
      this.suspended = false;
    }
    this.current = state;
    void this.coordinator.update(state);
    if (state) void this.coordinator.setAudible(this.audible);
  }

  setAudible(playing: boolean): void {
    this.audible = playing;
    if (!this.closed && !this.suspended) void this.coordinator.setAudible(playing);
  }

  setForeground(value: boolean): void {
    this.foreground = value;
  }

  private stopFromSystem(): void {
    if (this.closed) return;
    if (this.current) this.dispatch('stopLocal', this.current.trackId);
    this.current = null;
    this.audible = false;
    this.suspended = true;
    this.observedPause = false;
    void this.coordinator.update(null);
  }

  dispose(): Promise<void> {
    this.closed = true;
    this.current = null;
    if (this.listening) {
      try {
        backgroundTaskManager.off('continuousTaskCancel', this.cancelled);
      } catch {
        this.report('cancel-unsubscribe');
      }
      this.listening = false;
    }
    return this.coordinator.dispose();
  }
}

let activeService: HarmonyMediaService | undefined;
let cleanup: Promise<void> = Promise.resolve();
let foreground: boolean = true;

export function createHarmonyMediaService(context: common.UIAbilityContext,
  dispatch: (action: PlayerAction, trackId: string, time?: number) => void,
  report: (operation: string) => void): HarmonyMediaService {
  if (activeService) cleanup = activeService.dispose();
  activeService = new HarmonyMediaService(context, dispatch, report, cleanup);
  activeService.setForeground(foreground);
  return activeService;
}

export function setHarmonyMediaForeground(value: boolean): void {
  foreground = value;
  activeService?.setForeground(value);
}

export function releaseHarmonyMedia(): void {
  if (activeService) {
    cleanup = activeService.dispose();
    activeService = undefined;
  }
}
