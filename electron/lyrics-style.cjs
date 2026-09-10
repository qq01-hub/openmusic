const DEFAULT_LYRICS_STYLE = Object.freeze({
  activeColor: '#a7ffb8',
  activeFontSize: 22,
  translationColor: '#ffffff',
  translationFontSize: 18,
});

function normalizeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function normalizeFontSize(value, fallback) {
  const size = Number(value);
  return Number.isFinite(size) ? Math.min(32, Math.max(12, Math.round(size))) : fallback;
}

function normalizeLyricsStyle(value) {
  return {
    activeColor: normalizeColor(value?.activeColor, DEFAULT_LYRICS_STYLE.activeColor),
    activeFontSize: normalizeFontSize(value?.activeFontSize, DEFAULT_LYRICS_STYLE.activeFontSize),
    translationColor: normalizeColor(value?.translationColor, DEFAULT_LYRICS_STYLE.translationColor),
    translationFontSize: normalizeFontSize(value?.translationFontSize, DEFAULT_LYRICS_STYLE.translationFontSize),
  };
}

module.exports = { DEFAULT_LYRICS_STYLE, normalizeLyricsStyle };
