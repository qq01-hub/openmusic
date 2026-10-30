import { getSharedAudio } from './audioElement';

type AudioTask = () => void | Promise<void>;
type QueuedAudioTask = { run: AudioTask; cancel: () => void };

/**
 * 全局单例音频执行队列：play / pause / seek / load 串行执行，
 * 避免并发操作打断 decode pipeline 导致无声或重播。
 */
class AudioController {
  private queue: QueuedAudioTask[] = [];
  private running = false;

  get audio(): HTMLAudioElement {
    return getSharedAudio();
  }

  get isRunning(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** 入队并等待该任务完成 */
  exec(task: AudioTask): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        run: async () => {
          try {
            await task();
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        cancel: resolve,
      });
      void this.drain();
    });
  }

  /** 入队，不等待完成 */
  enqueue(task: AudioTask): void {
    void this.exec(task);
  }

  clearQueue(): void {
    // 跳过的任务也必须结束等待，让换曲流程继续检查 generation 并释放加载锁
    const skipped = this.queue.splice(0);
    for (const task of skipped) task.cancel();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await task.run();
      } catch {
        // 继续执行后续任务
      }
    }
    this.running = false;
    if (this.queue.length > 0) {
      void this.drain();
    }
  }
}

let controller: AudioController | null = null;

export function getAudioController(): AudioController {
  if (!controller) {
    controller = new AudioController();
  }
  return controller;
}
