import { useContext } from 'react';
import { Button, Empty, Space, Table, Tag } from 'antd';
import { RiskHelpContext, count, RiskSection, time, type AccountDetail, type MusicResponse } from './riskControlShared';

const OUTCOMES = { ok: '响应正常', empty: '空结果', failed: '请求失败', substituted: '返回替代曲', aborted: '连接中断' };
const SOURCES: Record<string, string> = { netease: '网易云', tencent: 'QQ音乐', qq: 'QQ音乐', kugou: '酷狗', kuwo: '酷我', migu: '咪咕', bilibili: '哔哩哔哩', qishui: '汽水' };
const OPERATIONS: Record<string, string> = { url: '播放地址', lrc: '歌词', search: '音乐搜索', search_playlist: '歌单搜索', song: '歌曲信息', playlist: '歌单', fm: '推荐', media: '媒体传输', source: '音源信息' };

export function MusicResponseSummary({ response }: { response?: MusicResponse }) {
  if (!response) return <Tag>无响应摘要</Tag>;
  const outcomeColor = response.outcome === 'failed' || response.outcome === 'aborted'
    ? 'red'
    : response.outcome === 'empty' || response.outcome === 'substituted'
      ? 'orange'
      : 'green';
  return (
    <div className="risk-cell-stack">
      <Space size={[4, 4]} wrap>
        <Tag color={outcomeColor}>{OUTCOMES[response.outcome]}</Tag>
        <Tag color={response.status >= 400 ? 'red' : 'blue'}>HTTP {response.status || '未完成'}</Tag>
        <Tag>{count(response.durationMs)} ms</Tag>
        {response.resultCount !== undefined && <Tag color="cyan">{count(response.resultCount)} 条结果</Tag>}
      </Space>
      {response.songs.map(song => (
        <Space size={[4, 4]} wrap key={`${song.source}:${song.id}`}>
          <Tag color="geekblue">{SOURCES[song.source] || song.source || '未知音源'}</Tag>
          <Tag color="purple">{song.name || '未含歌名'}{song.artist ? ` - ${song.artist}` : ''}</Tag>
          <code className="risk-code-pill">{song.id}</code>
        </Space>
      ))}
    </div>
  );
}

