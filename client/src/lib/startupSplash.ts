/** 启动页支持键盘无鼠标进入，同时避开页面内的其他快捷键 */
export function isStartupSplashDismissKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

export type AuroraSpectrumBar = {
  u: number;
  edge: number;
  peak: number;
  val: number;
};

/** 初始化 K2 极光频谱柱阵列（两端平滑收边，中间保留多波峰起伏） */
export function createAuroraSpectrumBars(count: number): AuroraSpectrumBar[] {
  const safeCount = Math.max(2, Math.floor(count));
  const bars: AuroraSpectrumBar[] = [];
  for (let i = 0; i < safeCount; i++) {
    const u = i / (safeCount - 1);
    const edge = Math.pow(Math.sin(u * Math.PI), 0.55);
    bars.push({
      u,
      edge,
      peak: 0,
      val: 0,
    });
  }
  return bars;
}

/** 计算单根频谱柱在时间 t 下的目标归一化高度（3 重非对称交织波浪，保持波峰波谷落差鲜明且舒缓流淌） */
export function sampleAuroraWaveTarget(u: number, edge: number, t: number, env: number, fade: number): number {
  const w1 = Math.sin(u * Math.PI * 3.8 - t * 1.05);
  const w2 = Math.sin(u * Math.PI * 6.6 + t * 0.78 + 1.1);
  const w3 = Math.cos(u * Math.PI * 10.5 - t * 1.38 + Math.sin(t * 0.5 + u * 4));
  const raw = 0.5 + 0.25 * w1 + 0.16 * w2 + 0.09 * w3;
  const shaped = Math.pow(Math.max(0.05, Math.min(1, raw)), 1.32);
  const pulse = 0.08 * env * (0.5 + 0.5 * w1);
  return (0.06 + edge * (0.08 + 0.82 * shaped + pulse)) * fade;
}
