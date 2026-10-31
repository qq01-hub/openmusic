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

/** 将封面 CDN 地址转为指定边长的缩略图或高清图 URL（服务端 meting 重定向与媒体代理用） */
export function resizeCoverForThumb(url, px) {
  if (!url || !px || px <= 0) return url;

  let next = url;

  // NetEase：不再追加 ?param=NyN，大图直接用
  if (/music\.126\.net|126\.net/i.test(next)) {
    return stripNeteaseParam(next);
  }

  if (/\.gtimg\.(?:com|cn)\/music\/photo_new\//i.test(next) || /y\.qq\.com\/music\/photo_new\//i.test(next)) {
    const target = px <= 150 ? 150 : px <= 320 ? 300 : 800;
    if (/T00[123](?:R\d+x\d+)?M000/i.test(next)) {
      return next.replace(/T00([123])(?:R\d+x\d+)?(M000)/i, (_, kind, m000) => {
        const prefix = kind === '1' ? 'T001' : 'T002';
        return `${prefix}R${target}x${target}${m000}`;
      });
    }
    if (/\d+x\d+/.test(next)) return next.replace(/\d+x\d+/g, `${target}x${target}`);
    return next;
  }

  if (/(?:^|\.|\/)(?:kugou\.com|kugou\.net|kgimg\.com|kgimg\.net|kgcdn\.com)(?:\/|:|$)/i.test(next)) {
    const bucket = px <= 64 ? 64 : px <= 120 ? 120 : px <= 240 ? 240 : px <= 400 ? 400 : 1024;
    const stdResized = next.replace(/(\/(?:stdmusic|softhead)\/)(\d+)(\/)/i, `$1${bucket}$3`);
    if (stdResized !== next) return stdResized;
    const resized = next.replace(/\/(\d+)\//, `/${bucket}/`);
    if (resized !== next) return resized;
    const fallbackResized = next.replace(/\/(1024|1000|720|480|400|240|200|150|120|64)\//, `/${bucket}/`);
    if (fallbackResized !== next) return fallbackResized;
  }

  if (/douyinpic\.com/i.test(next)) {
    const target = px <= 120 ? 120 : px <= 320 ? 300 : 1080;
    const c5 = next.replace(/(~c5_)\d+x\d+(\.)/i, `$1${target}x${target}$2`);
    if (c5 !== next) return c5;
    const tplv = next.replace(/(~tplv-[^:?#]+?:)\d+:\d+(\.)/i, `$1${target}:${target}$2`);
    if (tplv !== next) return tplv;
  }

  if (/param=\d+y\d+/i.test(next)) {
    return stripNeteaseParam(next);
  }

  if (/thumbnail=\d+/i.test(next)) {
    return next.replace(/thumbnail=\d+/gi, `thumbnail=${px}`);
  }

  return next;
}