export default function RiskMusicResponses({ detail, compact = false, onInspect }: { detail: AccountDetail; compact?: boolean; onInspect?: () => void }) {
  const showHelp = useContext(RiskHelpContext);
  const daily = detail.daily || {};
  const analysis = detail.musicResponseAnalysis;
  const avgDuration = daily.response_total ? `${count(Math.round((daily.response_duration_ms || 0) / daily.response_total))} ms` : '暂无样本';
  const topSong = analysis?.topSongs?.[0];
  const topSongShare = topSong ? Math.round(topSong.requests / Math.max(1, analysis?.targetedResponses || 0) * 100) : 0;

  return (
    <RiskSection
      title="歌曲响应与目标分布"
      actions={onInspect && <Button onClick={onInspect}>查看响应明细</Button>}
      description="仅采集 HTTP 音乐请求，保留近 24 小时最近完成的 200 条摘要，每条最多采样 3 首实际返回的歌曲，不存播放直链、歌词、音频密钥或凭据，也不额外请求上游补歌名，耗时为整次 HTTP 请求完成耗时，响应正常不等于歌曲已成功播放"
    >
      <div className="risk-response-metrics">
        {[
          { label: '今日已记录响应', value: count(daily.response_total), tags: [{ text: `正常 ${count(daily.response_ok)}`, color: 'green' }, { text: `空结果 ${count(daily.response_empty)}`, color: 'default' }] },
          { label: '失败与中断', value: count(Number(daily.response_failed || 0) + Number(daily.response_aborted || 0)), tags: [{ text: `失败 ${count(daily.response_failed)}`, color: daily.response_failed ? 'red' : 'default' }, { text: `中断 ${count(daily.response_aborted)}`, color: daily.response_aborted ? 'orange' : 'default' }] },
          { label: '替代曲与平均耗时', value: count(daily.response_substituted), tags: [{ text: '替代曲响应', color: daily.response_substituted ? 'gold' : 'default' }, { text: `均耗 ${avgDuration}`, color: 'blue' }] },
          { label: '采样目标歌曲', value: `${count(analysis?.distinctSongs)} 首`, tags: [{ text: `定向响应 ${count(analysis?.targetedResponses)} 次`, color: 'purple' }] },
        ].map(item => (
          <div className="risk-response-card" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <Space size={[4, 4]} wrap>
              {item.tags.map(tag => <Tag key={tag.text} color={tag.color}>{tag.text}</Tag>)}
            </Space>
          </div>
        ))}
      </div>
      {showHelp && (
        <details className="risk-section-note">
          <summary>目标统计口径</summary>
          <p>重复取歌仅作复核依据，不自动加分，目标分布只统计正常的取链、歌词及歌曲信息响应，搜索和歌单采样不计入重复次数，请求歌曲 ID 不是响应确认的歌曲身份，统计从升级后开始，不回填历史</p>
        </details>
      )}
      {compact && topSong && (
        <div className="risk-tag-bar">
          <span className="risk-tag-bar-label">采样高频目标</span>
          <Tag color="geekblue">{SOURCES[topSong.source] || topSong.source}</Tag>
          {topSong.name && <Tag color="purple">{topSong.name}{topSong.artist ? ` - ${topSong.artist}` : ''}</Tag>}
          <code className="risk-code-pill">{topSong.id}</code>
          <Tag color="blue">{count(topSong.requests)} 次</Tag>
          <Tag color={topSongShare >= 50 ? 'orange' : 'cyan'}>占比 {topSongShare}%</Tag>
        </div>
      )}
      {!compact && (
        <>
          <Table
            size="small"
            rowKey={row => `${row.source}:${row.id}`}
            dataSource={analysis?.topSongs || []}
            pagination={false}
            scroll={{ x: 550 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无可归因的目标歌曲样本" /> }}
            columns={[
              {
                title: '采样高频目标',
                render: (_, row) => (
                  <Space size={[6, 4]} wrap>
                    <Tag color="geekblue">{SOURCES[row.source] || row.source}</Tag>
                    <Tag color={row.name ? 'purple' : 'default'}>{row.name ? `${row.name}${row.artist ? ` - ${row.artist}` : ''}` : '未含歌名'}</Tag>
                    <code className="risk-code-pill">{row.id}</code>
                  </Space>
                ),
              },
              { title: '正常响应次数', dataIndex: 'requests', width: 130, render: (val: number) => <Tag color="blue">{count(val)} 次</Tag> },
              {
                title: '采样占比',
                width: 110,
                render: (_, row) => {
                  const pct = Math.round(row.requests / Math.max(1, analysis?.targetedResponses || 0) * 100);
                  return <Tag color={pct >= 50 ? 'orange' : 'cyan'}>{pct}%</Tag>;
                },
              },
            ]}
          />
          <Table
            size="small"
            rowKey="requestId"
            dataSource={detail.musicResponses || []}
            pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }}
            scroll={{ x: 1100 }}
            columns={[
              { title: '请求时间', dataIndex: 'at', render: time, width: 180 },
              {
                title: '操作与请求目标',
                width: 240,
                render: (_, row) => (
                  <div className="risk-cell-stack">
                    <Space size={[4, 4]} wrap>
                      <Tag color="geekblue">{OPERATIONS[row.operation] || row.operation}</Tag>
                      <Tag color="cyan">{SOURCES[row.source] || row.source || '音源未记录'}</Tag>
                    </Space>
                    <code className="risk-code-pill">{row.requestedSongId || '未记录歌曲 ID'}</code>
                  </div>
                ),
              },
              { title: '响应摘要', render: (_, row) => <MusicResponseSummary response={row} /> },
              { title: '来源 IP', dataIndex: 'ip', width: 160, render: (val: string) => <Tag color="cyan">{val || '—'}</Tag> },
            ]}
          />
        </>
      )}
    </RiskSection>
  );
}
