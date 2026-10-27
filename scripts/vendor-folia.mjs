import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 从固定版本源码提取舞台、参数面板、歌词解析器的依赖闭包
const require = createRequire(new URL('../client/package.json', import.meta.url));
const ts = require('typescript');
const source = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(source, 'src/components/visualizer/registry.tsx'))) {
  throw new Error('请传入 Folia 源码目录');
}
const target = path.resolve(import.meta.dirname, '../vendor/folia/upstream');
const pending = [
  'src/components/visualizer/VisualizerRenderer.tsx',
  'src/stores/useVisualizerSettingsStore.ts',
  'src/utils/lyrics/parserCore.ts',
  'src/index.css',
  'src/vite-env.d.ts',
  'src/i18n/virtualModules.d.ts',
].map(file => path.join(source, file));
const seen = new Set();
const packages = new Set();
function resolveFile(base) {
  return [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'].map(ext => base + ext),
    ...['.ts', '.tsx', '.js'].map(ext => path.join(base, 'index' + ext))]
    .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
while (pending.length) {
  const file = pending.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const refs = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) refs.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) refs.push(node.arguments[0].text);
    if (ts.isNewExpression(node) && node.expression.getText(parsed) === 'URL' && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0])) refs.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const match of text.matchAll(/import\.meta\.glob[^\(]*\(\s*['"]([^'"]+)['"]/g)) {
    const pattern = path.resolve(path.dirname(file), match[1]).replaceAll('\\', '/');
    const star = pattern.indexOf('*');
    const base = pattern.slice(0, star).replace(/\/$/, '');
    const suffix = pattern.slice(star + 1);
    if (fs.existsSync(base)) for (const dir of fs.readdirSync(base, { withFileTypes: true })) {
      const found = path.join(base, dir.name, suffix.replace(/^\//, ''));
      if (fs.existsSync(found)) pending.push(found);
    }
  }
  for (const ref of refs) {
    if (ref.startsWith('.') || ref.startsWith('@/')) {
      const resolved = resolveFile(ref.startsWith('@/') ? path.join(source, 'src', ref.slice(2)) : path.resolve(path.dirname(file), ref));
      if (resolved && resolved.startsWith(source + path.sep)) pending.push(resolved);
    } else if (!ref.startsWith('virtual:') && !ref.startsWith('node:')) {
      packages.add(ref.startsWith('@') ? ref.split('/').slice(0, 2).join('/') : ref.split('/')[0]);
    }
  }
}
for (const file of seen) {
  const dest = path.join(target, path.relative(source, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
fs.writeFileSync(path.join(target, 'SOURCE.json'), JSON.stringify({
  repository: 'https://github.com/chthollyphile/folia-major',
  commit: '77640a4c9861df04ce1197944ce57e0ad7f56d66',
  files: [...seen].map(file => path.relative(source, file).replaceAll('\\', '/')).sort(),
}, null, 2) + '\n');
console.log(JSON.stringify({ files: seen.size, packages: [...packages].sort() }));
