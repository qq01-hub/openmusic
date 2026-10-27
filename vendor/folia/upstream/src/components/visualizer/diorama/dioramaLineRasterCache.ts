import { requestVisualizerFrame, cancelVisualizerFrame } from '@/utils/frameRateLimiter';
import { type DioramaLineRaster, rasterDioramaLine } from './dioramaTextRaster';
import { NEIGHBOR_RASTER_BUDGET } from './dioramaSceneConstants';
import { type VisibleLineEntry } from './dioramaSceneTypes';

// src/components/visualizer/diorama/dioramaLineRasterCache.ts
// 邻行整行栅格缓存：按全局行号缓存，字体或歌词版本变了整体作废，不再需要的行释放纹理，
// 缺的行每个动画帧只栅格化几行（切歌那一帧不一次性栅格化）。DioramaScene 的 effect 只负责调用。

export interface DioramaLineRasterSyncInput {
    visibleLines: readonly VisibleLineEntry[];
    globalIndex: number;
    fontSpec: string;
    fontStack: string;
    fontWeight: number;
    linesEpoch: number;
    /** Called whenever textures landed or were dropped, so the planes re-render. */
    onChange: () => void;
}

export class DioramaLineRasterCache {
    /** Global line index -> its whole-line raster; consumers read it live. */
    readonly rasters = new Map<number, DioramaLineRaster>();
    private font = '';
    private epoch = -1;

    get(index: number) {
        return this.rasters.get(index);
    }

    /**
     * Prunes and flushes synchronously (cheap), then rasterises the missing lines a few per animation
     * frame. Returns the cancel for the pending batches, if any were scheduled.
     */
    sync({ visibleLines, globalIndex, fontSpec, fontStack, fontWeight, linesEpoch, onChange }: DioramaLineRasterSyncInput) {
        const cache = this.rasters;
        // A cached raster is only ever built for a MISSING index, so a lyric swap under a live index would
        // otherwise keep serving the previous song's words at the right place forever. Flush on the epoch
        // for the same reason the font change flushes: every entry is now derived from stale input.
        if (this.font !== fontSpec || this.epoch !== linesEpoch) {
            cache.forEach((raster) => raster.texture.dispose());
            cache.clear();
            this.font = fontSpec;
            this.epoch = linesEpoch;
        }
        const wanted = new Set<number>();
        visibleLines.forEach(({ index, line }) => {
            if (line?.fullText && index !== globalIndex) wanted.add(index);
        });
        let changed = false;
        cache.forEach((raster, index) => {
            if (!wanted.has(index)) {
                raster.texture.dispose();
                cache.delete(index);
                changed = true;
            }
        });
        const missing: number[] = [];
        wanted.forEach((index) => { if (!cache.has(index)) missing.push(index); });
        if (missing.length === 0) {
            if (changed) onChange();
            return undefined;
        }
        let cancelled = false;
        let rafId = 0;
        let qi = 0;
        const buildBatch = () => {
            if (cancelled) return;
            for (let n = 0; n < NEIGHBOR_RASTER_BUDGET && qi < missing.length; n += 1, qi += 1) {
                const entry = visibleLines.find((e) => e.index === missing[qi]);
                if (entry?.line?.fullText && !cache.has(missing[qi])) {
                    cache.set(missing[qi], rasterDioramaLine(entry.line.fullText, fontStack, fontWeight));
                }
            }
            onChange();
            if (qi < missing.length) rafId = requestVisualizerFrame(buildBatch);
        };
        rafId = requestVisualizerFrame(buildBatch);
        return () => { cancelled = true; if (rafId) cancelVisualizerFrame(rafId); };
    }

    /**
     * Builds the line the camera is LEAVING synchronously: it was drawn as per-glyph units until this
     * frame, so its whole-line raster has to exist the instant a transition demotes it to a plane.
     */
    ensureOutgoing(transitionOutgoingIndex: number, visibleLines: readonly VisibleLineEntry[], fontStack: string, fontWeight: number) {
        if (!this.rasters.has(transitionOutgoingIndex)) {
            const leaving = visibleLines.find((entry) => entry.index === transitionOutgoingIndex);
            if (leaving?.line?.fullText) {
                this.rasters.set(transitionOutgoingIndex, rasterDioramaLine(leaving.line.fullText, fontStack, fontWeight));
            }
        }
    }

    disposeAll() {
        this.rasters.forEach((raster) => raster.texture.dispose());
        this.rasters.clear();
    }
}
