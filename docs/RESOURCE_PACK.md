# 资源包：立绘 / 贴图替换（Unity AssetBundle）

> 适用于雀魂 Plus 3.0.0 及以上版本。

## 为什么和 2.0.1 不一样

2.0.1 时代游戏会直接请求 `extendRes/charactor/.../full.png`、`audio/sound/.../xxx.mp3` 这样的独立文件，
所以只要按 URL 替换文件就行。

现在雀魂改成了 Unity 客户端，实测所有立绘、语音、文字都被打进 **加密的 `.majset` AssetBundle**：

```
https://game.maj-soul.com/assetbundles/DXT/<混淆名>_<哈希>.majset
```

旧的 `extendRes` / `audio` 路径**根本不会被请求**，对它们做 URL 替换没有任何效果。

3.0 的做法是：程序内置一个基于 UnityPy 的补丁器，按资源名找到对应的 bundle，
把你的图片写进去，再在代理层把打好的 bundle 下发给游戏。

## 怎么用

### 1. 新建资源包

在用户数据目录的 `resourcepack/` 下新建一个文件夹（名字只能包含字母、数字、下划线），例如
`data/resourcepack/my_skin/`（Windows 便携版是程序旁的 `data\resourcepack\`），放入：

```
resourcepack/my_skin/
├─ resourcepack.json
└─ assets/
   └─ yiji_full.png
```

`resourcepack.json`：

```json
{
  "id": "my_skin",
  "version": "1.0.0",
  "name": "我的立绘",
  "author": "you",
  "description": "替换一姬看板娘立绘",
  "replace": [],
  "assets": [
    {
      "target": "deco/character/yiji/full",
      "file": "yiji_full.png"
    }
  ]
}
```

- `target`：资源分组名（见下表）；
- `file`：相对本资源包 `assets/` 目录的文件路径；
- 图片会自动缩放成原始贴图尺寸，支持 png / jpg / webp。

### 2. 启用资源包

打开雀魂 Plus 的资源管理器 → 「资源包」页 → 启用 `我的立绘` → 启动游戏。

首次启动会下载 `bundle_info_so.majset` 并生成资源索引（约 10~20 秒，之后会缓存）。
游戏请求到对应 bundle 时，程序会自动打补丁并缓存结果。

### 3. 让替换生效

游戏会把下载过的 bundle 缓存到 Cache Storage / IndexedDB 里，
换图后请点一下资源管理器底部的「清除缓存」按钮（游戏窗口的「开发」菜单里也有
「清除缓存并重载」），再启动游戏。

## target 命名

立绘 / 头像（`<角色>` 是拼音，如 `yiji`、`ichihime`、`a37`）：

| target | 说明 |
| --- | --- |
| `deco/character/<角色>/full` | 全身立绘（看板娘 / 大厅） |
| `deco/character/<角色>/bighead` | 大头像 |
| `deco/character/<角色>/smallhead` | 小头像 |
| `deco/character/<角色>/face` | 表情差分 |
| `deco/character/<角色>/reverse` | 反色 / 特殊差分 |
| `deco/title/<称号>` | 称号图片 |
| `deco/lobby_background/<背景>/pic` | 大厅背景 |
| `deco/bgm/pic/<名称>` | 曲绘 |

带皮肤后缀的写法是 `<角色>_<序号>`，例如 `deco/character/yiji_0/full`、
`deco/character/huiyeji_CJ/full`。完整列表可以在用户数据目录的
`bundles/index.json` 的 `groups` 字段里搜索。

TextAsset（文本类资源）也可以替换，`file` 指向 `.txt` / `.json` / `.bytes` 即可。

## 语音替换

新版语音仍然是独立的 mp3，只是路径变成了：

```
https://game.maj-soul.com/assetbundles/DXT/Assets/MyAssets/audio/sound/yiji/lobby/lobby_normal1.mp3
```

### 方式一：按路径镜像（推荐）

在资源包的 `assets/` 下按 URL 里 `Assets/` 之后的部分放置文件即可，不需要写规则：

```
resourcepack/my_voice/
├─ resourcepack.json
└─ assets/
   └─ audio/
      └─ sound/
         └─ yiji/
            ├─ act_rich.mp3
            ├─ act_ron.mp3
            └─ lobby/
               ├─ lobby_normal1.mp3
               └─ lobby_selfintro.mp3
