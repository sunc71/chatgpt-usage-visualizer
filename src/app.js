// 查找与识别 Codex / ChatGPT 桌面端应用（macOS + Windows）
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USER_APPS = path.join(os.homedir(), 'Applications');
// 本工具生成的 .app（启动器，以及旧版本的菜单栏程序）都带这个 bundle id 前缀
const GENERATED_ID_PREFIXES = ['local.chatgpt-usage-visualizer.', 'local.codex-usage-countdown.'];

export function isGeneratedApp(appPath) {
  if (process.platform !== 'darwin') return false;
  try {
    const plist = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
    return GENERATED_ID_PREFIXES.some((id) => plist.includes(id));
  } catch {
    return false;
  }
}

function normalizeName(name) {
  return String(name || '').replace(/\.exe$/i, '').replace(/\.app$/i, '');
}

function windowsCandidates(name) {
  const raw = String(name || '');
  const n = normalizeName(raw);
  const out = [];

  // --app 允许直接传 exe 的完整路径。
  if (/[\\/]/.test(raw) || /^[A-Za-z]:/.test(raw)) {
    out.push(raw);
    if (!/\.exe$/i.test(raw)) out.push(`${raw}.exe`);
  }

  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ].filter(Boolean);

  for (const root of roots) {
    out.push(
      path.join(root, n, `${n}.exe`),
      path.join(root, 'OpenAI', `${n}.exe`),
      path.join(root, 'OpenAI', n, `${n}.exe`),
    );
  }

  // WindowsApps 中的 App Execution Alias 也可能可直接执行。
  if (process.env.LOCALAPPDATA) {
    out.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', `${n}.exe`));
  }

  return [...new Set(out)];
}

function findWindowsApp(names) {
  for (const name of names) {
    for (const candidate of windowsCandidates(name)) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { name: normalizeName(name), path: candidate };
        }
      } catch {}
    }
  }

  // 最后尝试 PATH / App Execution Alias。
  for (const name of names) {
    const exe = /\.exe$/i.test(name) ? name : `${name}.exe`;
    try {
      const hit = execFileSync('where.exe', [exe], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      }).split(/\r?\n/).map((x) => x.trim()).find(Boolean);
      if (hit) return { name: normalizeName(name), path: hit };
    } catch {}
  }
  return null;
}

// 依次在常见目录和系统索引中查找桌面端应用（跳过本工具生成的应用）
export function findApp(names) {
  if (process.platform === 'win32') return findWindowsApp(names);

  const dirs = ['/Applications', USER_APPS];
  for (const n of names) {
    for (const d of dirs) {
      const p = path.join(d, `${n}.app`);
      if (fs.existsSync(p) && !isGeneratedApp(p)) return { name: n, path: p };
    }
  }
  for (const n of names) {
    try {
      const hit = execFileSync('/usr/bin/mdfind', [`kMDItemFSName == "${n}.app"`], { encoding: 'utf8' })
        .split('\n').filter(Boolean).find((p) => !isGeneratedApp(p));
      if (hit) return { name: n, path: hit };
    } catch {}
  }
  return null;
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function windowsProcessMatches(appPath) {
  const escaped = String(appPath).replace(/'/g, "''");
  const script = [
    `$target = [IO.Path]::GetFullPath('${escaped}')`,
    '$found = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
    '  Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target) } |',
    '  Select-Object -First 1',
    'if ($found) { exit 0 } else { exit 1 }',
  ].join(' ');
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 5000,
  }).status === 0;
}

export function isRunning(appPath) {
  if (process.platform === 'win32') return windowsProcessMatches(appPath);

  // 从行首精确匹配，避免把 ~/Applications 下的同名启动器误认为原应用
  const r = spawnSync('/usr/bin/pgrep', ['-f', `^${reEscape(path.join(appPath, 'Contents', 'MacOS'))}/`]);
  return r.status === 0;
}

export function bundleId(appPath) {
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync('/usr/bin/defaults', ['read', path.join(appPath, 'Contents', 'Info'), 'CFBundleIdentifier'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
