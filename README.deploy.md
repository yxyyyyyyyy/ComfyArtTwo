# ComfyArt 部署：Mac 源码 + 5090 F 盘运行

这是官方 [ComfyArt](https://github.com/jtydhr88/ComfyArt) 的本地部署副本，保留完整前端、Python 后端、Agent、工作流、测试和许可证。

已通过前端生产构建、Mac 与 Windows 各 169 项测试、5090 上的 OCR、视觉 Agent 识图和画布文字编辑，以及 Z-Image Turbo 真实出图。验证记录在 `artifacts/`，源码版本记录在 `deploy/source-lock.json`。

## 打开

在 Mac 上双击本目录的 `打开ComfyArt.command`，或打开 <http://127.0.0.1:8188/comfyart/>。启动脚本会连接 SSH 别名 `5090`，启动远端服务和本地 SSH 隧道。需要 Mac 能通过当前校园网/VPN 连接该主机。

示例项目：<http://127.0.0.1:8188/comfyart/?project=c988236b>。

## 文件位置

- Mac 主源码：`/Users/yxy/开源项目/ComfyArt`；前端在 `src/`，后端在 `api/`、`bot/`，生成流程在 `workflows/`。
- Mac 引擎源码快照：`engine/ComfyUI/`，对应原始压缩归档 `engine/comfyui-source.tar.gz`。
- 5090 运行根目录：`F:\ComfyArt`。
- ComfyUI：`F:\ComfyArt\ComfyUI`；扩展：`custom_nodes\ComfyArt`。
- 图像及视频权重：`F:\ComfyArt\ComfyUI\models`；生成结果：`F:\ComfyArt\ComfyUI\output\comfyart`。
- 本地视觉 Agent 权重：`F:\ComfyArt\ollama\models`，独立 Ollama 端口 `11435`。
- 项目与聊天数据库：`F:\ComfyArt\ComfyUI\user\__comfyart\data.db`；素材与其他用户设置也在 `user/` 下。
- 服务日志：`F:\ComfyArt\logs`；Mac 验收记录：`artifacts/`。

运行环境复用机器已有的 Python 3.12、PyTorch 2.11 CUDA 12.8 与 Ollama 程序；新增 Python 包安装到 F 盘虚拟环境。服务只监听远端回环地址，通过 SSH 隧道访问。

## 当前模型

图像生成使用原版 Z-Image Turbo BF16、Qwen3 4B 文本编码器与 AE；视觉设计 Agent 使用 Qwen3-VL 4B Instruct，具备图像输入和工具调用。MiniMax H3 视频权重及 Turbo LoRA 已独立放到 F 盘；视频完成节点与权重检查，尚未验证完整视频生成。

画布、排版、图层、矢量、项目保存、PNG/PDF/PPTX 导出等沿用上游实现。Qwen Image 2.1 图像编辑、多角度、分层、抠图、超分、语音、音乐、3D 等所需的附加权重和自定义节点尚未装齐，安装清单见官方 `README.zh.md`。

## 开发与同步

```sh
cd /Users/yxy/开源项目/ComfyArt
npm ci
npm run build
python3 deploy/sync.py
```

同步会上传 `F:\ComfyArt\source.zip`。首次安装或需要更新 Python 依赖时运行：

```sh
python3 deploy/remote.py deploy/bootstrap.ps1
```

仅更新扩展并重启，运行：

```sh
python3 deploy/remote.py deploy/update.ps1
```

源码同步会排除 `.git/`、`node_modules/`、Mac 虚拟环境、引擎快照、验收产物和 `.env`，远端模型与项目数据不会被替换。

## 启停与验收

```sh
python3 deploy/remote.py deploy/start-agent.ps1
python3 deploy/remote.py deploy/start.ps1
python3 deploy/remote.py deploy/status.ps1
python3 deploy/smoke.py --generate
python3 deploy/remote.py deploy/stop.ps1
python3 deploy/remote.py deploy/stop-agent.ps1
```

Windows 任务计划中的 `ComfyArt-Server`、`ComfyArt-Agent` 用于保持进程在 SSH 断开后继续运行；没有设置定时巡检或账号云服务。重启 Windows 后可再次双击 Mac 启动脚本。

部署保留约 4GB 额外显存余量，使用 NVML 跟踪同机其他程序的占用。设计 Agent 在每次回复后释放模型，ComfyUI 关闭节点缓存，便于两个服务和原有 GPU 服务共存。机械 F 盘加载大模型较慢。

## 兼容修复与许可证

补充 `onnxruntime>=1.20`，支持 RapidOCR 的新版 ONNX 模型；Python 3.10 使用 `tomli` 读取 TOML。Windows 使用 `--disable-pinned-memory --disable-async-offload --disable-cuda-malloc`，解决本机原生加载与分配路径的问题，保留原版引擎的动态显存管理。项目代码为 MIT；tldraw SDK 使用其独立许可证，原有许可证及开发模式角标均保留。
