import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { AiModelPool, AiProvider, AiProviderModel } from './types';
import './AiModelPoolManager.css';

type FetchedModelItem = {
  model: string;
  name?: string;
  supportsVision?: boolean;
  contextWindowTokens?: number;
};

type CatalogCapabilityFilter = 'all' | 'unadded' | 'vision' | 'added';

function extractModelBrand(modelId: string): string {
  const raw = String(modelId || '').trim();
  if (!raw) return '其他';
  if (raw.includes('/')) return raw.split('/')[0].trim() || '其他';
  const lower = raw.toLowerCase();
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return 'OpenAI';
  if (lower.startsWith('claude')) return 'Anthropic';
  if (lower.startsWith('gemini')) return 'Google';
  if (lower.startsWith('qwen')) return 'Qwen';
  if (lower.startsWith('deepseek')) return 'DeepSeek';
  if (lower.startsWith('glm')) return 'GLM';
  return '其他';
}

type Props = {
  providers: AiProvider[];
  onChange: (providers: AiProvider[]) => void;
  onTest: (pool: AiModelPool, mode?: 'text' | 'vision') => void;
  onSave: (providers: AiProvider[]) => Promise<boolean>;
  saving: boolean;
  testingId: string;
};

function makeId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newProvider(nextOrder: number): AiProvider {
  return {
    id: makeId('provider'),
    name: `供应商 ${Math.max(1, Math.round(nextOrder / 10))}`,
    enabled: true,
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    apiProtocol: 'chat_completions',
    apiKey: '',
    configuredApiKey: false,
    maxRequestsPerMinute: 1000,
    maxTokensPerMinute: 50_000,
    sortOrder: nextOrder,
    models: [],
  };
}

function newProviderModel(nextOrder: number, partial?: Partial<AiProviderModel>): AiProviderModel {
  return {
    id: makeId('model'),
    model: partial?.model || '',
    name: partial?.name || '',
    enabled: partial?.enabled ?? true,
    supportsVision: Boolean(partial?.supportsVision),
    enableThinking: Boolean(partial?.enableThinking),
    thinkingAdapter: partial?.thinkingAdapter || 'auto',
    thinkingEffort: partial?.thinkingEffort || 'auto',
    thinkingBudgetTokens: partial?.thinkingBudgetTokens || 0,
    builtinWebSearch: Boolean(partial?.builtinWebSearch),
    contextWindowTokens: Number(partial?.contextWindowTokens) || 256 * 1024,
    sortOrder: nextOrder,
  };
}

function reindexSortOrders<T extends { sortOrder: number }>(items: T[]): T[] {
  return items.map((item, idx) => ({ ...item, sortOrder: (idx + 1) * 10 }));
}

