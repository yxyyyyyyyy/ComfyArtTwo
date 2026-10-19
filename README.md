# 幕间 · MUJIAN STUDIO

本地 AI 漫剧创作工作台。从故事剧本、角色声音，到制作进度与成片放映，把创作过程放在一个清晰的界面里。

本项目基于 [jtydhr88/ComfyArt](https://github.com/jtydhr88/ComfyArt) 二次开发，使用 ComfyUI、React 和 tldraw，保留原项目的版权与许可证。仓库名为 **ComfyArtTwo**，应用界面品牌为 **幕间**；原有 `/comfyart/` 地址和数据格式继续保留，兼容已有项目。

<img src="docs/media/mujian-home.png" alt="幕间创作首页：新建漫剧、继续制作、查看成片" width="480" />

## 本项目的改进

- **独立的漫剧界面**：新增创作首页，以及项目总览、故事剧本、角色与声音、制作工作台、成片放映室和高级画布导航。
- **剧本与修订稿**：自动保存原稿和风格要求；已有生成记录时，以修订稿新建项目，保留旧版成片和素材。
- **可见的制作进度**：展示实际阶段、场景素材、配音和任务状态，支持继续制作、失败重试与已完成素材复用。
- **本地配音与合成**：接入 Qwen3-TTS 中文角色配音，将动画片段、动态漫画、字幕与音效合成为视频。
- **部署与稳定性**：提供 Mac 源码维护、Windows RTX 5090 部署脚本，并处理模型资源交接、断线恢复和 Windows 文件占用等问题。

角色页展示已有制作记录中的音色、对白和旁白，可保存创作备注供修订参考。人物一致性和动作连贯性仍需人工检查。

## 已验证的成片流程

已制作一集 **360 秒、720 × 1280、9:16** 的竖屏漫剧，包含中文角色配音、字幕和悬疑音效，采用 **53 秒原生人物动画片段与 307 秒动态漫画** 的混合形式。

剧本整理、画面验收和剪辑质量检查仍需人工参与。项目不承诺任意剧本直接生成六分钟连续原生动画。不同模型和硬件环境下，生成速度及效果会有差异。

测试记录：20 项前端测试通过；生产构建通过；已在浏览器验证草稿保存、分镜拆分、修订稿带入新项目和成片播放。

## 安装与运行

先准备可以运行的 ComfyUI 环境，在 `ComfyUI/custom_nodes` 下克隆：

```sh
git clone https://github.com/yxyyyyyyyy/ComfyArtTwo.git ComfyArt
cd ComfyArt
```

使用 **ComfyUI 所在的 Python 环境** 安装依赖：

```sh
python -m pip install -r requirements.txt
```

重启 ComfyUI，打开 <http://127.0.0.1:8188/comfyart/>。仓库包含构建后的前端；修改源码后重新构建：

```sh
npm ci
npm run build
npm run test:frontend
```

模型权重、节点与运行环境需要单独准备，源码齐全不代表所有可选功能均已安装。当前 Mac / Windows 5090 部署、模型配置和整集制作流程见 [部署说明](README.deploy.md)。部署脚本中的 SSH 别名、盘符及目录应按自己的环境配置。

## 目录

- `src/studio/`、`src/styles/studio.css`：幕间界面、项目总览与剧本修订。
- `src/ui/`：制作任务、角色与成片交互，以及保留的画布工具。
- `api/`、`bot/`、`workflows/`：后端接口、Agent 和 ComfyUI 工作流。
- `deploy/`：本地部署、配音、动画制作、字幕混音与合成脚本。
- `productions/`：剧集制作规范与示例。
- `tests/`：回归测试。

本仓库不包含本地模型权重、用户项目数据库、私密配置和本次生成的完整视频。`docs/` 中保留了上游公开宣传素材，幕间截图为本项目界面。

## 上游与许可

感谢 [ComfyArt](https://github.com/jtydhr88/ComfyArt) 原作者 Terry Jia 及相关开源项目。

- ComfyArt 扩展代码保留 [MIT 许可证](LICENSE)。
- tldraw SDK 使用其 [独立许可证](licenses/tldraw-LICENSE.md)，生产使用需遵循对应授权要求。
- ComfyUI 引擎、其他节点及模型分别遵循各自许可证。
- 上游功能及说明原文：[English](README.upstream.md) · [中文](README.zh.md)。上游文档中的宣传素材和功能清单不表示本项目已安装全部可选模型。
