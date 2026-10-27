import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const stageDirectory = path.resolve(import.meta.dirname, '../vendor/folia');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(argumentsList) {
  const result = spawnSync(npmCommand, argumentsList, { cwd: stageDirectory, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(path.join(stageDirectory, 'node_modules/.package-lock.json'))) run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
run(['run', 'build']);
