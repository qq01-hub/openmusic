export const resolveRenderResolution = (
    width: number,
    height: number,
    requested: number | undefined,
    maxPixels = 3_000_000,
) => {
    const ratio = typeof requested === 'number' && Number.isFinite(requested) && requested > 0 ? requested : 1;
    return Math.min(ratio, 2, Math.sqrt(maxPixels / (Math.max(1, width) * Math.max(1, height))));
};
