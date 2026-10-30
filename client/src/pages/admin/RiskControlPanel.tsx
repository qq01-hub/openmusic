import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, ConfigProvider, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tabs } from 'antd';
import { DeleteOutlined, ReloadOutlined, SafetyCertificateOutlined, SettingOutlined } from '@ant-design/icons';
import { adminFetch, formatRelativeTime } from './utils';
import { count, errorText, POLICY_LABELS, queueScore, riskColor, RiskSection, RiskHelpContext, STATUS_OPTIONS, statusLabel, time, type AccountDetail, type Decision, type Policy, type RiskAccount, type RiskEvent, type RiskPage, type HumanChallengeState } from './riskControlShared';
import RiskAccountDetail from './RiskAccountDetail';
import './RiskControlPanel.css';

export default function RiskControlPanel({ onOpenRoom, initialAccountId = '', onOpenSecurity }: { onOpenSecurity?: () => void; onOpenRoom: (roomId: string, accountId: string) => void; initialAccountId?: string }) {
  const { message } = App.useApp();
  const [data, setData] = useState<RiskPage | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [pool, setPool] = useState('main');
  const [order, setOrder] = useState('risk');
  const [lookup, setLookup] = useState('');
  const [query, setQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [events, setEvents] = useState<RiskEvent[]>([]);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearingRequest = useRef(false);
  const [policyForm] = Form.useForm<Policy>();
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const eventsRequest = useRef<AbortController | null>(null);
  const selectedId = useRef('');
  const lastListError = useRef('');

  const load = useCallback(async () => {
    if (clearingRequest.current) return;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true); setError('');
    try {
      const result = await adminFetch<RiskPage>(`/api/admin/risk/accounts?${new URLSearchParams({ page: String(page), status, pool, order, q: query })}`, { signal: controller.signal });
      if (!controller.signal.aborted) {
        lastListError.current = '';
        if (page > 1 && !result.items.length && result.total > 0) setPage(1);
        else setData(result);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        const text = errorText(reason, '账户列表加载失败');
        setError(text); setData(null);
        if (lastListError.current !== text) void message.error({ key: 'risk-list-error', content: text, duration: 5 });
        lastListError.current = text;
      }
    }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [page, status, pool, order, query, message]);

  useEffect(() => { void load(); return () => listRequest.current?.abort(); }, [load]);
  useEffect(() => {
    if (!autoRefresh || query || status || pool !== 'main') return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, query, status, pool, load]);
  useEffect(() => () => { detailRequest.current?.abort(); eventsRequest.current?.abort(); }, []);

  const openDetail = useCallback(async (id: string) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    selectedId.current = id;
    setDetailOpen(true); setDetailLoading(true); setDetail(null); setDetailError('');
    try {
      const result = await adminFetch<AccountDetail>(`/api/admin/risk/accounts/${encodeURIComponent(id)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDetail(result);
    } catch (reason) { if (!controller.signal.aborted) { const text = errorText(reason, '账户详情加载失败'); setDetailError(text); void message.error({ key: 'risk-detail-error', content: text }); } }
    finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }, [message]);
  useEffect(() => { if (initialAccountId) void openDetail(initialAccountId); }, [initialAccountId, openDetail]);

  const saveDecision = async (values: Decision) => {
    if (!detail || detail.id !== selectedId.current) { message.warning('账户已变化，请重新查看后处置'); return; }
    const id = detail.id;
    setSaving(true);
    try {
      await adminFetch(`/api/admin/risk/accounts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(values) });
      message.success('账户处置已保存');
      await Promise.all([load(), selectedId.current === id ? openDetail(id) : Promise.resolve()]);
    } catch (reason) { message.error(errorText(reason, '保存失败')); throw reason; }
    finally { setSaving(false); }
  };
  const resetRisk = async (id: string, reason: string) => {
    if (!detail || detail.id !== id) { message.warning('账户已变化，请重新查看后重置'); return; }
    setSaving(true);
    try {
      await adminFetch(`/api/admin/risk/accounts/${encodeURIComponent(id)}/reset`, { method: 'POST', body: JSON.stringify({ reason }) });
      message.success('账户风险状态和分数已重置');
      await Promise.all([load(), selectedId.current === id ? openDetail(id) : Promise.resolve()]);
    } catch (reasonError) { message.error(errorText(reasonError, '风险重置失败')); throw reasonError; }
    finally { setSaving(false); }
  };
  const updateHumanChallenge = (id: string, humanChallenge: HumanChallengeState) => {
    setDetail(current => current?.id === id ? { ...current, humanChallenge } : current);
    setData(current => current ? { ...current, items: current.items.map(item => item.id === id ? { ...item, humanChallenge } : item) } : current);
  };
  const openPolicy = async () => {
    try { policyForm.setFieldsValue(await adminFetch<Policy>('/api/admin/risk/policy')); setPolicyOpen(true); }
    catch (reason) { message.error(errorText(reason, '额度加载失败')); }
  };
  const savePolicy = async () => {
    const values = await policyForm.validateFields(); setSaving(true);
    try { await adminFetch('/api/admin/risk/policy', { method: 'PUT', body: JSON.stringify(values) }); message.success('全局额度已更新'); setPolicyOpen(false); }
    catch (reason) { message.error(errorText(reason, '额度保存失败')); }
    finally { setSaving(false); }
  };
  const loadEvents = async () => {
    eventsRequest.current?.abort();
    const controller = new AbortController();
    eventsRequest.current = controller;
    setEventsOpen(true); setEventsLoading(true); setEventsError('');
    try {
      const result = await adminFetch<{ items: RiskEvent[] }>('/api/admin/risk/events', { signal: controller.signal });
      if (!controller.signal.aborted) setEvents(result.items);
    }
    catch (reason) { if (!controller.signal.aborted) { const text = errorText(reason, '安全事件加载失败'); setEventsError(text); setEvents([]); void message.error({ key: 'risk-events-error', content: text }); } }
    finally { if (!controller.signal.aborted) setEventsLoading(false); }
  };
  const changePool = (value: string) => { listRequest.current?.abort(); setData(null); setError(''); setPool(value); setStatus(''); setPage(1); };

  const clearHistory = async () => {
    if (clearingRequest.current) return;
    clearingRequest.current = true;
    setClearing(true);
    listRequest.current?.abort(); detailRequest.current?.abort(); eventsRequest.current?.abort();
    try {
      const result = await adminFetch<{ accounts: number }>('/api/admin/risk/history/clear', { method: 'POST', body: JSON.stringify({ confirm: 'CLEAR_RISK_HISTORY' }) });
      void message.success({ key: 'risk-history-clear', content: `已清理 ${count(result.accounts)} 个账户的历史数据，今日统计和额度已保留` });
      setClearOpen(false);
    } catch (reason) { void message.error({ key: 'risk-history-clear', content: errorText(reason, '历史数据清理失败，请重试') }); }
    finally {
      clearingRequest.current = false;
      setClearing(false);
      await Promise.all([load(), detailOpen && selectedId.current ? openDetail(selectedId.current) : Promise.resolve(), eventsOpen ? loadEvents() : Promise.resolve()]);
    }
  };

  return <RiskHelpContext.Provider value={showHelp}><ConfigProvider theme={{ token: { fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif', fontSize: 14, fontSizeSM: 14 } }}><div className="risk-panel">
    <div className="risk-page-heading"><h2><SafetyCertificateOutlined /> 账户风控</h2><Space className="risk-toolbar" wrap><Button type="text" aria-pressed={showHelp} onClick={() => setShowHelp(value => !value)}>{showHelp ? '隐藏说明' : '显示说明'}</Button>{onOpenSecurity && <Button onClick={onOpenSecurity}>人机校验配置</Button>}<Button disabled={clearing} onClick={() => void loadEvents()}>安全事件</Button><Button disabled={clearing} icon={<SettingOutlined />} onClick={() => void openPolicy()}>请求额度</Button><Button type="primary" icon={<ReloadOutlined />} loading={loading} disabled={clearing} onClick={() => { lastListError.current = ''; void load(); }}>刷新数据</Button><Button className="risk-destructive-action" type="text" danger icon={<DeleteOutlined />} loading={clearing} disabled={saving} onClick={() => setClearOpen(true)}>清除历史数据</Button></Space></div>
    <div className="risk-summary" aria-label="风险队列概况">{[
      [pool === 'blocked' ? '风控池账户' : pool === 'all' ? '全量账户' : '主列表账户', data?.total], ['全站高风险', data?.high], ['风控池总数', data?.blocked],
    ].map(([label, value]) => <div className="risk-summary-item" key={String(label)}><span>{label}</span><strong>{typeof value === 'number' ? count(value) : '—'}</strong></div>)}</div>
    <Tabs className="risk-pool-tabs" activeKey={pool} onChange={changePool} items={[{ key: 'main', label: '待复核' }, { key: 'blocked', label: `风控池 · ${data ? count(data.blocked) : '—'}` }, { key: 'all', label: '全部账户' }]} />
    <RiskSection title={pool === 'blocked' ? '已限制账户' : pool === 'all' ? '全部账户' : '待复核账户'} description="主列表排除已限制账户，关注和高风险但未处置的账户保留待复核，风控池按人工状态分类，不以评分自动封禁，校验记录不代表永久真人身份" actions={<label className="risk-auto-refresh"><Switch size="small" checked={autoRefresh && !query && !status && pool === 'main'} disabled={Boolean(query || status || pool !== 'main')} onChange={setAutoRefresh} aria-label="自动刷新风险列表" />自动刷新</label>}>
      <div className="risk-filters"><Input.Search aria-label="搜索账户" placeholder="名称、昵称、账号、邮箱或 IP" value={lookup} allowClear onChange={event => { setLookup(event.target.value); if (!event.target.value) { setQuery(''); setPage(1); } }} onSearch={value => { const next = value.trim(); lastListError.current = ''; if (next === query && page === 1) void load(); else { setQuery(next); setPage(1); } }} enterButton="搜索" maxLength={254} /><Select aria-label="账户状态" value={status} disabled={pool === 'blocked'} onChange={value => { setStatus(value); setPage(1); }} options={[{ value: '', label: pool === 'blocked' ? '已限制' : '全部状态' }, ...(pool === 'main' ? STATUS_OPTIONS.filter(option => option.value !== 'blocked') : STATUS_OPTIONS)]} /><Select aria-label="排序方式" value={order} onChange={value => { setOrder(value); setPage(1); }} options={[{ value: 'risk', label: '风险优先' }, { value: 'recent', label: '最近活跃' }]} /></div>
      <p className="risk-mobile-hint">左右滑动查看更多</p>
      <Table<RiskAccount> className="risk-account-table" rowKey="id" loading={loading} dataSource={data?.items || []} scroll={{ x: 1140 }} rowClassName={account => queueScore(account) >= 60 ? 'risk-row-high' : ''} pagination={{ current: page, pageSize: 20, total: data?.total || 0, showSizeChanger: false, onChange: setPage, showTotal: total => `共 ${count(total)} 个账户` }} locale={{ emptyText: <Empty description={error ? '数据暂不可用，请恢复连接后重试' : query || status || pool !== 'main' ? '没有匹配的账户，请调整筛选条件' : '尚无风控记录，账户后续登录或访问时开始采集'} /> }} columns={[
        { title: '账户', width: 220, render: (_, account) => <div className="risk-account-cell"><Button type="link" onClick={() => void openDetail(account.id)}>{account.displayName || account.nickname || account.email || account.id}</Button><span className="risk-secondary risk-ellipsis">{account.email && account.email !== account.displayName ? account.email : account.id}</span></div> },
        { title: '风险与状态', width: 220, render: (_, account) => <div className="risk-cell-stack"><Space size={8} wrap><Tag color={riskColor(queueScore(account))}>{queueScore(account)} 分</Tag><Tag color={account.status === 'blocked' ? 'red' : account.status === 'watch' ? 'orange' : 'default'}>{statusLabel(account.status)}</Tag></Space></div> },
        { title: '今日请求', width: 170, render: (_, account) => <div className="risk-cell-stack"><span className="risk-request-count">{count(account.daily.requests)}<span className="risk-secondary"> 次</span></span><span className="risk-secondary">音乐 {count(account.daily.music)} · 实时 {count(account.daily.socketRequests)}</span>{account.daily.denied > 0 && <Tag color="orange">拒绝 {count(account.daily.denied)}</Tag>}{account.dailyEstimated && <Tag>升级日估算</Tag>}</div> },
        { title: '网络与房间', width: 190, render: (_, account) => <div className="risk-cell-stack"><span>{account.lastRequestIp || account.lastLoginIp || '—'}</span><span className="risk-secondary">24h {count(account.ipCount)} 个 IP · 今日 {count(account.roomCount)} 个房间</span></div> },
        { title: '人机验证', width: 180, render: (_, account) => <div className="risk-cell-stack"><Tag color={account.humanChallenge?.bypass ? 'green' : account.humanChallenge?.pending ? 'orange' : account.lastHumanVerifiedAt ? 'blue' : 'default'}>{account.humanChallenge?.bypass ? '已放行' : account.humanChallenge?.pending ? '待验证' : account.lastHumanVerifiedAt ? '有通过记录' : '暂无记录'}</Tag>{account.humanChallenge && account.humanChallenge.triggers > 0 && <span className="risk-secondary">今日触发 {account.humanChallenge.triggers} · 通过 {account.humanChallenge.passes}</span>}{account.daily.untrustedForwarded > 0 && <Tag color="orange">异常转发声明</Tag>}</div> },
        { title: '最近活动', width: 160, render: (_, account) => <div className="risk-cell-stack"><span className="risk-secondary">{formatRelativeTime(account.lastSeenAt)}</span><Button className="risk-detail-link" type="link" onClick={() => void openDetail(account.id)}>查看画像</Button></div> },
      ]} />
      <div className="risk-section-footer"><span>更新于 {time(data?.generatedAt || 0)} · 北京时间</span><span>{query || status || pool !== 'main' ? '手动刷新' : autoRefresh ? '每 30 秒刷新' : '自动刷新已暂停'}</span></div>
    </RiskSection>
    <Modal title="清除全站风控历史数据" open={clearOpen} onCancel={() => { if (!clearingRequest.current) setClearOpen(false); }} onOk={() => void clearHistory()} confirmLoading={clearing} closable={!clearing} keyboard={!clearing} cancelButtonProps={{ disabled: clearing }} okButtonProps={{ danger: true }} okText="确认清除" cancelText="取消">
      <Alert type="warning" showIcon title="清除后无法恢复，请确认已备份需要留存的数据" />
      <p>清除所有账户的历史 IP、登录记录、客户端特征、按 IP 分组的请求明细、入房与昵称历史、错误明细、往日统计及已有安全事件</p>
      <p>保留账户资料、登录会话、人工限制与处置记录、标签备注、风控策略、今日统计及当前限流额度，不会解除账户限制</p>
      <p>清理期间和完成后仍会正常采集新访问记录，今日风险因子仍可能生效</p>
    </Modal>
      <Drawer title="账户风险画像" size="min(1100px, 100vw)" open={detailOpen} onClose={() => { selectedId.current = ''; detailRequest.current?.abort(); setDetailOpen(false); }} loading={detailLoading}>
      <div className="risk-panel risk-detail">{detailError && <Alert type="error" showIcon title="账户画像加载失败" description={detailError} action={<Button onClick={() => void openDetail(selectedId.current)}>重试</Button>} />}{detail && <RiskAccountDetail key={detail.id} detail={detail} saving={saving} onOpenAccount={id => void openDetail(id)} onOpenRoom={id => { setDetailOpen(false); onOpenRoom(id, detail.id); }} onOpenIp={ip => { detailRequest.current?.abort(); selectedId.current = ''; setDetailOpen(false); setLookup(ip); setQuery(ip); setStatus(''); setPool('all'); setPage(1); }} onSaveDecision={saveDecision} onResetRisk={resetRisk} onHumanChallengeChange={updateHumanChallenge} />}</div>
    </Drawer>
    <Modal title="全局请求额度" open={policyOpen} onCancel={() => setPolicyOpen(false)} onOk={() => { void savePolicy().catch(() => message.warning('请检查额度输入')); }} confirmLoading={saving} okText="保存额度" cancelText="取消"><Alert type="warning" showIcon title="额度对新请求立即生效，日额度按北京时间零点重置" description="同 IP 限额覆盖共享网络下的所有账户，请为校园网、公司网和家庭网络预留余量" style={{ marginBottom: 20 }} /><Form form={policyForm} layout="vertical">{(Object.keys(POLICY_LABELS) as (keyof Policy)[]).map(key => <Form.Item key={key} name={key} label={POLICY_LABELS[key]} rules={[{ required: true }, { type: 'integer', min: 1, max: 10000000 }]}><InputNumber min={1} max={10000000} precision={0} style={{ width: '100%' }} /></Form.Item>)}</Form></Modal>
    <Drawer title="最近安全事件" size="min(1000px, 100vw)" open={eventsOpen} onClose={() => setEventsOpen(false)}><div className="risk-panel"><p className="risk-muted">展示最近 200 条，存储最多 2000 条且不超过 90 天，重复额度告警按账户每分钟合并，未认证尝试仅保留账户摘要，不是全量请求日志</p>{eventsError && <Button onClick={() => void loadEvents()}>重试加载事件</Button>}<Table rowKey="rowId" loading={eventsLoading} size="small" dataSource={events.map((row, index) => ({ ...row, rowId: `${row.at}:${index}` }))} scroll={{ x: 780 }} columns={[{ title: '北京时间', dataIndex: 'at', render: time, width: 185 }, { title: '账户 / 摘要', render: (_, row) => <span className="risk-wrap">{row.accountId || row.accountHash || '未认证'}</span>, width: 260 }, { title: 'IP', dataIndex: 'ip', width: 170 }, { title: '事件代码', dataIndex: 'code', render: (value: string) => <span className="risk-wrap">{value}</span> }]} /></div></Drawer>
  </div></ConfigProvider></RiskHelpContext.Provider>;
}
