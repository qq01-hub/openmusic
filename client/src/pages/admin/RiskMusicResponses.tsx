import { useContext } from 'react';
import { Button, Descriptions, Empty, Table, Tag } from 'antd';
import { RiskHelpContext, count, RiskSection, time, type AccountDetail, type MusicResponse } from './riskControlShared';

const OUTCOMES = { ok: '响应正常', empty: '空结果', failed: '请求失败', substituted: '返回替代曲', aborted: '连接中断' };
const SOURCES: Record<string, string> = { netease: '网易', tencent: 'QQ', qq: 'QQ', kugou: '酷狗', kuwo: '酷我', migu: '咪咕', bilibili: '哔哩哔哩', qishui: '汽水' };
const OPERATIONS: Record<string, string> = { url: '播放地址', lrc: '歌词', search: '音乐搜索 / 建议', search_playlist: '歌单搜索', song: '歌曲信息', playlist: '歌单', fm: '推荐', media: '媒体传输', source: '音源信息' };

export function MusicResponseSummary({ response }: { response?: MusicResponse }) {
  if (!response) return <span className="risk-muted">无响应摘要</span>;
  return <div className="risk-cell-stack">
    <span><Tag color={response.outcome === 'failed' || response.outcome === 'aborted' ? 'red' : response.outcome === 'empty' || response.outcome === 'substituted' ? 'orange' : 'default'}>{OUTCOMES[response.outcome]}</Tag> HTTP {response.status || '未完成'} · {count(response.durationMs)} ms</span>
    {response.songs.map(song => <span className="risk-wrap" key={`${song.source}:${song.id}`}>{song.name || '响应未含歌名'}{song.artist ? ` · ${song.artist}` : ''}<small className="risk-muted"> · {SOURCES[song.source] || song.source || '音源未记录'} / {song.id}</small></span>)}
    {response.resultCount !== undefined && <span className="risk-muted">{count(response.resultCount)} 条结果</span>}
  </div>;
}

export default function RiskMusicResponses({ detail, compact = false, onInspect }: { detail: AccountDetail; compact?: boolean; onInspect?: () => void }) {
  const showHelp = useContext(RiskHelpContext);
  const daily = detail.daily || {};
  const analysis = detail.musicResponseAnalysis;
  return <RiskSection title="歌曲响应与目标分布" actions={onInspect && <Button onClick={onInspect}>查看响应明细</Button>} description="仅采集 HTTP 音乐请求，保留近 24 小时最近完成的 200 条摘要，每条最多采样 3 首实际返回的歌曲，不存播放直链、歌词、音频密钥或凭据，也不额外请求上游补歌名，耗时为整次 HTTP 请求完成耗时，响应正常不等于歌曲已成功播放">
    {compact ? <div className="risk-response-metrics">{[
      ['响应总数', count(daily.response_total)],
      ['失败 / 中断', `${count(daily.response_failed)} / ${count(daily.response_aborted)}`],
      ['替代曲响应', count(daily.response_substituted)],
      ['采样目标歌曲', `${count(analysis?.distinctSongs)} 首`],
    ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> : <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
      { key: 'total', label: '今日已记录响应', children: count(daily.response_total) },
      { key: 'ok', label: '今日正常 / 空结果', children: `${count(daily.response_ok)} / ${count(daily.response_empty)}` },
      { key: 'failed', label: '今日失败 / 中断', children: `${count(daily.response_failed)} / ${count(daily.response_aborted)}` },
      { key: 'substituted', label: '今日替代曲响应', children: count(daily.response_substituted) },
      { key: 'average', label: '今日平均完成耗时', children: daily.response_total ? `${count(Math.round((daily.response_duration_ms || 0) / daily.response_total))} ms` : '暂无样本' },
      { key: 'targets', label: '采样目标歌曲数', children: `${count(analysis?.distinctSongs)} 首 / ${count(analysis?.targetedResponses)} 次定向正常响应` },
    ]} />}
    {showHelp && <details className="risk-section-note"><summary>目标统计口径</summary><p>重复取歌仅作复核依据，不自动加分，目标分布只统计正常的取链、歌词及歌曲信息响应，搜索和歌单采样不计入重复次数，请求歌曲 ID 不是响应确认的歌曲身份，统计从升级后开始，不回填历史</p></details>}
    {compact && analysis?.topSongs[0] && <p className="risk-wrap">采样最高频目标：{SOURCES[analysis.topSongs[0].source] || analysis.topSongs[0].source} / {analysis.topSongs[0].id} · {count(analysis.topSongs[0].requests)} 次，占定向正常响应 {Math.round(analysis.topSongs[0].requests / Math.max(1, analysis.targetedResponses) * 100)}%</p>}
    {!compact && <><Table size="small" rowKey={row => `${row.source}:${row.id}`} dataSource={analysis?.topSongs || []} pagination={false} scroll={{ x: 550 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无可归因的目标歌曲样本" /> }} columns={[
      { title: '采样高频目标', render: (_, row) => <div className="risk-cell-stack"><span>{row.name || '仅记录目标 ID，未返回歌名'}{row.artist ? ` · ${row.artist}` : ''}</span><code className="risk-wrap">{SOURCES[row.source] || row.source} / {row.id}</code></div> },
      { title: '正常响应次数', dataIndex: 'requests', render: count, width: 120 },
      { title: '采样占比', width: 100, render: (_, row) => `${Math.round(row.requests / Math.max(1, analysis?.targetedResponses || 0) * 100)}%` },
    ]} />
    <Table size="small" rowKey="requestId" dataSource={detail.musicResponses || []} pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }} scroll={{ x: 1100 }} columns={[
      { title: '请求时间', dataIndex: 'at', render: time, width: 180 },
      { title: '操作 / 请求目标', width: 180, render: (_, row) => <div className="risk-cell-stack"><span>{OPERATIONS[row.operation] || row.operation} · {SOURCES[row.source] || row.source || '音源未记录'}</span><code className="risk-wrap">{row.requestedSongId || '未记录歌曲 ID'}</code></div> },
      { title: '响应摘要', render: (_, row) => <MusicResponseSummary response={row} /> },
      { title: '来源 IP', dataIndex: 'ip', width: 160 },
    ]} /></>}
  </RiskSection>;
}
