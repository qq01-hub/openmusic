// 单元测试自动发现：递归收集 src 下的 *.test.ts 后交给 tsx --test。
// 不用 glob 模式是因为 CI 的 Node 20 不支持 --test 的 glob 参数（Node 22+ 才支持），
// 靠 shell 展开又不跨平台；这里用手工遍历，Node 20/22/24 与各平台行为一致。
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(clientRoot, 'src');

function collectTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTests(full));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

const files = collectTests(srcRoot).sort();
if (files.length === 0) {
  console.error('run-unit-tests: src 下没有发现 *.test.ts');
  process.exit(1);
}

const tsxBin = path.join(clientRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const result = spawnSync(tsxBin, ['--test', ...files], { stdio: 'inherit', cwd: clientRoot });
process.exit(result.status ?? 1);
