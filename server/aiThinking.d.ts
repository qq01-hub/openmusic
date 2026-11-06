export type AiThinkingEffort = 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface AiThinkingOptions {
  apiBaseUrl?: string;
  protocol?: 'chat_completions' | 'responses';
  model?: string;
  enabled?: boolean;
  thinkingAdapter?: string;
  thinkingEffort?: AiThinkingEffort;
  thinkingBudgetTokens?: number;
}
export function getAiThinkingCapabilities(options: AiThinkingOptions): {
  supported: boolean;
  adapter: string;
  efforts: AiThinkingEffort[];
  supportsBudget: boolean;
  alwaysThinking: boolean;
  effectiveEffort: Exclude<AiThinkingEffort, 'auto'> | 'none' | null;
  error: string;
};
