// src/utils/buildProvenance.ts
// 构建来源：官方（本仓库 GitHub Actions 构建）/ 自部署（Docker、Vercel、Cloudflare）/ 非官方（其余一切），以及来源仓库与 commit。
// 这些值都由 vite define 在构建期注入（dev/build/buildIdentity.mjs）；没有 define 的环境按非官方处理。

export type BuildKind = 'official' | 'self-hosted' | 'unofficial';

/**
 * 版本信息行末尾的固定英文标记（官方构建没有）：用户会把整行复制进 issue，triage 按它识别，所以不随界面语言变化。
 */
export const BUILD_KIND_TAGS: Readonly<Record<Exclude<BuildKind, 'official'>, string>> = {
    'self-hosted': 'Self-hosted',
    unofficial: 'Unofficial build',
};

export const getBuildKind = (): BuildKind => {
    const kind = typeof __BUILD_KIND__ === 'undefined' ? null : __BUILD_KIND__;
    return kind === 'official' || kind === 'self-hosted' ? kind : 'unofficial';
};

/** 诊断报告里的 build 行：`official (owner/repo@commit)`、`self-hosted vercel (...)` 或 `unofficial (...)`。 */
export const formatBuildProvenance = (): string => {
    const repo = typeof __BUILD_REPO__ === 'undefined' ? 'unknown' : __BUILD_REPO__;
    const commit = typeof __BUILD_COMMIT__ === 'undefined' ? 'dev' : __BUILD_COMMIT__;
    const host = typeof __BUILD_HOST__ === 'undefined' ? '' : __BUILD_HOST__;
    return `${getBuildKind()}${host ? ` ${host}` : ''} (${repo}@${commit})`;
};
