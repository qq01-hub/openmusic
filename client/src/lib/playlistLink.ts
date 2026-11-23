import type { PlaylistPlatform } from '../api/music/playlist';

/** 从分享文案中提取第一个 http(s) 链接（去掉中文/引号与尾随标点） */
export function extractMusicShareUrl(input: string): string {
  const text = String(input || '').trim();
  const match = text.match(/https?:\/\/[^\s一-鿿「」《》“”"'<>]+/i);
  return match ? match[0].replace(/[.,;，。；)）\]]+$/, '') : text;
}

/**
 * 判断搜索框输入是否为网易云 / QQ 音乐的「歌单」分享链接或文案。
 *
 * 只识别歌单链接：歌曲 / 专辑 / 电台链接返回 null，避免把普通搜索劫持成歌单解析。
 * 纯数字 ID 也返回 null（无法区分是歌单还是歌曲搜索关键词），仍由导入弹窗显式选平台处理。
 */
export function detectPlaylistLink(input: string): PlaylistPlatform | null {
  const text = String(input || '').trim();
  if (!text) return null;

  const url = extractMusicShareUrl(text);

  // 网易云：必须带 playlist 标记，排除 song / album / djradio 链接
  if (/music\.163\.com/i.test(url) && /playlist/i.test(url)) {
    return 'netease';
  }

  // QQ 音乐：分享到 QQ/我的电脑 的 details/playlist.html?id=…，或旧版 playlist/songlist/taoge/dissid
  if (/\.qq\.com/i.test(url)) {
    if (
      /\/(playlist|songlist)\b/i.test(url)
      || /\/details\/playlist/i.test(url)
      || /taoge/i.test(url)
      || /[?&](?:id|dissid)=\d{4,}/i.test(url)
    ) {
      return 'qq';
    }
  }

  return null;
}
