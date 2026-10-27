// src/utils/libraryWallSeamStyle.ts
// bravais 信息条（缝）实色模式的预设样式（设计稿 §5「缝的材质」）：取值、默认值、规范化，以及每个预设的材质——
// 以 CSS 自定义属性给出（纸色、整条背景、印刷预设的墨色）。stage 把它们写在根节点上、由 bravais 的样式消费，设置分区的
// 色样用同一份字符串画预览，两边不各写一遍。纯数据（叶子层）：不读 store、不 import React。
//
// 规则：
// - 全是静态背景（CSS 渐变 / 内联 SVG 的 data URI），不用图片资源、不做动画；图案的定位锚在缝的水平中线与顶边
//   （缝从中线向两侧张开，开合时图案不横向滑动）。
// - 主题系（paper / frost / 四种图案）跟主题变量走（--bg-color / --text-primary / --text-accent / --text-secondary），
//   日光 / 暗色两种模式自然成立；文字仍是主题主色，图案只用 ≤16% 的主题色细线 / 细点，不改变纸的明暗档。
// - 印刷系（white / black）是固定的纸与墨，不随主题翻转：在缝里把主题变量换成墨色（含强调色——单色印刷），
//   对比度约 17:1；另有一道双细线框与一层很淡的纸纹（单色 feTurbulence，固定 180px 的平铺，只栅格化一次）。
// - 「始终透明」开着时预设不生效（stage 不写这些变量），见 useLibraryWallLookStore。

/** 预设：主题纸色（现状，默认）/ 纯白印刷 / 纯黑印刷 / 磨砂主题色 / 细点阵 / 斜线 / 等高线 / 格纹。 */
export type LibraryWallSeamStyle = 'paper' | 'white' | 'black' | 'frost' | 'dots' | 'hatch' | 'contour' | 'check';

/** 设置分区与命令面板列出的顺序。 */
export const LIBRARY_WALL_SEAM_STYLES: readonly LibraryWallSeamStyle[] = Object.freeze([
    'paper', 'white', 'black', 'frost', 'dots', 'hatch', 'contour', 'check',
] as const);

export const DEFAULT_LIBRARY_WALL_SEAM_STYLE: LibraryWallSeamStyle = 'paper';

export const isLibraryWallSeamStyle = (value: unknown): value is LibraryWallSeamStyle => (
    typeof value === 'string' && (LIBRARY_WALL_SEAM_STYLES as readonly string[]).includes(value)
);

/** 存储或导入的取值：认识的原样返回，其余回默认（主题纸色）。 */
export const normalizeLibraryWallSeamStyle = (value: unknown): LibraryWallSeamStyle => (
    isLibraryWallSeamStyle(value) ? value : DEFAULT_LIBRARY_WALL_SEAM_STYLE
);

/** 各预设的界面名（设置分区、导入确认框共用；命令面板的 picker 另带英文兜底）。 */
export const LIBRARY_WALL_SEAM_STYLE_LABEL_KEYS: Readonly<Record<LibraryWallSeamStyle, string>> = Object.freeze({
    paper: 'options.bravaisSeamStylePaper',
    white: 'options.bravaisSeamStyleWhite',
    black: 'options.bravaisSeamStyleBlack',
    frost: 'options.bravaisSeamStyleFrost',
    dots: 'options.bravaisSeamStyleDots',
    hatch: 'options.bravaisSeamStyleHatch',
    contour: 'options.bravaisSeamStyleContour',
    check: 'options.bravaisSeamStyleCheck',
});

/** 印刷系预设：墨色是固定值，缝里的主题变量换成它。 */
export const isPrintSeamStyle = (style: LibraryWallSeamStyle) => style === 'white' || style === 'black';

const THEME_PAPER = 'color-mix(in srgb, var(--bg-color, #070707) 90%, var(--text-primary, #f7f4ee))';
const mixTheme = (variable: string, fallback: string, percent: number) => (
    `color-mix(in srgb, var(${variable}, ${fallback}) ${percent}%, transparent)`
);

/** 单色纸纹：feTurbulence 的红通道映射成很淡的 alpha（约 1%–5%），颜色是给定的墨色。 */
const grain = (rgb: string) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'>`
        + `<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/>`
        + `<feColorMatrix values='0 0 0 0 ${rgb} 0 0 0 0 ${rgb} 0 0 0 0 ${rgb} .12 0 0 0 -.03'/></filter>`
        + `<rect width='100%' height='100%' filter='url(#g)'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 50% 0 / 180px 180px`;
};

/** 印刷的双细线：两侧各一道 1px 的外框线，再往里 4px 一道更淡的线（像印刷品的版框）。 */
const printRules = (ink: string) => (
    `linear-gradient(90deg, ${ink} 0 1px, transparent 1px 5px, color-mix(in srgb, ${ink} 55%, transparent) 5px 6px, `
    + `transparent 6px calc(100% - 6px), color-mix(in srgb, ${ink} 55%, transparent) calc(100% - 6px) calc(100% - 5px), `
    + `transparent calc(100% - 5px) calc(100% - 1px), ${ink} calc(100% - 1px))`
);

export type LibraryWallSeamStyleLook = {
    /** 纸的底色（缝里的下拉框等控件也用它）。 */
    paper: string;
    /** 整条缝的 background 简写（图案层在前、纸色在最后）。 */
    surface: string;
    /** 印刷系的墨色与次级墨色；主题系为 null（文字沿用主题主色）。 */
    ink: string | null;
    inkSoft: string | null;
};

