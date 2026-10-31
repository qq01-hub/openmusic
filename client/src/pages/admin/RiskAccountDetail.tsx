import RiskSessions from './RiskSessions';
import { adminFetch } from './utils';
import RiskMusicResponses, { MusicResponseSummary } from './RiskMusicResponses';
import { useState } from 'react';
import RiskProfileOverview from './RiskProfileOverview';
import { Alert, App, Button, Collapse, Descriptions, Empty, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Switch } from 'antd';
import { count, hasDailyActivity, RiskHelpContext, POLICY_LABELS, PROVIDERS, riskColor, riskLabel, RiskSection, STATUS_OPTIONS, statusColor, statusLabel, time, type AccountDetail, type MusicResponse, type Day, type Decision, type Policy, type HumanChallengeState } from './riskControlShared';
import RiskErrorBreakdown from './RiskErrorBreakdown';

const OPERATIONS: Record<string, string> = {
  search: '音乐搜索', url: '播放地址', lrc: '歌词', pic: '封面', playlist: '歌单', song: '歌曲信息',
  search_playlist: '歌单搜索', fm: '推荐电台', source: '音源', media: '媒体代理', qr: '二维码', queue: '队列',
  api: '其他接口', socket: '实时操作', music: '其他音乐请求',
};

function DailyTable({ days }: { days: Day[] }) {
  return (
    <Table
      size="small"
      rowKey="date"
      dataSource={days.filter(hasDailyActivity)}
      pagination={false}
      scroll={{ x: 760 }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="最近 14 天暂无活动记录" /> }}
      columns={[
        { title: '北京时间日期', dataIndex: 'date', width: 150, render: (val: string) => <Tag>{val}</Tag> },
        ...([
          ['requests', '总请求', 'blue'],
          ['music', '音乐请求', 'purple'],
          ['socketRequests', '实时操作', 'geekblue'],
          ['denied', '拒绝', 'orange'],
          ['errors', '错误', 'red'],
          ['authFailures', '凭据失败', 'volcano'],
          ['roomJoins', '入房次数', 'cyan'],
        ] as const).map(([key, label, color]) => ({
          title: label,
          dataIndex: key,
          render: (val: string | number | undefined) => {
            const num = Number(val || 0);
            return num > 0 ? <Tag color={color}>{count(num)}</Tag> : <span className="risk-muted">0</span>;
          },
        })),
      ]}
    />
  );
}

