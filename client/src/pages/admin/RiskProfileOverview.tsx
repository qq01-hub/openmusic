import { useContext } from 'react';
import RiskMusicResponses from './RiskMusicResponses';
import { Button, Empty, Progress, Space, Tag } from 'antd';
import type { EChartsCoreOption } from 'echarts/core';
import { RiskHelpContext, count, riskColor, riskLabel, RiskSection, time, type AccountDetail } from './riskControlShared';
import AdminChart from './AdminChart';

export const MUSIC_OPERATION_LABELS: Record<string, string> = { search: '音乐搜索', url: '播放地址', lrc: '歌词', song: '歌曲信息', playlist: '歌单', search_playlist: '歌单搜索', fm: '推荐电台', source: '音源', media: '媒体代理' };

export default function RiskProfileOverview({ detail, onInspect, onOpenRoom, onOpenIp }: {
  detail: AccountDetail;
  onInspect: (tab: string, operation?: string) => void;
  onOpenRoom: (id: string) => void;
  onOpenIp: (ip: string) => void;
}) {
  const showHelp = useContext(RiskHelpContext);
  const daily = detail.daily || {};
  const operations = Object.entries(MUSIC_OPERATION_LABELS).map(([key, label]) => ({ key, label, value: Number(daily[`operation_${key}`] || 0) })).filter(row => row.value > 0).sort((a, b) => b.value - a.value);
  const operationTotal = operations.reduce((sum, row) => sum + row.value, 0);
  const factors = [...(detail.factors || [])].filter(row => row.points > 0).sort((a, b) => b.points - a.points);
  const days = [...(detail.days || [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  const peak = Math.max(1, ...days.map(day => Number(day.requests || 0)));
  const lastIp = detail.lastRequestIp || detail.lastLoginIp;
  const ip = lastIp === 'unknown' ? '' : lastIp;
  const evidence: Record<string, string> = {
    musicMinutePeak: `当日音乐分钟峰值 ${count(daily.musicMinutePeak)} 次，需结合批量操作核查`,
    toolClientBurst: `工具类 UA 声明 ${count(daily.automationClientRequests)} 次 · 成功入房 ${count(daily.roomJoins)} 次，客户端声明可伪造`,
    urlHarvesting: `成功取链 ${count(daily.response_url_ok)} 次 · 实时操作 ${count(daily.socketRequests)} 次 · 入房 ${count(daily.roomJoins)} 次，不包含替代曲`,
    operationConcentration: `${operations[0]?.label || '未分类'} ${count(operations[0]?.value)} / ${count(operationTotal)} 次音乐操作，封面与其他 API 不参与占比`,
    musicWithoutContext: `音乐 ${count(daily.music)} 次 · 实时操作 ${count(daily.socketRequests)} 次 · 成功入房 ${count(daily.roomJoins)} 次`,
    musicOnlyBurst: `音乐 ${count(daily.music)} / 总请求 ${count(daily.requests)} 次`,
    highErrorRate: `错误 ${count(daily.errors)} / 总请求 ${count(daily.requests)} 次，需先排除上游故障`,
    denied: `今日已拒绝 ${count(daily.denied)} 次，包含账户限制后的重试`,
    ipCount: `近 24 小时 ${count(detail.ipCount)} 个访问 IP，需排除共享网络与网络切换`,
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
  return <div className="risk-tab-content">
    <div className="risk-profile-metrics">
      {[
        { label: '今日音乐请求', value: count(daily.music), tab: 'requests' },
        { label: '今日实时操作', value: count(daily.socketRequests), tab: 'requests' },
        { label: '今日成功入房', value: count(daily.roomJoins), tab: 'rooms' },
        { label: '今日拒绝 / 错误', value: `${count(daily.denied)} / ${count(daily.errors)}`, tab: 'requests' },
      ].map(metric => <button className="risk-profile-metric" key={metric.label} onClick={() => onInspect(metric.tab)}><span>{metric.label}</span><strong>{metric.value}</strong></button>)}
    </div>
    <div className="risk-detail-grid">
      <RiskSection title="风险证据摘要" description="当前评分实时重算，列表排序使用最近活动采样分，规则可能相关，不能将分数解释为违规概率" actions={<Tag color={riskColor(detail.score)}>{riskLabel(detail.score)}</Tag>}>
        <div className="risk-score-line"><strong>{detail.score}<small> / 100</small></strong><Button type="primary" onClick={() => onInspect('decision')}>复核处置</Button></div>
        <Progress percent={detail.score} showInfo={false} strokeColor={detail.score >= 60 ? '#b42318' : detail.score >= 30 ? '#ad6800' : '#1677ff'} />
        {factors.length ? <ul className="risk-evidence-list">{factors.slice(0, 5).map(factor => <li key={factor.id}><div className="risk-cell-stack"><span>{factor.label}</span>{showHelp && evidence[factor.id] && <details className="risk-section-note"><summary>依据</summary><p>{evidence[factor.id]}</p></details>}</div><Tag color="orange">+{factor.points}</Tag></li>)}</ul> : <p className="risk-muted">暂无命中信号</p>}
        <Button className="risk-detail-link" type="link" onClick={() => onInspect('identity')}>查看全部依据 →</Button>
      </RiskSection>
      <RiskSection title="今日音乐操作结构" description="仅统计音乐业务操作，排除封面、心跳及其他 API，音乐操作累计达到 200 次且单一操作占比至少 90% 时形成核查信号，点击操作筛选最近请求">
        {operationTotal ? <><div className="risk-distribution-summary"><strong>{operations[0].label} {Math.floor(operations[0].value / operationTotal * 100)}%</strong><Space wrap><Tag color="blue">样本 {count(operationTotal)} 次</Tag><Tag color="default">点击柱条查看明细</Tag></Space></div><button className="risk-chart-button" type="button" onClick={() => onInspect('requests')} aria-label="查看今日音乐操作请求明细"><AdminChart option={operationOption} label={`今日音乐操作分布，共 ${count(operationTotal)} 次`} /></button></> : <Empty image={false} description="今日暂无音乐操作样本" />}
      </RiskSection>
    </div>
    <RiskMusicResponses detail={detail} compact onInspect={() => onInspect('requests')} />
    <RiskSection title="近 14 天行为趋势" description="总请求、音乐请求与实时业务操作使用相同纵轴，实时音乐请求同时包含在两者中，不应相加，详细计数在请求与配额页" actions={<Button onClick={() => onInspect('requests')}>查看每日明细</Button>}>
      {days.some(day => Number(day.requests || 0) > 0) ? <button className="risk-chart-button" type="button" onClick={() => onInspect('requests')} aria-label={`查看最近 ${days.length} 天请求趋势`}><AdminChart option={trendOption} label={`最近 ${days.length} 天总请求、音乐请求和实时操作趋势，峰值 ${peak} 次`} /></button> : <Empty image={false} description="暂无可展示的趋势数据" />}
    </RiskSection>
    <RiskSection title="关联核查入口" description="仅在既有管理员权限内跳转，历史房间可能已销毁，IP 共享不能证明账户属于同一人">
      <div className="risk-association-grid"><div><span>最近活动房间</span>{detail.lastRoomId ? <Button type="link" onClick={() => onOpenRoom(detail.lastRoomId)}>{detail.lastRoomId} → 房间管理</Button> : <span className="risk-muted">暂无成功入房记录</span>}{detail.lastRoomAt > 0 && <span className="risk-secondary">{time(detail.lastRoomAt)}</span>}</div><div><span>最近访问 IP</span>{ip ? <Button type="link" onClick={() => onOpenIp(ip)}>{ip} → 关联账户</Button> : <span className="risk-muted">未记录</span>}<small>近 24 小时 {count(detail.ipCount)} 个 IP</small></div><div><span>账户身份与登录</span><Button type="link" onClick={() => onInspect('network')}>登录及客户端历史 →</Button><small>最近登录 {time(detail.lastLoginAt)}</small></div></div>
    </RiskSection>
  </div>;
}
