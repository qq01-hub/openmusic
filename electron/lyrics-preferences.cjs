const fs = require('node:fs');
const { DEFAULT_LYRICS_STYLE, normalizeLyricsStyle } = require('./lyrics-style.cjs');

const DEFAULT_LYRICS_PREFERENCES = Object.freeze({ locked: false, position: null, style: DEFAULT_LYRICS_STYLE });

function validPosition(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: Math.round(value.x), y: Math.round(value.y) };
}

function normalizeLyricsPreferences(value) {
  return {
    locked: Boolean(value?.locked),
    position: validPosition(value?.position),
    style: normalizeLyricsStyle(value?.style),
  };
}

function readLyricsPreferences(filePath) {
  try { return normalizeLyricsPreferences(JSON.parse(fs.readFileSync(filePath, 'utf8'))); } catch { return { ...DEFAULT_LYRICS_PREFERENCES, style: { ...DEFAULT_LYRICS_STYLE } }; }
}

function writeLyricsPreferences(filePath, value) {
  try { fs.writeFileSync(filePath, JSON.stringify(normalizeLyricsPreferences(value)), 'utf8'); } catch { /* preferences are best-effort */ }
}

module.exports = { DEFAULT_LYRICS_PREFERENCES, normalizeLyricsPreferences, readLyricsPreferences, writeLyricsPreferences };