export default function RiskAccountDetail({ detail, saving, onOpenAccount, onOpenRoom, onOpenIp, onSaveDecision, onResetRisk, onHumanChallengeChange }: {
  detail: AccountDetail; saving: boolean;
  onOpenRoom: (id: string) => void; onOpenIp: (ip: string) => void;
  onOpenAccount: (id: string) => void; onSaveDecision: (values: Decision) => Promise<void>; onResetRisk: (id: string, reason: string) => Promise<void>;
  onHumanChallengeChange: (id: string, state: HumanChallengeState) => void;
}) {
  const { modal, message } = App.useApp();
  const [showHelp, setShowHelp] = useState(false);
  const [human, setHuman] = useState(detail.humanChallenge);
  const [humanSaving, setHumanSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [matchedOnly, setMatchedOnly] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [requestPage, setRequestPage] = useState(1);
  const [requestPageSize, setRequestPageSize] = useState(10);
  const requestRows = (detail.requestEvents || []).filter(event => !operationFilter || event.operation === operationFilter);
  const changeOperation = (value: string) => { setOperationFilter(value); setRequestPage(1); };
  const inspect = (tab: string, operation = '') => { changeOperation(operation); setActiveTab(tab); };
  const confirmDecision = (values: Decision) => {
    modal.confirm({
      title: `确认将账户设为「${statusLabel(values.status)}」？`,
      content: (
        <div className="risk-wrap">
          <p>{detail.displayName || detail.id}</p>
          <p>{values.reason}</p>
          <p>限制访问会沿用现有替代曲处理规则，评分不会自动改变账户状态</p>
        </div>
      ),
      okText: '确认保存',
      cancelText: '返回检查',
      okButtonProps: { danger: values.status === 'blocked' },
      onOk: () => onSaveDecision(values),
    });
  };
  const operations = Object.entries(detail.daily || {}).filter(([key]) => key.startsWith('operation_')).sort((left, right) => right[1] - left[1]);

  const identityTab = (
    <div className="risk-tab-content">
      <div className="risk-detail-grid">
        <RiskSection title="账户身份" description="来自服务端账户记录，绑定状态变化后重新读取">
          <Descriptions
            className="risk-kv-grid"
            column={1}
            size="small"
            colon={false}
            items={[
              { key: 'id', label: '账户 ID', children: <code className="risk-code-pill">{detail.id}</code> },
              { key: 'name', label: '账户名称', children: detail.displayName ? <Tag color="blue">{detail.displayName}</Tag> : <Tag>未记录</Tag> },
              { key: 'nickname', label: '房间昵称', children: detail.nickname ? <Tag color="cyan">{detail.nickname}</Tag> : <Tag>未记录</Tag> },
              { key: 'email', label: '绑定邮箱', children: detail.email ? <Tag color="geekblue">{detail.email}</Tag> : <Tag>未绑定</Tag> },
              {
                key: 'verified',
                label: '认证状态',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color={detail.email && detail.emailVerified ? 'green' : detail.email ? 'orange' : 'default'}>
                      {detail.email ? (detail.emailVerified ? '邮箱已验证' : '邮箱待确认') : '无邮箱'}
                    </Tag>
                    <Tag color={detail.identityAvailable && detail.hasPassword ? 'blue' : 'default'}>
                      {detail.identityAvailable ? (detail.hasPassword ? '已设密码' : '未设密码') : '待补全'}
                    </Tag>
                  </Space>
                ),
              },
              { key: 'roomUserId', label: '房间身份 ID', children: detail.roomUserId ? <code className="risk-code-pill">{detail.roomUserId}</code> : <Tag>未记录</Tag> },
              { key: 'created', label: '注册时间', children: <Tag>{time(detail.createdAt)}</Tag> },
              { key: 'registrationIp', label: '注册 IP', children: detail.registrationIp ? <Tag color="cyan">{detail.registrationIp}</Tag> : <Tag>未记录</Tag> },
            ]}
          />
        </RiskSection>
        <RiskSection title="活动概况" description="今日为北京时间自然日，IP 与客户端计数为近 24 小时">
          <Descriptions
            className="risk-kv-grid"
            column={1}
            size="small"
            colon={false}
            items={[
              {
                key: 'score',
                label: '风险与状态',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color={riskColor(detail.score)}>{detail.score} 分 · {riskLabel(detail.score)}</Tag>
                    <Tag color={statusColor(detail.status)}>{statusLabel(detail.status)}</Tag>
                  </Space>
                ),
              },
              {
                key: 'proxy',
                label: '网络链路',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color={detail.lastNetworkRoute === 'trusted_proxy' ? 'blue' : 'default'}>
                      {detail.lastNetworkRoute === 'trusted_proxy' ? '可信代理链路' : detail.lastNetworkRoute === 'direct' ? '直连 / 未信任代理' : '历史未采集'}
                    </Tag>
                    {detail.daily.untrustedForwarded > 0 && <Tag color="orange">忽略转发 {count(detail.daily.untrustedForwarded)} 次</Tag>}
                  </Space>
                ),
              },
              {
                key: 'human',
                label: '人机校验',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color={detail.lastHumanVerifiedAt ? 'green' : 'default'}>
                      {detail.lastHumanVerifiedAt ? '已验证' : '无验证记录'}
                    </Tag>
                    {Boolean(detail.lastHumanVerifiedAt) && <Tag>{time(detail.lastHumanVerifiedAt!)}</Tag>}
                  </Space>
                ),
              },
              {
                key: 'stats',
                label: '累计请求',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color="blue">登录 {count(detail.loginCount)}</Tag>
                    <Tag color="geekblue">总请求 {count(detail.requests)}</Tag>
                    <Tag color="purple">音乐 {count(detail.musicRequests)}</Tag>
                    <Tag color={detail.denied > 0 ? 'orange' : 'default'}>拒绝 {count(detail.denied)}</Tag>
                    <Tag color={detail.errors > 0 ? 'red' : 'default'}>错误 {count(detail.errors)}</Tag>
                  </Space>
                ),
              },
              {
                key: 'network',
                label: '房间与设备',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color="cyan">今日 {count(detail.roomCount)} 房</Tag>
                    <Tag color="blue">入房 {count(detail.daily.roomJoins)} 次</Tag>
                    <Tag color="geekblue">24h IP {count(detail.ipCount)}</Tag>
                    <Tag>客户端 {count(detail.clientCount)}</Tag>
                    <Tag color={detail.sharedAccounts > 0 ? 'orange' : 'default'}>同IP关联 {count(detail.sharedAccounts)}</Tag>
                  </Space>
                ),
              },
              { key: 'seen', label: '首次采集', children: <Tag>{time(detail.firstSeenAt)}</Tag> },
              { key: 'last', label: '最近活动', children: <Tag color="blue">{time(detail.lastSeenAt)}</Tag> },
              { key: 'login', label: '最近登录', children: <Tag>{time(detail.lastLoginAt)}</Tag> },
              { key: 'scored', label: '评分采样', children: <Tag>{time(detail.scoredAt)}</Tag> },
            ]}
          />
        </RiskSection>
      </div>
      <RiskSection title="绑定账号" description="仅展示登录平台、名称和脱敏标识，不展示凭据或平台原始身份标识">
        <Table
          size="small"
          rowKey="provider"
          dataSource={detail.identities || []}
          pagination={false}
          scroll={{ x: 650 }}
          columns={[
            { title: '登录方式', dataIndex: 'provider', render: (value: string) => <Tag color="geekblue">{PROVIDERS[value] || value}</Tag>, width: 140 },
            { title: '账号名称', dataIndex: 'username', render: (value: string) => value ? <Tag color="blue">{value}</Tag> : <Tag>未记录</Tag> },
            { title: '脱敏标识', dataIndex: 'subjectHint', render: (value: string) => <code className="risk-code-pill">{value || '—'}</code>, width: 160 },
            { title: '绑定时间', dataIndex: 'linkedAt', render: (val: number) => <Tag>{time(val)}</Tag>, width: 180 },
          ]}
        />
      </RiskSection>
      <RiskSection
        title="风险依据与规则矩阵"
        description="各规则展示统计窗口、观测值、阈值和贡献分，组合规则 1 表示所有条件成立，0 表示不成立，零分线索不用于认定违规，风险总分不是机器人概率"
        actions={<label className="risk-auto-refresh"><Switch size="small" checked={matchedOnly} onChange={setMatchedOnly} />仅看命中</label>}
      >
        <Table
          size="small"
          rowKey="id"
          dataSource={[...(detail.factors || [])].filter(factor => !matchedOnly || factor.matched || factor.points > 0).sort((a, b) => b.points - a.points)}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={matchedOnly ? '当前无命中风险规则（可关闭右上角「仅看命中」查看全部规则）' : '暂无风险规则'} /> }}
          columns={[
            {
              title: '规则与分类',
              dataIndex: 'label',
              render: (label: string, row) => (
                <Space size={[6, 4]} wrap>
                  <Tag color="geekblue">{row.category || '历史规则'}</Tag>
                  <span className="risk-rule-title">{label}</span>
                </Space>
              ),
            },
            { title: '统计窗口', dataIndex: 'window', width: 140, render: (value: string) => <Tag>{value || '历史未记录'}</Tag> },
            { title: '触发阈值', dataIndex: 'threshold', width: 110, render: (value?: number) => value === undefined ? <span className="risk-muted">—</span> : <Tag color="default">≥ {count(value)}</Tag> },
            {
              title: '观测值',
              dataIndex: 'value',
              width: 160,
              render: (value: number, row) => {
                if (['musicWithoutContext', 'roomHopping', 'highErrorRate', 'musicOnlyBurst', 'toolClientBurst', 'urlHarvesting'].includes(row.id)) {
                  return <Tag color={value ? 'volcano' : 'default'}>{value ? '满足组合条件' : '未满足'}</Tag>;
                }
                const text = `${count(value)}${['operationConcentration', 'emptyResponseRate'].includes(row.id) ? '%' : ''}`;
                return <Tag color={row.matched || row.points > 0 ? 'blue' : 'default'}>{text}</Tag>;
              },
            },
            {
              title: '贡献分',
              dataIndex: 'points',
              width: 110,
              render: (value: number, row) => value
                ? <Tag color={value >= 25 ? 'red' : 'orange'}>+{value} 分</Tag>
                : <Tag color={row.matched ? 'gold' : 'default'}>{row.matched ? '仅作线索' : '未命中'}</Tag>,
            },
          ]}
        />
      </RiskSection>
    </div>
  );

  const roomsTab = (
    <div className="risk-tab-content">
      <RiskSection title="进入过的房间" description="仅记录服务端确认成功的入房，近 90 天最多 200 个房间，同账户同房间 60 秒内合并次数，不补造升级前历史">
        <Table
          size="small"
          rowKey="roomId"
          dataSource={detail.rooms || []}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }}
          scroll={{ x: 1100 }}
          columns={[
            {
              title: '房间 / ID',
              width: 240,
              render: (_, row) => (
                <Space size={[6, 4]} wrap>
                  <Button className="risk-detail-link" type="link" onClick={() => onOpenRoom(row.roomId)}>{row.roomName || '未命名房间'} →</Button>
                  <code className="risk-code-pill">{row.roomId}</code>
                </Space>
              ),
            },
            { title: '最近入房昵称', dataIndex: 'nickname', width: 160, render: (value: string) => value ? <Tag color="blue">{value}</Tag> : <Tag>未记录</Tag> },
            { title: '次数', dataIndex: 'joins', render: (val: number) => <Tag color="geekblue">{count(val)} 次</Tag>, width: 90 },
            { title: '入房方式', dataIndex: 'readOnly', render: (value: boolean) => <Tag color={value ? 'default' : 'green'}>{value ? '只读' : '普通'}</Tag>, width: 110 },
            { title: '最近入房 IP', dataIndex: 'ip', width: 170, render: (val: string) => val ? <Tag color="cyan" className="risk-clickable-tag" onClick={() => onOpenIp(val)}>{val}</Tag> : <Tag>未记录</Tag> },
            { title: '首次进入', dataIndex: 'firstSeenAt', render: time, width: 180 },
            { title: '最近进入', dataIndex: 'lastSeenAt', render: time, width: 180 },
          ]}
        />
      </RiskSection>
      <RiskSection title="历史房间昵称" description="近 90 天最多保留 20 个最近使用的昵称，不作为违规结论">
        <Table
          size="small"
          rowKey="name"
          dataSource={detail.nicknames || []}
          pagination={false}
          columns={[
            { title: '昵称', dataIndex: 'name', render: (value: string) => <Tag color="blue">{value}</Tag> },
            { title: '最近使用', dataIndex: 'lastSeenAt', render: time, width: 180 },
          ]}
        />
      </RiskSection>
    </div>
  );

  const requestsTab = (
    <div className="risk-tab-content">
      <RiskSection title="按 IP 查看请求" description="从升级后开始记录，每个账户保留近 90 天最近活跃的 200 个 IP，各列累计计数，歌曲类 WebSocket 同时归入歌曲列和 WebSocket 列，封面单独统计，不计入歌曲额度与 IP 切换因子">
        <Table
          size="small"
          rowKey="ip"
          dataSource={detail.ipRequests || []}
          pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }}
          scroll={{ x: 1000 }}
          columns={[
            {
              title: '访问 IP',
              dataIndex: 'ip',
              width: 190,
              render: (ip: string) => ip === 'unknown' ? <Tag>未记录</Tag> : <Tag color="cyan" className="risk-clickable-tag" onClick={() => onOpenIp(ip)}>{ip} →</Tag>,
            },
            { title: '总请求', dataIndex: 'total', render: (val: number) => <Tag color="blue">{count(val)}</Tag> },
            { title: '歌曲请求', dataIndex: 'music', render: (val: number) => val > 0 ? <Tag color="purple">{count(val)}</Tag> : <span className="risk-muted">0</span> },
            { title: 'WebSocket', dataIndex: 'socket', render: (val: number) => val > 0 ? <Tag color="geekblue">{count(val)}</Tag> : <span className="risk-muted">0</span> },
            { title: '封面', dataIndex: 'image', render: (val: number) => val > 0 ? <Tag>{count(val)}</Tag> : <span className="risk-muted">0</span> },
            { title: '其他接口', dataIndex: 'api', render: (val: number) => val > 0 ? <Tag>{count(val)}</Tag> : <span className="risk-muted">0</span> },
            { title: '最近请求', dataIndex: 'lastSeenAt', render: time, width: 180 },
          ]}
        />
      </RiskSection>
      <RiskSection title="歌曲请求的 IP 变化" description="近 10 分钟至少 3 个歌曲请求 IP 且切换 6 次加 20 分，切换 12 次加 30 分，稳定共享出口或两个出口之间切换不命中此因子，仅供人工复核">
        <div className="risk-tag-bar">
          <Tag color="cyan">歌曲请求 IP {count(detail.musicIpCount)} 个</Tag>
          <Tag color={(detail.musicIpChanges || 0) >= 6 ? 'orange' : 'blue'}>切换 {count(detail.musicIpChanges)} 次</Tag>
        </div>
      </RiskSection>
      <RiskSection title="最近重要请求" description="保留近 24 小时最近 200 条歌曲和 WebSocket 请求，包含被拒绝的尝试，封面仅保留分组计数">
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color="geekblue">操作筛选</Tag>
          <Select aria-label="筛选请求操作" value={operationFilter} style={{ width: 180 }} onChange={changeOperation} options={[{ value: '', label: '全部操作' }, ...Object.entries(OPERATIONS).map(([value, label]) => ({ value, label }))]} />
        </Space>
        <Table
          size="small"
          rowKey="id"
          dataSource={requestRows}
          pagination={{
            current: Math.min(requestPage, Math.max(1, Math.ceil(requestRows.length / requestPageSize))),
            pageSize: requestPageSize,
            total: requestRows.length,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            showTotal: total => `已留存 ${count(total)} 条，最多 200 条`,
            onChange: (page, size) => { setRequestPage(size === requestPageSize ? page : 1); setRequestPageSize(size); },
          }}
          scroll={{ x: 1120 }}
          columns={[
            { title: '北京时间', dataIndex: 'at', render: time, width: 180 },
            { title: 'IP', dataIndex: 'ip', width: 180, render: (val: string) => <Tag color="cyan">{val || '—'}</Tag> },
            { title: '类别', dataIndex: 'kind', width: 120, render: (value: string) => <Tag color={value === 'socket' ? 'purple' : 'blue'}>{value === 'socket' ? 'WebSocket' : '歌曲请求'}</Tag> },
            { title: '操作', dataIndex: 'operation', width: 140, render: (value: string) => <Tag color="geekblue">{OPERATIONS[value] || value}</Tag> },
            { title: '响应歌曲与结果', dataIndex: 'response', width: 380, render: (response: MusicResponse | undefined) => <MusicResponseSummary response={response} /> },
          ]}
        />
      </RiskSection>
      <RiskSection title="今日操作分布" description="按已认证请求计数，包含被额度或处置拒绝的尝试，不等同于成功业务操作数">
        {operations.length ? (
          <div className="risk-operation-grid">
            {operations.map(([key, value]) => (
              <div key={key}>
                <Tag color="geekblue">{OPERATIONS[key.slice(10)] || key.slice(10)}</Tag>
                <b>{count(value)}</b>
              </div>
            ))}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日尚无操作数据" />
        )}
      </RiskSection>
      <RiskSection title="全局请求配额" description="当前生效的账户及共享网络额度，不是单账户自定义配置">
        <div className="risk-operation-grid">
          {(Object.keys(POLICY_LABELS) as (keyof Policy)[]).map(key => (
            <div key={key}>
              <span>{POLICY_LABELS[key]}</span>
              <Tag color="blue">{count(detail.policy?.[key])}</Tag>
            </div>
          ))}
        </div>
      </RiskSection>
      <RiskSection title="最近 14 天" description="按北京时间 00:00–24:00 汇总，仅展示有活动的日期">
        <DailyTable days={detail.days || []} />
      </RiskSection>
      <RiskMusicResponses detail={detail} />
      <RiskErrorBreakdown detail={detail} />
      {!!detail.legacyDays?.length && (
        <Collapse
          items={[{
            key: 'legacy',
            label: '查看升级前旧口径统计',
            children: (
              <div className="risk-tab-content">
                <Alert type="info" title="旧统计以原 UTC 日分桶保留，以下仅将区间换算为北京时间，不与新自然日混同" showIcon />
                <Table
                  size="small"
                  rowKey="date"
                  dataSource={detail.legacyDays}
                  pagination={false}
                  scroll={{ x: 740 }}
                  columns={[
                    { title: '北京时间区间', dataIndex: 'date', width: 370, render: (value: string) => { const start = Date.parse(`${value}T00:00:00Z`); return `${time(start)} 至 ${time(start + 86400000 - 1000)}`; } },
                    { title: '总请求', dataIndex: 'requests', render: count },
                    { title: '音乐请求', dataIndex: 'music', render: count },
                    { title: '拒绝', dataIndex: 'denied', render: count },
                  ]}
                />
              </div>
            ),
          }]}
        />
      )}
    </div>
  );

  const networkTab = (
    <div className="risk-tab-content">
      <RiskSessions key={detail.id} accountId={detail.id} />
      <RiskSection title="登录历史" description="近 90 天最多保留 100 条成功登录记录，凭据失败记录在安全事件中">
        <Table
          size="small"
          rowKey="rowId"
          dataSource={(detail.logins || []).map((row, index) => ({ ...row, rowId: `${row.at}:${index}` }))}
          pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }}
          scroll={{ x: 850 }}
          columns={[
            { title: '北京时间', dataIndex: 'at', render: time, width: 185 },
            { title: '可信来源 IP', dataIndex: 'ip', width: 160, render: (val: string) => <Tag color="cyan">{val || '—'}</Tag> },
            { title: '方式', dataIndex: 'method', render: (value: string) => <Tag color="geekblue">{PROVIDERS[value] || value}</Tag>, width: 130 },
            { title: '客户端声明', dataIndex: 'userAgent', render: (value: string) => <span className="risk-wrap risk-ua">{value || '未记录'}</span> },
          ]}
        />
      </RiskSection>
      <div className="risk-detail-grid">
        <RiskSection title="历史访问 IP" description="合并登录与请求来源，当前画像另按近 24 小时重要请求 IP 计分，封面不参与该计分">
          <Table
            size="small"
            rowKey="ip"
            dataSource={detail.ips || []}
            pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }}
            scroll={{ x: 360 }}
            columns={[
              { title: 'IP', dataIndex: 'ip', width: 170, render: (val: string) => <Tag color="cyan" className="risk-clickable-tag" onClick={() => onOpenIp(val)}>{val}</Tag> },
              { title: '最近使用', dataIndex: 'lastSeenAt', render: time, width: 180 },
            ]}
          />
        </RiskSection>
        <RiskSection title="最近活动 IP 的关联账户" description="取最新登录或请求 IP，同一 IP 不代表同一人，最多展示 20 个近 90 天账户">
          {detail.relatedAccounts?.length ? (
            <Space size={[6, 6]} wrap>
              {detail.relatedAccounts.map(id => (
                <Tag key={id} color="geekblue" className="risk-clickable-tag" onClick={() => onOpenAccount(id)}>
                  {id} →
                </Tag>
              ))}
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联账户" />
          )}
        </RiskSection>
      </div>
      <RiskSection title="客户端特征历史" description="近 90 天最多 50 项，来自可伪造的 User-Agent 声明，不是硬件设备或可信设备指纹">
        <Table
          size="small"
          rowKey="userAgent"
          dataSource={detail.clients || []}
          pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }}
          scroll={{ x: 650 }}
          columns={[
            { title: '客户端声明', dataIndex: 'userAgent', render: (value: string) => <span className="risk-wrap risk-ua">{value}</span> },
            { title: '最近出现', dataIndex: 'lastSeenAt', render: time, width: 180 },
          ]}
        />
      </RiskSection>
    </div>
  );

  const decisionTab = (
    <div className="risk-tab-content">
      <RiskSection title="异常访问人机验证" description="管理员放行长期有效，直至撤销，仅跳过异常访问验证码，不解除账户封禁、登录验证或请求额度限制">
        {human && (
          <Descriptions
            className="risk-kv-grid"
            size="small"
            column={{ xs: 1, sm: 2 }}
            colon={false}
            items={[
              {
                key: 'state',
                label: '当前状态',
                children: (
                  <Tag color={human.bypass ? 'green' : human.pending ? 'orange' : 'blue'}>
                    {human.bypass ? '管理员已放行' : human.pending ? '待验证 · 资源已拦截' : '无需验证'}
                  </Tag>
                ),
              },
              { key: 'day', label: '北京时间日期', children: <Tag>{human.day}</Tag> },
              {
                key: 'daily',
                label: '今日触发 / 通过',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color="orange">触发 {human.triggers}</Tag>
                    <Tag color="green">通过 {human.passes}</Tag>
                    <Tag>上限 {human.dailyLimit || 2} 轮</Tag>
                  </Space>
                ),
              },
              {
                key: 'total',
                label: '累计触发 / 通过',
                children: (
                  <Space size={[4, 4]} wrap>
                    <Tag color="orange">触发 {human.triggerTotal}</Tag>
                    <Tag color="green">通过 {human.passTotal}</Tag>
                  </Space>
                ),
              },
              { key: 'last', label: '最近通过', children: <Tag>{time(human.lastVerifiedAt)}</Tag> },
              { key: 'cooldown', label: '冷却至', children: <Tag>{time(human.cooldownUntil)}</Tag> },
              { key: 'reason', label: '放行处置原因', children: human.bypassReason ? <Tag color="purple">{human.bypassReason}</Tag> : <Tag>无</Tag> },
            ]}
          />
        )}
        <Form<{ reason: string }>
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={values => {
            modal.confirm({
              title: human?.bypass ? '确认撤销验证码放行？' : '确认长期放行此账户的异常访问验证码？',
              content: '此操作不会改变账户封禁状态或配额',
              onOk: async () => {
                setHumanSaving(true);
                try {
                  const next = await adminFetch<NonNullable<typeof human>>(`/api/admin/risk/accounts/${encodeURIComponent(detail.id)}/human-challenge`, {
                    method: 'PUT',
                    body: JSON.stringify({ bypass: !human?.bypass, reason: values.reason }),
                  });
                  setHuman(next);
                  onHumanChallengeChange(detail.id, next);
                  message.success('验证码放行状态已更新');
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '保存失败');
                  throw error;
                } finally {
                  setHumanSaving(false);
                }
              },
            });
          }}
        >
          <Form.Item name="reason" label="放行或撤销原因" rules={[{ required: true, whitespace: true }, { max: 200 }]}>
            <Input.TextArea rows={2} maxLength={200} showCount />
          </Form.Item>
          <Button htmlType="submit" loading={humanSaving} disabled={saving}>{human?.bypass ? '撤销长期放行' : '长期放行验证码'}</Button>
        </Form>
      </RiskSection>

      <RiskSection title="账户标记与处置" description="所有变更需要填写原因并确认，风险分只排序和提示，不自动封禁">
        <Form<Decision> initialValues={{ status: detail.status, tags: detail.tags, note: detail.note, reason: '' }} layout="vertical" onFinish={confirmDecision} disabled={saving}>
          <div className="risk-detail-grid">
            <Form.Item name="status" label="账户状态" rules={[{ required: true }]}><Select options={STATUS_OPTIONS} /></Form.Item>
            <Form.Item name="tags" label="风险标签" extra="最多 10 个，每个最多 24 字" rules={[{ validator: (_, values: string[]) => values?.length > 10 || values?.some(value => value.length > 24) ? Promise.reject(new Error('标签最多 10 个，每个最多 24 字')) : Promise.resolve() }]}>
              <Select mode="tags" tokenSeparators={['，', ',']} maxCount={10} placeholder="输入标签后按回车" />
            </Form.Item>
          </div>
          <Form.Item name="note" label="内部备注" rules={[{ max: 500 }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="记录核查线索和后续处理建议" /></Form.Item>
          <Form.Item name="reason" label="本次处置原因" rules={[{ required: true, whitespace: true, message: '请填写可追溯的处置原因' }, { max: 200 }]}><Input.TextArea rows={2} maxLength={200} showCount /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>复核并保存处置</Button>
        </Form>
        <Button style={{ marginTop: 12 }} danger disabled={saving} onClick={() => { setResetReason(''); setResetOpen(true); }}>重置风险状态和分数</Button>
        <Modal
          title="重置账户风险状态和分数"
          open={resetOpen}
          onCancel={() => setResetOpen(false)}
          onOk={async () => {
            const reason = resetReason.trim();
            if (!reason || reason.length > 200) { message.error('请填写 1 至 200 字的重置原因'); return; }
            await onResetRisk(detail.id, reason); setResetOpen(false);
          }}
          confirmLoading={saving}
          okText="确认重置"
          cancelText="取消"
        >
          <Alert type="warning" showIcon title="将状态恢复为正常并把风险分数置为 0" description="保留账户已有统计与历史 IP，并继续保留最近使用的 IP" style={{ marginBottom: 16 }} />
          <Input.TextArea value={resetReason} onChange={event => setResetReason(event.target.value)} maxLength={200} showCount rows={3} placeholder="填写可追溯的重置原因" />
        </Modal>
      </RiskSection>
      <RiskSection title="处置历史" description="近 90 天最多 100 条，具体操作者请在后台审计日志中核对">
        <Table
          size="small"
          rowKey="rowId"
          dataSource={(detail.decisions || []).map((row, index) => ({ ...row, rowId: `${row.at}:${index}` }))}
          pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50] }}
          scroll={{ x: 740 }}
          columns={[
            { title: '北京时间', dataIndex: 'at', render: time, width: 180 },
            {
              title: '状态变更',
              width: 220,
              render: (_, row) => (
                <Space size={6} wrap>
                  <Tag color={statusColor(row.previousStatus)}>{statusLabel(row.previousStatus)}</Tag>
                  <span className="risk-muted">→</span>
                  <Tag color={statusColor(row.status)}>{statusLabel(row.status)}</Tag>
                </Space>
              ),
            },
            { title: '原因', dataIndex: 'reason', render: (value: string) => <span className="risk-wrap">{value}</span> },
          ]}
        />
      </RiskSection>
    </div>
  );

  return (
    <RiskHelpContext.Provider value={showHelp}>
      <div className="risk-detail-heading">
        <div>
          <h2>{detail.displayName || '账户画像'}</h2>
          <Space size={[6, 6]} wrap>
            <code className="risk-code-pill">{detail.id}</code>
            {detail.email && <Tag color="geekblue">{detail.email}</Tag>}
            {detail.nickname && detail.nickname !== detail.displayName && <Tag color="cyan">昵称 · {detail.nickname}</Tag>}
            {(detail.tags || []).map(tag => <Tag key={tag} color="purple">{tag}</Tag>)}
          </Space>
        </div>
        <Space size={[6, 6]} wrap>
          <Tag color={riskColor(detail.score)}>{detail.score} 分 · {riskLabel(detail.score)}</Tag>
          <Tag color={statusColor(detail.status)}>{statusLabel(detail.status)}</Tag>
          <Tag color={detail.humanChallenge?.bypass ? 'green' : detail.humanChallenge?.pending ? 'orange' : detail.lastHumanVerifiedAt ? 'blue' : 'default'}>
            {detail.humanChallenge?.bypass ? '验证码已放行' : detail.humanChallenge?.pending ? '验证码待通过' : detail.lastHumanVerifiedAt ? '人机已验证' : '无验证记录'}
          </Tag>
          <Button type="text" aria-pressed={showHelp} onClick={() => setShowHelp(value => !value)}>{showHelp ? '隐藏说明' : '显示说明'}</Button>
        </Space>
      </div>
      {detail.dailyEstimated && <Alert type="warning" showIcon title="升级日统计为保守估算" description="为防止升级后额度被重复使用，首次切换日合并相交的旧 UTC 日计数，可能高于真实当日值，下一北京时间自然日恢复新口径" />}
      <Tabs
        className="risk-detail-tabs"
        tabBarGutter={24}
        key={detail.id}
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'overview', label: '画像概览', children: <RiskProfileOverview detail={detail} onInspect={inspect} onOpenRoom={onOpenRoom} onOpenIp={onOpenIp} /> },
          { key: 'identity', label: '身份与风险', children: identityTab },
          { key: 'rooms', label: '房间与昵称', children: roomsTab },
          { key: 'requests', label: '请求与配额', children: requestsTab },
          { key: 'network', label: '登录与网络', children: networkTab },
          { key: 'decision', label: '标记与处置', children: decisionTab },
        ]}
      />
    </RiskHelpContext.Provider>
  );
}
