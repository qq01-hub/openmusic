const MAX_SOURCE_BYTES = 96 * 1024 * 1024;

type Box = { size: number; offset: number; data: Uint8Array };
type StscEntry = { firstChunk: number; samplesPerChunk: number };

const encryptedBoxTypes = new Set(['senc', 'saio', 'saiz', 'sinf', 'schi', 'tenc', 'schm', 'frma']);
const containerBoxTypes = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);

function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, false);
}

function text(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function box(data: Uint8Array, wanted: string, start = 0, end = data.length): Box | null {
  let offset = start;
  while (offset + 8 <= end) {
    const size = u32(data, offset);
    if (size < 8 || offset + size > end) return null;
    if (text(data.subarray(offset + 4, offset + 8)) === wanted) {
      return { size, offset, data: data.subarray(offset + 8, offset + size) };
    }
    offset += size;
  }
  return null;
}

function bitCount(input: number): number {
  let value = input;
  value -= (value >> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
  return (((value + (value >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

function decodeSpadeA(value: string): string {
  const source = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (source.length < 3) return '';
  const padding = (source[0] ^ source[1] ^ source[2]) - 48;
  if (padding < 0 || source.length < padding + 2) return '';
  const input = source.subarray(1, source.length - padding);
  const working = new Uint8Array(input.length + 2);
  working.set([0xfa, 0x55]);
  working.set(input, 2);
  const decoded = new Uint8Array(input.length);
  for (let index = 0; index < decoded.length; index += 1) {
    let byte = (input[index] ^ working[index]) - bitCount(index) - 21;
    while (byte < 0) byte += 0xff;
    decoded[index] = byte & 0xff;
  }
  const first = decoded[0];
  const skip = first >= 48 && first <= 57 ? first - 48 : first >= 97 && first <= 122 ? first - 87 : 255;
  const end = 1 + source.length - padding - 2 - skip;
  return end > 1 && end <= decoded.length ? text(decoded.subarray(1, end)) : '';
}

function resolveKey(value: string): Uint8Array {
  const raw = value.trim();
  const hex = /^[0-9a-f]{32}$/i.test(raw) ? raw : decodeSpadeA(raw);
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('汽水音频密钥无效');
  return Uint8Array.from(hex.match(/../g)!, (part) => parseInt(part, 16));
}

/** 仅拷贝视图自身字节，避免 new Uint8Array(view).buffer 在已独立 buffer 上再复制一次。 */
function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return value.buffer as ArrayBuffer;
  }
  return value.slice().buffer as ArrayBuffer;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32Bytes(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function readResponse(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) throw new Error('汽水音频文件过大');
  if (!response.body) {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.length > MAX_SOURCE_BYTES) throw new Error('汽水音频文件过大');
    return value;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error('汽水音频文件过大');
    }
    chunks.push(result.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;
  return output;
}

function sampleSizes(stsz: Box): Uint32Array {
  const fixed = u32(stsz.data, 4);
  const count = u32(stsz.data, 8);
  if (count > 200_000 || (!fixed && 12 + count * 4 > stsz.data.length)) throw new Error('汽水音频样本数据无效');
  if (fixed) return new Uint32Array(count).fill(fixed);
  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) sizes[i] = u32(stsz.data, 12 + i * 4);
  return sizes;
}

function sampleToChunk(stsc: Box): StscEntry[] {
  const count = u32(stsc.data, 4);
  if (count > 20_000 || 8 + count * 12 > stsc.data.length) throw new Error('汽水音频 chunk 数据无效');
  const entries: StscEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * 12;
    entries.push({ firstChunk: u32(stsc.data, offset), samplesPerChunk: u32(stsc.data, offset + 4) });
  }
  return entries;
}

function samplesInChunk(chunk: number, entries: StscEntry[]): number {
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    if (chunk >= current.firstChunk && (!next || chunk < next.firstChunk)) return current.samplesPerChunk;
  }
  return 0;
}

function rebuiltChunkOffsets(sizes: Uint32Array, entries: StscEntry[], chunkCount: number, mdatOffset: number): number[] {
  const offsets: number[] = [];
  let sampleIndex = 0;
  let offset = mdatOffset;
  for (let chunk = 1; chunk <= chunkCount; chunk += 1) {
    offsets.push(offset);
    const count = samplesInChunk(chunk, entries);
    for (let index = 0; index < count && sampleIndex < sizes.length; index += 1) {
      offset += sizes[sampleIndex];
      sampleIndex += 1;
    }
  }
  return offsets;
}

function rewriteStco(data: Uint8Array, offsets: number[]): Uint8Array {
  const count = u32(data, 4);
  if (count > offsets.length) throw new Error('汽水音频 chunk 偏移无效');
  const output = new Uint8Array(8 + count * 4);
  output.set(data.subarray(0, 8));
  const view = new DataView(output.buffer);
  for (let index = 0; index < count; index += 1) view.setUint32(8 + index * 4, offsets[index], false);
  return output;
}

function cleanBoxChildren(source: Uint8Array, start: number, end: number, context: {
  sizes: Uint32Array;
  stsc: StscEntry[];
  chunkCount: number;
  mdatOffset: number;
}): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) {
      parts.push(source.subarray(offset, end));
      break;
    }
    const size = u32(source, offset);
    if (size < 8 || offset + size > end) {
      parts.push(source.subarray(offset, end));
      break;
    }
    const type = text(source.subarray(offset + 4, offset + 8));
    if (encryptedBoxTypes.has(type)) {
      offset += size;
      continue;
    }
    if (type === 'enca') {
      const fixedEnd = Math.min(offset + size, offset + 36);
      const fixed = source.subarray(offset + 8, fixedEnd);
      const inner = cleanBoxChildren(source, fixedEnd, offset + size, context);
      parts.push(u32Bytes(fixed.length + inner.length + 8), ascii('mp4a'), fixed, inner);
    } else if (type === 'stco') {
      const body = rewriteStco(source.subarray(offset + 8, offset + size), rebuiltChunkOffsets(
        context.sizes, context.stsc, context.chunkCount, context.mdatOffset,
      ));
      parts.push(u32Bytes(body.length + 8), ascii('stco'), body);
    } else if (containerBoxTypes.has(type)) {
      const fixedSize = type === 'stsd' ? 8 : 0;
      const fixedEnd = Math.min(offset + size, offset + 8 + fixedSize);
      const fixed = source.subarray(offset + 8, fixedEnd);
      const inner = cleanBoxChildren(source, fixedEnd, offset + size, context);
      parts.push(u32Bytes(fixed.length + inner.length + 8), ascii(type), fixed, inner);
    } else {
      parts.push(source.subarray(offset, offset + size));
    }
    offset += size;
  }
  return concat(parts);
}

