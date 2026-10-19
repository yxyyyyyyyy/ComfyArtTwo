# 幕间 · MUJIAN STUDIO

通用 AI 创作工作台，融合 **Agent、图片生成与编辑、视频制作、自由画布**。从一句想法到设计作品，在同一个空间里组织素材、调用工具并完成创作。

本项目基于 [jtydhr88/ComfyArt](https://github.com/jtydhr88/ComfyArt) 二次开发，使用 ComfyUI、React 和 tldraw，保留原项目的版权与许可证。仓库名为 **ComfyArtTwo**，应用界面品牌为 **幕间**；原有 `/comfyart/` 地址和数据格式继续保留，兼容已有项目。

## 核心功能

- **Agent 创作**：通过对话规划设计，调用画布与生成工具；保留上游 Agent 和技能入口。
- **图片制作**：文生图、参考图生成、图像编辑，以及按已安装模型提供的抠图、超分、擦除、扩图等工具。
- **视频制作**：文生视频、图生视频、分镜制作、旁白字幕与成片合成；支持查看进度和复用已完成素材。
- **自由画布**：组织图片、视频、文字和设计元素，保留原有项目、图层、排版、素材和导出能力。
- **项目管理**：查看最近项目、搜索、继续创作及管理作品。

具体模型能力取决于已安装的权重与节点；项目保留上游功能，不将演示案例等同于全部功能。

## 本项目的改进

- 重新设计品牌、首页和固定导航，Agent、图片、视频作为主要创作入口。
- 按能力拆分独立页面：Agent 对话与执行、图片生成编辑、视频参数与预览；底层工作流继续复用。
- 增加可见的制作阶段、场景素材预览、断线恢复和失败重试。
- 增加剧本修订稿、角色配音信息和成片播放页面，作为视频制作的扩展流程。
- 完善模型资源交接、任务编号保存及文件占用处理，减少重复生成。

## 本地项目与数据

项目可用于图片创作、海报、品牌素材、设计排版和视频制作，漫剧只是其中一种使用方式。

本地项目、对话、剧本、制作清单与生成媒体保留在运行环境中，不随源码提交到 GitHub。`productions/`、项目数据目录、数据库、导出文件和验收截图均已加入忽略规则。应用不会自动把创作内容同步到 GitHub。

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

模型权重、节点与运行环境需要单独准备，源码齐全不代表所有可选功能均已安装。环境配置、开发构建和示例视频流程见 [部署说明](README.deploy.md)。部署脚本中的 SSH 别名、盘符及目录应按自己的环境配置。

## 目录

- `src/studio/`、`src/styles/studio.css`：通用创作导航、项目总览与扩展视频流程。
- `src/ui/`：制作任务、角色与成片交互，以及保留的画布工具。
- `api/`、`bot/`、`workflows/`：后端接口、Agent 和 ComfyUI 工作流。
- `deploy/`：本地部署、配音、动画制作、字幕混音与合成脚本。
- `tests/`：回归测试。

本仓库不包含本地模型权重、用户项目数据库、对话、剧本、生成媒体和私密配置。`docs/` 中保留上游公开宣传素材，不包含本地项目展示截图。

## 上游与许可

感谢 [ComfyArt](https://github.com/jtydhr88/ComfyArt) 原作者 Terry Jia 及相关开源项目。

- ComfyArt 扩展代码保留 [MIT 许可证](LICENSE)。
- tldraw SDK 使用其 [独立许可证](licenses/tldraw-LICENSE.md)，生产使用需遵循对应授权要求。
- ComfyUI 引擎、其他节点及模型分别遵循各自许可证。
- 上游功能及说明原文：[English](README.upstream.md) · [中文](README.zh.md)。上游文档中的宣传素材和功能清单不表示本项目已安装全部可选模型。
