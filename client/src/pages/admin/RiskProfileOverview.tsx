import { useContext } from 'react';
import RiskMusicResponses from './RiskMusicResponses';
import { Button, Empty, Progress, Space, Tag } from 'antd';
import type { EChartsCoreOption } from 'echarts/core';
import { RiskHelpContext, count, riskColor, riskLabel, RiskSection, time, type AccountDetail } from './riskControlShared';
import AdminChart from './AdminChart';

export const MUSIC_OPERATION_LABELS: Record<string, string> = {
  search: '音乐搜索',
  url: '播放地址',
  lrc: '歌词',
  song: '歌曲信息',
  playlist: '歌单',
  search_playlist: '歌单搜索',
  fm: '推荐电台',
  source: '音源',
  media: '媒体代理',
};

export default function RiskProfileOverview({ detail, onInspect, onOpenRoom, onOpenIp }: {
  detail: AccountDetail;
  onInspect: (tab: string, operation?: string) => void;
  onOpenRoom: (id: string) => void;
  onOpenIp: (ip: string) => void;
}) {
  const showHelp = useContext(RiskHelpContext);
  const daily = detail.daily || {};
  const operations = Object.entries(MUSIC_OPERATION_LABELS)
    .map(([key, label]) => ({ key, label, value: Number(daily[`operation_${key}`] || 0) }))
    .filter(row => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const operationTotal = operations.reduce((sum, row) => sum + row.value, 0);
  const factors = [...(detail.factors || [])].filter(row => row.points > 0).sort((a, b) => b.points - a.points);
  const days = [...(detail.days || [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  const peak = Math.max(1, ...days.map(day => Number(day.requests || 0)));
  const lastIp = detail.lastRequestIp || detail.lastLoginIp;
  const ip = lastIp === 'unknown' ? '' : lastIp;

  const evidenceTags: Record<string, { label: string; color?: string }[]> = {
    musicMinutePeak: [
      { label: `分钟峰值 ${count(daily.musicMinutePeak)} 次`, color: 'blue' },
      ...(showHelp ? [{ label: '结合批量操作核查' }] : []),
    ],
    toolClientBurst: [
      { label: `工具 UA ${count(daily.automationClientRequests)} 次`, color: 'volcano' },
      { label: `入房 ${count(daily.roomJoins)} 次`, color: 'cyan' },
    ],
    urlHarvesting: [
      { label: `成功取链 ${count(daily.response_url_ok)} 次`, color: 'purple' },
      { label: `实时 ${count(daily.socketRequests)} 次`, color: 'geekblue' },
      { label: `入房 ${count(daily.roomJoins)} 次`, color: 'cyan' },
    ],
    operationConcentration: [
      { label: `${operations[0]?.label || '未分类'} ${count(operations[0]?.value)} 次`, color: 'geekblue' },
      { label: `音乐总计 ${count(operationTotal)} 次`, color: 'blue' },
    ],
    musicWithoutContext: [
      { label: `音乐 ${count(daily.music)} 次`, color: 'purple' },
      { label: `实时 ${count(daily.socketRequests)} 次`, color: 'geekblue' },
      { label: `入房 ${count(daily.roomJoins)} 次`, color: 'cyan' },
    ],
    musicOnlyBurst: [
      { label: `音乐 ${count(daily.music)} 次`, color: 'purple' },
      { label: `总请求 ${count(daily.requests)} 次`, color: 'blue' },
    ],
    highErrorRate: [
      { label: `错误 ${count(daily.errors)} 次`, color: 'red' },
      { label: `总请求 ${count(daily.requests)} 次`, color: 'blue' },
    ],
    denied: [
      { label: `今日拒绝 ${count(daily.denied)} 次`, color: 'orange' },
    ],
    ipCount: [
      { label: `24h IP ${count(detail.ipCount)} 个`, color: 'cyan' },
    ],
  };

  const operationOption: EChartsCoreOption = {
    grid: { left: 96, right: 24, top: 18, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e8eef7' } } },
    yAxis: { type: 'category', data: operations.map(row => row.label).reverse(), axisLabel: { color: '#334155' } },
    series: [{ type: 'bar', data: operations.map(row => row.value).reverse(), barMaxWidth: 18, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#bfdbfe' }, { offset: 1, color: '#60a5fa' }] }, borderRadius: [0, 8, 8, 0] }, emphasis: { itemStyle: { color: '#2563eb' } } }],
  };

  const trendOption: EChartsCoreOption = {
    grid: { left: 48, right: 20, top: 22, bottom: 28 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, right: 0, textStyle: { color: '#64748b' } },
    xAxis: { type: 'category', data: days.map(day => day.date.slice(5)), boundaryGap: false, axisLabel: { color: '#64748b' } },
    yAxis: { type: 'value', min: 0, max: peak, axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e8eef7' } } },
    series: [
      { name: '总请求', type: 'line', smooth: true, showSymbol: false, data: days.map(day => Number(day.requests || 0)), lineStyle: { width: 3, color: '#2563eb' }, areaStyle: { color: 'rgba(96,165,250,.12)' } },
      { name: '音乐请求', type: 'line', smooth: true, showSymbol: false, data: days.map(day => Number(day.music || 0)), lineStyle: { width: 2, color: '#7c3aed' } },
      { name: '实时操作', type: 'line', smooth: true, showSymbol: false, data: days.map(day => Number(day.socketRequests || 0)), lineStyle: { width: 2, color: '#f59e0b' } },
    ],
  };

  return (
    <div className="risk-tab-content">
      <div className="risk-profile-metrics">
        {[
          { label: '今日音乐请求', tag: '音乐业务', tagColor: 'purple', value: count(daily.music), subTag: `总请求 ${count(daily.requests)}`, subColor: 'blue', tab: 'requests' },
          { label: '今日实时操作', tag: 'WebSocket', tagColor: 'geekblue', value: count(daily.socketRequests), subTag: `客户端 ${count(detail.clientCount)}`, subColor: 'default', tab: 'requests' },
          { label: '今日成功入房', tag: '房间活跃', tagColor: 'cyan', value: count(daily.roomJoins), subTag: `今日 ${count(detail.roomCount)} 房`, subColor: 'blue', tab: 'rooms' },
          { label: '今日拒绝 / 错误', tag: '异常拦截', tagColor: (daily.denied || daily.errors) ? 'orange' : 'default', value: count(Number(daily.denied || 0) + Number(daily.errors || 0)), subTag: `拒绝 ${count(daily.denied)} / 错误 ${count(daily.errors)}`, subColor: daily.errors ? 'red' : daily.denied ? 'orange' : 'default', tab: 'requests' },
        ].map(metric => (
          <button className="risk-profile-metric" key={metric.label} onClick={() => onInspect(metric.tab)}>
            <div className="risk-metric-head">
              <span>{metric.label}</span>
              <Tag color={metric.tagColor}>{metric.tag}</Tag>
            </div>
            <strong>{metric.value}</strong>
            <div className="risk-metric-foot">
              <Tag color={metric.subColor}>{metric.subTag}</Tag>
            </div>
          </button>
        ))}
      </div>
      <div className="risk-detail-grid">
        <RiskSection
          title="风险证据摘要"
          description="当前评分实时重算，列表排序使用最近活动采样分，规则可能相关，不能将分数解释为违规概率"
          actions={<Tag color={riskColor(detail.score)}>{detail.score} 分 · {riskLabel(detail.score)}</Tag>}
        >
          <div className="risk-score-line">
            <strong>{detail.score}<small> / 100</small></strong>
            <Button type="primary" onClick={() => onInspect('decision')}>复核处置</Button>
          </div>
          <Progress percent={detail.score} showInfo={false} strokeColor={detail.score >= 60 ? '#b42318' : detail.score >= 30 ? '#ad6800' : '#1677ff'} />
          {factors.length ? (
            <ul className="risk-evidence-list">
              {factors.slice(0, 5).map(factor => (
                <li key={factor.id}>
                  <div className="risk-cell-stack">
                    <Space size={[6, 4]} wrap>
                      {factor.category && <Tag color="geekblue">{factor.category}</Tag>}
                      <span className="risk-rule-title">{factor.label}</span>
                    </Space>
                    <Space size={[4, 4]} wrap>
                      {(evidenceTags[factor.id] || []).map(item => (
                        <Tag key={item.label} color={item.color || 'default'}>{item.label}</Tag>
                      ))}
                      {factor.window && <Tag>{factor.window}</Tag>}
                    </Space>
                  </div>
                  <Tag color={factor.points >= 25 ? 'red' : 'orange'}>+{factor.points} 分</Tag>
                </li>
              ))}
            </ul>
          ) : (
            <div className="risk-empty-tag-box">
              <Tag color="green">当前无加分风险因子</Tag>
            </div>
          )}
          <Button className="risk-detail-link" type="link" onClick={() => onInspect('identity')}>查看全部规则矩阵 →</Button>
        </RiskSection>
        <RiskSection
          title="今日音乐操作结构"
          description="仅统计音乐业务操作，排除封面、心跳及其他 API，音乐操作累计达到 200 次且单一操作占比至少 90% 时形成核查信号，点击操作筛选最近请求"
        >
          {operationTotal ? (
            <>
              <div className="risk-distribution-summary">
                <div className="risk-score-line">
                  <strong>{operations[0].label} {Math.floor(operations[0].value / operationTotal * 100)}%</strong>
                  <Space size={[4, 4]} wrap>
                    <Tag color="blue">样本 {count(operationTotal)} 次</Tag>
                    <Tag color="purple">{operations.length} 类操作</Tag>
                  </Space>
                </div>
                <Space size={[6, 6]} wrap>
                  {operations.slice(0, 6).map(op => (
                    <Tag
                      key={op.key}
                      color="geekblue"
                      className="risk-clickable-tag"
                      onClick={() => onInspect('requests', op.key)}
                    >
                      {op.label} · {count(op.value)}
                    </Tag>
                  ))}
                </Space>
              </div>
              <button className="risk-chart-button" type="button" onClick={() => onInspect('requests')} aria-label="查看今日音乐操作请求明细">
                <AdminChart option={operationOption} label={`今日音乐操作分布，共 ${count(operationTotal)} 次`} />
              </button>
            </>
          ) : (
            <Empty image={false} description="今日暂无音乐操作样本" />
          )}
        </RiskSection>
      </div>
      <RiskMusicResponses detail={detail} compact onInspect={() => onInspect('requests')} />
      <RiskSection
        title="近 14 天行为趋势"
        description="总请求、音乐请求与实时业务操作使用相同纵轴，实时音乐请求同时包含在两者中，不应相加，详细计数在请求与配额页"
        actions={<Button onClick={() => onInspect('requests')}>查看每日明细</Button>}
      >
        {days.some(day => Number(day.requests || 0) > 0) ? (
          <button className="risk-chart-button" type="button" onClick={() => onInspect('requests')} aria-label={`查看最近 ${days.length} 天请求趋势`}>
            <AdminChart option={trendOption} label={`最近 ${days.length} 天总请求、音乐请求和实时操作趋势，峰值 ${peak} 次`} />
          </button>
        ) : (
          <Empty image={false} description="暂无可展示的趋势数据" />
        )}
      </RiskSection>
      <RiskSection title="关联核查入口" description="仅在既有管理员权限内跳转，历史房间可能已销毁，IP 共享不能证明账户属于同一人">
        <div className="risk-association-grid">
          <div className="risk-assoc-card">
            <div className="risk-assoc-head">
              <Tag color="cyan">房间轨迹</Tag>
              <span>最近活动房间</span>
            </div>
            {detail.lastRoomId ? (
              <Button type="link" onClick={() => onOpenRoom(detail.lastRoomId)}>{detail.lastRoomId} → 房间管理</Button>
            ) : (
              <Tag>暂无入房记录</Tag>
            )}
            <Space size={[4, 4]} wrap>
              <Tag color="blue">今日 {count(detail.roomCount)} 房</Tag>
              {detail.lastRoomAt > 0 && <Tag>{time(detail.lastRoomAt)}</Tag>}
            </Space>
          </div>
          <div className="risk-assoc-card">
            <div className="risk-assoc-head">
              <Tag color="geekblue">网络出口</Tag>
              <span>最近访问 IP</span>
            </div>
            {ip ? (
              <Button type="link" onClick={() => onOpenIp(ip)}>{ip} → 关联账户</Button>
            ) : (
              <Tag>未记录 IP</Tag>
            )}
            <Space size={[4, 4]} wrap>
              <Tag color="cyan">24h {count(detail.ipCount)} IP</Tag>
              <Tag color={detail.sharedAccounts > 0 ? 'orange' : 'default'}>同IP关联 {count(detail.sharedAccounts)}</Tag>
            </Space>
          </div>
          <div className="risk-assoc-card">
            <div className="risk-assoc-head">
              <Tag color="purple">登录设备</Tag>
              <span>账户身份与登录</span>
            </div>
            <Button type="link" onClick={() => onInspect('network')}>登录及客户端历史 →</Button>
            <Space size={[4, 4]} wrap>
              <Tag color="blue">累计登录 {count(detail.loginCount)}</Tag>
              <Tag>{time(detail.lastLoginAt)}</Tag>
            </Space>
          </div>
        </div>
      </RiskSection>
    </div>
  );
}
