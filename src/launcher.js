import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPortOpen } from './cdp.js';
import { isRunning, bundleId } from './app.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const LAUNCHER_ID = 'local.chatgpt-usage-visualizer.launcher';
const LEGACY_LAUNCHER_IDS = ['local.codex-usage-countdown.launcher'];

const WIN_HOME = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const WIN_LAUNCHER_DIR = path.join(WIN_HOME, 'ChatGPT Usage Visualizer');
const MAC_LAUNCHER_DIR = path.join(os.homedir(), 'Applications');
const LAUNCHER_DIR = process.platform === 'win32' ? WIN_LAUNCHER_DIR : MAC_LAUNCHER_DIR;

export const LAUNCHER_LOG = process.platform === 'win32'
  ? path.join(WIN_LAUNCHER_DIR, 'chatgpt-usage-visualizer.log')
  : path.join(os.homedir(), 'Library', 'Logs', 'chatgpt-usage-visualizer.log');

function safeLauncherName(name) {
  const s = String(name || '').trim();
  if (!s || /[\\/\0:*?"<>|]/.test(s) || ['.', '..'].includes(s)) {
    throw new Error('启动器名称包含 Windows/macOS 不允许的字符');
  }
  return s;
}

export function isOurLauncher(appPath) {
  if (process.platform === 'win32') {
    try {
      const text = fs.readFileSync(appPath, 'utf8');
      return text.includes('chatgpt-usage-visualizer launcher');
    } catch {
      return false;
    }
  }
  try {
    const plist = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
    return [LAUNCHER_ID, ...LEGACY_LAUNCHER_IDS].some((id) => plist.includes(id));
  } catch {
    return false;
  }
}

export function findInstalledLaunchers() {
  let entries = [];
  try { entries = fs.readdirSync(LAUNCHER_DIR); } catch { return []; }
  if (process.platform === 'win32') {
    return entries.filter((e) => e.endsWith('.cmd'))
      .map((e) => path.join(LAUNCHER_DIR, e))
      .filter(isOurLauncher);
  }
  return entries.filter((e) => e.endsWith('.app'))
    .map((e) => path.join(LAUNCHER_DIR, e))
    .filter(isOurLauncher);
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

export async function quitApp(app, timeoutMs = 20000) {
  if (process.platform === 'win32') {
    const script = [
      `$target=[IO.Path]::GetFullPath(${psQuote(app.path)})`,
      '$ps=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
      'Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target) }',
      'foreach($p in $ps){ Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue }',
    ].join(' ');
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    const id = bundleId(app.path);
    spawnSync('/usr/bin/osascript', ['-e', id ? `quit app id "${id}"` : `quit app "${app.name}"`]);
  }

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!isRunning(app.path)) return true;
    await sleep(500);
  }
  return false;
}

function resolveWindowsPackageIdentity(exePath) {
  const script = [
    `$target=[IO.Path]::GetFullPath(${psQuote(exePath)})`,
    '$pkg = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {',
    '  $_.InstallLocation -and $target.StartsWith([IO.Path]::GetFullPath($_.InstallLocation), [StringComparison]::OrdinalIgnoreCase)',
    '} | Select-Object -First 1',
    "if ($pkg) { [pscustomobject]@{ PackageFamilyName=$pkg.PackageFamilyName; Name=$pkg.Name; Version=$pkg.Version.ToString() } | ConvertTo-Json -Compress }",
  ].join(' ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
    }).trim();
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

function launchPackagedWindowsApp(app, port) {
  const identity = app.packageFamilyName ? app : resolveWindowsPackageIdentity(app.path);
  const family = identity?.packageFamilyName || identity?.PackageFamilyName;
  const appId = app.appId || 'App';
  if (!family) throw new Error('无法确认 Windows package identity，已停止启动以避免破坏原客户端 UI');

  const args = `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`;
  const script = [
    '$cmd = Get-Command Invoke-CommandInDesktopPackage -ErrorAction SilentlyContinue',
    "if (-not $cmd) { Write-Error 'Invoke-CommandInDesktopPackage unavailable'; exit 2 }",
    `Invoke-CommandInDesktopPackage -PackageFamilyName ${psQuote(family)} -AppId ${psQuote(appId)} -Command ${psQuote(app.path)} -Args ${psQuote(args)}`,
  ].join('; ');

  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 12000,
  });
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').trim();
    throw new Error(`无法以 Windows 包身份启动桌面端${detail ? `：${detail}` : ''}`);
  }
}

