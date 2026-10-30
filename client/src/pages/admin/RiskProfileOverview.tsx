import { useContext } from 'react';
import RiskMusicResponses from './RiskMusicResponses';
import { Button, Empty, Progress, Tag } from 'antd';
import { RiskHelpContext, count, riskColor, riskLabel, RiskSection, time, type AccountDetail } from './riskControlShared';

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
  const dateTickCount = Math.min(5, days.length);
  const dateTicks = new Set(Array.from({ length: dateTickCount }, (_, index) => Math.round(index * (days.length - 1) / Math.max(1, dateTickCount - 1))));
  const peak = Math.max(1, ...days.map(day => Number(day.requests || 0)));
  const series = (key: 'requests' | 'music' | 'socketRequests') => days.map((day, index) => `${70 + index * 566 / Math.max(1, days.length - 1)},${146 - Math.min(peak, Number(day[key] || 0)) / peak * 120}`).join(' ');
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
        {operationTotal ? <><div className="risk-distribution-summary"><strong>{operations[0].label} {Math.floor(operations[0].value / operationTotal * 100)}%</strong><span>首位操作占比 · 样本 {count(operationTotal)}</span></div><div className="risk-operation-bars">{operations.map(row => <button key={row.key} onClick={() => onInspect('requests', row.key)} aria-label={`查看${row.label}请求，共 ${row.value} 次`}><span>{row.label}</span><span className="risk-bar-track"><span style={{ width: `${row.value / operationTotal * 100}%` }} /></span><b>{count(row.value)}</b></button>)}</div></> : <Empty image={false} description="今日暂无音乐操作样本" />}
      </RiskSection>
    </div>
    <RiskMusicResponses detail={detail} compact onInspect={() => onInspect('requests')} />
    <RiskSection title="近 14 天行为趋势" description="总请求、音乐请求与实时业务操作使用相同纵轴，实时音乐请求同时包含在两者中，不应相加，详细计数在请求与配额页" actions={<Button onClick={() => onInspect('requests')}>查看每日明细</Button>}>
      {days.some(day => Number(day.requests || 0) > 0) ? <><div className="risk-chart-legend"><span className="risk-legend-total">总请求</span><span className="risk-legend-music">音乐请求</span><span className="risk-legend-socket">实时操作</span></div><svg className="risk-trend-chart" viewBox="0 0 660 180" role="img" aria-label={`最近 ${days.length} 天总请求、音乐请求和实时操作趋势，峰值 ${peak} 次，精确数据见每日明细`}>
        {[26, 86, 146].map(y => <line key={y} x1="70" x2="636" y1={y} y2={y} stroke="#e3e8ef" />)}
        <text x="0" y="30">{count(peak)}</text><text x="16" y="150">0</text>
        <polyline points={series('requests')} fill="none" stroke="#1677ff" strokeWidth="2.5" />
        <polyline points={series('music')} fill="none" stroke="#722ed1" strokeWidth="2.5" strokeDasharray="2 3" />
        <polyline points={series('socketRequests')} fill="none" stroke="#ad6800" strokeWidth="2.5" strokeDasharray="5 3" />
        {days.map((day, index) => dateTicks.has(index) && <text key={day.date} x={70 + index * 566 / Math.max(1, days.length - 1)} y="171" textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'}>{day.date.slice(5)}</text>)}
      </svg></> : <Empty image={false} description="暂无可展示的趋势数据" />}
    </RiskSection>
    <RiskSection title="关联核查入口" description="仅在既有管理员权限内跳转，历史房间可能已销毁，IP 共享不能证明账户属于同一人">
      <div className="risk-association-grid"><div><span>最近活动房间</span>{detail.lastRoomId ? <Button type="link" onClick={() => onOpenRoom(detail.lastRoomId)}>{detail.lastRoomId} → 房间管理</Button> : <span className="risk-muted">暂无成功入房记录</span>}{detail.lastRoomAt > 0 && <span className="risk-secondary">{time(detail.lastRoomAt)}</span>}</div><div><span>最近访问 IP</span>{ip ? <Button type="link" onClick={() => onOpenIp(ip)}>{ip} → 关联账户</Button> : <span className="risk-muted">未记录</span>}<small>近 24 小时 {count(detail.ipCount)} 个 IP</small></div><div><span>账户身份与登录</span><Button type="link" onClick={() => onInspect('network')}>登录及客户端历史 →</Button><small>最近登录 {time(detail.lastLoginAt)}</small></div></div>
    </RiskSection>
  </div>;
}
