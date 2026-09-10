const TRAY_LYRICS_BOUNDS = Object.freeze({ width: 800, height: 64 });

function lockLyricsBounds(bounds) {
  return { x: bounds.x, y: bounds.y, width: TRAY_LYRICS_BOUNDS.width, height: TRAY_LYRICS_BOUNDS.height };
}

function shouldHideToTray(isQuitting) {
  return !isQuitting;
}

module.exports = { TRAY_LYRICS_BOUNDS, lockLyricsBounds, shouldHideToTray };
