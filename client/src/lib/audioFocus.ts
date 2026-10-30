/** 系统媒体中断只影响本机，后台同步必须等待用户主动恢复 */
const interruptedAudio = new WeakSet<HTMLAudioElement>();

export function isAudioFocusInterrupted(audio: HTMLAudioElement): boolean {
  return interruptedAudio.has(audio);
}

export function interruptAudioFocus(audio: HTMLAudioElement): void {
  interruptedAudio.add(audio);
}

export function resumeAudioFocus(audio: HTMLAudioElement): void {
  interruptedAudio.delete(audio);
}
