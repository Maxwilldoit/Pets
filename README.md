# Pets

**简体中文** · [English](README.en.md)

Pets 是一款适用于 Windows、macOS 和 Linux 的桌面宠物应用，提供本地宠物管理、动画展示和 Codex 宠物导出。

## 核心功能

- 在控制面板浏览、搜索、按来源筛选宠物，预览宠物及其动画。
- 透明置顶桌宠，支持点击轮换动作、拖动、甩动，以及通过右键菜单切换宠物和调整大小；透明区域支持鼠标点击穿透。
- 支持托盘控制、多显示器和位置记忆；Windows 与 macOS 支持登录时启动。
- 导入本地宠物文件夹，自动识别 Codex 宠物目录中的兼容宠物。

当前源码（**v0.2.0**）支持简体中文和英文界面。可在「设置 → 语言」中切换或跟随系统，选择会自动保存。已发布的 v0.1.1 安装包暂不包含语言切换功能。

## 平台与下载

最新正式版为 [v0.1.1](https://github.com/Maxworkinghard/Pets/releases/tag/v0.1.1)，内置 **11 只宠物**，包含 **Makima 1.1.0**。使用发行包无需另装 Node.js。

| 平台 | 下载 | 安装方式 |
| --- | --- | --- |
| Windows x64 | [安装版（.exe）](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-windows-x64-setup.exe) · [便携版（.exe）](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-windows-x64-portable.exe) | 运行安装程序，或直接运行便携版。 |
| macOS Intel（x64） | [DMG](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-x64.dmg) · [ZIP](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-x64.zip) | 打开 DMG 或解压 ZIP，将 Pets.app 移入「应用程序」。 |
| macOS Apple Silicon（arm64） | [DMG](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-arm64.dmg) · [ZIP](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-arm64.zip) | 打开 DMG 或解压 ZIP，将 Pets.app 移入「应用程序」。 |
| Linux x64 | [AppImage](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-linux-x86_64.AppImage) · [DEB](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-linux-amd64.deb) | 为 AppImage 添加可执行权限后运行；DEB 适用于 Debian / Ubuntu 等兼容系统。 |

下载后可与 Release 附带的 `SHA256SUMS` 核对。v0.1.1 的 Windows 发行文件没有代码签名；macOS 发行文件没有开发者签名，也未经过 Apple 公证，系统可能提示警告或阻止打开。安装与校验命令见 [发行说明](docs/releases/v0.1.1.md)。

## 使用

1. 安装或解压对应平台的发行包，启动 Pets。
2. 在控制面板选择宠物，点击「设为桌面宠物」。单击宠物轮换动作，右键打开控制菜单。
3. 在设置中调整大小、自由走动、随机动作和启动选项。通过托盘图标重新打开面板或退出；后续启动会恢复宠物与位置。

导出时，在宠物详情中点击「导出到 Codex」（v0.1.1 中为「导入到 Codex」）。Pets 会将 `pet.json` 和 `spritesheet.webp` 写入 Codex 宠物目录，默认路径为 `~/.codex/pets/<id>/`。完成后在 Codex 中选择该宠物。

## 开发

需要 **Node.js 22.12 或更高版本**及 npm。在仓库根目录执行：

```sh
cd desktop
npm ci
npm start
```

以下命令均在 `desktop/` 中执行：

```sh
npm run dev                     # 带调试日志启动
npm test                        # 运行单元测试
npm run validate                # 校验内置宠物
npm run pack                    # 生成当前平台的应用目录
npm run dist -- --publish never # 在本地生成发行文件
```

构建产物位于 `desktop/dist/`。请在目标操作系统上打包；发行工作流使用各平台原生运行环境构建上述四种平台目标。

## 宠物格式与素材库

每只宠物是一个包含 `pet.json` 和素材的文件夹，支持 GIF / APNG / WebP 动图、PNG 帧序列和精灵图。字段与示例见 [宠物格式说明](pets/README.md) 和 [JSON Schema](schema/pet.schema.json)。

独立的 [Snapshot 公开素材库](catalog/README.md) 提供 [素材目录](catalog.json) 和 [GIF 下载包](https://github.com/Maxworkinghard/Pets/releases/tag/snapshot-assets-v1)，采用 Snapshot 的清单格式。原始素材见 [sources 说明](sources/README.md)。

## 许可

代码许可状态为 **UNLICENSED**，见 [desktop/package.json](desktop/package.json)，目前未提供开源代码许可。宠物素材及原始素材的授权以各自 `pet.json` 的 `license` 字段及随附说明为准。

公开素材库目前未单独声明素材许可，详见 [素材许可](catalog/README.md#素材许可) 及各 ZIP 中的 `ASSET-LICENSE.txt`。公开下载不等于授予开放许可或商业使用许可。
