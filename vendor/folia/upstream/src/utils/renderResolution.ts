export const resolveRenderResolution = (
    width: number,
    height: number,
    requested: number | undefined,
    maxPixels = 3_000_000,
) => {
    const ratio = typeof requested === 'number' && Number.isFinite(requested) && requested > 0 ? requested : 1;
    const narrow = Math.min(width, height) <= 768;
    const budget = Math.min(maxPixels, narrow ? 1_500_000 : 3_000_000);
    return Math.min(ratio, narrow ? 1.5 : 2, Math.sqrt(budget / (Math.max(1, width) * Math.max(1, height))));
};