export async function launchWithPort(app, port, timeoutMs = 30000) {
  if (process.platform === 'win32') {
    if (app.packaged || app.packageFamilyName || /[\\/]WindowsApps[\\/]/i.test(app.path)) {
      launchPackagedWindowsApp(app, port);
    } else {
      const child = spawn(app.path, [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${port}`,
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
    }
  } else {
    spawnSync('/usr/bin/open', ['-a', app.path, '--args', `--remote-debugging-port=${port}`]);
  }

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await sleep(500);
  }
  return false;
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cmdQuote = (s) => `"${String(s).replace(/"/g, '""')}"`;

function installWindowsLauncher({ app, name, nodePath, toolPath, extraArgs }) {
  const launcherName = safeLauncherName(name || app.name || 'ChatGPT Usage');
  fs.mkdirSync(WIN_LAUNCHER_DIR, { recursive: true });

  const launcherPath = path.join(WIN_LAUNCHER_DIR, `${launcherName}.cmd`);
  const args = ['start', '--yes', '--with-app', ...extraArgs].map(cmdQuote).join(' ');
  const log = LAUNCHER_LOG;

  fs.writeFileSync(launcherPath, `@echo off\r\nREM chatgpt-usage-visualizer launcher\r\nif not exist ${cmdQuote(nodePath)} (\r\n  echo Node.js not found. Re-run install.\r\n  pause\r\n  exit /b 1\r\n)\r\nif not exist ${cmdQuote(toolPath)} (\r\n  echo chatgpt-usage-visualizer files not found. Re-run install.\r\n  pause\r\n  exit /b 1\r\n)\r\nstart "" /b ${cmdQuote(nodePath)} ${cmdQuote(toolPath)} ${args} >> ${cmdQuote(log)} 2>&1\r\n`, 'utf8');

  // 创建开始菜单快捷方式。失败不影响 .cmd 启动器本身。
  let shortcut = null;
  const programs = process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  if (programs) {
    shortcut = path.join(programs, `${launcherName} (Usage).lnk`);
    const script = [
      '$w=New-Object -ComObject WScript.Shell',
      `$s=$w.CreateShortcut(${psQuote(shortcut)})`,
      `$s.TargetPath=${psQuote(process.env.ComSpec || 'cmd.exe')}`,
      `$s.Arguments='/c ""' + ${psQuote(launcherPath)} + '""'`,
      `$s.WorkingDirectory=${psQuote(path.dirname(toolPath))}`,
      '$s.WindowStyle=7',
      '$s.Save()',
    ].join(';');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    });
    if (r.status !== 0) shortcut = null;
  }

  return { path: launcherPath, name: launcherName, removed: [], shortcut };
}

// 返回 { path, removed }：removed 为被替换掉的旧启动器路径（用于更新程序坞）
export function installLauncherApp({ app, name, nodePath, toolPath, extraArgs = [] }) {
  if (process.platform === 'win32') {
    return installWindowsLauncher({ app, name, nodePath, toolPath, extraArgs });
  }

  const launcherName = safeLauncherName(name || app.name);
  const LAUNCHER_PATH = path.join(MAC_LAUNCHER_DIR, `${launcherName}.app`);
  if (path.resolve(LAUNCHER_PATH) === path.resolve(app.path)) {
    throw new Error(`${app.path} 是原应用本身，请用 --launcher-name 换一个启动器名称`);
  }
  if (fs.existsSync(LAUNCHER_PATH) && !isOurLauncher(LAUNCHER_PATH)) {
    throw new Error(`${LAUNCHER_PATH} 已存在且不是本工具生成的，请用 --launcher-name 换一个名称`);
  }
  const removed = findInstalledLaunchers();
  for (const old of removed) fs.rmSync(old, { recursive: true, force: true });
  const contents = path.join(LAUNCHER_PATH, 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  fs.mkdirSync(path.dirname(LAUNCHER_LOG), { recursive: true });

  let hasIcon = false;
  try {
    let icon = execFileSync('/usr/bin/defaults', ['read', path.join(app.path, 'Contents', 'Info'), 'CFBundleIconFile'], { encoding: 'utf8' }).trim();
    if (icon && !icon.endsWith('.icns')) icon += '.icns';
    const src = path.join(app.path, 'Contents', 'Resources', icon);
    if (icon && fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(contents, 'Resources', 'AppIcon.icns'));
      hasIcon = true;
    }
  } catch {}

  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIdentifier</key><string>${LAUNCHER_ID}</string>
  <key>CFBundleName</key><string>${xmlEsc(launcherName)}</string>
  <key>CFBundleDisplayName</key><string>${xmlEsc(launcherName)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.6.0</string>
  <key>LSUIElement</key><true/>
  ${hasIcon ? '<key>CFBundleIconFile</key><string>AppIcon</string>' : ''}
</dict></plist>
`);

  const args = ['start', '--yes', '--with-app', ...extraArgs].map(shq).join(' ');
  const script = path.join(contents, 'MacOS', 'launcher');
  fs.writeFileSync(script, `#!/bin/bash
# 由 chatgpt-usage install 生成
if [ ! -x ${shq(nodePath)} ] || [ ! -f ${shq(toolPath)} ]; then
  osascript -e 'display alert "额度组件启动器已失效" message "找不到 Node 或工具文件，请重新运行 chatgpt-usage install。"'
  open -a ${shq(app.path)}
  exit 1
fi
/usr/bin/nohup ${shq(nodePath)} ${shq(toolPath)} ${args} >> ${shq(LAUNCHER_LOG)} 2>&1 < /dev/null &
disown
exit 0
`);
  fs.chmodSync(script, 0o755);
  spawnSync('/usr/bin/codesign', ['--force', '--deep', '-s', '-', LAUNCHER_PATH]);
  return { path: LAUNCHER_PATH, name: launcherName, removed: removed.filter((p) => p !== LAUNCHER_PATH) };
}

export function uninstallLauncherApp() {
  const found = findInstalledLaunchers();
  for (const p of found) fs.rmSync(p, { recursive: true, force: true });
  if (process.platform === 'win32') {
    const programs = process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    if (programs) {
      let entries = [];
      try { entries = fs.readdirSync(programs); } catch {}
      for (const e of entries.filter((x) => / \(Usage\)\.lnk$/i.test(x))) {
        try { fs.rmSync(path.join(programs, e), { force: true }); } catch {}
      }
    }
  }
  return found;
}

// ---------- macOS 程序坞支持 ----------
const PB = '/usr/libexec/PlistBuddy';
const DOCK_BACKUP = path.join(os.homedir(), '.chatgpt-usage-visualizer', 'dock-backup.plist');
const pb = (file, cmd) => execFileSync(PB, ['-c', cmd, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryPb = (file, cmd) => { try { return pb(file, cmd); } catch { return null; } };
const urlToPath = (u) => decodeURIComponent(String(u).replace(/^file:\/\//, '')).replace(/\/$/, '');

function readDockTiles(tmp) {
  const tiles = [];
  for (let i = 0; ; i++) {
    if (tryPb(tmp, `Print :persistent-apps:${i}:tile-type`) === null && tryPb(tmp, `Print :persistent-apps:${i}`) === null) break;
    const url = tryPb(tmp, `Print :persistent-apps:${i}:tile-data:file-data:_CFURLString`);
    tiles.push({ index: i, path: url ? urlToPath(url) : null });
  }
  return tiles;
}

function retarget(tmp, i, targetPath) {
  const base = `:persistent-apps:${i}:tile-data`;
  pb(tmp, `Set ${base}:file-data:_CFURLString ${pathToFileURL(targetPath).href}/`);
  tryPb(tmp, `Delete ${base}:book`);
  tryPb(tmp, `Delete ${base}:bundle-identifier`);
  tryPb(tmp, `Delete ${base}:file-label`);
}

function editDock(fn) {
  if (process.platform !== 'darwin') return 'unchanged';
  const tmp = path.join(os.tmpdir(), `chatgpt-usage-dock-${process.pid}.plist`);
  execFileSync('/usr/bin/defaults', ['export', 'com.apple.dock', tmp]);
  const result = fn(tmp, readDockTiles(tmp));
  if (result !== 'unchanged') {
    execFileSync('/usr/bin/defaults', ['import', 'com.apple.dock', tmp]);
    spawnSync('/usr/bin/killall', ['Dock']);
  }
  fs.rmSync(tmp, { force: true });
  return result;
}

export function dockInstall(appPath, LAUNCHER_PATH, oldPaths = []) {
  if (process.platform !== 'darwin') return 'exists';
  return editDock((tmp, tiles) => {
    if (!fs.existsSync(DOCK_BACKUP)) {
      fs.mkdirSync(path.dirname(DOCK_BACKUP), { recursive: true });
      fs.copyFileSync(tmp, DOCK_BACKUP);
    }
    if (tiles.some((t) => t.path === LAUNCHER_PATH)) return 'unchanged';
    const orig = tiles.find((t) => oldPaths.includes(t.path)) || tiles.find((t) => t.path === appPath);
    if (orig) {
      retarget(tmp, orig.index, LAUNCHER_PATH);
      return 'replaced';
    }
    const i = tiles.length;
    const url = `${pathToFileURL(LAUNCHER_PATH).href}/`;
    pb(tmp, `Add :persistent-apps:${i} dict`);
    pb(tmp, `Add :persistent-apps:${i}:tile-type string file-tile`);
    pb(tmp, `Add :persistent-apps:${i}:tile-data dict`);
    pb(tmp, `Add :persistent-apps:${i}:tile-data:file-data dict`);
    pb(tmp, `Add :persistent-apps:${i}:tile-data:file-data:_CFURLString string ${url}`);
    pb(tmp, `Add :persistent-apps:${i}:tile-data:file-data:_CFURLStringType integer 15`);
    return 'added';
  }).replace('unchanged', 'exists');
}

export function dockRestore(app, launcherPaths) {
  if (process.platform !== 'darwin') return 'none';
  return editDock((tmp, tiles) => {
    const t = tiles.find((x) => launcherPaths.includes(x.path));
    if (!t) return 'unchanged';
    if (app) retarget(tmp, t.index, app.path);
    else pb(tmp, `Delete :persistent-apps:${t.index}`);
    return 'restored';
  }).replace('unchanged', 'none');
}

export function relaunchLater(launcherPath, seconds = 15) {
  if (process.platform === 'win32') {
    const script = `Start-Sleep -Seconds ${Math.max(0, Number(seconds) || 0)}; Start-Process -FilePath ${psQuote(process.env.ComSpec || 'cmd.exe')} -ArgumentList '/c',${psQuote('"' + launcherPath + '"')} -WindowStyle Hidden`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  const child = spawn('/bin/sh', ['-c', `sleep ${Number(seconds)}; /usr/bin/open ${shq(launcherPath)}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
