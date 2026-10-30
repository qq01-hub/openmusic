import { NativePlayerState } from './MediaProtocol';

export interface NativeMediaDriver {
  updateSession(state: NativePlayerState, audible: boolean): Promise<void>;
  clearSession(): Promise<void>;
  startBackground(): Promise<void>;
  stopBackground(): Promise<void>;
}

// 所有系统调用串行执行，异步操作完成后复核最新意图，避免离房与申请后台任务竞态
export class MediaCoordinator {
  private state: NativePlayerState | null = null;
  private audible: boolean = false;
  private closed: boolean = false;
  private revision: number = 0;
  private backgroundRunning: boolean = false;
  private cancellationVersion: number = 0;
  private retryAt: number = 0;
  private chain: Promise<void> = Promise.resolve();
  private driver: NativeMediaDriver;
  private report: (operation: string) => void;
  private clock: () => number;

  constructor(driver: NativeMediaDriver, report: (operation: string) => void, clock: () => number = Date.now) {
    this.driver = driver;
    this.report = report;
    this.clock = clock;
  }

  update(state: NativePlayerState | null): Promise<void> {
    if (this.closed) return this.chain;
    this.state = state;
    if (!state) this.audible = false;
    this.revision++;
    return this.schedule();
  }

  setAudible(value: boolean): Promise<void> {
    if (this.closed || this.audible === value) return this.chain;
    this.audible = value;
    this.revision++;
    return this.schedule();
  }

  backgroundCancelled(): Promise<void> {
    this.cancellationVersion++;
    this.backgroundRunning = false;
    this.audible = false;
    this.revision++;
    return this.schedule();
  }

  dispose(): Promise<void> {
    this.closed = true;
    this.state = null;
    this.audible = false;
    this.revision++;
    return this.schedule();
  }

  private schedule(): Promise<void> {
    this.chain = this.chain.then(() => this.reconcile()).catch(() => this.report('session'));
    return this.chain;
  }

  private async stopBackground(): Promise<void> {
    if (!this.backgroundRunning) return;
    try {
      await this.driver.stopBackground();
      this.backgroundRunning = false;
    } catch {
      this.report('background-stop');
    }
  }

  private async reconcile(): Promise<void> {
    const state = this.state;
    const revision = this.revision;
    if (!state) {
      await this.stopBackground();
      await this.driver.clearSession();
      return;
    }
    const playing = state.playing && this.audible;
    if (!playing) await this.stopBackground();
    await this.driver.updateSession(state, this.audible);
    if (revision !== this.revision || this.closed) return;
    if (playing && !this.backgroundRunning && this.clock() >= this.retryAt) {
      const cancellationVersion = this.cancellationVersion;
      try {
        await this.driver.startBackground();
        if (cancellationVersion === this.cancellationVersion) {
          this.backgroundRunning = true;
        } else {
          // 系统取消可能先于申请回调送达，不能把已取消任务重新标为运行中
          try {
            await this.driver.stopBackground();
          } catch {
            this.report('background-cancel-cleanup');
          }
          this.backgroundRunning = false;
        }
        this.retryAt = 0;
      } catch {
        this.retryAt = this.clock() + 5000;
        this.report('background-start');
      }
    }
  }
}
