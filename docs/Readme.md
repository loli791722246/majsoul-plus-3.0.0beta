# 雀魂 Plus 设计文档

这里简要说明 3.0 的启动流程和模块边界。协议细节见 [MITM.md](MITM.md)，
资源包格式见 [RESOURCE_PACK.md](RESOURCE_PACK.md)。

## 启动流程

0. **初始化**

   - `appDataDir`：便携模式为程序旁 `data/`，开发模式为项目根 `data/`；
   - `UserConfigs`：读取 `data/user-config.json`，缺失字段用默认值补齐；
   - `i18n`：初始化界面语言；
   - Manager 实例：资源包 / 扩展 / 工具管理器；
   - 默认配置 `Object.freeze`。

1. **加载全局目录**

   - `data/resourcepack/`、`data/extension/`、`data/tool/`；
   - 目录不存在时从 `dist/bin/` 复制内置内容；
   - 复制失败只记录日志，不阻塞启动（避免安全软件 `EPERM` 弹窗）。

2. **加载资源包 / 扩展 / 工具**

   读取各目录下的 `active.json`，构造启用列表。加载失败会被捕获并记录，
   主进程继续启动。

3. **启动游戏**

   - 收到 Manager 的 `start-game`；
   - 创建游戏窗口，加载官方页面；
   - 启动本地 MITM 代理，游戏窗口的 session 走该代理；
   - 注册快捷键、截图、老板键等。

4. **MITM 代理**

   - `src/mitm/certificate.ts`：本地 CA，按 SNI 动态签发证书；
   - `src/mitm/proxy.ts`：HTTP CONNECT、TLS 解密、HTTP 转发、HTML 注入；
   - `src/mitm/websocket.ts`：WebSocket 帧转发，挂载 mod / 资源替换钩子。

5. **Mod**

   - `src/mod/liqi.ts`：从 `liqi.desc` 载入 protobuf 描述；
   - `src/mod/engine.ts`：参考 MajsoulMax `plugin/mod.py` 的规则，
     修改 `Req` / `Res` / `Notify`；
   - `src/mod/settings.ts`：读写 `data/config/settings.mod.yaml`；
   - `src/mod/data.ts`：读取 `max_data.yaml`。

6. **资源替换**

   - `src/majsoul/index.ts` 在请求阶段按 URL 后缀匹配资源包 / 扩展规则；
   - 命中 AssetBundle 时调用 `BundlePatcher`，用 `runtime/patcher/patcher.py`
     生成补丁并缓存；
   - 字体补全、立绘偏移都在补丁器内完成；
   - 文本替换由注入脚本扫描 Unity 堆内存完成。

7. **窗口与生命周期**

   - 游戏窗口关闭后按配置隐藏 / 销毁 Manager；
   - 全部窗口退出后结束进程；
   - Nahimic 环境由启动脚本处理，不属于应用逻辑。

## 数据流

```text
游戏窗口
  │  HTTPS / WSS
  ▼
本地 MITM 代理
  ├─ HTTP：按路径返回资源包 / 扩展文件
  ├─ WebSocket：protobuf 解码 → ModEngine → 重新编码
  └─ AssetBundle：BundlePatcher → 本地缓存 → 返回补丁后的 bundle
```

## IPC

见 [IPC.md](IPC.md)。
