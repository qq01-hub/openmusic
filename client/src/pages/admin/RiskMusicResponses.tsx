import { count, type MusicResponse } from './riskControlShared';

const OUTCOMES = { ok: '响应正常', empty: '空结果', failed: '请求失败', substituted: '返回替代曲', aborted: '连接中断' };
const SOURCES: Record<string, string> = { netease: '网易云', tencent: 'QQ音乐', qq: 'QQ音乐', kugou: '酷狗', kuwo: '酷我', migu: '咪咕', bilibili: '哔哩哔哩', qishui: '汽水' };

export function responseMatch(response: MusicResponse, responses: MusicResponse[]): string {
  if (!['url', 'lrc'].includes(response.operation) || response.outcome !== 'ok') return '';
  const targetId = response.requestedSongId;
  const sampled = response.songs?.[0];
  if (targetId && sampled?.id && sampled.source === response.source && targetId !== sampled.id) return '响应中的歌曲 ID 与请求目标不同，请核对';
  const opposite = response.operation === 'url' ? 'lrc' : 'url';
  const paired = targetId && response.source && responses.some(item => item.operation === opposite
    && item.outcome === 'ok' && item.source === response.source && item.ip === response.ip
    && item.requestedSongId === targetId && Math.abs(item.at - response.at) <= 10 * 60 * 1000);
  return paired ? '已采集同平台、同歌曲的播放地址与歌词请求' : '未采集到配对请求，可能使用缓存或仅试听';
}

export function MusicResponseSummary({ response, responses = [] }: { response?: MusicResponse; responses?: MusicResponse[] }) {
  if (!response) return <span className="risk-muted">未采集响应摘要</span>;
  const returned = response.songs || [];
  const knownTarget = responses.flatMap(item => item.songs || []).find(song => song.id === response.requestedSongId && song.source === response.source && song.name);
  return <div className="risk-response-evidence">
    <div><strong>{SOURCES[response.source] || '音源未记录'}</strong>{response.requestedSongId && <span> · 目标 ID {response.requestedSongId}{knownTarget ? ` · ${knownTarget.name}${knownTarget.artist ? ` / ${knownTarget.artist}` : ''}（采样曲名）` : ''}</span>}</div>
    <div className={['failed', 'aborted'].includes(response.outcome) ? 'risk-response-error' : ''}>{OUTCOMES[response.outcome]} · HTTP {response.status || '未完成'} · {count(response.durationMs)} ms{response.resultCount !== undefined && ` · ${count(response.resultCount)} 条结果`}</div>
    {returned.length > 0 && <div>已返回歌曲数据</div>}

  </div>;
}
