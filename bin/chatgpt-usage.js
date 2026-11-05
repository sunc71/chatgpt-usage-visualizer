#!/usr/bin/env node
// 命令入口：只负责分发，具体实现在 src/
import { cmd, flag, buildConfig } from '../src/cli.js';
import { USER_CONFIG_PATH } from '../src/config.js';
import { findApp } from '../src/app.js';
import { findCodexBin, AppServerClient } from '../src/appServer.js';
import { readLatestFromSessions } from '../src/sessions.js';
import { toDisplayWindows } from '../src/normalize.js';
import { cleanupLegacyMenubar } from '../src/legacy.js';

const sidebar = () => import('../src/commands.js');

function describe(snap) {
  return toDisplayWindows(snap).map((w) => `${w.label} 剩余 ${Math.round(100 - w.usedPercent)}%`).join('，') || '无窗口数据';
}

async function install() {
  const cfg = buildConfig();
  const app = findApp(cfg.appNames);
  if (!app) {
    const hint = process.platform === 'win32'
      ? '可用 --app "C:\\完整路径\\ChatGPT.exe" 指定。'
      : '可用 --app 指定。';
    throw new Error(`找不到 Codex/ChatGPT 应用（尝试过：${cfg.appNames.join('、')}），${hint}`);
  }

  if (process.platform === 'darwin' && cleanupLegacyMenubar()) console.log('✓ 已移除旧版本的菜单栏程序');

  const sb = await sidebar();
  const reveal = await sb.installSidebar(sb.sidebarConfig(), app);
  console.log(`NEEDS_RELAUNCH=${flag('relaunch') ? 'no' : 'yes'}`);
  console.log('INSTALL_RESULT=ok');

  if (reveal && !flag('no-reveal')) {
    const { spawnSync } = await import('node:child_process');
    if (process.platform === 'win32') {
      spawnSync('explorer.exe', ['/select,', reveal], { windowsHide: true });
    } else {
      spawnSync('/usr/bin/open', ['-R', reveal]);
    }
  }
}

async function uninstall() {
  const cfg = buildConfig();
  const sb = await sidebar();
  if (sb.removeSidebar(cfg)) {
    console.log(process.platform === 'win32'
      ? '✓ 已删除 Windows 启动器和开始菜单快捷方式'
      : '✓ 已删除启动器并还原程序坞');
  }
  if (process.platform === 'darwin' && cleanupLegacyMenubar()) console.log('✓ 已移除旧版本的菜单栏程序');
  console.log('UNINSTALL_RESULT=ok');
}

async function doctor() {
  const cfg = buildConfig();
  const ok = (b, m) => console.log(`${b ? '✓' : '✗'} ${m}`);
  const major = Number(process.versions.node.split('.')[0]);

  ok(major >= 22, `Node.js ${process.versions.node}（需要 22 或更高）`);
  const supported = process.platform === 'darwin' || process.platform === 'win32';
  ok(supported, `系统：${process.platform}（支持 macOS / Windows）`);

  const app = findApp(cfg.appNames);
  const appHint = process.platform === 'win32'
    ? '--app 可直接填写 ChatGPT.exe / Codex.exe 的完整路径'
    : '--app 填桌面端应用名，可用 ls /Applications 查看';
  ok(!!app, app ? `应用：${app.path}` : `找不到应用（尝试过：${cfg.appNames.join('、')}）。${appHint}`);

  const bin = findCodexBin(cfg, app && app.path);
  ok(!!bin, bin ? `codex 可执行文件：${bin}` : '找不到 codex 可执行文件（将退回使用会话记录）');

  if (bin) {
    const c = new AppServerClient(bin, { debug: flag('debug') });
    try {
      await c.start();
      ok(true, `app-server 额度读取成功：${describe(await c.readRateLimits())}`);
    } catch (e) {
      ok(false, `app-server 额度读取失败：${e.message}`);
    } finally {
      c.stop();
    }
  }

  const fb = readLatestFromSessions(cfg.sessionsDir);
  ok(!!fb, fb ? `会话记录备用数据：${describe(fb.snapshot)}` : `会话记录中没有找到额度数据（${cfg.sessionsDir}）`);
  await (await sidebar()).doctorSidebar(ok);
  console.log(`\n自定义配置文件位置：${USER_CONFIG_PATH}`);
}

async function help() {
  console.log(`chatgpt-usage —— 在 Codex / ChatGPT 桌面端侧栏显示额度与重置倒计时（非官方工具）

用法：
  chatgpt-usage install    创建启动器
                           macOS：可用 --dock 替换程序坞图标
                           Windows：自动创建开始菜单 Usage 快捷方式
                           --relaunch 15 秒后通过启动器重启桌面端
  chatgpt-usage uninstall  删除启动器（macOS 同时还原程序坞）
  chatgpt-usage doctor     检查运行环境与数据源
  chatgpt-usage start      手动运行组件（终端前台）
  chatgpt-usage relaunch   15 秒后通过启动器重新打开桌面端（--delay 秒数）

选项：
  --app <名称或路径>      macOS 可填 Codex；Windows 建议填 exe 完整路径
  --launcher-name <名称>  自定义启动器名称
  --port <端口>           调试端口，默认 9222
  --codex-bin <路径>      指定 codex / codex.exe
  --yes                   需要重启桌面端时不再询问
  --debug                 输出详细日志`);
}

const commands = {
  install,
  uninstall,
  doctor,
  help,
  start: async () => (await sidebar()).start(),
  relaunch: async () => (await sidebar()).relaunch(),
};

(commands[cmd] || help)().catch((e) => {
  console.error(`错误：${e.message}`);
  process.exit(1);
});
