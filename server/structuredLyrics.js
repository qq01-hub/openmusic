const MAX_LYRIC_LENGTH = 1024 * 1024;
const FORMATS = new Set(['yrc', 'qrc', 'krc', 'ttml', 'enhanced-lrc']);

export function normalizeStructuredLyrics(body) {
  let data;
  try { data = JSON.parse(body); } catch { data = { lyric: body }; }
  if (typeof data === 'string') data = { lyric: data };
  if (data?.data && typeof data.data === 'object') data = data.data;
  const text = value => typeof value === 'string' && value.length <= MAX_LYRIC_LENGTH ? value : '';
  const lyric = value => text(value?.lyric ?? value);
  const wordFormat = FORMATS.has(data?.wordFormat) && text(data?.wordLyric) ? data.wordFormat : '';
  return {
    version: 1,
    lyric: lyric(data?.lyric || data?.lrc),
    translation: lyric(data?.translation || data?.tlyric),
    romanization: lyric(data?.romanization || data?.romalrc),
    wordLyric: wordFormat ? text(data?.wordLyric) : '',
    wordFormat,
    source: wordFormat ? data?.source === 'amll' ? 'amll' : 'platform' : 'lrc',
  };
}

export async function readStructuredLyricResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_LYRIC_LENGTH * 4) throw new Error('lyric response too large');
    return body;
  }
  const chunks = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_LYRIC_LENGTH * 4) throw new Error('lyric response too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (timedOut) throw new Error('lyric response timeout');
  return Buffer.concat(chunks).toString('utf8');
}
