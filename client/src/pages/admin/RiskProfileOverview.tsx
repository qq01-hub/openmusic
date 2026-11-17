import { Button, Empty } from 'antd';
import { count, RiskSection, time, type AccountDetail } from './riskControlShared';

export default function RiskProfileOverview({ detail, onInspect, onOpenRoom, onOpenIp }: {
  detail: AccountDetail;
  onInspect: (tab: string, operation?: string) => void;
  onOpenRoom: (id: string) => void;
  onOpenIp: (ip: string) => void;
}) {
  const daily = detail.daily || {};
  const factors = [...(detail.factors || [])].filter(row => row.points > 0).sort((a, b) => b.points - a.points);
  const ip = detail.lastRequestIp || detail.lastLoginIp;
  return <div className="risk-tab-content">
    <div className="risk-profile-metrics">
      {[
        ['今日总请求', count(daily.requests)],
        ['成功取链 / 60 秒峰值', `${count(daily.response_url_ok)} / ${count(daily.urlIpMinutePeak)}`],
        ['实时操作 / 成功入房', `${count(daily.socketRequests)} / ${count(daily.roomJoins)}`],
        ['拒绝 / 错误', `${count(daily.denied)} / ${count(daily.errors)}`],
      ].map(([label, value]) => <div className="risk-profile-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <RiskSection title="复核线索" description="评分是核查线索，不代表机器人概率，成功取链峰值按同账户、同 IP 的滚动 60 秒统计">
      {factors.length ? <ul className="risk-evidence-list">{factors.map(factor => <li key={factor.id}><div><strong>{factor.label}</strong><div className="risk-muted">{factor.window} · 观测 {count(factor.value)} · 阈值 {count(factor.threshold)}</div></div><strong>+{factor.points}</strong></li>)}</ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无加分风险因子" />}
      <div className="risk-review-links">
        <Button onClick={() => onInspect('identity')}>身份与全部规则</Button>
        {detail.lastRoomId && <Button onClick={() => onOpenRoom(detail.lastRoomId)}>最近房间 {detail.lastRoomId}</Button>}
        {ip && ip !== 'unknown' && <Button onClick={() => onOpenIp(ip)}>来源 IP {ip}</Button>}
        <span className="risk-muted">最近活动 {time(detail.lastSeenAt)}</span>
      </div>
    </RiskSection>
  </div>;
}
