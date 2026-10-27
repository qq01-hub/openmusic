// src/utils/libraryWallLook.ts
// bravais 海报墙「透光」偏好的取值规则（纯函数，叶子层）：三档 look、部分透明时每块的窗数（1–6）、
// 窗数对应的百分比标注。store（useLibraryWallLookStore）、设置分区与命令面板共用这一份，免得各自再写一遍钳制。

/** 三档透光：实色（与 Lattice 一致）/ 部分透明（每块 k 个窗）/ 全透明（墙上磁贴都是窗，只显示标题）。 */
export type LibraryWallLook = 'solid' | 'partial' | 'clear';

/** 设置分区与命令面板列出的顺序。 */
export const LIBRARY_WALL_LOOKS: readonly LibraryWallLook[] = Object.freeze(['solid', 'partial', 'clear'] as const);

export const DEFAULT_LIBRARY_WALL_LOOK: LibraryWallLook = 'solid';

/** 一个 12×8 块里的 slot 数，与 `src/components/wall/blockTemplates.ts` 的 SLOTS_PER_BLOCK 相同（单测钉住）。 */
export const LIBRARY_WALL_SLOTS_PER_BLOCK = 12;

export const MIN_LIBRARY_WALL_WINDOWS_PER_BLOCK = 1;
export const MAX_LIBRARY_WALL_WINDOWS_PER_BLOCK = 6;
export const DEFAULT_LIBRARY_WALL_WINDOWS_PER_BLOCK = 3;

/** 部分透明可选的每块窗数：1…6。 */
export const LIBRARY_WALL_WINDOW_COUNTS: readonly number[] = Object.freeze(Array.from(
    { length: MAX_LIBRARY_WALL_WINDOWS_PER_BLOCK - MIN_LIBRARY_WALL_WINDOWS_PER_BLOCK + 1 },
    (_, index) => MIN_LIBRARY_WALL_WINDOWS_PER_BLOCK + index,
));

export const isLibraryWallLook = (value: unknown): value is LibraryWallLook => (
    value === 'solid' || value === 'partial' || value === 'clear'
);

/** 存储或外部传入的档位：认识的原样返回，其余（缺失、旧值、拼错）回默认档。 */
export const normalizeLibraryWallLook = (value: unknown): LibraryWallLook => (
    isLibraryWallLook(value) ? value : DEFAULT_LIBRARY_WALL_LOOK
);

/**
 * 每块窗数：数字或数字字符串取整后钳到 1–6；非数字、空串、NaN / Infinity 回默认 3。
 * 越界值钳到边界而不是回默认：存了 9 的人想要的是「尽量多」，给 6 比给 3 更接近。
 */
export const clampLibraryWallWindowsPerBlock = (value: unknown): number => {
    const numeric = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN);
    if (!Number.isFinite(numeric)) return DEFAULT_LIBRARY_WALL_WINDOWS_PER_BLOCK;
    return Math.min(
        MAX_LIBRARY_WALL_WINDOWS_PER_BLOCK,
        Math.max(MIN_LIBRARY_WALL_WINDOWS_PER_BLOCK, Math.round(numeric)),
    );
};

/** 窗数占一块的百分比（k / 12，四舍五入到整数）：1→8、3→25、6→50。只用于标注。 */
export const libraryWallWindowSharePercent = (windowsPerBlock: number): number => (
    Math.round((clampLibraryWallWindowsPerBlock(windowsPerBlock) / LIBRARY_WALL_SLOTS_PER_BLOCK) * 100)
);
