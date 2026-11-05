# ChatGPT Usage Visualizer

在 **ChatGPT / Codex 桌面端侧边栏**显示额度信息，包括：

- 5 小时额度剩余比例
- 每周额度剩余比例
- 重置倒计时 / 重置时间
- 自动同步
- 手动刷新
- 圆环、沙漏、咖啡、电池四种样式

> 非官方工具，与 OpenAI 无关。工具通过本机 Chromium DevTools 调试端口向桌面端页面注入组件。客户端更新后，组件选择器可能需要适配。

<p align="center">
  <img src="docs/preview-light.png" width="360">
  <img src="docs/preview-dark.png" width="360">
</p>

---

## Windows 10 / 11：直接安装

### 1. 准备环境

需要：

- Windows 10 / 11
- Node.js 22+
- Git
- ChatGPT 或 Codex Windows 桌面端

检查 Node.js：

```powershell
node -v
```

如果版本低于 22，请先安装新版 Node.js。

---

### 2. Clone Windows 版本

打开 **PowerShell**：

```powershell
git clone -b windows-support https://github.com/sunc71/chatgpt-usage-visualizer.git
cd chatgpt-usage-visualizer
```

这里已经直接 clone `windows-support` 分支，不需要再执行 `git checkout`。

---

### 3. 检查环境

```powershell
node .\bin\chatgpt-usage.js doctor
```

正常情况下会看到类似：

```text
✓ Node.js ...
✓ 系统：win32
✓ 应用：...
✓ codex 可执行文件：...
```

其中 `codex 可执行文件` 找不到并不一定导致工具完全不能用，工具还可以退回读取本地会话额度记录。

---

### 4. 一键安装

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后：

1. **完全退出 ChatGPT / Codex**
2. 打开 Windows 开始菜单
3. 找到：

```text
ChatGPT (Usage)
```

或者：

```text
Codex (Usage)
```

4. 从这个快捷方式启动

以后也建议从这个 `(Usage)` 快捷方式启动桌面端。

---

## 如果自动找不到 ChatGPT / Codex

先找到实际的 `.exe` 路径，然后运行：

```powershell
node .\bin\chatgpt-usage.js doctor --app "C:\完整路径\ChatGPT.exe"
```

确认正常后安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -App "C:\完整路径\ChatGPT.exe"
```

Codex 同理：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -App "C:\完整路径\Codex.exe"
```

---

## Windows 日志

默认日志：

```text
%LOCALAPPDATA%\ChatGPT Usage Visualizer\chatgpt-usage-visualizer.log
```

PowerShell 查看：

```powershell
Get-Content "$env:LOCALAPPDATA\ChatGPT Usage Visualizer\chatgpt-usage-visualizer.log" -Tail 100
```

实时查看：

```powershell
Get-Content "$env:LOCALAPPDATA\ChatGPT Usage Visualizer\chatgpt-usage-visualizer.log" -Wait
```

---

## Windows 卸载

在仓库目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

或者：

```powershell
node .\bin\chatgpt-usage.js uninstall
```

会删除本工具创建的启动器和开始菜单快捷方式。

---

## 更新

进入仓库：

```powershell
cd chatgpt-usage-visualizer
git pull
```

如果启动器相关代码发生更新，建议重新安装一次：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

## Windows 常见问题

### `doctor` 找不到桌面端

直接指定 exe：

```powershell
node .\bin\chatgpt-usage.js doctor --app "C:\完整路径\ChatGPT.exe"
```

然后安装时同样加 `-App`。

### 安装后组件没有出现

确认：

1. 原来的 ChatGPT / Codex 已经完全退出
2. 是从开始菜单的 **`(Usage)` 快捷方式**启动
3. 调试端口 9222 已开启

检查：

```powershell
node .\bin\chatgpt-usage.js doctor
```

然后查看日志：

```powershell
Get-Content "$env:LOCALAPPDATA\ChatGPT Usage Visualizer\chatgpt-usage-visualizer.log" -Tail 100
```

### 调试端口 9222 没有打开

本工具需要通过：

```text
--remote-debugging-port=9222
```

启动桌面客户端。

部分 Windows Store / MSIX 安装版本可能不允许直接这样启动。如果遇到这种情况，优先尝试能够直接定位到 `ChatGPT.exe` / `Codex.exe` 的桌面安装版本。

### PowerShell 不允许执行脚本

直接使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

无需永久修改系统的 Execution Policy。

---

## 手动运行

不安装快捷方式也可以：

```powershell
node .\bin\chatgpt-usage.js start
```

终端需要保持打开。

按：

```text
Ctrl + C
```

停止。

---

## 常用命令

```powershell
# 环境检查
node .\bin\chatgpt-usage.js doctor

# 安装
node .\bin\chatgpt-usage.js install

# 手动启动
node .\bin\chatgpt-usage.js start

# 延迟重新启动
node .\bin\chatgpt-usage.js relaunch

# 卸载
node .\bin\chatgpt-usage.js uninstall
```

常用参数：

```text
--app <应用名或 exe 路径>
--launcher-name <启动器名称>
--port <端口>
--codex-bin <codex.exe 路径>
--yes
--debug
```

---

## macOS

原项目的 macOS 支持仍然保留。

### Clone

```bash
git clone https://github.com/sunc71/chatgpt-usage-visualizer.git
cd chatgpt-usage-visualizer
git checkout windows-support
```

### 检查

```bash
node bin/chatgpt-usage.js doctor
```

### 安装

```bash
./install.sh
```

### 卸载

```bash
./uninstall.sh
```

macOS 日志：

```text
~/Library/Logs/chatgpt-usage-visualizer.log
```

---

## 工作原理

工具不会修改 ChatGPT / Codex 安装包。

启动器会以类似下面的参数启动 Electron 桌面端：

```text
--remote-debugging-port=9222
```

然后工具通过本机 Chromium DevTools Protocol：

```text
127.0.0.1:9222
```

找到桌面端主窗口，并注入 `src/widget.js`。

额度数据优先来自 Codex 自带的：

```text
codex app-server
```

接口：

```text
account/rateLimits/read
```

如果无法使用 app-server，则退回读取本地 `~/.codex/sessions` 中最近的额度快照。

工具不会读取或上传登录凭证。

---

## 自定义配置

配置文件：

```text
~/.chatgpt-usage-visualizer/config.json
```

例如：

```json
{
  "appNames": ["ChatGPT", "Codex"],
  "debugPort": 9222,
  "style": "ring",
  "timeDisplay": "countdown",
  "pollFocusedSec": 60,
  "pollBackgroundSec": 300,
  "thresholds": {
    "warnRemainingPercent": 25,
    "dangerRemainingPercent": 10
  }
}
```

样式：

```text
ring
hourglass
coffee
battery
```

时间显示：

```text
countdown
deadline
```

---

## 开发与测试

项目要求 Node.js 22+。

运行单测：

```powershell
npm test
```

Windows 和 macOS 都有 GitHub Actions 检查：

- Node.js 语法检查
- 单元测试

---

## 安全说明

调试端口仅绑定本机，但在桌面端以调试模式运行期间，本机其他进程理论上也可能访问这个调试接口。

因此：

- 只建议在自己的可信电脑上使用
- 不要把调试端口暴露到公网
- 本工具不会上传使用数据
- 本工具不会读取 OpenAI 登录凭据

---

## Credits

原始项目：

```text
ZGSQ-QIANG/chatgpt-usage-visualizer
```

Windows 支持 fork：

```text
sunc71/chatgpt-usage-visualizer
```

---

## License

MIT