const PRINT_WHITE_INK = '#141414';
const PRINT_BLACK_INK = '#f3f1ec';

/** 每个预设的材质。paper 是现状（由 bravais.css 自己画，包括透光档下的半透明纸），这里给出等价的不透明预览。 */
export const LIBRARY_WALL_SEAM_STYLE_LOOKS: Readonly<Record<LibraryWallSeamStyle, LibraryWallSeamStyleLook>> = Object.freeze({
    paper: { paper: THEME_PAPER, surface: THEME_PAPER, ink: null, inkSoft: null },
    white: {
        paper: '#f7f6f2',
        surface: `${printRules('rgb(20 20 20 / 22%)')}, ${grain('0')}, #f7f6f2`,
        ink: PRINT_WHITE_INK,
        inkSoft: 'rgb(20 20 20 / 62%)',
    },
    black: {
        paper: '#101010',
        surface: `${printRules('rgb(243 241 236 / 24%)')}, ${grain('1')}, #101010`,
        ink: PRINT_BLACK_INK,
        inkSoft: 'rgb(243 241 236 / 64%)',
    },
    // 磨砂主题色：强调色 20% 混进底色的半透明纸（82%），上面一层强调色 → 第二色的斜向渐变（14% / 12%）与很淡的颗粒。
    // 实色档下透出的是墙面的光晕，透光档下隐约透出 visualizer。
    frost: {
        paper: 'color-mix(in srgb, color-mix(in srgb, var(--bg-color, #070707) 80%, var(--text-accent, #fd5c47)) 82%, transparent)',
        surface: `linear-gradient(165deg, ${mixTheme('--text-accent', '#fd5c47', 14)}, ${mixTheme('--text-secondary', '#6a48ff', 12)}), `
            + `${grain('1')}, `
            + 'color-mix(in srgb, color-mix(in srgb, var(--bg-color, #070707) 80%, var(--text-accent, #fd5c47)) 82%, transparent)',
        ink: null,
        inkSoft: null,
    },
    // 细点阵：主色 16% 的 1px 圆点，9px 一格。
    dots: {
        paper: THEME_PAPER,
        surface: `radial-gradient(circle, ${mixTheme('--text-primary', '#f7f4ee', 16)} 0 1px, transparent 1.6px) 50% 0 / 9px 9px, ${THEME_PAPER}`,
        ink: null,
        inkSoft: null,
    },
    // 斜线：强调色 14% 的 1px 斜线，每 7px 一道（像雕版的排线）。
    hatch: {
        paper: THEME_PAPER,
        surface: `repeating-linear-gradient(135deg, ${mixTheme('--text-accent', '#fd5c47', 14)} 0 1px, transparent 1px 7px), ${THEME_PAPER}`,
        ink: null,
        inkSoft: null,
    },
    // 等高线：两组同心椭圆环（主色 10%、第二色 14%，各 1px、16px / 22px 一圈），中心偏在缝中线的左上与右下（相对中线的
    // 固定像素偏移），穿过缝的是一段段弧线，交叠成地形图的样子。椭圆与偏移都是绝对尺寸：缝开合（变宽）时环不变形、不滑动。
    contour: {
        paper: THEME_PAPER,
        surface: `repeating-radial-gradient(ellipse 300px 190px at calc(50% - 150px) 24%, transparent 0 15px, ${mixTheme('--text-primary', '#f7f4ee', 10)} 15px 16px), `
            + `repeating-radial-gradient(ellipse 240px 330px at calc(50% + 170px) 82%, transparent 0 21px, ${mixTheme('--text-secondary', '#6a48ff', 14)} 21px 22px), `
            + THEME_PAPER,
        ink: null,
        inkSoft: null,
    },
    // 格纹（gingham）：强调色 7% 的横竖两组半格条纹，交叠处 14%，14px 一格；外加第二色 10% 的 1px 细格线。
    check: {
        paper: THEME_PAPER,
        surface: `linear-gradient(90deg, ${mixTheme('--text-accent', '#fd5c47', 7)} 50%, transparent 50%) 50% 0 / 14px 14px, `
            + `linear-gradient(${mixTheme('--text-accent', '#fd5c47', 7)} 50%, transparent 50%) 50% 0 / 14px 14px, `
            + `linear-gradient(90deg, ${mixTheme('--text-secondary', '#6a48ff', 10)} 0 1px, transparent 1px) 50% 0 / 56px 56px, `
            + THEME_PAPER,
        ink: null,
        inkSoft: null,
    },
});

/**
 * stage 根节点上写的自定义属性（paper 不写：bravais.css 的现状，含透光档的半透明纸）。
 * 印刷系另给墨色，bravais 的样式在缝里把主题变量换成它。
 */
export const libraryWallSeamStyleVars = (style: LibraryWallSeamStyle): Record<string, string> | null => {
    if (style === 'paper') return null;
    const look = LIBRARY_WALL_SEAM_STYLE_LOOKS[style];
    return {
        '--bravais-seam-paper': look.paper,
        '--bravais-seam-surface': look.surface,
        ...(look.ink && look.inkSoft ? { '--bravais-seam-print-ink': look.ink, '--bravais-seam-print-ink-soft': look.inkSoft } : {}),
    };
};