export default function AiModelPoolManager({ providers, onChange, onTest, onSave, saving, testingId }: Props) {
  const { message } = App.useApp();
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [modelOptionsOpen, setModelOptionsOpen] = useState(false);
  const [fetchingProviderId, setFetchingProviderId] = useState<string>('');
  const [fetchedByProvider, setFetchedByProvider] = useState<Record<string, FetchedModelItem[]>>({});
  const [addedSearch, setAddedSearch] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<CatalogCapabilityFilter>('all');
  const [catalogBrand, setCatalogBrand] = useState<string>('all');
  const [pickerModalOpen, setPickerModalOpen] = useState(false);
  const [pendingSelectedKeys, setPendingSelectedKeys] = useState<Set<string>>(() => new Set());
  const [providerModal, setProviderModal] = useState<{ provider: AiProvider; isNew: boolean } | null>(null);
  const [providerForm] = Form.useForm<Omit<AiProvider, 'id' | 'configuredApiKey' | 'models'>>();
  const [manualModelText, setManualModelText] = useState('');

  const sortedProviders = useMemo(
    () => [...providers].sort((a, b) => a.sortOrder - b.sortOrder),
    [providers],
  );

  useEffect(() => {
    if (!sortedProviders.length) {
      if (selectedProviderId) setSelectedProviderId('');
      return;
    }
    if (!sortedProviders.some((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(sortedProviders[0].id);
    }
  }, [sortedProviders, selectedProviderId]);

  const activeProvider = useMemo(
    () => sortedProviders.find((p) => p.id === selectedProviderId) || sortedProviders[0] || null,
    [sortedProviders, selectedProviderId],
  );

  const sortedModels = useMemo(
    () => [...(activeProvider?.models || [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [activeProvider],
  );

  const filteredSortedModels = useMemo(() => {
    const q = addedSearch.trim().toLowerCase();
    if (!q) return sortedModels;
    return sortedModels.filter((m) => `${m.model} ${m.name || ''}`.toLowerCase().includes(q));
  }, [sortedModels, addedSearch]);

  useEffect(() => {
    if (!sortedModels.length) {
      if (selectedModelId) setSelectedModelId('');
      return;
    }
    if (!sortedModels.some((m) => m.id === selectedModelId)) {
      setSelectedModelId(sortedModels[0].id);
    }
  }, [sortedModels, selectedModelId]);

  const activeModel = useMemo(
    () => sortedModels.find((m) => m.id === selectedModelId) || sortedModels[0] || null,
    [sortedModels, selectedModelId],
  );

  const totalModelsCount = useMemo(
    () => sortedProviders.reduce((sum, p) => sum + (p.models?.length || 0), 0),
    [sortedProviders],
  );
  const enabledModelsCount = useMemo(
    () => sortedProviders.reduce(
      (sum, p) => sum + (p.enabled ? (p.models || []).filter((m) => m.enabled).length : 0),
      0,
    ),
    [sortedProviders],
  );
  const visionModelsCount = useMemo(
    () => sortedProviders.reduce(
      (sum, p) => sum + (p.enabled ? (p.models || []).filter((m) => m.enabled && m.supportsVision).length : 0),
      0,
    ),
    [sortedProviders],
  );

  const updateProvider = (providerId: string, updater: (prev: AiProvider) => AiProvider) => {
    onChange(providers.map((p) => (p.id === providerId ? updater(p) : p)));
  };

  const updateActiveModel = (modelId: string, updater: (prev: AiProviderModel) => AiProviderModel) => {
    if (!activeProvider) return;
    updateProvider(activeProvider.id, (prev) => ({
      ...prev,
      models: prev.models.map((m) => (m.id === modelId ? updater(m) : m)),
    }));
  };

  const moveProvider = (providerId: string, direction: -1 | 1) => {
    const idx = sortedProviders.findIndex((p) => p.id === providerId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= sortedProviders.length) return;
    const next = [...sortedProviders];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    onChange(reindexSortOrders(next));
  };

  const moveModel = (modelId: string, direction: -1 | 1) => {
    if (!activeProvider) return;
    const idx = sortedModels.findIndex((m) => m.id === modelId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= sortedModels.length) return;
    const next = [...sortedModels];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    updateProvider(activeProvider.id, (prev) => ({
      ...prev,
      models: reindexSortOrders(next),
    }));
  };

  const openProviderEditor = (provider: AiProvider, isNew = false) => {
    providerForm.resetFields();
    providerForm.setFieldsValue({
      name: provider.name,
      enabled: provider.enabled,
      apiBaseUrl: provider.apiBaseUrl,
      apiProtocol: provider.apiProtocol,
      apiKey: provider.apiKey || '',
      maxRequestsPerMinute: provider.maxRequestsPerMinute,
      maxTokensPerMinute: provider.maxTokensPerMinute,
      sortOrder: provider.sortOrder,
    });
    setProviderModal({ provider, isNew });
  };

  const saveProviderEditor = (values: Omit<AiProvider, 'id' | 'configuredApiKey' | 'models'>) => {
    if (!providerModal) return;
    const next: AiProvider = {
      ...providerModal.provider,
      ...values,
      name: (values.name || '').trim() || '未命名供应商',
      apiBaseUrl: (values.apiBaseUrl || '').trim(),
      apiKey: (values.apiKey || '').trim(),
    };
    if (providerModal.isNew) {
      const nextList = reindexSortOrders([...sortedProviders, next]);
      onChange(nextList);
      setSelectedProviderId(next.id);
    } else {
      onChange(providers.map((p) => (p.id === next.id ? next : p)));
    }
    setProviderModal(null);
    message.success('供应商设置已更新到草稿，点击底部「保存配置」生效');
  };

  const fetchProviderModels = async (provider: AiProvider, openModalAfterFetch = true) => {
    if (fetchingProviderId) return;
    if (!provider.apiBaseUrl.trim()) {
      message.warning('请先配置该供应商的 Base URL');
      return;
    }
    if (!provider.apiKey.trim() && !provider.configuredApiKey) {
      message.warning('请先填写该供应商的 API Key');
      return;
    }
    setFetchingProviderId(provider.id);
    try {
      const response = await fetch('/api/admin/ai/provider-models', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          apiBaseUrl: provider.apiBaseUrl.trim(),
          ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
        }),
      });
      const res = await response.json().catch(() => ({
        success: false,
        error: `请求失败（${response.status}）`,
      })) as { success: boolean; models?: FetchedModelItem[]; error?: string };
      if (!res.success || !Array.isArray(res.models)) {
        message.error(res.error || '拉取模型失败');
        return;
      }
      setFetchedByProvider((prev) => ({ ...prev, [provider.id]: res.models || [] }));
      setCatalogSearch('');
      setCatalogFilter('all');
      setCatalogBrand('all');
      setPendingSelectedKeys(new Set());
      if (openModalAfterFetch) {
        setPickerModalOpen(true);
      }
      message.success(`已从「${provider.name}」拉取 ${res.models.length} 个模型，请筛选并挑选需要加入的模型`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '拉取模型失败');
    } finally {
      setFetchingProviderId('');
    }
  };

  const addedModelKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const m of activeProvider?.models || []) {
      set.add(m.model.toLowerCase());
    }
    return set;
  }, [activeProvider]);

  const addSingleCatalogModel = (item: FetchedModelItem) => {
    if (!activeProvider) return;
    const exists = activeProvider.models.find((m) => m.model.toLowerCase() === item.model.toLowerCase());
    if (exists) {
      setSelectedModelId(exists.id);
      message.info(`${item.model} 已在列表中`);
      return;
    }
    if (activeProvider.models.length >= 40) {
      message.warning('单个供应商最多添加 40 个模型');
      return;
    }
    const created = newProviderModel((activeProvider.models.length + 1) * 10, {
      model: item.model,
      name: item.name || '',
      supportsVision: Boolean(item.supportsVision),
      contextWindowTokens: item.contextWindowTokens || 256 * 1024,
    });
    updateProvider(activeProvider.id, (prev) => ({
      ...prev,
      models: [...prev.models, created],
    }));
    setSelectedModelId(created.id);
    message.success(`已加入模型 ${item.model}`);
  };

  const removeSingleCatalogModel = (modelName: string) => {
    if (!activeProvider) return;
    const exists = activeProvider.models.find((m) => m.model.toLowerCase() === modelName.toLowerCase());
    if (!exists) return;
    updateProvider(activeProvider.id, (prev) => ({
      ...prev,
      models: reindexSortOrders(prev.models.filter((m) => m.id !== exists.id)),
    }));
  };

  const batchAddPendingModels = () => {
    if (!activeProvider) return;
    const catalog = fetchedByProvider[activeProvider.id] || [];
    const toAdd = catalog.filter(
      (item) => pendingSelectedKeys.has(item.model.toLowerCase()) && !addedModelKeySet.has(item.model.toLowerCase()),
    );
    if (!toAdd.length) {
      message.info('请先勾选尚未加入的模型');
      return;
    }
    const remainSlots = Math.max(0, 40 - activeProvider.models.length);
    if (remainSlots <= 0) {
      message.warning('当前供应商已达到 40 个模型上限');
      return;
    }
    const accepted = toAdd.slice(0, remainSlots);
    const createdList = accepted.map((item, idx) =>
      newProviderModel((activeProvider.models.length + idx + 1) * 10, {
        model: item.model,
        name: item.name || '',
        supportsVision: Boolean(item.supportsVision),
        contextWindowTokens: item.contextWindowTokens || 256 * 1024,
      }),
    );
    updateProvider(activeProvider.id, (prev) => ({
      ...prev,
      models: [...prev.models, ...createdList],
    }));
    if (createdList[0]) setSelectedModelId(createdList[0].id);
    setPendingSelectedKeys(new Set());
    setPickerModalOpen(false);
    message.success(`已将选中的 ${createdList.length} 个模型加入当前供应商`);
  };

  const addManualModel = () => {
    if (!activeProvider) return;
    const raw = manualModelText.trim();
    if (!raw) return;
    if (!/^[A-Za-z0-9._+:/-]+$/.test(raw) || raw.length > 64) {
      message.error('模型 ID 仅支持字母、数字及 . _ + : / -，且不超过 64 字符');
      return;
    }
    const existing = activeProvider.models.find((m) => m.model.toLowerCase() === raw.toLowerCase());
    if (existing) {
      setSelectedModelId(existing.id);
      setManualModelText('');
      message.info('该模型已在当前供应商列表中');
      return;
    }
    if (activeProvider.models.length >= 40) {
      message.warning('单个供应商最多添加 40 个模型');
      return;
    }
    const inferredVision = /(?:vision|vl|vlm|pixtral|llava|internvl|minicpm-v|qwen(?:2(?:\.5)?|3(?:\.5)?)-vl|glm-4(?:\.\d+)?v|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|claude-3|claude-4|gemini-(?:1\.5|2|2\.5|3)|omni)/i.test(raw);
    const created = newProviderModel((activeProvider.models.length + 1) * 10, {
      model: raw,
      supportsVision: inferredVision,
    });
    updateProvider(activeProvider.id, (prev) => ({
      ...prev,
      models: [...prev.models, created],
    }));
    setSelectedModelId(created.id);
    setManualModelText('');
  };

  const buildPoolForTest = (provider: AiProvider, modelItem: AiProviderModel, mode: 'text' | 'vision'): AiModelPool => ({
    id: `${provider.id}:${modelItem.id}`,
    providerId: provider.id,
    modelId: modelItem.id,
    enabled: provider.enabled && modelItem.enabled,
    type: mode,
    supportsVision: modelItem.supportsVision,
    name: modelItem.name || provider.name || modelItem.model,
    providerName: provider.name,
    apiBaseUrl: provider.apiBaseUrl,
    apiProtocol: provider.apiProtocol,
    apiKey: provider.apiKey,
    configuredApiKey: provider.configuredApiKey,
    model: modelItem.model,
    enableThinking: modelItem.enableThinking,
    thinkingAdapter: modelItem.thinkingAdapter || 'auto',
    thinkingEffort: modelItem.thinkingEffort || 'auto',
    thinkingBudgetTokens: modelItem.thinkingBudgetTokens || 0,
    builtinWebSearch: modelItem.builtinWebSearch === true,
    contextWindowTokens: modelItem.contextWindowTokens,
    maxRequestsPerMinute: provider.maxRequestsPerMinute,
    maxTokensPerMinute: provider.maxTokensPerMinute,
    priority: provider.sortOrder,
  });

  const activeCatalog = activeProvider ? (fetchedByProvider[activeProvider.id] || []) : [];

  const catalogBrands = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of activeCatalog) {
      const brand = extractModelBrand(item.model);
      counts.set(brand, (counts.get(brand) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [activeCatalog]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return activeCatalog.filter((item) => {
      const key = item.model.toLowerCase();
      const isAdded = addedModelKeySet.has(key);
      if (catalogFilter === 'vision' && !item.supportsVision) return false;
      if (catalogFilter === 'unadded' && isAdded) return false;
      if (catalogFilter === 'added' && !isAdded) return false;
      if (catalogBrand !== 'all' && extractModelBrand(item.model) !== catalogBrand) return false;
      if (!q) return true;
      return `${item.model} ${item.name || ''}`.toLowerCase().includes(q);
    });
  }, [activeCatalog, addedModelKeySet, catalogSearch, catalogFilter, catalogBrand]);

  const unaddedFilteredCatalog = useMemo(
    () => filteredCatalog.filter((item) => !addedModelKeySet.has(item.model.toLowerCase())),
    [filteredCatalog, addedModelKeySet],
  );

  const togglePendingKey = (modelId: string, checked: boolean) => {
    const key = modelId.toLowerCase();
    setPendingSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const selectAllFilteredUnadded = () => {
    setPendingSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const item of unaddedFilteredCatalog) {
        next.add(item.model.toLowerCase());
      }
      return next;
    });
  };

  const renderCatalogFilterToolbar = () => (
    <div className="ai-catalog-filter-box">
      <Input
        size="small"
        prefix={<SearchOutlined />}
        placeholder="搜索模型名称或 ID（如 Qwen / DeepSeek / VL / GPT）"
        allowClear
        value={catalogSearch}
        onChange={(e) => setCatalogSearch(e.target.value)}
      />
      <div className="ai-catalog-filter-row">
        <Segmented
          size="small"
          value={catalogFilter}
          onChange={(val) => setCatalogFilter(val as CatalogCapabilityFilter)}
          options={[
            { value: 'all', label: `全部(${activeCatalog.length})` },
            { value: 'unadded', label: `未加(${activeCatalog.filter((i) => !addedModelKeySet.has(i.model.toLowerCase())).length})` },
            { value: 'vision', label: `支持图像(${activeCatalog.filter((i) => i.supportsVision).length})` },
            { value: 'added', label: `已加(${activeCatalog.filter((i) => addedModelKeySet.has(i.model.toLowerCase())).length})` },
          ]}
        />
        {catalogBrands.length > 1 && (
          <Select
            size="small"
            value={catalogBrand}
            onChange={setCatalogBrand}
            style={{ minWidth: 118 }}
            options={[
              { value: 'all', label: '全部系列' },
              ...catalogBrands.map(([brand, count]) => ({
                value: brand,
                label: `${brand} (${count})`,
              })),
            ]}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="ai-pool-manager">
      <div className="ai-pool-summary">
        <span>{sortedProviders.length} 个供应商</span>
        <span>{totalModelsCount} 个已选模型（{enabledModelsCount} 个启用 · {visionModelsCount} 个支持图像）</span>
        <span>调度优先级：按「供应商排序 → 供应商内模型排序」依次提供服务并自动故障转移</span>
      </div>

      <div className="ai-cascade-board">
        {/* 供应商与模型上下排列，模型选项独立编辑 */}
        <div className="ai-cascade-column">
          <div className="ai-cascade-header">
            <div>
              <strong>供应商</strong>
              <span>按顺序优先调用</span>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={sortedProviders.length >= 20}
              onClick={() => openProviderEditor(newProvider((sortedProviders.length + 1) * 10), true)}
            >
              添加供应商
            </Button>
          </div>
          <div className="ai-cascade-body" role="list" aria-label="AI 供应商列表">
            {sortedProviders.map((provider, idx) => {
              const isSelected = activeProvider?.id === provider.id;
              const enabledModelCount = (provider.models || []).filter((m) => m.enabled).length;
              return (
                <div
                  key={provider.id}
                  role="listitem"
                  className={`ai-cascade-item ${isSelected ? 'is-active' : ''}`}
                  onClick={() => setSelectedProviderId(provider.id)}
                >
                  <div className="ai-cascade-item-main">
                    <div className="ai-cascade-title-row">
                      <Tag color={isSelected ? 'blue' : 'default'}>#{idx + 1}</Tag>
                      <strong className="ai-cascade-title">{provider.name || '未命名供应商'}</strong>
                      {provider.configuredApiKey || provider.apiKey ? (
                        <Tag color="green">已配密钥</Tag>
                      ) : (
                        <Tag color="warning">待填密钥</Tag>
                      )}
                    </div>
                    <code className="ai-cascade-sub">{provider.apiBaseUrl || '未填写 Base URL'}</code>
                    <div className="ai-cascade-badges">
                      <span>{enabledModelCount}/{(provider.models || []).length} 个模型启用</span>
                      <span>· {provider.apiProtocol === 'responses' ? 'Responses' : 'Chat'}</span>
                    </div>
                  </div>
                  <div className="ai-cascade-item-actions" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      size="small"
                      checked={provider.enabled}
                      onChange={(enabled) => updateProvider(provider.id, (p) => ({ ...p, enabled }))}
                      aria-label={`启用供应商 ${provider.name}`}
                    />
                    <Space size={2}>
                      <Tooltip title="上移供应商优先级">
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowUpOutlined />}
                          disabled={idx === 0}
                          onClick={() => moveProvider(provider.id, -1)}
                        />
                      </Tooltip>
                      <Tooltip title="下移供应商优先级">
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowDownOutlined />}
                          disabled={idx === sortedProviders.length - 1}
                          onClick={() => moveProvider(provider.id, 1)}
                        />
                      </Tooltip>
                      <Tooltip title="编辑连接与密钥">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => openProviderEditor(provider, false)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="删除该供应商及其下属模型？"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => {
                          onChange(reindexSortOrders(sortedProviders.filter((p) => p.id !== provider.id)));
                        }}
                      >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  </div>
                </div>
              );
            })}
            {!sortedProviders.length && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无供应商，请先点击右上角添加" />
            )}
          </div>
        </div>

        <div className="ai-cascade-column">
          <div className="ai-cascade-header">
            <div>
              <strong>已选模型（{sortedModels.length}）</strong>
              <span>{activeProvider ? `${activeProvider.name} · 仅加入勾选模型` : '请先选择供应商'}</span>
            </div>
            {activeProvider && (
              <Space size={8} wrap>
                {activeCatalog.length > 0 && (
                  <Button
                    size="small"
                    onClick={() => {
                      setPendingSelectedKeys(new Set());
                      setPickerModalOpen(true);
                    }}
                  >
                    挑选({activeCatalog.length})
                  </Button>
                )}
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  loading={fetchingProviderId === activeProvider.id}
                  onClick={() => void fetchProviderModels(activeProvider, true)}
                >
                  拉取并挑选
                </Button>
              </Space>
            )}
          </div>
          <div className="ai-cascade-body" role="list" aria-label="供应商模型列表">
            {activeProvider ? (
              <>
                <div className="ai-model-quick-add">
                  <Input
                    size="small"
                    placeholder="手动输入模型 ID（如 Qwen/Qwen3-8B）"
                    value={manualModelText}
                    onChange={(e) => setManualModelText(e.target.value)}
                    onPressEnter={(e) => {
                      e.preventDefault();
                      addManualModel();
                    }}
                  />
                  <Button size="small" icon={<PlusOutlined />} onClick={addManualModel}>
                    加入
                  </Button>
                </div>

                {sortedModels.length > 3 && (
                  <Input
                    size="small"
                    prefix={<SearchOutlined />}
                    placeholder="在已选模型中筛选名称或 ID"
                    allowClear
                    value={addedSearch}
                    onChange={(e) => setAddedSearch(e.target.value)}
                  />
                )}

                {filteredSortedModels.map((modelItem) => {
                  const realIdx = sortedModels.findIndex((m) => m.id === modelItem.id);
                  const isSelected = activeModel?.id === modelItem.id;
                  const poolKey = `${activeProvider.id}:${modelItem.id}`;
                  return (
                    <div
                      key={modelItem.id}
                      role="listitem"
                      className={`ai-cascade-item ${isSelected ? 'is-active' : ''}`}
                      onClick={() => {
                        setSelectedModelId(modelItem.id);
                        setModelOptionsOpen(true);
                      }}
                    >
                      <div className="ai-cascade-item-main">
                        <div className="ai-cascade-title-row">
                          <Tag color={isSelected ? 'blue' : 'default'}>#{realIdx + 1}</Tag>
                          <strong className="ai-cascade-title">{modelItem.name || modelItem.model}</strong>
                          {modelItem.supportsVision && (
                            <Tag color="purple" icon={<EyeOutlined />}>支持图像</Tag>
                          )}
                          {modelItem.enableThinking && (
                            <Tag color="cyan">思考</Tag>
                          )}
                        </div>
                        <code className="ai-cascade-sub">{modelItem.model}</code>
                      </div>
                      <div className="ai-cascade-item-actions" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          size="small"
                          checked={modelItem.enabled}
                          onChange={(enabled) => updateActiveModel(modelItem.id, (m) => ({ ...m, enabled }))}
                          aria-label={`启用模型 ${modelItem.model}`}
                        />
                        <Space size={2}>
                          <Button
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                              setSelectedModelId(modelItem.id);
                              setModelOptionsOpen(true);
                            }}
                          >
                            设置
                          </Button>
                          <Tooltip title="上移模型优先级">
                            <Button
                              type="text"
                              size="small"
                              icon={<ArrowUpOutlined />}
                              disabled={realIdx <= 0}
                              onClick={() => moveModel(modelItem.id, -1)}
                            />
                          </Tooltip>
                          <Tooltip title="下移模型优先级">
                            <Button
                              type="text"
                              size="small"
                              icon={<ArrowDownOutlined />}
                              disabled={realIdx < 0 || realIdx === sortedModels.length - 1}
                              onClick={() => moveModel(modelItem.id, 1)}
                            />
                          </Tooltip>
                          <Button
                            type="text"
                            size="small"
                            loading={testingId === poolKey}
                            onClick={() => onTest(buildPoolForTest(activeProvider, modelItem, 'text'), 'text')}
                          >
                            测试
                          </Button>
                          <Popconfirm
                            title="移除该模型？"
                            okText="移除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => {
                              updateProvider(activeProvider.id, (prev) => ({
                                ...prev,
                                models: reindexSortOrders(prev.models.filter((m) => m.id !== modelItem.id)),
                              }));
                            }}
                          >
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      </div>
                    </div>
                  );
                })}

                {!sortedModels.length && (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂未加入模型，点右上角「拉取并挑选」选择需要的模型加入"
                  />
                )}
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先在上方选择或添加供应商" />
            )}
          </div>
        </div>

      </div>

      <Modal
        open={modelOptionsOpen && Boolean(activeProvider && activeModel)}
        className="ai-pool-manager"
        title="模型设置"
        width={680}
        centered
        onCancel={() => setModelOptionsOpen(false)}
        footer={(
          <Space>
            <Button disabled={saving} onClick={() => setModelOptionsOpen(false)}>关闭</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={async () => {
                if (await onSave(providers)) setModelOptionsOpen(false);
              }}
            >
              保存模型配置
            </Button>
          </Space>
        )}
      >
          <Typography.Paragraph type="secondary">
            点击「保存模型配置」后立即生效，刷新页面也会保留
          </Typography.Paragraph>
            {activeProvider && activeModel ? (
              <div className="ai-model-option-card">
                <div className="ai-model-option-head">
                  <div>
                    <Typography.Text strong>{activeModel.name || activeModel.model}</Typography.Text>
                    <div className="ai-model-option-code">{activeModel.model}</div>
                  </div>
                  <Space size={6}>
                    <Button
                      size="small"
                      loading={testingId === `${activeProvider.id}:${activeModel.id}`}
                      onClick={() => onTest(buildPoolForTest(activeProvider, activeModel, 'text'), 'text')}
                    >
                      测试对话
                    </Button>
                    {activeModel.supportsVision && (
                      <Button
                        size="small"
                        loading={testingId === `${activeProvider.id}:${activeModel.id}`}
                        onClick={() => onTest(buildPoolForTest(activeProvider, activeModel, 'vision'), 'vision')}
                      >
                        测试识图
                      </Button>
                    )}
                  </Space>
                </div>

                <div className="ai-model-option-grid">
                  <div className="ai-model-option-field">
                    <span>显示别名（可选）</span>
                    <Input
                      size="small"
                      maxLength={40}
                      placeholder="留空默认显示模型 ID"
                      value={activeModel.name}
                      onChange={(e) => updateActiveModel(activeModel.id, (m) => ({ ...m, name: e.target.value }))}
                    />
                  </div>
                  <div className="ai-model-option-field">
                    <span>上下文窗口（K）</span>
                    <InputNumber
                      size="small"
                      min={4}
                      max={2048}
                      precision={0}
                      style={{ width: '100%' }}
                      value={Math.max(4, Math.round((activeModel.contextWindowTokens || 256 * 1024) / 1024))}
                      onChange={(val) => updateActiveModel(activeModel.id, (m) => ({
                        ...m,
                        contextWindowTokens: (Number(val) || 256) * 1024,
                      }))}
                    />
                  </div>
                </div>

                <div className="ai-model-switches">
                  <label className="ai-model-switch-item">
                    <div>
                      <strong>支持图像识别</strong>
                      <span>开启后该模型可直接处理房间聊天截图与图片识图，无需单独重复添加视觉模型</span>
                    </div>
                    <Switch
                      checked={activeModel.supportsVision}
                      onChange={(supportsVision) => updateActiveModel(activeModel.id, (m) => ({ ...m, supportsVision }))}
                    />
                  </label>
                  <label className="ai-model-switch-item">
                    <div>
                      <strong>深度思考（Thinking）</strong>
                      <span>按供应商、模型与接口协议发送思考参数，未适配时测试会报错；部分模型始终思考，关闭开关也无法禁用</span>
                    </div>
                    <Switch
                      checked={Boolean(activeModel.enableThinking)}
                      onChange={(enableThinking) => updateActiveModel(activeModel.id, (m) => ({ ...m, enableThinking }))}
                    />
                  </label>
                  <div className="ai-model-switch-item ai-model-thinking-protocol">
                    <div>
                      <strong>思考参数协议</strong>
                      <span>中转服务或模型别名无法自动识别时，选择中转入口实际接受的协议，保存前先测试</span>
                    </div>
                    <div>
                      <Select
                        aria-label="思考参数协议"
                        value={activeModel.thinkingAdapter || 'auto'}
                        onChange={(thinkingAdapter) => updateActiveModel(activeModel.id, (m) => ({ ...m, thinkingAdapter }))}
                        style={{ width: '100%' }}
                        options={[
                          { value: 'auto', label: '自动识别' },
                          { value: 'gateway', label: '标准中转 · reasoning_effort' },
                          { value: 'openai', label: 'OpenAI 推理模型' },
                          { value: 'siliconflow', label: '硅基流动' },
                          { value: 'qwen', label: '阿里云百炼 / Qwen' },
                          { value: 'deepseek', label: 'DeepSeek' },
                          { value: 'gemini', label: 'Gemini OpenAI 兼容' },
                          { value: 'kimi', label: 'Moonshot / Kimi' },
                          { value: 'glm', label: '智谱 / GLM' },
                          { value: 'openrouter', label: 'OpenRouter' },
                          { value: 'vllm', label: 'vLLM · 按已知模型模板' },
                          { value: 'groq', label: 'Groq' },
                          { value: 'minimax', label: 'MiniMax' },
                          { value: 'mistral', label: 'Mistral' },
                          { value: 'ark', label: '火山方舟 / Ark' },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="ai-model-switch-item ai-model-thinking-protocol">
                    <div>
                      <strong>思考强度</strong>
                      <span>自动沿用当前协议的默认策略，其他档位按模型能力发送；不支持的配置会在测试中明确报错</span>
                    </div>
                    <Select
                      aria-label="思考强度"
                      disabled={!activeModel.enableThinking}
                      value={activeModel.thinkingEffort || 'auto'}
                      onChange={(thinkingEffort) => updateActiveModel(activeModel.id, (m) => ({ ...m, thinkingEffort }))}
                      style={{ width: '100%' }}
                      options={[
                        { value: 'auto', label: '自动 · 保持协议默认' },
                        { value: 'minimal', label: '最低 · minimal' },
                        { value: 'low', label: '低 · low' },
                        { value: 'medium', label: '中 · medium' },
                        { value: 'high', label: '高 · high' },
                        { value: 'xhigh', label: '极高 · xhigh' },
                        { value: 'max', label: '最高 · max' },
                      ]}
                    />
                  </div>
                  <div className="ai-model-switch-item ai-model-thinking-protocol">
                    <div>
                      <strong>思考 Token 预算</strong>
                      <span>0 表示沿用默认；仅百炼、硅基和 OpenRouter 的 Chat 接口支持，OpenRouter 使用预算时强度选自动，正文额度会另行预留</span>
                    </div>
                    <InputNumber
                      aria-label="思考 Token 预算"
                      disabled={!activeModel.enableThinking}
                      min={0}
                      max={32768}
                      precision={0}
                      value={activeModel.thinkingBudgetTokens || 0}
                      onChange={(value) => updateActiveModel(activeModel.id, (m) => ({ ...m, thinkingBudgetTokens: Number(value) || 0 }))}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <label className="ai-model-switch-item">
                    <div>
                      <strong>模型自带联网搜索</strong>
                      <span>模型或中转入口本身会联网时开启，优先使用原生能力，不可用时仍可调用站内免费搜索</span>
                    </div>
                    <Switch
                      checked={activeModel.builtinWebSearch === true}
                      onChange={(builtinWebSearch) => updateActiveModel(activeModel.id, (m) => ({ ...m, builtinWebSearch }))}
                    />
                  </label>
                  <label className="ai-model-switch-item">
                    <div>
                      <strong>参与服务调度</strong>
                      <span>按当前供应商顺序与模型顺序提供文本及识图服务</span>
                    </div>
                    <Switch
                      checked={activeModel.enabled}
                      onChange={(enabled) => updateActiveModel(activeModel.id, (m) => ({ ...m, enabled }))}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="ai-model-option-empty">
                请选择要配置的模型
              </div>
            )}

      </Modal>

      {/* 拉取并批量筛选挑选模型弹窗 */}
      <Modal
        open={pickerModalOpen && Boolean(activeProvider)}
        className="ai-pool-manager"
        title={activeProvider ? `从「${activeProvider.name}」筛选并选择要加入的模型` : '挑选模型'}
        width={780}
        centered
        onCancel={() => setPickerModalOpen(false)}
        footer={(
          <div className="ai-picker-modal-footer">
            <Space size={8} wrap>
              <Button size="small" onClick={selectAllFilteredUnadded} disabled={!unaddedFilteredCatalog.length}>
                全选当前筛选未加({unaddedFilteredCatalog.length})
              </Button>
              <Button size="small" onClick={() => setPendingSelectedKeys(new Set())} disabled={!pendingSelectedKeys.size}>
                清空勾选
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已勾选 {pendingSelectedKeys.size} 个待加入 · 当前供应商已选 {activeProvider?.models.length || 0}/40 个
              </Typography.Text>
            </Space>
            <Space>
              <Button onClick={() => setPickerModalOpen(false)}>关闭</Button>
              <Button
                type="primary"
                disabled={!pendingSelectedKeys.size}
                onClick={batchAddPendingModels}
              >
                加入选中的模型 ({pendingSelectedKeys.size})
              </Button>
            </Space>
          </div>
        )}
      >
        <div className="ai-picker-modal-body">
          {renderCatalogFilterToolbar()}
          <div className="ai-picker-modal-list">
            {filteredCatalog.map((item) => {
              const key = item.model.toLowerCase();
              const isAdded = addedModelKeySet.has(key);
              const isChecked = isAdded || pendingSelectedKeys.has(key);
              return (
                <div
                  key={item.model}
                  className={`ai-picker-modal-row ${isAdded ? 'is-added' : isChecked ? 'is-checked' : ''}`}
                  onClick={() => {
                    if (isAdded) return;
                    togglePendingKey(item.model, !pendingSelectedKeys.has(key));
                  }}
                >
                  <Checkbox
                    checked={isChecked}
                    disabled={isAdded}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => togglePendingKey(item.model, e.target.checked)}
                  />
                  <div className="ai-picker-modal-main">
                    <div className="ai-picker-modal-title">
                      <code>{item.model}</code>
                      {item.name && item.name !== item.model && <span>{item.name}</span>}
                    </div>
                    <div className="ai-picker-modal-tags">
                      <Tag>{extractModelBrand(item.model)}</Tag>
                      {item.supportsVision && (
                        <Tag color="purple" icon={<EyeOutlined />}>支持图像</Tag>
                      )}
                      {item.contextWindowTokens && (
                        <Tag color="blue">{Math.round(item.contextWindowTokens / 1024)}K</Tag>
                      )}
                    </div>
                  </div>
                  <div className="ai-picker-modal-action" onClick={(e) => e.stopPropagation()}>
                    {isAdded ? (
                      <Space size={4}>
                        <Tag color="success" icon={<CheckOutlined />}>已加入</Tag>
                        <Button size="small" type="text" danger onClick={() => removeSingleCatalogModel(item.model)}>
                          移除
                        </Button>
                      </Space>
                    ) : (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => addSingleCatalogModel(item)}
                      >
                        单选加入
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {!filteredCatalog.length && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配筛选条件的模型，试试调整搜索词或分类" />
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(providerModal)}
        title={providerModal?.isNew ? '添加 AI 供应商' : '编辑 AI 供应商'}
        width={680}
        centered
        onCancel={() => setProviderModal(null)}
        maskClosable={false}
        footer={(
          <Space>
            <Button onClick={() => setProviderModal(null)}>取消</Button>
            <Button type="primary" onClick={() => providerForm.submit()}>应用到草稿</Button>
          </Space>
        )}
      >
        <Form form={providerForm} layout="vertical" onFinish={saveProviderEditor} requiredMark={false}>
          <Row gutter={16}>
            <Col xs={24} sm={14}>
              <Form.Item label="供应商名称" name="name" rules={[{ required: true, whitespace: true, message: '请填写供应商名称' }]}>
                <Input placeholder="例如：硅基流动 / OpenAI / DeepSeek" maxLength={40} autoFocus />
              </Form.Item>
            </Col>
            <Col xs={24} sm={10}>
              <Form.Item label="请求协议" name="apiProtocol">
                <Select
                  options={[
                    { value: 'chat_completions', label: 'Chat Completions' },
                    { value: 'responses', label: 'Responses API' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Base URL" name="apiBaseUrl" rules={[{ required: true, whitespace: true, message: '请填写有效的 Base URL' }]}>
                <Input placeholder="https://api.siliconflow.cn/v1" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="API Key" name="apiKey">
                <Input.Password
                  autoComplete="new-password"
                  placeholder={providerModal?.provider.configuredApiKey ? '已保存密钥，留空保持不变' : '填写该供应商的 API Key'}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item label="每分钟请求 / RPM" name="maxRequestsPerMinute" rules={[{ required: true, message: '请填写 RPM' }]}>
                <InputNumber min={1} max={10_000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item label="每分钟 Token / TPM" name="maxTokensPerMinute" rules={[{ required: true, message: '请填写 TPM' }]}>
                <InputNumber min={1000} max={2_000_000} step={1000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="启用供应商" name="enabled" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