```

`resourcepack.json` 里保持 `"replace": []`、`"assets": []` 即可，程序会自动匹配。

### 方式二：replace 规则

```json
"replace": [
  {
    "from": "audio/sound/yiji/lobby/lobby_normal1.mp3",
    "to": "audio/normal1.mp3"
  }
]
```

文件放 `assets/audio/normal1.mp3`。规则按 URL 后缀匹配，不用管前面的
`/assetbundles/DXT/Assets/MyAssets/`。

旧版资源包的写法（例如 `audio/sound/yiji/lobby_normal1.mp3`，没有 `lobby/`
这一层）也能匹配：程序会按「角色 + 文件名」再比较一次。

## 文本替换（语音台词 / 角色名 / 界面文字）

新版把文本放在加密的 Lua 表里，没法像旧版那样直接改 `cfg` 或替换文件。
3.0 的做法是：游戏启动后，客户端会把 Lua 表解密到 wasm 内存里，注入脚本在内存中
查找原文的 UTF-8 字节并**就地替换**。

在 `resourcepack.json` 里加 `text` 数组：

```json
{
  "id": "my_text",
  "version": "1.0.0",
  "text": [
    { "from": "一姬", "to": "泠鸢" },
    { "from": "获得语音", "to": "取得语音" },
    { "from": "今日からお世話になります。", "to": "今天开始请多关照。" }
  ]
}
```

规则：

- `from` 必须和游戏里显示的文字**完全一致**（区分简繁、全半角）；
- 普通文本：`to` 的 UTF-8 字节数**不能超过** `from`，不足会补空格；超过会被跳过并在日志提示；
- 短名字（不含换行、≤64 字）：`to` 可以比 `from` 长，程序会用 **PUA 合成字形** 显示。
  - `from` 是 3 的整数倍时，每个 PUA 字形占 3 字节；
  - 不是整数倍时，用 1 字节 `U+0001` / 2 字节 `U+00AD` 零宽空字形补齐；
  - 最多 64 个 PUA 槽，可容纳较长的语音台词；
- 人物简介等长段落**不能**使用 PUA（含换行或超过 64 字），必须压缩到原字节数以内；
- 会对内存中所有匹配生效，例如改「一姬」会同时把「一姬的契约者」改成「橘爱丽丝的契约者」；
- 页面加载后每 3 秒扫描一次，持续约 5 分钟，进大厅 / 对局后稍等几秒即可生效；
- 只对 Lua 驱动的文本有效，以图片形式绘制的文字改不了；
- 改完不需要清缓存，重启游戏即可。

> 长名字会触发字体补丁：程序从系统字体复制 / 合成 PUA 字形，保证 4~5 个字的名字
> 也能按正确宽度显示。设置页可以调整补字字体、缩放和偏移。

> 这个方案不修改任何文件、不碰服务器数据，只在本地内存里替换显示文本。

## 字体补全

如果替换后的文字出现方框 / 缺字，设置页的「字体补全」会自动从系统字体
（默认幼圆，可切楷体 / 黑体 / 宋体 / 微软雅黑等）复制缺失字形到游戏字体。

- **字号缩放**：`1.0` 为原始大小，只影响新补的字形；
- **水平 / 垂直偏移**：单位是 em 比例（`0.01` = 1%），用于修正补字基线；
- 自定义字体：把 `.ttf` / `.ttc` / `.otf` 放进 `data/fonts/`，刷新后可在下拉框选择。

## 立绘调整（不建议使用）

设置页提供水平 / 垂直偏移和缩放，只移动 Sprite 网格，不修改图片。
但游戏内立绘显示区域有**遮罩**，偏移过大时超出部分仍会被切断。

推荐做法：在本地用图片编辑器把人物构图移到画布中间（或按游戏比例重新裁切 /
加透明边），再替换进资源包。这样不受遮罩限制。

## 目前还不支持

- **图片形式的文字**（例如部分活动标题、桌布上的字）：需要替换贴图，请用 `assets` 的贴图替换。

这两项会在后续版本补充。立绘、头像、称号、背景、曲绘等贴图类资源已经可用。

## 常见问题

**Q：启动时卡很久？**
首次会生成资源索引（下载 600KB 清单并解析 7000+ 个 bundle），之后启动很快。

**Q：替换后没变化？**
1. 确认资源包已启用；
2. 清除缓存（资源管理器 → 设置 / 关于页的「清除缓存」）；
3. 查看日志里有没有「资源替换完成」；
4. 确认 `target` 与 `index.json` 中的 `groups` 完全一致。

**Q：会不会影响账号安全？**
替换只发生在本地，服务器看不到你的资源；但使用修改类工具本身存在风险，请自行判断。
