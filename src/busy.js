import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 判断 Codex 是否可能正在执行任务（启发式）：
// 1. 最近 recentWriteSec 秒内有会话记录写入；
// 2. codex app-server 的子进程中存在未知工作负载。
// 无法读取进程状态时保守视为忙碌，避免自动重启打断任务。

function parseEtime(s) {
  const m = String(s).trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

function listWindowsProcesses() {
  const script = `
$items = Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
  $age = $null
  try { $age = [math]::Max(0, ((Get-Date) - $_.CreationDate).TotalSeconds) } catch {}
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    ppid = [int]$_.ParentProcessId
    age = $age
    command = if ($_.CommandLine) { [string]$_.CommandLine } else { [string]$_.ExecutablePath }
    exe = [string]$_.ExecutablePath
  }
}
$items | ConvertTo-Json -Compress
`;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 8000,
    }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
      pid: Number(p.pid),
      ppid: Number(p.ppid),
      age: p.age == null ? null : Number(p.age),
      command: String(p.command || ''),
      exe: String(p.exe || ''),
    }));
  } catch {
    return null;
  }
}

export function listProcesses() {
  if (process.platform === 'win32') return listWindowsProcesses();

  let out = '';
  try {
    out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,etime=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
  const procs = out.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), age: parseEtime(m[3]), command: m[4], exe: '' }));
  return procs.length ? procs : null;
}

function isKnownMcpService(command) {
  return /^(?:\S*[\\/])?npx(?:\.cmd)?\s+(?:(?:-y|--yes)\s+)?@modelcontextprotocol\/server-[\w-]+(?:\s|$)/i.test(command)
    || /^(?:\S*[\\/])?node(?:\.exe)?\s+\S*\/@modelcontextprotocol\/server-[\w-]+\/(?:dist|build)\/\S+\.js(?:\s|$)/i.test(command);
}

function pathStartsWith(candidate, root) {
  if (!candidate || !root) return false;
  const a = path.resolve(candidate).toLowerCase();
  const b = path.resolve(root).toLowerCase();
  return a === b || a.startsWith(b + path.sep);
}

export function runningCommands(appPath, procs = listProcesses(), graceSec = 120) {
  if (!procs) return null;
  const appRoot = process.platform === 'win32' ? path.dirname(appPath) : appPath;
  const inApp = (p) => {
    if (process.platform === 'win32') {
      return pathStartsWith(p.exe, appRoot)
        || (p.command && p.command.toLowerCase().includes(appRoot.toLowerCase()));
    }
    return p.command.startsWith(appPath + '/');
  };

  const roots = procs.filter((p) => {
    const exeName = path.basename(p.exe || String(p.command).split(/\s+/)[0]).toLowerCase();
    return inApp(p) && (exeName === 'codex' || exeName === 'codex.exe' || /[\\/]codex(?:\.exe)?(?:\s|$)/i.test(p.command));
  });

  const children = new Map();
  for (const p of procs) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }

  const found = [];
  const visited = new Set();
  for (const root of roots) {
    const stack = [...(children.get(root.pid) || [])];
    while (stack.length) {
      const p = stack.pop();
      if (!p || visited.has(p.pid)) continue;
      visited.add(p.pid);
      stack.push(...(children.get(p.pid) || []));
      if (inApp(p) || isKnownMcpService(p.command)) continue;
      // 保留上游行为：随 codex 一起启动的早期常驻子进程不视为用户任务。
      // 只有明显晚于 codex 根进程启动的未知进程才判定为活动命令。
      if (root.age != null && p.age != null && root.age - p.age <= graceSec) continue;
      found.push(p);
    }
  }
  return found;
}

function newestSessionWriteAgeSec(dir) {
  let newest = 0;
  const walk = (d, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith('.jsonl')) {
        try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch {}
      }
    }
  };
  walk(dir, 0);
  return newest ? (Date.now() - newest) / 1000 : Infinity;
}

export function codexBusy(app, cfg) {
  const b = cfg.busy || {};
  const writeAge = newestSessionWriteAgeSec(cfg.sessionsDir);
  if (writeAge < (b.recentWriteSec ?? 30)) return { busy: true, reason: `${Math.round(writeAge)} 秒前有会话写入` };
  const cmds = runningCommands(app.path, listProcesses(), b.commandGraceSec ?? 120);
  if (!cmds) return { busy: true, reason: '无法确认进程状态，请手动确认任务已结束' };
  if (cmds.length) return { busy: true, reason: `正在运行命令：${cmds[0].command.slice(0, 60)}` };
  return { busy: false, reason: '' };
}

const asStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '" & linefeed & "')}"`;

function windowsDialog({ title, message, cancelButton }) {
  const hint = '\n\nWindows 按钮：是 = 立即重启；否 = 任务完成后自动重启；取消 = 稍后手动重启。';
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$r=[System.Windows.Forms.MessageBox]::Show(
  ${JSON.stringify(String(message) + hint)},
  ${JSON.stringify(String(title))},
  [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
  [System.Windows.Forms.MessageBoxIcon]::Warning,
  [System.Windows.Forms.MessageBoxDefaultButton]::Button3
)
Write-Output $r
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 300000,
  });
  if (r.status !== 0) return cancelButton || null;
  const value = String(r.stdout || '').trim();
  if (/^Yes$/i.test(value)) return '立即重启';
  if (/^No$/i.test(value)) return '任务完成后自动重启';
  return cancelButton || '稍后手动重启';
}

// 弹出最多三个按钮的对话框，返回被点击的按钮文字；取消或出错返回 null
export function askDialog(opts) {
  if (process.platform === 'win32') return windowsDialog(opts);

  const { title, message, buttons, defaultButton, cancelButton } = opts;
  const script = `display dialog ${asStr(message)} with title ${asStr(title)} buttons {${buttons.map(asStr).join(', ')}}`
    + (defaultButton ? ` default button ${asStr(defaultButton)}` : '')
    + (cancelButton ? ` cancel button ${asStr(cancelButton)}` : '')
    + ' with icon caution giving up after 300';
  const r = spawnSync('/usr/bin/osascript', ['-e', 'activate', '-e', script], { encoding: 'utf8' });
  if (r.status !== 0) return cancelButton || null;
  if (/gave up:true/.test(r.stdout)) return cancelButton || null;
  const m = r.stdout.match(/button returned:([^,]*)/);
  return m ? m[1].trim() : null;
}

export function notify(title, message) {
  if (process.platform === 'win32') {
    try {
      const child = spawn('msg.exe', ['*', '/TIME:5', `${title}: ${message}`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } catch {}
    return;
  }
  spawnSync('/usr/bin/osascript', ['-e', `display notification ${asStr(message)} with title ${asStr(title)}`]);
}
