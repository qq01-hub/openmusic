import * as THREE from 'three';
import { type Line } from '../../../types';
import { type DioramaTextPlacement } from './cameraPath';
import { type DioramaUnitRaster } from './dioramaTextRaster';

// src/components/visualizer/diorama/dioramaSceneTypes.ts
// 镜台场景内部结构：可见行、阻尼主题色、当前行的单元与其栅格。

export interface VisibleLineEntry {
    index: number;
    line: Line;
    placement: DioramaTextPlacement;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    /** True for lines belonging to the OUTGOING corridor during a transition (a different segment than
     * the active one): rendered as a receding departing cluster rather than the current-song neighbours. */
    isOutgoing: boolean;
}

export interface DampedThemeColors {
    primary: THREE.Color;
    accent: THREE.Color;
    secondary: THREE.Color;
    bg: THREE.Color;
}

// One "unit" of the active line, rendered as its OWN plane: a single grapheme for CJK (每个字单独),
// a whole word for other scripts (每个词单独). charStart/charEnd are code-unit indices into the line
// string, used to measure the unit's exact slot in the full-line layout (kerning preserved).
export interface LyricUnit {
    text: string;
    charStart: number;
    charEnd: number;
    startTime: number;
    endTime: number;
}

// Graphemes that split per character: han, kana, compatibility ideographs, half-width kana, PLUS
// bullets/geometric shapes (the interlude countdown dots ●●● must each be their own unit so the
// glow can centre on each dot). Everything else (latin etc.) groups into per-word units.
export const CJK_GRAPHEME_RE = /[⺀-鿿぀-ヿ豈-﫿ｦ-ﾟ•·■-◿]/;

// A laid-out, rasterised unit of the active line, in world units at scale 1.
export interface PlacedUnitRaster {
    raster: DioramaUnitRaster;
    centerX: number;
    width: number;
    height: number;
}
