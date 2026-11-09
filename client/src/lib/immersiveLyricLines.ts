/**
 * 沉浸模式多语歌词分行（所有视觉预设共用：星河 3D / 声波地形 DOM）
 * - 独立 translation 字段
 * - 或「原文 （翻译）」括号格式
 * - 或文本内已有换行
 */

export interface ResolveImmersiveLyricOptions {
  /** 是否显示翻译，默认 true */
  showTranslation?: boolean;
  /** 新版沉浸翻译模式；off 优先于 showTranslation */
  translationMode?: 'off' | 'current' | 'dual' | 'multi';
}

export function immersiveLyricLineCount(fx: {
  lyricDisplayMode: 'single' | 'dual' | 'triple' | 'cinema' | 'custom';
  lyricCustomLineCount: number;
}): number {
  if (fx.lyricDisplayMode === 'single') return 1;
  if (fx.lyricDisplayMode === 'dual') return 2;
  if (fx.lyricDisplayMode === 'triple') return 3;
  if (fx.lyricDisplayMode === 'cinema') return 5;
  return Math.max(1, Math.min(10, Math.round(fx.lyricCustomLineCount) || 3));
}

/** 相对当前行的偏移（不含边界裁剪）。dual 固定当前+下一句。 */
export function immersiveLyricOffsets(fx: Parameters<typeof immersiveLyricLineCount>[0]): number[] {
  const count = immersiveLyricLineCount(fx);
  if (fx.lyricDisplayMode === 'dual') return [0, 1];
  const activeSlot = Math.floor(count / 2);
  return Array.from({ length: count }, (_, index) => index - activeSlot);
}

/**
 * 滑动窗口：尽量凑满设定行数。
 * 旧逻辑直接 filter 负索引，歌开头自定义 10 行会只剩 5 行。
 */
export function immersiveLyricIndexes(
  activeIndex: number,
  total: number,
  fx: Parameters<typeof immersiveLyricLineCount>[0],
): number[] {
  if (activeIndex < 0 || total <= 0) return [];
  const count = immersiveLyricLineCount(fx);
  if (count <= 1) return [activeIndex];

  if (fx.lyricDisplayMode === 'dual') {
    const indexes = [activeIndex];
    if (activeIndex + 1 < total) indexes.push(activeIndex + 1);
    return indexes;
  }

  const window = Math.min(count, total);
  let start = activeIndex - Math.floor(window / 2);
  if (start < 0) start = 0;
  if (start + window > total) start = Math.max(0, total - window);
  return Array.from({ length: window }, (_, index) => start + index);
}

function stripEmbeddedTranslation(text: string): string {
  const m = text.match(/^(.*)\s*[（(]\s*([^（）()\n]+?)\s*[）)]\s*$/u);
  const head = m?.[1]?.trim();
  return head || text;
}

export function resolveImmersiveLyricLines(
  text: string,
  translation?: string | null,
  options?: ResolveImmersiveLyricOptions,
): string[] {
  const translationMode = options?.translationMode;
  const showTranslation = options?.showTranslation !== false && translationMode !== 'off';
  const original = String(text || '').replace(/\r\n/g, '\n').trim();
  const trans = String(translation || '').replace(/\r\n/g, '\n').trim();

  if (!showTranslation) {
    if (!original) return [];
    if (original.includes('\n')) {
      const first = original.split('\n').map((line) => line.trim()).find(Boolean);
      return first ? [stripEmbeddedTranslation(first)] : [];
    }
    return [stripEmbeddedTranslation(original)];
  }

  if (original && trans && original !== trans) {
    return [original, `（${trans.replace(/^[（(]|[）)]$/g, '').trim()}）`];
  }

  if (!original) return [];

  if (original.includes('\n')) {
    return original
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  // 贪婪取末尾一对括号作为翻译
  const m = original.match(/^(.*)\s*[（(]\s*([^（）()\n]+?)\s*[）)]\s*$/u);
  const head = m?.[1]?.trim();
  const tail = m?.[2]?.trim();
  if (head && tail) {
    return [head, `（${tail}）`];
  }

  return [original];
}

/** 同时间戳相邻行合并为原文 + 翻译（常见双语 LRC） */
export function mergeLyricTranslations<T extends { time: number; text: string; translation?: string }>(
  lines: T[],
): T[] {
  if (lines.length < 2) return lines;

  const out: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    const next = lines[i + 1];
    const curText = String(cur.text || '').trim();
    const nextText = String(next?.text || '').trim();

    if (
      next
      && Math.abs(next.time - cur.time) < 0.051
      && !cur.translation
      && curText
      && nextText
      && curText !== nextText
    ) {
      out.push({ ...cur, text: curText, translation: nextText });
      i += 1;
      continue;
    }

    out.push(cur);
  }
  return out;
}

/** 只补全同一句、同时间轴的译文，已有译文始终优先 */
export function supplementLyricTranslations<T extends { time: number; text: string; translation?: string }>(
  lines: T[],
  translations: unknown,
): T[] {
  if (!Array.isArray(translations)) return lines;
  const valid = translations.filter((line): line is { time: number; text: string; translation: string } =>
    line && Number.isFinite(line.time) && typeof line.text === 'string'
    && typeof line.translation === 'string' && line.translation.length <= 500
    && /[\u3400-\u9fff]/u.test(line.translation));
  let changed = false;
  const result = lines.map(line => {
    if (line.translation) return line;
    const match = valid.find(other => other.text === line.text && Math.abs(other.time - line.time) < 0.051);
    if (!match) return line;
    changed = true;
    return { ...line, translation: match.translation };
  });
  return changed ? result : lines;
}

export function serializeLyricTranslations(lines: { time: number; translation?: string }[]): string {
  return lines.filter(line => line.translation && Number.isFinite(line.time)).map(line => {
    const ms = Math.max(0, Math.round(line.time * 1000));
    const minutes = String(Math.floor(ms / 60000)).padStart(2, '0');
    const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    return `[${minutes}:${seconds}.${String(ms % 1000).padStart(3, '0')}]${line.translation}`;
  }).join('\n');
}
