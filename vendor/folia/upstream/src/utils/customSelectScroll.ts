// 只调整下拉列表自身的滚动位置，不带动外层设置面板或页面
export function centeredOptionScrollTop(optionTop: number, optionHeight: number, viewportHeight: number, contentHeight: number): number {
  const maximum = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(maximum, optionTop - (viewportHeight - optionHeight) / 2));
}

// 键盘导航就近显示，不调用会连带滚动宿主面板的 scrollIntoView
export function nearestOptionScrollTop(optionTop: number, optionHeight: number, viewportHeight: number, contentHeight: number, currentScrollTop: number): number {
  const target = optionTop < currentScrollTop ? optionTop
    : optionTop + optionHeight > currentScrollTop + viewportHeight ? optionTop + optionHeight - viewportHeight : currentScrollTop;
  return Math.max(0, Math.min(Math.max(0, contentHeight - viewportHeight), target));
}
