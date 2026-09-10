const active = document.querySelector('#active');
const translation = document.querySelector('#translation');
const shell = document.querySelector('.lyrics-shell');
const stage = document.querySelector('.lyrics-stage');
const lock = document.querySelector('#lock');
const settings = document.querySelector('#settings');
const close = document.querySelector('#close');
let dragging = false;

function applyStyle(style) {
  const root = document.documentElement;
  root.style.setProperty('--active-color', style.activeColor);
  root.style.setProperty('--active-size', `${style.activeFontSize}px`);
  root.style.setProperty('--translation-color', style.translationColor);
  root.style.setProperty('--translation-size', `${style.translationFontSize}px`);
}

function updateText(payload) {
  const translationText = payload.translation || '';
  active.textContent = payload.activeText || '暂无歌词';
  translation.textContent = translationText;
  translation.hidden = !translationText;
  shell.classList.toggle('has-translation', Boolean(translationText));
}

shell.addEventListener('pointerenter', () => shell.classList.add('is-hovered'));
shell.addEventListener('pointerleave', () => shell.classList.remove('is-hovered'));
stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || shell.classList.contains('is-locked')) return;
  dragging = true;
  stage.setPointerCapture(event.pointerId);
  window.lyricsAPI.startDrag();
});
stage.addEventListener('pointermove', () => { if (dragging) window.lyricsAPI.moveDrag(); });
stage.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  window.lyricsAPI.endDrag();
});
stage.addEventListener('pointercancel', () => { if (dragging) { dragging = false; window.lyricsAPI.endDrag(); } });
lock.addEventListener('click', () => void window.lyricsAPI.toggleLock());
settings.addEventListener('click', () => void window.lyricsAPI.openSettings());
close.addEventListener('click', () => void window.lyricsAPI.close());
window.lyricsAPI.onUpdate(updateText);
window.lyricsAPI.onStyleUpdate(applyStyle);
window.lyricsAPI.onLockUpdate((locked) => {
  shell.classList.toggle('is-locked', locked);
  lock.textContent = locked ? '🔒' : '🔓';
  lock.setAttribute('aria-label', locked ? '解锁歌词位置' : '锁定歌词位置');
  shell.title = locked ? '歌词位置已锁定；点击锁图标可解锁' : '拖动可移动；点击锁图标可锁定';
});
