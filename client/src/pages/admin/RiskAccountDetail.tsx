import { Alert, App, Button, Collapse, Descriptions, Empty, Form, Input, Select, Space, Table, Tabs, Tag } from 'antd';
import { count, hasDailyActivity, IdentityTags, POLICY_LABELS, PROVIDERS, riskColor, riskLabel, RiskSection, STATUS_OPTIONS, statusLabel, time, type AccountDetail, type Day, type Decision, type Policy } from './riskControlShared';
import RiskErrorBreakdown from './RiskErrorBreakdown';

const OPERATIONS: Record<string, string> = {
  search: '音乐搜索', url: '播放地址', lrc: '歌词', pic: '封面', playlist: '歌单', song: '歌曲信息',
  search_playlist: '歌单搜索', fm: '推荐电台', source: '音源', media: '媒体代理', qr: '二维码', queue: '队列',
  api: '其他接口', socket: '实时操作', music: '其他音乐请求',
};

function DailyTable({ days }: { days: Day[] }) {
  return <Table size="small" rowKey="date" dataSource={days.filter(hasDailyActivity)} pagination={false} scroll={{ x: 760 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="最近 14 天暂无活动记录" /> }} columns={[
    { title: '北京时间日期', dataIndex: 'date', width: 150 },
    ...([['requests', '总请求'], ['music', '音乐请求'], ['socketRequests', '实时操作'], ['denied', '拒绝'], ['errors', '错误'], ['authFailures', '凭据失败'], ['roomJoins', '入房次数']] as const).map(([key, label]) => ({ title: label, dataIndex: key, render: count })),
  ]} />;
}

