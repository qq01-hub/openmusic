import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, ConfigProvider, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined, SettingOutlined } from '@ant-design/icons';
import { adminFetch, formatRelativeTime } from './utils';
import { count, errorText, POLICY_LABELS, queueScore, riskColor, riskLabel, RiskSection, STATUS_OPTIONS, statusLabel, time, type AccountDetail, type Decision, type Policy, type RiskAccount, type RiskEvent, type RiskPage } from './riskControlShared';
import RiskAccountDetail from './RiskAccountDetail';
import './RiskControlPanel.css';

export default function RiskControlPanel() {
  const { message } = App.useApp();
  const [data, setData] = useState<RiskPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
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
  const [policyForm] = Form.useForm<Policy>();
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const selectedId = useRef('');
  const lastListError = useRef('');

  const load = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true); setError('');
    try {
      const result = await adminFetch<RiskPage>(`/api/admin/risk/accounts?${new URLSearchParams({ page: String(page), status, order, q: query })}`, { signal: controller.signal });
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
  }, [page, status, order, query, message]);

  useEffect(() => { void load(); return () => listRequest.current?.abort(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);
  useEffect(() => () => detailRequest.current?.abort(), []);

  const openDetail = async (id: string) => {
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
  };

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
    setEventsOpen(true); setEventsLoading(true); setEventsError('');
    try { setEvents((await adminFetch<{ items: RiskEvent[] }>('/api/admin/risk/events')).items); }
    catch (reason) { const text = errorText(reason, '安全事件加载失败'); setEventsError(text); setEvents([]); void message.error({ key: 'risk-events-error', content: text }); }
    finally { setEventsLoading(false); }
  };

  return <ConfigProvider theme={{ token: { fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif', fontSize: 14, fontSizeSM: 14 } }}><div className="risk-panel">
    <div className="risk-page-heading"><h2><SafetyCertificateOutlined /> 账户风控</h2><Space wrap><Button onClick={() => void loadEvents()}>安全事件</Button><Button icon={<SettingOutlined />} onClick={() => void openPolicy()}>请求额度</Button><Button icon={<ReloadOutlined />} loading={loading} onClick={() => { lastListError.current = ''; void load(); }}>刷新数据</Button></Space></div>
    <div className="risk-summary" aria-label="风险队列概况">{[
      ['匹配账户', data?.total], ['全站高风险', data?.high], ['全站受限', data?.blocked],
    ].map(([label, value]) => <div className="risk-summary-item" key={String(label)}><span>{label}</span><strong>{typeof value === 'number' ? count(value) : '—'}</strong></div>)}</div>
    <RiskSection title="账户列表" description="默认按风险采样分数从高到低排列，筛选状态不改变排序方式，完整绑定身份、标签和行为记录可在账户画像中查看" actions={<label className="risk-auto-refresh"><Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} aria-label="自动刷新风险列表" />自动刷新</label>}>
      <div className="risk-filters"><Input.Search aria-label="搜索账户" placeholder="名称、昵称、账号、邮箱或 IP" value={lookup} allowClear onChange={event => { setLookup(event.target.value); if (!event.target.value) { setQuery(''); setPage(1); } }} onSearch={value => { const next = value.trim(); lastListError.current = ''; if (next === query && page === 1) void load(); else { setQuery(next); setPage(1); } }} enterButton="搜索" maxLength={254} /><Select aria-label="账户状态" value={status} onChange={value => { setStatus(value); setPage(1); }} options={[{ value: '', label: '全部状态' }, ...STATUS_OPTIONS]} /><Select aria-label="排序方式" value={order} onChange={value => { setOrder(value); setPage(1); }} options={[{ value: 'risk', label: '风险从高到低' }, { value: 'recent', label: '最近活跃优先' }]} /></div>
      <p className="risk-mobile-hint">左右滑动列表可查看风险值与行为数据，点击账户名称打开完整画像</p>
      <Table<RiskAccount> className="risk-account-table" rowKey="id" loading={loading} dataSource={data?.items || []} scroll={{ x: 1080 }} rowClassName={account => queueScore(account) >= 60 ? 'risk-row-high' : ''} pagination={{ current: page, pageSize: 20, total: data?.total || 0, showSizeChanger: false, onChange: setPage, showTotal: total => `共 ${count(total)} 个账户` }} locale={{ emptyText: <Empty description={error ? '数据暂不可用，请恢复连接后重试' : query || status ? '没有匹配的账户，请调整筛选条件' : '尚无风控记录，账户后续登录或访问时开始采集'} /> }} columns={[
        { title: '账户', width: 250, render: (_, account) => <div className="risk-account-cell"><Button type="link" onClick={() => void openDetail(account.id)}>{account.displayName || account.nickname || account.email || account.id}</Button><span className="risk-secondary risk-ellipsis">{account.email && account.email !== account.displayName ? account.email : account.id}</span></div> },
        { title: '风险与状态', width: 270, render: (_, account) => <div className="risk-cell-stack"><Space size={8} wrap><Tag color={riskColor(queueScore(account))}>{queueScore(account)} 分 · {riskLabel(queueScore(account))}</Tag><span className={`risk-status risk-status--${account.status}`}>{statusLabel(account.status)}</span></Space><span className="risk-secondary risk-line-clamp">{account.reasons[0] || '暂未命中规则'}</span></div> },
        { title: '今日请求', width: 170, render: (_, account) => <div className="risk-cell-stack"><span className="risk-request-count">{count(account.daily.requests)}<span className="risk-secondary"> 次</span></span><span className="risk-secondary">拒绝 {count(account.daily.denied)} · 音乐 {count(account.daily.music)}</span>{account.dailyEstimated && <Tag>升级日估算</Tag>}</div> },
        { title: '网络与房间', width: 230, render: (_, account) => <div className="risk-cell-stack"><span>{account.lastRequestIp || account.lastLoginIp || '尚无可信 IP'}</span><span className="risk-secondary">24h {count(account.ipCount)} 个 IP · 今日 {count(account.roomCount)} 个房间</span></div> },
        { title: '最近活动', width: 160, render: (_, account) => <div className="risk-cell-stack"><span className="risk-secondary">{formatRelativeTime(account.lastSeenAt)}</span><Button className="risk-detail-link" type="link" onClick={() => void openDetail(account.id)}>查看画像</Button></div> },
      ]} />
      <div className="risk-section-footer"><span>更新于 {time(data?.generatedAt || 0)} · 北京时间</span><span>{autoRefresh ? '每 30 秒刷新' : '自动刷新已暂停'} · 详情实时复核</span></div>
    </RiskSection>
    <Drawer title="账户风险画像" size="min(1100px, 100vw)" open={detailOpen} onClose={() => { selectedId.current = ''; detailRequest.current?.abort(); setDetailOpen(false); }} loading={detailLoading}>
      <div className="risk-panel risk-detail">{detailError && <Button onClick={() => void openDetail(selectedId.current)}>重试加载画像</Button>}{detail && <RiskAccountDetail detail={detail} saving={saving} onOpenAccount={id => void openDetail(id)} onSaveDecision={saveDecision} />}</div>
    </Drawer>
    <Modal title="全局请求额度" open={policyOpen} onCancel={() => setPolicyOpen(false)} onOk={() => { void savePolicy().catch(() => message.warning('请检查额度输入')); }} confirmLoading={saving} okText="保存额度" cancelText="取消"><Alert type="warning" showIcon title="额度对新请求立即生效，日额度按北京时间零点重置" description="同 IP 限额覆盖共享网络下的所有账户，请为校园网、公司网和家庭网络预留余量" style={{ marginBottom: 20 }} /><Form form={policyForm} layout="vertical">{(Object.keys(POLICY_LABELS) as (keyof Policy)[]).map(key => <Form.Item key={key} name={key} label={POLICY_LABELS[key]} rules={[{ required: true }, { type: 'integer', min: 1, max: 10000000 }]}><InputNumber min={1} max={10000000} precision={0} style={{ width: '100%' }} /></Form.Item>)}</Form></Modal>
    <Drawer title="最近安全事件" size="min(1000px, 100vw)" open={eventsOpen} onClose={() => setEventsOpen(false)}><div className="risk-panel"><p className="risk-muted">展示最近 200 条，存储最多 2000 条且不超过 90 天，重复额度告警按账户每分钟合并，未认证尝试仅保留账户摘要，不是全量请求日志</p>{eventsError && <Button onClick={() => void loadEvents()}>重试加载事件</Button>}<Table rowKey="rowId" loading={eventsLoading} size="small" dataSource={events.map((row, index) => ({ ...row, rowId: `${row.at}:${index}` }))} scroll={{ x: 780 }} columns={[{ title: '北京时间', dataIndex: 'at', render: time, width: 185 }, { title: '账户 / 摘要', render: (_, row) => <span className="risk-wrap">{row.accountId || row.accountHash || '未认证'}</span>, width: 260 }, { title: 'IP', dataIndex: 'ip', width: 170 }, { title: '事件代码', dataIndex: 'code', render: (value: string) => <span className="risk-wrap">{value}</span> }]} /></div></Drawer>
  </div></ConfigProvider>;
}
