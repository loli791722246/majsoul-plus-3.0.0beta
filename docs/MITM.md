# 中间人（MITM）实现说明

> 对应版本：`majsoul-plus` 3.0.0
>
> 参考实现：[MajsoulMax](https://github.com/Avenshy/MajsoulMax)（mitmproxy + protobuf 修改）

## 为什么改成中间人

雀魂在 2024 年后逐步切换到 **Unity WebGL** 客户端：页面只是一个 Unity 容器，
游戏逻辑、资源与网络代码都在 WebAssembly 里。旧版雀魂 Plus 依赖的
「本地镜像服务器 + 修改 `code.js` / `resversion.json`」方案因此完全失效：

- 不再有 `code.js`，也就没有 `GameMgr` 之类的 JS 接口；
- 资源打包进 Unity 的 bundle，`resversion.json` 的映射不再适用；
- 官方页面必须以真实域名访问，否则登录 / WebSocket 网关无法工作。

MajsoulMax 的做法是**在本地运行一个 HTTPS 代理**，把游戏流量劫持下来，
解密后修改 WebSocket 里的 protobuf 报文。本版本把这一套机制用 TypeScript
在 Electron 主进程里重新实现，不再依赖 Python、mitmproxy 或系统代理设置。

## 总体结构

```
┌──────────────┐   CONNECT    ┌──────────────────────────────┐   TLS    ┌──────────────┐
│ 游戏窗口      │ ───────────► │ 本地 MITM 代理 (127.0.0.1)    │ ───────► │ 雀魂官方服务器 │
│ (Chromium)   │ ◄─────────── │  · 动态签发证书               │ ◄─────── │              │
└──────────────┘   解密流量    │  · WebSocket protobuf 改写    │          └──────────────┘
                              └──────────────────────────────┘
```

| 文件 | 作用 |
| --- | --- |
| `src/mitm/certificate.ts` | 生成 / 载入本地 CA，按域名动态签发证书（node-forge） |
| `src/mitm/proxy.ts` | HTTP CONNECT 代理、TLS 解密、HTTP 转发、HTML 注入 |
| `src/mitm/websocket.ts` | WebSocket 双向转发，为每帧报文提供修改钩子（ws） |
| `src/mod/liqi.ts` | 加载 `liqi.desc`（FileDescriptorSet），解析雀魂报文格式 |
| `src/mod/engine.ts` | `plugin/mod.py` 的 TypeScript 移植：解锁角色 / 皮肤 / 装扮等 |
| `src/mod/settings.ts` | `settings.mod.yaml` 的读写 |
| `src/mod/data.ts` | `max_data.yaml`（全角色 / 皮肤 / 称号 / 物品）读取 |
| `src/majsoul/index.ts` | 把代理、mod、资源包、扩展注入串联起来 |
| `src/majsoul/data-updater.ts` | 从 `Avenshy/MajsoulData` 自动更新 liqi 数据 |

## 报文格式

与 MajsoulMax 完全一致：

```
字节 0      : 1 = Notify / 2 = Req / 3 = Res
字节 1..2   : Req、Res 的 uint16 小端消息编号（滑动窗口）
字节 3..    : base.BaseMessage { string method_name = 1; bytes data = 2; }
```

- `Req` 带方法名，客户端发出；代理记录 `msg_id -> 响应类型`。
- `Res` 的 `method_name` 为空，需要靠上面的映射还原方法名。
- `Notify` 没有消息编号。

`liqi.desc` 是游戏客户端导出的 `FileDescriptorSet`，`protobufjs` 可以直接
`Root.fromDescriptor()` 载入，无需代码生成。响应重新编码时**必须保持
`method_name` 为空**，否则客户端会解析失败。

## 已移植的 mod 规则

与 `plugin/mod.py` 一一对应：

- `fetchCharacterInfo` / `fetchInfo`：解锁全部角色、皮肤、称号、加载 CG、装扮；
- `login` / `oauth2Login`：替换看板娘、头像框、昵称、称号、标识；
- `changeMainCharacter` / `changeCharacterSkin` / `useTitle` / `setLoadingImage`
  等请求：保存到配置，并把请求伪造成 `loginBeat`，避免服务器报错；
- `changeCharacterSkin` 额外注入一条 `NotifyAccountUpdate`，让客户端立即刷新；
- `NotifyAccountUpdate`：含角色更新时丢弃，防止服务器把解锁状态改回去；
- `NotifyRoomPlayerUpdate` / `createRoom` / `fetchRoom` / `authGame` /
  `fetchGameRecord`：替换自己的角色、头像框、称号、装扮；
- `fetchBagInfo`：向背包中加入全部物品与加载插图；
- `fetchTitleList`、`fetchAllCommonViews`、`fetchAnnouncement`、
  `fetchServerSettings`、`fetchRandomCharacter` 等。

配置项（看板娘、昵称、星标、装扮页、便捷提示、地铁模式、随机皮肤等）与
MajsoulMax 的 `settings.mod.yaml` 保持一致。

## 资源替换与扩展注入

- **资源替换**：请求阶段按 URL 路径后缀匹配资源包 / 扩展的 `replace` 规则，
  命中则直接返回本地文件（`extendRes` 资源自动异或）。这对应 MajsoulMax 的
  `replace` 插件，不再依赖 `resversion.json`。
- **扩展注入**：`<head>` 前置脚本与 `DOMContentLoaded` 后置脚本会以内联
  `<script>` 的形式注入游戏页面，并移除页面 CSP。旧版 Cocos 扩展依赖的
  `GameMgr` / `code.js` 已不存在，因此这类扩展需要重写。

## 证书

首次启动时会在用户数据目录生成：

- `certificates/majsoul-plus-ca.crt` / `.key`：本地根证书；
- `certificates/majsoul-plus-leaf.key`：叶子证书私钥（各域名共用）。

游戏窗口通过 `session.setCertificateVerifyProc(() => 0)` 跳过校验，因此
**无需**把根证书安装到系统。若要让其他程序（例如浏览器）也走这个代理，
则需要手动信任上面的根证书。

## 数据更新

`data-updater.ts` 会在启动后异步访问
`https://api.github.com/repos/Avenshy/MajsoulData/releases/latest`，
把 `liqi.desc` 与 `max_data.yaml` 下载到用户数据目录的 `data/` 下，
下次启动生效。内置数据位于 `assets/data/`。
