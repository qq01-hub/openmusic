const activeColor = document.querySelector('#active-color');
const activeSize = document.querySelector('#active-size');
const activeSizeValue = document.querySelector('#active-size-value');
const translationColor = document.querySelector('#translation-color');
const translationSize = document.querySelector('#translation-size');
const translationSizeValue = document.querySelector('#translation-size-value');
const close = document.querySelector('#settings-close');

function render(style) {
  activeColor.value = style.activeColor;
  activeSize.value = String(style.activeFontSize);
  activeSizeValue.textContent = `${style.activeFontSize}px`;
  translationColor.value = style.translationColor;
  translationSize.value = String(style.translationFontSize);
  translationSizeValue.textContent = `${style.translationFontSize}px`;
}

function send() {
  window.lyricsSettingsAPI.set({ activeColor: activeColor.value, activeFontSize: Number(activeSize.value), translationColor: translationColor.value, translationFontSize: Number(translationSize.value) });
}

close.addEventListener('click', () => void window.lyricsSettingsAPI.close());
activeColor.addEventListener('input', send);
activeSize.addEventListener('input', send);
translationColor.addEventListener('input', send);
translationSize.addEventListener('input', send);
window.lyricsSettingsAPI.onUpdate(render);
void window.lyricsSettingsAPI.get().then(render);
