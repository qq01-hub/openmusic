/** 去掉 NetEase 风格 ?param=NyN（该参数会导致封面加载失败） */
function stripNeteaseParam(url) {
  if (!/param=\d+y\d+/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('param');
    return parsed.toString();
  } catch {
    return url
      .replace(/([?&])param=\d+y\d+/gi, '$1')
      .replace(/\?&/, '?')
      .replace(/[?&]$/, '')
      .replace(/\?$/, '');
  }
}

/** 将封面 CDN 地址转为指定边长的缩略图 URL（服务端 meting 重定向用） */
export function resizeCoverForThumb(url, px) {
  if (!url || !px || px <= 0) return url;

  let next = url;

  // NetEase：不再追加 ?param=NyN，大图直接用
  if (/music\.126\.net|126\.net/i.test(next)) {
    return stripNeteaseParam(next);
  }

  if (/\.gtimg\.com\/music\/photo_new\//i.test(next) || /y\.qq\.com\/music\/photo_new\//i.test(next)) {
    const code = px <= 58 ? 'T001R' : px <= 300 ? 'T002R' : 'T003R';
    if (/T00\dR/i.test(next)) return next.replace(/T00\dR/i, code);
    if (/\d+x\d+/.test(next)) return next.replace(/\d+x\d+/g, `${px}x${px}`);
    return next;
  }

  if (/(?:^|\.|\/)(?:kugou\.com|kugou\.net|kgimg\.com|kgimg\.net|kgcdn\.com)(?:\/|:|$)/i.test(next)) {
    const bucket = px <= 64 ? 64 : px <= 120 ? 120 : px <= 240 ? 240 : 400;
    const resized = next.replace(/\/(\d+)\//, `/${bucket}/`);
    if (resized !== next) return resized;
    const fallbackResized = next.replace(/\/(480|400|240|200|150)\//, `/${bucket}/`);
    if (fallbackResized !== next) return fallbackResized;
  }

  if (/param=\d+y\d+/i.test(next)) {
    return stripNeteaseParam(next);
  }

  if (/thumbnail=\d+/i.test(next)) {
    return next.replace(/thumbnail=\d+/gi, `thumbnail=${px}`);
  }

  return next;
}
