export function findFoliaLyricIndex(lines: readonly { startTime: number }[], time: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].startTime <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
