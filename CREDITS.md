# Credits & Third-Party Notices

雀魂 Plus 3.0 的 MITM / Mod 部分不是在真空里写出来的。这里记录主要的上游项目、
数据来源和第三方库，方便再分发时保留署名。

## 特别感谢

### MajsoulMax（Avenshy）

- 仓库：<https://github.com/Avenshy/MajsoulMax>
- 作者：Avenshy 及贡献者
- 许可证：仓库 `LICENSE` 为 **GNU GPL-3.0**（README 中标注为 AGPL-3.0；如有冲突，
  以仓库实际 LICENSE 为准）

3.0 的以下部分参考 / 移植自 MajsoulMax：

- `plugin/mod.py` 的解锁规则、请求伪造、`NotifyAccountUpdate` 处理等；
- `settings.mod.yaml` 的配置结构；
- WebSocket protobuf 帧格式（`Req` / `Res` / `Notify`，请求编号映射）；
- 用 `liqi.desc` 动态解析协议的方式；
- 用本地 MITM 代理修改游戏流量的整体思路（MajsoulMax 使用 mitmproxy，
  本项目用 TypeScript + `node-forge` + `ws` 重新实现，不包含 mitmproxy 代码）。

对应实现主要在：

```text
src/mod/engine.ts
src/mod/liqi.ts
src/mod/settings.ts
src/mod/data.ts
src/mitm/
docs/MITM.md
```

这些文件是 **TypeScript 重写 / 参考实现**，不是对 MajsoulMax 的逐行复制；但规则和
协议行为来自上游，再分发时请保留本说明，并同时遵守 MajsoulMax 的许可证。

### MajsoulData（Avenshy）

- 仓库：<https://github.com/Avenshy/MajsoulData>
- 用途：`assets/data/liqi.desc`、`assets/data/max_data.yaml`，以及启动后的自动更新。

`liqi.desc` 是雀魂客户端的 `FileDescriptorSet`，`max_data.yaml` 包含角色 / 皮肤 /
称号 / 物品等静态数据。数据版权归雀魂官方及原数据整理者所有，本项目仅用于本地
协议解析和界面展示。

### mitmproxy

- 仓库：<https://github.com/mitmproxy/mitmproxy>
- 用途：MITM 方案的概念参考（动态签发证书、解密 HTTPS / WSS）。
- 本项目没有链接或分发 mitmproxy 的代码。

### UnityPy

- 仓库：<https://github.com/K0lb3/UnityPy>
- 许可证：MIT
- 用途：解析 / 修改 Unity AssetBundle（Texture2D、Sprite、TextAsset、Font），
  由 `runtime/patcher/patcher.py` 调用。

### 资源包作者

- 示例资源包「橘爱丽丝 / MajsoulArisu」的立绘、语音、文本由资源包作者提供；
  这些素材不随源码仓库分发，版权归原作者与雀魂官方所有。

## 第三方库

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Electron 33 | 桌面壳 / Chromium | MIT |
| TypeScript | 主进程 / 管理器 | Apache-2.0 |
| node-forge | 本地 CA、证书签发 | BSD-3-Clause |
| ws | WebSocket 转发 | MIT |
| protobufjs | `liqi.desc` 解析 | BSD-3-Clause |
| koa / koa-router | 本地资源服务 | MIT |
| js-yaml | `settings.mod.yaml` | MIT |
| adm-zip | `.mspr` / `.mspe` / `.mspm` / `.mspt` 读取 | MIT |
| chalk | 终端颜色 | MIT |
| semver | 扩展 / 工具版本比较 | ISC |
| UnityPy | AssetBundle 补丁 | MIT |
| Pillow | 图片解码 / 缩放 | HPND |
| fontTools | 字体补丁 / PUA 字形合成 | MIT |
| PyInstaller | 打包 `patcher.exe` | GPL-2.0-or-later，含允许分发非自由程序的例外 |
| Sass | 管理器样式 | MIT |
| electron-builder | 打包 | MIT |

完整依赖版本见 `package.json`、`pnpm-lock.yaml` 与 `runtime/patcher/requirements.txt`。

## 许可证

- 本项目：**AGPL-3.0**，见 [LICENSE](LICENSE)。
- MajsoulMax：**GPL-3.0**（以其仓库 LICENSE 为准）。
- 第三方库：各自许可证，见上表与各库发行包。

如果你基于本项目二次开发：

1. 保留 `LICENSE`、本 `CREDITS.md` 和 `Readme.md` 中的上游说明；
2. 同时遵守 MajsoulMax 的 GPL-3.0；
3. 不要移除资源包作者、雀魂官方素材的版权声明；
4. 不要把游戏素材、字体、立绘当作本项目原创内容再分发。

## 免责声明

本项目与雀魂官方（CATFOOD / Yostar）没有任何关联。所有游戏素材、角色、商标归
其各自权利人所有。使用修改类工具可能导致账号被封禁，产生的一切后果由使用者自行承担。