function findFlacMetadata(stsd: Box): Uint8Array | null {
  const marker = new TextEncoder().encode('dfLa');
  for (let index = 4; index + 4 <= stsd.data.length; index += 1) {
    if (stsd.data[index] !== marker[0] || stsd.data[index + 1] !== marker[1]
      || stsd.data[index + 2] !== marker[2] || stsd.data[index + 3] !== marker[3]) continue;
    const size = u32(stsd.data, index - 4);
    if (size >= 8 && index - 4 + size <= stsd.data.length) return stsd.data.subarray(index + 4, index - 4 + size);
  }
  return null;
}

async function decryptAudio(data: Uint8Array, rawKey: string): Promise<{ data: Uint8Array; contentType: string }> {
  const moov = box(data, 'moov');
  if (!moov) throw new Error('汽水音频缺少 moov');
  const trak = box(data, 'trak', moov.offset + 8, moov.offset + moov.size);
  const mdia = trak && box(data, 'mdia', trak.offset + 8, trak.offset + trak.size);
  const minf = mdia && box(data, 'minf', mdia.offset + 8, mdia.offset + mdia.size);
  const stbl = minf && box(data, 'stbl', minf.offset + 8, minf.offset + minf.size);
  const stsd = stbl && box(data, 'stsd', stbl.offset + 8, stbl.offset + stbl.size);
  const stsz = stbl && box(data, 'stsz', stbl.offset + 8, stbl.offset + stbl.size);
  const stsc = stbl && box(data, 'stsc', stbl.offset + 8, stbl.offset + stbl.size);
  const stco = stbl && box(data, 'stco', stbl.offset + 8, stbl.offset + stbl.size);
  let senc = stbl && box(data, 'senc', stbl.offset + 8, stbl.offset + stbl.size);
  if (!senc) senc = box(data, 'senc', moov.offset + 8, moov.offset + moov.size);
  const mdat = box(data, 'mdat');
  if (!trak || !mdia || !minf || !stbl || !stsd || !stsz || !stsc || !stco || !senc || !mdat) throw new Error('汽水音频容器不完整');

  const sizes = sampleSizes(stsz);
  const stscEntries = sampleToChunk(stsc);
  const chunkCount = u32(stco.data, 4);
  if (chunkCount > 200_000 || 8 + chunkCount * 4 > stco.data.length) throw new Error('汽水音频 chunk 偏移无效');
  const sourceChunkOffsets = Array.from({ length: chunkCount }, (_, index) => u32(stco.data, 8 + index * 4));
  const ivCount = u32(senc.data, 4);
  if (ivCount > 200_000 || 8 + ivCount * 8 > senc.data.length) throw new Error('汽水音频 IV 数据无效');
  if (sizes.length > ivCount) throw new Error('汽水音频样本范围无效');

  const sampleOffsets = new Uint32Array(sizes.length);
  let sampleIndex = 0;
  for (let chunk = 1; chunk <= chunkCount && sampleIndex < sizes.length; chunk += 1) {
    let offset = sourceChunkOffsets[chunk - 1];
    const count = samplesInChunk(chunk, stscEntries);
    if (!count) throw new Error('汽水音频 chunk 映射无效');
    for (let index = 0; index < count && sampleIndex < sizes.length; index += 1) {
      const size = sizes[sampleIndex];
      if (offset + size > data.length) throw new Error('汽水音频样本范围无效');
      sampleOffsets[sampleIndex] = offset;
      offset += size;
      sampleIndex += 1;
    }
  }
  if (sampleIndex !== sizes.length) throw new Error('汽水音频样本与 chunk 映射不一致');

  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(resolveKey(rawKey)),
    { name: 'AES-CTR' },
    false,
    ['decrypt'],
  );
  const metadata = findFlacMetadata(stsd);
  // 复用 16 字节 counter，避免为每个 sample 分配独立 IV Uint8Array（高采样数时对象开销巨大）
  const counter = new Uint8Array(16);
  if (metadata) {
    const header = new TextEncoder().encode('fLaC');
    const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
    const output = new Uint8Array(header.length + metadata.length + totalBytes);
    output.set(header, 0);
    output.set(metadata, header.length);
    let writeAt = header.length + metadata.length;
    for (let index = 0; index < sizes.length; index += 1) {
      const size = sizes[index];
      const sourceOffset = sampleOffsets[index];
      counter.fill(0);
      counter.set(senc.data.subarray(8 + index * 8, 16 + index * 8));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: toArrayBuffer(counter), length: 64 },
        key,
        toArrayBuffer(data.subarray(sourceOffset, sourceOffset + size)),
      );
      output.set(new Uint8Array(decrypted), writeAt);
      writeAt += size;
    }
    return { data: output, contentType: 'audio/flac' };
  }

  const samples: Uint8Array[] = [];
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    const sourceOffset = sampleOffsets[index];
    counter.fill(0);
    counter.set(senc.data.subarray(8 + index * 8, 16 + index * 8));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: toArrayBuffer(counter), length: 64 },
      key,
      toArrayBuffer(data.subarray(sourceOffset, sourceOffset + size)),
    );
    samples.push(new Uint8Array(decrypted));
  }
  const ftyp = box(data, 'ftyp');
  const draftMoov = cleanBoxChildren(data, moov.offset + 8, moov.offset + moov.size, {
    sizes, stsc: stscEntries, chunkCount, mdatOffset: 0,
  });
  const mdatOffset = (ftyp?.size || 0) + draftMoov.length + 16;
  const cleanMoovData = cleanBoxChildren(data, moov.offset + 8, moov.offset + moov.size, {
    sizes, stsc: stscEntries, chunkCount, mdatOffset,
  });
  const cleanMoov = concat([u32Bytes(cleanMoovData.length + 8), ascii('moov'), cleanMoovData]);
  const cleanMdatData = concat(samples);
  const cleanMdat = concat([u32Bytes(cleanMdatData.length + 8), ascii('mdat'), cleanMdatData]);
  return { data: concat([ftyp ? data.subarray(ftyp.offset, ftyp.offset + ftyp.size) : new Uint8Array(), cleanMoov, cleanMdat]), contentType: 'audio/mp4' };
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; url: string; auth: string }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = async (event: MessageEvent<{ id: number; url: string; auth: string }>) => {
  const { id, url, auth } = event.data;
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`汽水 CDN 请求失败: ${response.status}`);
    const encrypted = await readResponse(response);
    const decrypted = await decryptAudio(encrypted, auth);
    const transferable = toArrayBuffer(decrypted.data);
    workerScope.postMessage({ id, data: transferable, contentType: decrypted.contentType }, [transferable]);
  } catch (error) {
    workerScope.postMessage({ id, error: error instanceof Error ? error.message : '汽水本地解密失败' });
  }
};

export {};
