# 雀魂 Plus 3.0

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)](https://www.electronjs.org/)
[![Unity WebGL](https://img.shields.io/badge/client-Unity%20WebGL-orange)](docs/MITM.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#从源码构建)

雀魂 Plus 是一款面向 PC 的雀魂麻将第三方浏览器。3.0 起改用 **本地中间人代理
（MITM）** 接管游戏网络流量，在不修改游戏文件的前提下解锁角色、皮肤、装扮，
并支持 Unity AssetBundle 资源替换、语音 / 文本替换、字体补全等扩展功能。

> 3.0 全面适配雀魂的 **Unity WebGL** 客户端，思路与
> [MajsoulMax](https://github.com/Avenshy/MajsoulMax) 相同。旧的
> 「本地镜像服务器 + 修改 `code.js`」实现已失效，见 [docs/MITM.md](docs/MITM.md)。

> [!WARNING]
> 使用任何修改游戏内容的第三方工具都有可能导致账号被封禁。本项目仅供学习交流，
> 请自行承担风险；下载后 24 小时内删除。

## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [数据目录](#数据目录)
- [资源包](#资源包)
- [从源码构建](#从源码构建)
- [目录结构](#目录结构)
- [与 2.0.1 的差异](#与-201-的差异)
- [常见问题](#常见问题)
- [致谢与许可证](#致谢与许可证)

## 功能

- **本地 MITM 代理**：无需安装系统代理、无需 Python / mitmproxy；
- **解锁**：全角色、皮肤、装扮、称号、加载 CG、语音、表情；
- **个性化**：看板娘、昵称、星标角色、主播 / Pro 标识、显示服务器；
- **对局**：便捷提示、地铁模式、随机角色皮肤；
- **资源包**：替换 Unity 立绘、头像、称号、背景、曲绘等贴图；
- **语音**：按 URL 路径镜像或 `replace` 规则替换 mp3；
- **文本**：运行时替换角色名、语音台词、人物简介、界面文字；
- **长名字**：PUA 合成字形，支持比原文更长的短名字；
- **字体补全**：自动从系统字体补缺失字形，可调字体 / 缩放 / 偏移；
- **设置页**：字体补全、解锁开关、立绘微调；
- **诊断**：`requests.log` 与 `text-diag.json`（`Ctrl+Shift+D`）。

## 快速开始

### Windows 便携版

1. 解压 `majsoul-plus-3.0.0-win-x64.zip`；
2. 双击 `启动雀魂Plus.bat`（需要时右键「以管理员身份运行」）；
3. 在管理器选择服务器 → 启动游戏。

启动脚本会：

- 停止并结束 `NahimicService` / `NahimicSvc32` / `NahimicSvc64`（避免 Electron 崩溃）；
- 使用 `--no-sandbox` 启动 Electron；
- 设置控制台 UTF-8（`chcp 65001`）；
- 退出后恢复 Nahimic 服务。

> 如果双击 bat 后窗口一闪而过，请右键「以管理员身份运行」；
> 仍无法启动时先手动执行 `Majsoul Plus.exe --no-sandbox` 看报错。

### 其他平台

```bash
pnpm install
pnpm start
```

## 数据目录

3.0 默认使用**便携模式**：配置、资源包、字体、缓存都放在程序旁的 `data/`。

```text
majsoul-plus-3.0.0-win-x64/
├─ Majsoul Plus.exe
├─ 启动雀魂Plus.bat
└─ data/
   ├─ config/settings.mod.yaml
   ├─ resourcepack/
   ├─ extension/
   ├─ tool/
   ├─ fonts/
   ├─ bundles/index.json
   ├─ requests.log
   └─ text-diag.json
```

从源码 / 开发模式启动时，`data/` 位于项目根目录。

> 旧版 `%APPDATA%\Majsoul Plus` 下的配置和资源包不会自动迁移。需要的话把
> `resourcepack/`、`config/`、`fonts/` 复制到 `data/` 对应目录。
>
> 便携模式主要是为了规避安全软件对 `%APPDATA%` 写入的拦截（`EPERM`），
> 同时方便整个目录拷走。

### 配置文件

`data/config/settings.mod.yaml`：

```yaml
config:
  character: 200001 # 当前看板娘
  characters: {} # 各角色使用的皮肤
  nickname: '' # 自定义昵称
  star_chars: [] # 星标角色
  bianjietishi: false # 强制启用便捷提示
  title: 0 # 当前使用的称号
  loading_image: [] # 加载 CG
  emoji: false # 解锁全部表情（不推荐）
  views: # 各装扮页的装扮
    0: []
  views_index: 0 # 正在使用的装扮页
  show_server: true # 显示玩家所在服务器
  verified: 0 # 0 无标识 / 1 主播 / 2 Pro
  anti_replace_nickname: true # 禁止外服玩家使用默认昵称
  random_character: # 对局随机角色皮肤
    enabled: false
    pool: []
  safe_mode: false # 地铁模式
```

## 资源包

资源包 / 扩展 / 工具的格式与旧版一致，放在 `data/` 下对应目录。

- 立绘、头像、称号、背景、曲绘：AssetBundle 补丁；
- 语音：`audio/sound/...` 路径镜像或 `replace`；
- 文本：`text` 规则，运行时内存替换；
- 长名字：PUA 合成字形；
- 字体：设置页自动补字 / 合成。

完整字段、`target` 列表和示例见 **[docs/RESOURCE_PACK.md](docs/RESOURCE_PACK.md)**。

```json
{
  "id": "my_skin",
  "version": "1.0.0",
  "name": "我的立绘",
  "author": "you",
  "assets": [
    { "target": "deco/character/yiji/full", "file": "yiji_full.png" }
  ],
  "text": [{ "from": "一姬", "to": "橘爱丽丝" }]
}
```

> 立绘调整受游戏内遮罩限制，偏移过大仍会被切断。建议在本地编辑图片，
> 把人物构图移到画布中间后再替换，而不是依赖偏移。

## 从源码构建

环境要求：

- Node.js 18+
- pnpm（或 npm）
- Python 3.10+（仅重新打包 `patcher.exe` 时需要）

```bash
pnpm install
pnpm start        # 编译后启动
pnpm run build    # electron-builder 打包
pnpm test         # MITM / mod 冒烟测试（需要联网）
pnpm typecheck    # TypeScript 类型检查
```

Electron 下载慢时可以设置镜像：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

### 重新构建资源补丁器

修改 `runtime/patcher/patcher.py` 后：

```bash
pip install UnityPy pillow pyinstaller
python -m PyInstaller --noconfirm --onedir --name patcher \
  --collect-all UnityPy --collect-all PIL --collect-all fmod_toolkit \
  --collect-all archspec --exclude-module pandas --exclude-module lxml \
  --distpath runtime/patcher-bin \
  runtime/patcher/patcher.py
```

开发时不想打包，可以设置 `MAJSOUL_PYTHON` 指向本机 Python，
程序会直接运行 `runtime/patcher/patcher.py`。

## 目录结构

```text
src/
  mitm/        本地 CA、CONNECT、TLS、WebSocket 转发
  mod/         protobuf 解析与 mod 规则（参考 MajsoulMax）
  majsoul/     代理 / mod / 资源包 / 扩展的整合入口
  bundles/     AssetBundle 补丁器调用、缓存、字体补全
  resourcepack/资源包 / 扩展 / 工具管理
  manager/     资源管理器界面
  windows/     Electron 窗口
runtime/
  patcher/     资源补丁器源码（UnityPy）
  patcher-bin/ PyInstaller 打包产物（构建生成，不随源码分发）
assets/
  data/        内置 liqi.desc 与 max_data.yaml
  manager/     管理器页面
docs/
  MITM.md      中间人实现说明
  RESOURCE_PACK.md 资源包格式
test/          冒烟 / E2E 测试
```

## 与 2.0.1 的差异

| 功能 | 2.0.1 | 3.0 |
| --- | --- | --- |
| 游戏加载 | 本地镜像服务器 | 真实域名 + 本地 MITM |
| 客户端 | Cocos / JS | Unity WebGL / wasm |
| 解锁 | 无 | 移植 MajsoulMax mod |
| 贴图替换 | `resversion.json` 映射 | AssetBundle 补丁 |
| 语音替换 | 直接替换 mp3 | URL 镜像 / `replace` |
| 文本替换 | 修改 `cfg` 对象 | 运行时堆内存替换 |
| 长角色名 | 受字节数限制 | PUA 合成字形 |
| 字体缺字 | 手动改字体 | 自动补字 / 合成 |
| 扩展 | 依赖 `GameMgr` | 仅页面脚本，旧扩展需重写 |
| Electron | 7 | 33 |
| 数据目录 | `%APPDATA%` | 程序旁 `data/`（便携） |

完整变更、破坏性变更和已知限制见 **[CHANGELOG.md](CHANGELOG.md)**。

## 常见问题

### 程序启动后立刻退出（Nahimic / A-Volute）

部分微星、华硕笔记本的 Nahimic OSD 钩子会让 Electron / Chromium 在创建窗口时直接
崩溃，事件查看器里可以看到 `NahimicOSD.dll`。这不是本项目的问题。

```powershell
net stop NahimicService
.\Majsoul Plus.exe --no-sandbox
net start NahimicService
```

或直接使用 `启动雀魂Plus.bat`（需要管理员权限）。

### 弹「没有适当的权限」/ `EPERM`

安全软件可能拦截 Electron 向 `%APPDATA%` 写文件。3.0 默认使用程序旁 `data/`，
不会再写 `%APPDATA%`；如果仍遇到，确认：

- 解压目录可写（不要放在 `C:\Program Files`）；
- `data\` 没有被设为只读；
- 安全软件没有把整个解压目录加入保护。

### 游戏一直白屏 / 卡在「正在检查资料更新」

- 确认本地代理端口（默认 `23410`）没有被占用；
- 首次启动需要联网下载官方资源；
- 关闭其它全局代理 / VPN，避免二次劫持。

### 文本替换没生效

1. 确认资源包已启用、`from` 与游戏内文字完全一致（简繁 / 全半角）；
2. 普通文本 `to` 的 UTF-8 字节数不能超过 `from`；
3. 长名字是否超过 64 字、是否包含换行（含换行不会走 PUA）；
4. 按 `Ctrl+Shift+D` 生成 `data/text-diag.json`，查看 `matches` / `probes`。

### 新角色 / 新活动解析失败

程序启动后会从 `Avenshy/MajsoulData` 检查 `liqi.desc` 与 `max_data.yaml` 更新，
下载后重启游戏生效。也可以手动把这两个文件放到 `data/data/`。

## 致谢与许可证

- MITM / mod 思路与规则参考 [MajsoulMax](https://github.com/Avenshy/MajsoulMax)（Avenshy）；
- 协议数据来自 [MajsoulData](https://github.com/Avenshy/MajsoulData)；
- AssetBundle 解析使用 [UnityPy](https://github.com/K0lb3/UnityPy)；
- 字体补丁使用 [fontTools](https://github.com/fonttools/fonttools)。

完整的署名、第三方库许可证和再分发要求见 **[CREDITS.md](CREDITS.md)**。

本项目使用 **AGPL-3.0**，见 [LICENSE](LICENSE)。
软件图标、图像、SVG 矢量图形不遵循该协议，不可用于雀魂 Plus 以外的用途。
游戏素材、角色、商标归雀魂官方及各自权利人所有。

## 致用户

感谢阅读。雀魂 Plus 不希望影响雀魂官方的正常运营；一款游戏的长久运营需要玩家和
运营共同努力。请在使用魔改功能的同时，不要忘记为喜欢的游戏付费。