export default function RiskAccountDetail({ detail, saving, onOpenAccount, onSaveDecision }: {
  detail: AccountDetail; saving: boolean;
  onOpenAccount: (id: string) => void; onSaveDecision: (values: Decision) => Promise<void>;
}) {
  const { modal } = App.useApp();
  const confirmDecision = (values: Decision) => {
    modal.confirm({ title: `确认将账户设为「${statusLabel(values.status)}」？`,
      content: <div className="risk-wrap"><p>{detail.displayName || detail.id}</p><p>{values.reason}</p><p>限制访问会沿用现有替代曲处理规则，评分不会自动改变账户状态</p></div>,
      okText: '确认保存', cancelText: '返回检查', okButtonProps: { danger: values.status === 'blocked' }, onOk: () => onSaveDecision(values),
    });
  };
  const operations = Object.entries(detail.daily || {}).filter(([key]) => key.startsWith('operation_')).sort((left, right) => right[1] - left[1]);
  const identityTab = <div className="risk-tab-content">
    <div className="risk-detail-grid">
      <RiskSection title="账户身份" description="来自服务端账户记录，绑定状态变化后重新读取">
        <Descriptions column={1} size="small" items={[
          { key: 'id', label: '账户 ID', children: <code className="risk-wrap">{detail.id}</code> },
          { key: 'name', label: '账户名称', children: detail.displayName || '未记录' },
          { key: 'nickname', label: '最近房间昵称', children: detail.nickname || '未记录' },
          { key: 'email', label: '绑定邮箱', children: <span className="risk-wrap">{detail.email || '未绑定'}</span> },
          { key: 'verified', label: '邮箱验证', children: detail.email ? (detail.emailVerified ? '已验证' : '待确认') : '无绑定邮箱' },
          { key: 'password', label: '密码登录', children: detail.identityAvailable ? (detail.hasPassword ? '已设置' : '未设置') : '历史记录待补全' },
          { key: 'roomUserId', label: '房间身份 ID', children: <code className="risk-wrap">{detail.roomUserId || '未记录'}</code> },
          { key: 'created', label: '注册时间', children: time(detail.createdAt) },
          { key: 'registrationIp', label: '注册 IP', children: detail.registrationIp || '未记录' },
        ]} />
      </RiskSection>
      <RiskSection title="活动概况" description="今日为北京时间自然日，IP 与客户端计数为近 24 小时">
        <Descriptions column={1} size="small" items={[
          { key: 'score', label: '当前风险', children: <Tag color={riskColor(detail.score)}>{detail.score} 分 · {riskLabel(detail.score)}</Tag> },
          { key: 'seen', label: '首次采集', children: time(detail.firstSeenAt) },
          { key: 'last', label: '最近活动', children: time(detail.lastSeenAt) },
          { key: 'login', label: '最近登录', children: time(detail.lastLoginAt) },
          { key: 'scored', label: '最近评分采样', children: time(detail.scoredAt) },
          { key: 'loginCount', label: '累计登录', children: count(detail.loginCount) },
          { key: 'requests', label: '累计请求', children: count(detail.requests) },
          { key: 'music', label: '累计音乐请求', children: count(detail.musicRequests) },
          { key: 'denied', label: '累计拒绝 / 错误', children: `${count(detail.denied)} / ${count(detail.errors)}` },
          { key: 'room', label: '今日房间 / 入房', children: `${count(detail.roomCount)} / ${count(detail.daily.roomJoins)}` },
          { key: 'network', label: 'IP / 客户端特征', children: `${count(detail.ipCount)} / ${count(detail.clientCount)}` },
          { key: 'shared', label: '同 IP 关联账户', children: count(detail.sharedAccounts) },
        ]} />
      </RiskSection>
    </div>
    <RiskSection title="绑定账号" description="仅展示登录平台、名称和脱敏标识，不展示凭据或平台原始身份标识">
      <Table size="small" rowKey="provider" dataSource={detail.identities || []} pagination={false} scroll={{ x: 650 }} columns={[
        { title: '登录方式', dataIndex: 'provider', render: (value: string) => PROVIDERS[value] || value, width: 130 },
        { title: '账号名称', dataIndex: 'username', render: (value: string) => <span className="risk-wrap">{value || '未记录'}</span> },
        { title: '脱敏标识', dataIndex: 'subjectHint', render: (value: string) => <code>{value || '—'}</code>, width: 160 },
        { title: '绑定时间', dataIndex: 'linkedAt', render: time, width: 180 },
      ]} />
    </RiskSection>
    <RiskSection title="风险依据" description="展示每条规则的观测值与得分，合计上限 100 分，未命中为 0 分，供人工复核">
      <Table size="small" rowKey="id" dataSource={detail.factors || []} pagination={false} scroll={{ x: 620 }} columns={[
        { title: '规则', dataIndex: 'label' }, { title: '观测值', dataIndex: 'value', render: count, width: 120 },
        { title: '贡献分', dataIndex: 'points', width: 110, render: (value: number) => value ? <Tag color="orange">+{value}</Tag> : <span className="risk-muted">未命中</span> },
      ]} />
    </RiskSection>
  </div>;
  const roomsTab = <div className="risk-tab-content">
    <RiskSection title="进入过的房间" description="仅记录服务端确认成功的入房，近 90 天最多 200 个房间，同账户同房间 60 秒内合并次数，不补造升级前历史">
      <Table size="small" rowKey="roomId" dataSource={detail.rooms || []} pagination={{ pageSize: 10 }} scroll={{ x: 1100 }} columns={[
        { title: '房间 / ID', width: 220, render: (_, row) => <div className="risk-cell-stack"><b className="risk-wrap">{row.roomName || '未命名房间'}</b><code className="risk-wrap">{row.roomId}</code></div> },
        { title: '最近入房昵称', dataIndex: 'nickname', width: 160, render: (value: string) => <span className="risk-wrap">{value || '未记录'}</span> },
        { title: '次数', dataIndex: 'joins', render: count, width: 70 },
        { title: '最近入房方式', dataIndex: 'readOnly', render: (value: boolean) => value ? '只读' : '普通', width: 120 },
        { title: '最近入房 IP', dataIndex: 'ip', width: 160 },
        { title: '首次进入', dataIndex: 'firstSeenAt', render: time, width: 180 },
        { title: '最近进入', dataIndex: 'lastSeenAt', render: time, width: 180 },
      ]} />
    </RiskSection>
    <RiskSection title="历史房间昵称" description="近 90 天最多保留 20 个最近使用的昵称，不作为违规结论">
      <Table size="small" rowKey="name" dataSource={detail.nicknames || []} pagination={false} columns={[
        { title: '昵称', dataIndex: 'name', render: (value: string) => <span className="risk-wrap">{value}</span> },
        { title: '最近使用', dataIndex: 'lastSeenAt', render: time, width: 180 },
      ]} />
    </RiskSection>
  </div>;
  const requestsTab = <div className="risk-tab-content">
    <RiskSection title="今日操作分布" description="按已认证请求计数，包含被额度或处置拒绝的尝试，不等同于成功业务操作数">
      {operations.length ? <div className="risk-operation-grid">{operations.map(([key, value]) => <div key={key}><span className="risk-wrap">{OPERATIONS[key.slice(10)] || key.slice(10)}</span><b>{count(value)}</b></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日尚无操作数据" />}
    </RiskSection>
    <RiskSection title="全局请求配额" description="当前生效的账户及共享网络额度，不是单账户自定义配置">
      <Descriptions column={{ xs: 1, sm: 2 }} size="small" items={(Object.keys(POLICY_LABELS) as (keyof Policy)[]).map(key => ({ key, label: POLICY_LABELS[key], children: count(detail.policy?.[key]) }))} />
    </RiskSection>
    <RiskSection title="最近 14 天" description="按北京时间 00:00–24:00 汇总，仅展示有活动的日期"><DailyTable days={detail.days || []} /></RiskSection>
    <RiskErrorBreakdown detail={detail} />
    {!!detail.legacyDays?.length && <Collapse items={[{ key: 'legacy', label: '查看升级前旧口径统计', children: <div className="risk-tab-content"><Alert type="info" title="旧统计以原 UTC 日分桶保留，以下仅将区间换算为北京时间，不与新自然日混同" showIcon /><Table size="small" rowKey="date" dataSource={detail.legacyDays} pagination={false} scroll={{ x: 740 }} columns={[
      { title: '北京时间区间', dataIndex: 'date', width: 370, render: (value: string) => { const start = Date.parse(`${value}T00:00:00Z`); return `${time(start)} 至 ${time(start + 86400000 - 1000)}`; } },
      { title: '总请求', dataIndex: 'requests', render: count }, { title: '音乐请求', dataIndex: 'music', render: count }, { title: '拒绝', dataIndex: 'denied', render: count },
    ]} /></div> }]} />}
  </div>;
  const networkTab = <div className="risk-tab-content">
    <RiskSection title="登录历史" description="近 90 天最多保留 100 条成功登录记录，凭据失败记录在安全事件中">
      <Table size="small" rowKey="rowId" dataSource={(detail.logins || []).map((row, index) => ({ ...row, rowId: `${row.at}:${index}` }))} pagination={{ pageSize: 8 }} scroll={{ x: 850 }} columns={[
        { title: '北京时间', dataIndex: 'at', render: time, width: 185 }, { title: '可信来源 IP', dataIndex: 'ip', width: 160 },
        { title: '方式', dataIndex: 'method', render: (value: string) => PROVIDERS[value] || value, width: 100 },
        { title: '客户端声明', dataIndex: 'userAgent', render: (value: string) => <span className="risk-wrap risk-ua">{value || '未记录'}</span> },
      ]} />
    </RiskSection>
    <div className="risk-detail-grid">
      <RiskSection title="历史登录 IP" description="近 90 天最多 100 个，当前画像另按近 24 小时访问 IP 计分">
        <Table size="small" rowKey="ip" dataSource={detail.ips || []} pagination={{ pageSize: 8 }} scroll={{ x: 360 }} columns={[{ title: 'IP', dataIndex: 'ip', width: 170 }, { title: '最近使用', dataIndex: 'lastSeenAt', render: time, width: 180 }]} />
      </RiskSection>
      <RiskSection title="最近活动 IP 的关联账户" description="取最新登录或请求 IP，同一 IP 不代表同一人，最多展示 20 个近 90 天账户">
        {detail.relatedAccounts?.length ? <div className="risk-related">{detail.relatedAccounts.map(id => <Button key={id} type="link" onClick={() => onOpenAccount(id)}>{id}</Button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联账户" />}
      </RiskSection>
    </div>
    <RiskSection title="客户端特征历史" description="近 90 天最多 50 项，来自可伪造的 User-Agent 声明，不是硬件设备或可信设备指纹">
      <Table size="small" rowKey="userAgent" dataSource={detail.clients || []} pagination={{ pageSize: 8 }} scroll={{ x: 650 }} columns={[
        { title: '客户端声明', dataIndex: 'userAgent', render: (value: string) => <span className="risk-wrap risk-ua">{value}</span> }, { title: '最近出现', dataIndex: 'lastSeenAt', render: time, width: 180 },
      ]} />
    </RiskSection>
  </div>;
  const decisionTab = <div className="risk-tab-content">
    <RiskSection title="账户标记与处置" description="所有变更需要填写原因并确认，风险分只排序和提示，不自动封禁">
      <Form<Decision> initialValues={{ status: detail.status, tags: detail.tags, note: detail.note, reason: '' }} layout="vertical" onFinish={confirmDecision} disabled={saving}>
        <div className="risk-detail-grid"><Form.Item name="status" label="账户状态" rules={[{ required: true }]}><Select options={STATUS_OPTIONS} /></Form.Item>
          <Form.Item name="tags" label="风险标签" extra="最多 10 个，每个最多 24 字" rules={[{ validator: (_, values: string[]) => values?.length > 10 || values?.some(value => value.length > 24) ? Promise.reject(new Error('标签最多 10 个，每个最多 24 字')) : Promise.resolve() }]}><Select mode="tags" tokenSeparators={['，', ',']} maxCount={10} placeholder="输入标签后按回车" /></Form.Item></div>
        <Form.Item name="note" label="内部备注" rules={[{ max: 500 }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="记录核查线索和后续处理建议" /></Form.Item>
        <Form.Item name="reason" label="本次处置原因" rules={[{ required: true, whitespace: true, message: '请填写可追溯的处置原因' }, { max: 200 }]}><Input.TextArea rows={2} maxLength={200} showCount /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>复核并保存处置</Button>
      </Form>
    </RiskSection>
    <RiskSection title="处置历史" description="近 90 天最多 100 条，具体操作者请在后台审计日志中核对">
      <Table size="small" rowKey="rowId" dataSource={(detail.decisions || []).map((row, index) => ({ ...row, rowId: `${row.at}:${index}` }))} pagination={{ pageSize: 8 }} scroll={{ x: 740 }} columns={[
        { title: '北京时间', dataIndex: 'at', render: time, width: 180 },
        { title: '状态变更', width: 200, render: (_, row) => `${statusLabel(row.previousStatus)} → ${statusLabel(row.status)}` },
        { title: '原因', dataIndex: 'reason', render: (value: string) => <span className="risk-wrap">{value}</span> },
      ]} />
    </RiskSection>
  </div>;
  return <>
    <div className="risk-detail-heading"><div><h2>{detail.displayName || '账户画像'}</h2><code className="risk-wrap">{detail.id}</code><div style={{ marginTop: 8 }}><IdentityTags account={detail} /></div></div><Space wrap><Tag color={riskColor(detail.score)}>{detail.score} 分 · {riskLabel(detail.score)}</Tag><Tag>{statusLabel(detail.status)}</Tag></Space></div>
    {detail.dailyEstimated && <Alert type="warning" showIcon title="升级日统计为保守估算" description="为防止升级后额度被重复使用，首次切换日合并相交的旧 UTC 日计数，可能高于真实当日值，下一北京时间自然日恢复新口径" />}
    <Tabs key={detail.id} defaultActiveKey="identity" items={[{ key: 'identity', label: '身份与风险', children: identityTab }, { key: 'rooms', label: '房间与昵称', children: roomsTab }, { key: 'requests', label: '请求与配额', children: requestsTab }, { key: 'network', label: '登录与网络', children: networkTab }, { key: 'decision', label: '标记与处置', children: decisionTab }]} />
  </>;
}
