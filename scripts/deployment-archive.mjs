import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function createDeploymentArchive(sourceDirectory, destinationPath) {
  const source = fs.realpathSync(sourceDirectory);
  const destination = path.resolve(destinationPath);
  if (!fs.statSync(source).isDirectory()) throw new Error('压缩源必须是目录');
  if (isWithin(source, destination)) throw new Error('压缩包不能写入待压缩目录');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (isWithin(source, fs.realpathSync(path.dirname(destination)))) throw new Error('压缩包不能写入待压缩目录');
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}-${randomUUID()}.tmp.zip`);
  try {
    if (process.platform === 'win32') {
      const quote = value => `'${value.replaceAll("'", "''")}'`;
      const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.AppContext]::SetSwitch('Switch.System.IO.Compression.ZipFile.UseBackslash', $false)
[System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(source)}, ${quote(temporary)}, [System.IO.Compression.CompressionLevel]::Optimal, $false)
} catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
  exit 1
}`;
      execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true });
    } else {
      execFileSync('zip', ['-r', temporary, '.'], { cwd: source, stdio: 'inherit' });
    }
    if (fs.statSync(temporary).size < 22) throw new Error('压缩包生成不完整');
    fs.renameSync(temporary, destination);
    return destination;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
