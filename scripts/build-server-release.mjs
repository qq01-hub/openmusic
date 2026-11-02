import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeploymentArchive } from './deployment-archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.env.RELEASE_VERSION;
if (!/^v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(tag || '')) throw new Error('RELEASE_VERSION must be a release tag');
const output = path.join(root, 'release', `server-${tag}`);
if (fs.existsSync(output)) throw new Error('Release directory already exists');
fs.mkdirSync(path.join(output, 'server'), { recursive: true });
for (const file of fs.readdirSync(path.join(root, 'server'))) {
  if ((file.endsWith('.js') && !file.endsWith('.test.js') && file !== 'eslint.config.js')
    || ['package.json', 'package-lock.json', '.env.example'].includes(file)) {
    fs.copyFileSync(path.join(root, 'server', file), path.join(output, 'server', file));
  }
}
fs.cpSync(path.join(root, 'client/dist'), path.join(output, 'client/dist'), { recursive: true });
fs.cpSync(path.join(root, 'deploy'), path.join(output, 'deploy'), {
  recursive: true, filter: source => !source.split(path.sep).includes('node_modules'),
});
fs.writeFileSync(path.join(output, 'deployment-version.json'), JSON.stringify({ tag }));
createDeploymentArchive(output, path.join(root, 'release/openmusic-build.zip'));
console.log('Server release ZIP created');
