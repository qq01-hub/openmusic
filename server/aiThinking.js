/**
 * 思考参数属于上游协议，不能把某一家私有字段发给所有兼容接口
 * 未知模型不猜测能力，开启但无法适配时明确失败，交给现有模型池切换
 */
const THINKING_ADAPTERS = new Set(['auto', 'openai', 'gateway', 'siliconflow', 'qwen', 'deepseek', 'gemini', 'kimi', 'glm', 'openrouter', 'vllm', 'groq', 'minimax', 'mistral', 'ark']);
const THINKING_EFFORTS = new Set(['auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function openAiEfforts(name) {
  if (/^o[134](?:-|$)/.test(name)) return ['low', 'medium', 'high'];
  if (/^gpt-5-pro(?:-|$)/.test(name)) return ['high'];
  if (/^gpt-5(?:\.1)?-codex(?:-mini)?$/.test(name)) return ['low', 'medium', 'high'];
  if (/^gpt-5\.1-codex-max(?:-|$)/.test(name)) return ['low', 'medium', 'high', 'xhigh'];
  if (/^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(name)) return ['minimal', 'low', 'medium', 'high'];
  if (/^gpt-5\.1(?:-|$)/.test(name)) return ['low', 'medium', 'high'];
  if (/^gpt-5\.[2-5](?:-|$)/.test(name)) return name.includes('-pro')
    ? ['medium', 'high', 'xhigh'] : ['low', 'medium', 'high', 'xhigh'];
  if (/^gpt-(?:5\.6|6)(?:[.-]|$)/.test(name)) return ['low', 'medium', 'high', 'xhigh', 'max'];
  return null;
}

function thinkingConfigError(message, code = 'AI_THINKING_CONFIG_INVALID') {
  return Object.assign(new Error(message), { code, status: 400 });
}

export function normalizeAiThinkingEffort(value) {
  if (value === undefined || value === null || value === '') return 'auto';
  if (!THINKING_EFFORTS.has(value)) throw thinkingConfigError('思考强度无效，请选择后台提供的强度');
  return value;
}

export function normalizeAiThinkingBudget(value) {
  if (value === undefined || value === null || value === '') return 0;
  const budget = Number(value);
  if (!Number.isInteger(budget) || (budget !== 0 && (budget < 128 || budget > 32768))) {
    throw thinkingConfigError('思考预算必须为 0 或 128～32768 的整数');
  }
  return budget;
}

export function normalizeAiThinkingAdapter(value) {
  return THINKING_ADAPTERS.has(value) ? value : 'auto';
}

export function resolveAiThinking({ apiBaseUrl, protocol, model, enabled, thinkingAdapter, thinkingEffort, thinkingBudgetTokens }) {
  const requestedEffort = normalizeAiThinkingEffort(thinkingEffort);
  const budget = normalizeAiThinkingBudget(thinkingBudgetTokens);
  const host = new URL(apiBaseUrl).hostname.toLowerCase();
  const name = String(model).toLowerCase().replace(/^cn:/, '');
  const openaiName = name.replace(/^openai\//, '');
  const isHost = (domain) => host === domain || host.endsWith(`.${domain}`);
  let adapter = 'unsupported';
  if (isHost('siliconflow.cn') || isHost('siliconflow.com')) adapter = 'siliconflow';
  else if (isHost('aliyuncs.com') || isHost('dashscope-intl.aliyuncs.com')) adapter = 'qwen';
  else if (isHost('deepseek.com')) adapter = 'deepseek';
  else if (isHost('generativelanguage.googleapis.com')) adapter = 'gemini';
  else if (isHost('moonshot.cn') || isHost('moonshot.ai') || isHost('kimi.com')) adapter = 'kimi';
  else if (isHost('bigmodel.cn') || isHost('api.z.ai')) adapter = 'glm';
  else if (isHost('openrouter.ai')) adapter = 'openrouter';
  else if (isHost('groq.com')) adapter = 'groq';
  else if (isHost('minimax.io') || isHost('minimaxi.com')) adapter = 'minimax';
  else if (isHost('mistral.ai')) adapter = 'mistral';
  else if (isHost('volces.com')) adapter = 'ark';
  else if (/^(?:openai\/)?(?:o[134](?:-|$)|gpt-[56](?:[.-]|$))/.test(name)
    && !name.includes('-chat-')) adapter = 'openai';
  const configured = normalizeAiThinkingAdapter(thinkingAdapter);
  const explicit = configured !== 'auto';
  if (explicit) adapter = configured;

  const fields = {};
  let active = enabled;
  let omitTemperature = false;
  let completionTokens = false;
  let minimumOutputTokens = 4096;
  const unsupported = () => {
    const error = new Error(`模型 ${model} 的思考开关或当前接口协议尚未适配，请在后台测试支持的模型与协议`);
    error.code = 'AI_THINKING_UNSUPPORTED';
    throw error;
  };

  // 官方 Claude 兼容层会忽略 reasoning_effort，不能将手选 OpenAI 视作已启用
  if (isHost('anthropic.com') && enabled) unsupported();

  const openaiCanDisable = (/^gpt-5\.[1-9]/.test(openaiName) && !/-(?:pro|codex)/.test(openaiName))
    || /^gpt-6-(?:sol|luna)(?:-|$)/.test(openaiName);
  const openaiDefaultEffort = /^gpt-5-pro(?:-|$)/.test(openaiName) ? 'high' : 'medium';
  if (protocol === 'responses') {
    if (!['openai', 'deepseek', 'gateway', 'ark'].includes(adapter)) {
      if (enabled) unsupported();
      return { adapter, fields, active: false };
    }
    if (enabled) fields.reasoning = { effort: adapter === 'deepseek' ? 'high' : adapter === 'openai' ? openaiDefaultEffort : 'medium' };
    else if (adapter === 'deepseek' || adapter === 'gateway' || adapter === 'ark' || openaiCanDisable) {
      fields.reasoning = { effort: 'none' };
    } else active = true; // 固有推理模型不能通过布尔开关关闭
    if (adapter === 'openai' || adapter === 'gateway') fields.include = ['reasoning.encrypted_content'];
    fields.store = false;
    omitTemperature = true;
  } else if (adapter === 'openai') {
    completionTokens = true;
    omitTemperature = true;
    if (enabled) fields.reasoning_effort = openaiDefaultEffort;
    else if (openaiCanDisable) fields.reasoning_effort = 'none';
    else active = true;
  } else if (adapter === 'gateway') {
    fields.reasoning_effort = enabled ? 'medium' : 'none';
    omitTemperature = true;
  } else if (adapter === 'openrouter') {
    fields.reasoning = { enabled };
    omitTemperature = true;
  } else if (adapter === 'vllm') {
    if (/granite-3\.2|deepseek-v3\.1|holo2/.test(name)) fields.chat_template_kwargs = { thinking: enabled };
    else if (/qwen3|granite-4\.2|gemma-4|kolibri/.test(name)) fields.chat_template_kwargs = { enable_thinking: enabled };
    else if (/deepseek-r1/.test(name)) active = true;
    else if (enabled) unsupported();
  } else if (adapter === 'gemini' && (explicit || /gemini-(?:2\.5|[3-9])/.test(name))) {
    if (enabled) fields.reasoning_effort = 'medium';
    else if (name.includes('2.5-flash')) fields.reasoning_effort = 'none';
    else active = true;
    if (active && name.includes('2.5')) minimumOutputTokens = 12288;
  } else if (['siliconflow', 'qwen'].includes(adapter)) {
    const alwaysThinking = /(?:-thinking|deepseek-r1|qwq)/.test(name)
      || ['qwen3.8-2.4t-a95b', 'qwen3.7-max-preview', 'qwen3.7-max-2026-05-17'].includes(name);
    const hybrid = /(?:qwen3|qwen-plus|qwen-flash|qwen-max|deepseek-v[34]|glm-[45]|kimi-k2\.[5-9])/.test(name);
    if (alwaysThinking) active = true;
    else if (hybrid || explicit) fields.enable_thinking = enabled;
    else if (enabled) unsupported();
    if (adapter === 'siliconflow' && active && /deepseek-v4|glm-5\.2/.test(name)) fields.reasoning_effort = 'high';
    // 硅基的 max_tokens 不包含思考长度，正文额度无需按合计预算扩大
    if (adapter === 'siliconflow') minimumOutputTokens = 0;
    if (adapter === 'qwen' && active) {
      fields.stream = true;
      fields.stream_options = { include_usage: true };
    }
  } else if (adapter === 'deepseek') {
    if (name === 'deepseek-reasoner') active = true;
    else if (explicit || name === 'deepseek-chat' || /^deepseek-(?:v[34]|flash)/.test(name)) {
      fields.thinking = { type: enabled ? 'enabled' : 'disabled' };
    } else if (enabled) unsupported();
    // 中转别名无法从名称判断版本，手选协议后按 V4 思考参数发送
    if (active && (explicit || /^deepseek-(?:v4|flash)/.test(name)) && name !== 'deepseek-reasoner') fields.reasoning_effort = 'high';
    omitTemperature = active;
  } else if (adapter === 'kimi') {
    if (name.includes('thinking') || /^kimi-k2\.7-code(?:-highspeed)?$/.test(name) || /^kimi-k3(?:[.-]|$)/.test(name)) {
      active = true;
      if (/^kimi-k3(?:[.-]|$)/.test(name)) fields.reasoning_effort = 'high';
    } else if (explicit || /^kimi-k2\.[56](?:-|$)/.test(name)) fields.thinking = { type: enabled ? 'enabled' : 'disabled' };
    else if (enabled) unsupported();
    // Kimi 思考与非思考模式各有固定采样要求，使用上游默认值
    omitTemperature = true;
  } else if (adapter === 'glm' && (explicit || /^glm-(?:4\.[5-9]|5)/.test(name))) {
    if (/^glm-5\.[3-9]/.test(name) && !enabled) active = true;
    else fields.thinking = { type: enabled ? 'enabled' : 'disabled' };
    if (active && /^glm-5\.[23](?:-|$)/.test(name)) fields.reasoning_effort = 'high';
  } else if (adapter === 'groq') {
    completionTokens = true;
    omitTemperature = true;
    if (/gpt-oss|muse-spark/.test(name)) {
      active = true;
      fields.reasoning_effort = 'medium';
    } else if (/qwen3(?:[.-]|$)/.test(name)) {
      fields.reasoning_effort = enabled ? 'medium' : 'none';
    } else if (enabled) unsupported();
    // raw 与 tools / JSON mode 不兼容，parsed 才有独立推理字段
    if (active && !name.includes('gpt-oss')) fields.reasoning_format = 'parsed';
  } else if (adapter === 'minimax') {
    omitTemperature = true;
    fields.reasoning_split = true;
    completionTokens = true;
    if (/^minimax-m3\.1-flash(?:-|$)/.test(name)) {
      active = true;
      fields.reasoning_effort = 'high';
    } else if (/^minimax-m2(?:[.-]|$)/.test(name)) active = true;
    else if (/^minimax-m3$/.test(name)) fields.thinking = { type: enabled ? 'adaptive' : 'disabled' };
    else if (enabled) unsupported();
  } else if (adapter === 'mistral') {
    if (/mistral-small-2603|mistral-medium-3-5/.test(name)) fields.reasoning_effort = enabled ? 'high' : 'none';
    else if (/mistral-large-4(?:-|$)/.test(name)) {
      active = true;
      fields.reasoning_effort = 'medium';
    } else if (/magistral/.test(name)) active = true;
    else if (enabled) unsupported();
  } else if (adapter === 'ark') {
    // 接入点 ep-xxx 是后台分配的别名，无法由名称判断具体模型能力
    if (/^kimi-k3/.test(name)) {
      active = true;
      fields.reasoning_effort = 'high';
    } else fields.thinking = { type: enabled ? 'enabled' : 'disabled' };
  } else if (enabled) unsupported();

  if (active) {
    const effortError = () => {
      throw thinkingConfigError(`模型 ${model} 的 ${adapter} 协议不支持当前思考强度或预算，请调整配置后测试`, 'AI_THINKING_EFFORT_UNSUPPORTED');
    };
    if (budget) {
      if (!['qwen', 'siliconflow', 'openrouter'].includes(adapter) || protocol !== 'chat_completions') effortError();
      if (adapter === 'openrouter') {
        if (requestedEffort !== 'auto') throw thinkingConfigError('OpenRouter 的思考强度与 Token 预算只能选择一种', 'AI_THINKING_CONFIG_CONFLICT');
        fields.reasoning = { enabled: true, max_tokens: budget };
      } else fields.thinking_budget = budget;
      if (adapter !== 'siliconflow') minimumOutputTokens = Math.max(minimumOutputTokens, budget + 1024);
    }
    if (requestedEffort !== 'auto') {
      let effort = requestedEffort;
      let allowed = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
      if (adapter === 'deepseek') {
        effort = { minimal: 'low', medium: 'high', xhigh: 'high' }[effort] || effort;
      } else if (adapter === 'gemini') {
        effort = ['xhigh', 'max'].includes(effort) ? 'high' : effort;
        allowed = ['minimal', 'low', 'medium', 'high'];
        if (name.includes('2.5')) minimumOutputTokens = ({ minimal: 1024, low: 1024, medium: 8192, high: 24576 }[effort] || 8192) + 4096;
      } else if (adapter === 'openai') allowed = openAiEfforts(openaiName) || allowed;
      else if (adapter === 'siliconflow') allowed = ['high', 'max'];
      else if (adapter === 'kimi' || adapter === 'glm') allowed = ['low', 'high', 'max'];
      else if (adapter === 'groq') allowed = ['low', 'medium', 'high'];
      else if (adapter === 'mistral') allowed = /mistral-small-2603|mistral-medium-3-5/.test(name) ? ['high'] : ['low', 'medium', 'high'];
      if (!allowed.includes(effort)) effortError();
      if (protocol === 'responses' && ['openai', 'deepseek', 'gateway', 'ark'].includes(adapter)) fields.reasoning = { ...fields.reasoning, effort };
      else if (adapter === 'openrouter') fields.reasoning.effort = effort;
      else if (fields.reasoning_effort !== undefined || adapter === 'gateway' || adapter === 'openai' || adapter === 'gemini') fields.reasoning_effort = effort;
      else effortError();
    }
  }
  const effectiveEffort = fields.reasoning?.effort || fields.reasoning_effort || null;
  return {
    adapter, fields, active, omitTemperature, completionTokens, minimumOutputTokens,
    requestedEffort, effectiveEffort, budgetTokens: active ? budget : 0,
  };
}

// 后台与请求构造共用适配结果，只列出无需兼容映射的档位
export function getAiThinkingCapabilities(options = {}) {
  const result = {
    supported: false, adapter: 'unsupported', efforts: ['auto'], supportsBudget: false,
    alwaysThinking: false, effectiveEffort: null, error: '',
  };
  if (!options.apiBaseUrl || !String(options.model || '').trim()) {
    result.error = '先填写供应商地址与模型 ID，再选择思考配置';
    return result;
  }
  const base = { ...options, enabled: true, thinkingEffort: 'auto', thinkingBudgetTokens: 0 };
  try {
    const defaults = resolveAiThinking(base);
    result.supported = defaults.active;
    result.adapter = defaults.adapter;
    result.alwaysThinking = resolveAiThinking({ ...base, enabled: false }).active;
    result.effectiveEffort = defaults.effectiveEffort;
  } catch (error) {
    result.error = error.code ? error.message : '供应商地址无效，暂时无法识别思考能力';
    return result;
  }
  for (const effort of THINKING_EFFORTS) {
    if (effort === 'auto') continue;
    try {
      if (resolveAiThinking({ ...base, thinkingEffort: effort }).effectiveEffort === effort) result.efforts.push(effort);
    } catch { /* 不向后台提供当前适配器拒绝的档位 */ }
  }
  try {
    result.supportsBudget = resolveAiThinking({ ...base, thinkingBudgetTokens: 128 }).budgetTokens === 128;
  } catch { /* 不支持 Token 预算的模型保持不可选 */ }
  try {
    result.effectiveEffort = resolveAiThinking({
      ...base, enabled: options.enabled ?? true,
      thinkingEffort: options.thinkingEffort, thinkingBudgetTokens: options.thinkingBudgetTokens,
    }).effectiveEffort;
  } catch (error) {
    result.effectiveEffort = null;
    result.error = error.message;
  }
  return result;
}
