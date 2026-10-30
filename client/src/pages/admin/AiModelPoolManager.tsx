import { useMemo, useState } from 'react';
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { App, Button, Col, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Row, Select, Space, Switch, Tag } from 'antd';
import type { AiModelPool } from './types';
import './AiModelPoolManager.css';

type EditorValues = Omit<AiModelPool, 'id' | 'configuredApiKey' | 'contextWindowTokens'> & { contextWindowK: number };
type Props = {
  pools: AiModelPool[];
  onChange: (pools: AiModelPool[]) => void;
  onTest: (pool: AiModelPool) => void;
  testingId: string;
};

function newPool(): AiModelPool {
  return {
    id: globalThis.crypto?.randomUUID?.() || `ai-pool-${Date.now()}`, name: '', model: '', type: 'text', enabled: true,
    apiBaseUrl: '', apiProtocol: 'chat_completions', apiKey: '', configuredApiKey: false,
    enableThinking: false, contextWindowTokens: 256 * 1024,
    maxRequestsPerMinute: 1000, maxTokensPerMinute: 50_000, priority: 100,
  };
}

export default function AiModelPoolManager({ pools, onChange, onTest, testingId }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<EditorValues>();
  const [editor, setEditor] = useState<{ pool: AiModelPool; isNew: boolean } | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<'all' | 'text' | 'vision'>('all');
  const [page, setPage] = useState(1);
  const type = Form.useWatch('type', form);
  const filtered = useMemo(() => pools.filter((p) =>
    (filter === 'all' || p.type === filter)
    && `${p.name} ${p.model}`.toLowerCase().includes(keyword.trim().toLowerCase()),
  ), [pools, filter, keyword]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 5)));
  const visible = filtered.slice((currentPage - 1) * 5, currentPage * 5);

  const openEditor = (pool: AiModelPool, isNew = false) => {
    form.resetFields();
    form.setFieldsValue({ ...pool, contextWindowK: Math.round(pool.contextWindowTokens / 1024) });
    setEditor({ pool, isNew });
  };

  const apply = (values: EditorValues) => {
    if (!editor) return;
    if (editor.isNew && pools.length >= 20) {
      message.error('最多添加 20 个模型');
      return;
    }
    const { contextWindowK, ...fields } = values;
    const next: AiModelPool = {
      ...editor.pool, ...fields,
      model: fields.model.trim(), name: (fields.name || '').trim(),
      apiKey: fields.apiKey || '',
      contextWindowTokens: contextWindowK * 1024,
      enableThinking: fields.type === 'text' ? fields.enableThinking === true : undefined,
    };
    onChange(editor.isNew ? [...pools, next] : pools.map((p) => p.id === next.id ? next : p));
    if (editor.isNew) {
      setKeyword('');
      setFilter('all');
      setPage(Math.ceil((pools.length + 1) / 5));
    }
    setEditor(null);
    message.success('已应用到草稿，点击页面底部「保存配置」后生效');
  };

  return (
    <div className="ai-pool-manager">
      <div className="ai-pool-toolbar">
        <Input prefix={<SearchOutlined />} placeholder="搜索名称或模型 ID" aria-label="搜索模型" allowClear value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} />
        <Select aria-label="筛选模型类型" value={filter} onChange={(value) => { setFilter(value); setPage(1); }} options={[{ value: 'all', label: '全部类型' }, { value: 'text', label: '文本处理' }, { value: 'vision', label: '图片处理' }]} />
        <Button type="primary" icon={<PlusOutlined />} disabled={pools.length >= 20} onClick={() => openEditor(newPool(), true)}>添加模型</Button>
      </div>
      <div className="ai-pool-summary">
        <span>{pools.length} 个模型</span>
        <span>{pools.filter((p) => p.enabled).length} 个启用</span>
        <span>同优先级按并发负载调度</span>
      </div>
      <div className="ai-pool-list" role="list" aria-label="模型池">
        {visible.map((pool) => (
          <div className="ai-pool-row" role="listitem" key={pool.id}>
            <button className="ai-pool-identity" onClick={() => openEditor(pool)} aria-label={`编辑模型 ${pool.name || pool.model || '未命名模型'}`}>
              <strong>{pool.name || pool.model || '未命名模型'}</strong>
              <code>{pool.model || '未填写模型 ID'}</code>
            </button>
            <div className="ai-pool-meta">
              <Tag color="blue">{pool.type === 'text' ? '文本' : '识图'}</Tag>
              <span>{Math.round(pool.contextWindowTokens / 1024)}K · 优先级 {pool.priority}</span>
            </div>
            <Switch checked={pool.enabled} size="small" checkedChildren="开" unCheckedChildren="关" aria-label={`启用模型 ${pool.name || pool.model}`} onChange={(enabled) => onChange(pools.map((p) => p.id === pool.id ? { ...p, enabled } : p))} />
            <Space className="ai-pool-actions" size={2}>
              <Button type="text" icon={<EditOutlined />} onClick={() => openEditor(pool)}>编辑</Button>
              <Button type="text" loading={testingId === pool.id} disabled={Boolean(testingId) && testingId !== pool.id} onClick={() => onTest(pool)}>测试</Button>
              <Popconfirm title="从配置草稿中删除该模型？" description="点击页面底部保存配置后生效" onConfirm={() => onChange(pools.filter((p) => p.id !== pool.id))} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                <Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除模型 ${pool.name || pool.model}`} />
              </Popconfirm>
            </Space>
          </div>
        ))}
        {!visible.length && <div className="ai-pool-empty">{pools.length ? '没有匹配的模型，试试其他名称或类型' : '添加文本或识图模型，分别配置服务地址、密钥与调度参数'}</div>}
      </div>
      <div className="ai-pool-footer"><span>匹配 {filtered.length} 个 · 最多 20 个</span>{filtered.length > 0 && <Pagination simple current={currentPage} pageSize={5} total={filtered.length} onChange={setPage} showSizeChanger={false} />}</div>
      <p className="ai-pool-hint">新增和编辑在弹窗中完成，列表每页显示 5 个模型，应用草稿后统一保存</p>

      <Modal
        open={Boolean(editor)} title={editor?.isNew ? '添加模型' : '编辑模型'} width={1040} centered
        onCancel={() => setEditor(null)} maskClosable={false}
        className="ai-pool-editor" styles={{ body: { paddingTop: 16 } }}
        footer={<Space><Button onClick={() => setEditor(null)}>取消</Button><Button type="primary" onClick={() => form.submit()}>应用到草稿</Button></Space>}
      >
        <Form form={form} layout="vertical" onFinish={apply} requiredMark={false} scrollToFirstError>
          <div className="ai-pool-form-section"><h3>模型身份</h3><span>名称用于后台识别，模型 ID 用于上游请求</span></div>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}><Form.Item label="显示名称" name="name"><Input placeholder="例如：日常对话主模型" maxLength={40} autoFocus /></Form.Item></Col>
            <Col xs={24} sm={12} md={6}><Form.Item label="模型类型" name="type"><Select options={[{ value: 'text', label: '文本处理' }, { value: 'vision', label: '图片处理' }]} /></Form.Item></Col>
            <Col xs={24} md={10}><Form.Item label="模型 ID" name="model" rules={[{ required: true, whitespace: true, message: '请填写模型 ID' }, { pattern: /^[A-Za-z0-9._+:/-]+$/, message: '模型 ID 仅支持字母、数字及 . _ + : / -' }]}><Input placeholder="供应商提供的模型标识" maxLength={64} /></Form.Item></Col>
          </Row>
          <div className="ai-pool-form-section"><h3>服务连接</h3><span>密钥留空保留已保存的值</span></div>
          <Row gutter={16}>
            <Col xs={24} sm={16} md={10}><Form.Item label="Base URL" name="apiBaseUrl"><Input placeholder="https://api.example.com/v1" /></Form.Item></Col>
            <Col xs={24} sm={8} md={6}><Form.Item label="请求协议" name="apiProtocol"><Select options={[{ value: 'chat_completions', label: 'Chat Completions' }, { value: 'responses', label: 'Responses API' }]} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item label="API Key" name="apiKey"><Input.Password autoComplete="new-password" placeholder={editor?.pool.configuredApiKey ? '已保存，留空保持不变' : '填写服务密钥'} /></Form.Item></Col>
          </Row>
          <div className="ai-pool-form-section"><h3>调度与额度</h3><span>沿用现有调度规则与限制</span></div>
          <Row gutter={16}>
            <Col xs={12} sm={6}><Form.Item label="上下文 / K" name="contextWindowK" rules={[{ required: true, message: '请填写上下文大小' }]}><InputNumber min={4} max={2048} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} sm={6}><Form.Item label="每分钟请求 / RPM" name="maxRequestsPerMinute" rules={[{ required: true, message: '请填写 RPM' }]}><InputNumber min={1} max={10_000} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} sm={6}><Form.Item label="每分钟 Token / TPM" name="maxTokensPerMinute" rules={[{ required: true, message: '请填写 TPM' }]}><InputNumber min={1000} max={2_000_000} step={1000} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} sm={6}><Form.Item label="优先级" name="priority" rules={[{ required: true, message: '请填写优先级' }]}><InputNumber min={1} max={1000} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12}><Form.Item label="参与调度" name="enabled" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></Col>
            {type === 'text' && <Col xs={12}><Form.Item label="深度思考" name="enableThinking" valuePropName="checked"><Switch /></Form.Item></Col>}
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
