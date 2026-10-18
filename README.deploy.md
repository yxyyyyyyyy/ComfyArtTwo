# ComfyArt 部署：Mac 源码 + 5090 F 盘运行

这是官方 [ComfyArt](https://github.com/jtydhr88/ComfyArt) 的本地部署副本，保留完整前端、Python 后端、Agent、工作流、测试和许可证。

已通过前端生产构建、Mac 与 Windows 各 169 项 Python 测试、8 项前端回归测试、5090 上的 OCR、视觉 Agent 识图和画布文字编辑，以及 Z-Image Turbo 真实出图、透明抠图、四倍超分和 LaMa 局部擦除。验证记录在 `artifacts/`，源码版本记录在 `deploy/source-lock.json`。

## 打开

在 Mac 上双击本目录的 `打开ComfyArt.command`，或打开 <http://127.0.0.1:8188/comfyart/>。启动脚本会连接 SSH 别名 `5090`，启动远端服务和本地 SSH 隧道。需要 Mac 能通过当前校园网/VPN 连接该主机。

示例项目：<http://127.0.0.1:8188/comfyart/?project=c988236b>。

## 文件位置

- Mac 主源码：`/Users/yxy/开源项目/ComfyArt`；前端在 `src/`，后端在 `api/`、`bot/`，生成流程在 `workflows/`。
- Mac 引擎源码快照：`engine/ComfyUI/`，对应 ComfyUI 0.41.0 官方源码归档 `engine/comfyui-0.41.0-source.tar.gz`。旧版 0.30.0 归档仍保留用于追溯。LaMa 节点源码在 `engine/comfyui-inpaint-nodes/`，归档为 `engine/inpaint-source.tar.gz`。
- 5090 运行根目录：`F:\ComfyArt`。
- ComfyUI：`F:\ComfyArt\ComfyUI`；扩展：`custom_nodes\ComfyArt`。
- 图像及视频权重：`F:\ComfyArt\ComfyUI\models`；生成结果：`F:\ComfyArt\ComfyUI\output\comfyart`。
- 本地视觉 Agent 权重：`F:\ComfyArt\ollama\models`，独立 Ollama 端口 `11435`。
- 项目与聊天数据库：`F:\ComfyArt\ComfyUI\user\__comfyart\data.db`；素材与其他用户设置也在 `user/` 下。
- 服务日志：`F:\ComfyArt\logs`；Mac 验收记录：`artifacts/`。

运行环境复用机器已有的 Python 3.12 与 Ollama 程序；ComfyArt 使用 F 盘虚拟环境中的 PyTorch 2.11 CUDA 13.0、torchvision 0.26 和 torchaudio 2.11。原有全局 CUDA 12.8 环境保留。服务只监听远端回环地址，通过 SSH 隧道访问。

## 当前模型

图像生成使用原版 Z-Image Turbo BF16、Qwen3 4B 文本编码器与 AE；视觉设计 Agent 使用 Qwen3-VL 4B Instruct，具备图像输入和工具调用。MiniMax H3 已实测生成 512×512、56 帧、24fps 的约 2.33 秒 H.264 视频，包含音轨，冷启动完整执行约 479 秒。此为短片连通性验收，未将其当作 768p/1080p 长视频性能结论。图生视频同样通过 512×512、56 帧、带音轨的首帧图像生成测试，完整执行约 442 秒。文生视频与图生视频工作流默认使用 Turbo LoRA 的 8 步模式；视频面板另提供 512p 选项，默认仍为 768p。

画布、排版、图层、矢量、项目保存、PNG/PDF/PPTX 导出等沿用上游实现。BiRefNet 抠图、UltraSharp 四倍超分与 LaMa 橡皮擦已安装并实测，透明抠图也已从画布 MCP 工具完整执行。Qwen Image 2.1 改色、文生图和扩图已实测；扩图会验证原图中心像素保持一致。多角度和图生视频也已实测。改色、文生图、扩图、多角度、Z-Image、图生视频已在同一服务进程中连续成功执行。分层、语音、音乐、3D 及其他可选模型的安装清单见官方 `README.zh.md`；不能将源码齐全视为所有附加模型已可用。

## 开发与同步

```sh
cd /Users/yxy/开源项目/ComfyArt
npm ci
npm run build
npm run test:frontend
python3 deploy/sync.py
```

同步会上传 `F:\ComfyArt\source.zip`。首次安装或需要更新 Python 依赖时运行：

```sh
python3 deploy/remote.py deploy/bootstrap.ps1
```

安装和生成队列空闲时，仅更新扩展并重启，运行：

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

补充 `onnxruntime>=1.20`，支持 RapidOCR 的新版 ONNX 模型；Python 3.10 使用 `tomli` 读取 TOML。Windows 使用 `--disable-fast-disk --disable-pinned-memory --disable-async-offload --disable-cuda-malloc`。另在引擎 `comfy/memory_management.py` 增加 3 行补丁，使 `--disable-fast-disk` 同时绕过 aimdo 的原生文件直传路径，使用已有的 PyTorch 复制路径，保留动态显存管理。补丁位于 `deploy/patches/disable-direct-file-transfer.patch`，对应连续任务出现的 [上游 Windows 读取问题](https://github.com/Comfy-Org/comfy-aimdo/issues/61)。应用脚本先检查源码匹配并支持重复执行；`deploy/verify-engine-transfer.py` 在真实 CUDA 上确认绕过原生读入后数值仍完全一致。ComfyArt 扩展代码使用 MIT；ComfyUI 引擎与 LaMa 节点保留各自的 GPL-3.0 许可证；tldraw SDK 使用其独立许可证，原有许可证及开发模式角标均保留。

## 功能安装与检查

`deploy/feature-models.json` 固定了抠图、超分、橡皮擦、Qwen Image 2.1 和多角度模型的来源、版本、字节数与 SHA256。安装使用独立的 Windows 后台任务，SSH 断开后仍会继续。下载先写入 D 盘临时缓存，校验通过后顺序合并到 F 盘；运行时模型均在 F 盘。

```sh
python3 deploy/remote.py deploy/start-feature-install.ps1
python3 deploy/audit-workflows.py
python3 deploy/smoke-features.py cutout upscale erase
python3 deploy/smoke-features.py qwen-edit qwen-t2i outpaint angles
python3 deploy/smoke-features.py video i2v
```

安装完成后刷新 ComfyArt 页面，可更新模型菜单。检查脚本将每个工作流的缺失节点和模型写入 `artifacts/workflow-readiness.json`。功能测试会真实提交 GPU 任务并保存输出及历史；视频测试需要 Mac 的 `ffprobe`，用来验证画面尺寸、帧数和音轨。

现有旧引擎可运行 `deploy/upgrade-engine.ps1` 升级到锁定的 0.41.0。CUDA 13 运行库的官方文件与摘要记录在 `deploy/runtime-wheels.json`；`deploy/download-runtime.py` 可在 5090 下载。GPU 主机无法访问官方 CDN 时，可在 Mac 运行 `python3 deploy/fetch-runtime-mac.py`，校验后分块上传，再执行 `python3 deploy/remote.py deploy/upgrade-runtime.ps1`。升级脚本要求生成队列为空，并且只改 F 盘虚拟环境。

模型菜单现在同时检查主模型、文本编码器、VAE 与所需 LoRA；部分安装的模型不会被错误标成已安装。Agent 的模型列表也会按实际权重报告参考生视频、动作控制能力。Node 回归测试需要支持 `stripTypeScriptTypes` 的 Node 版本（本次使用 Node 25）。
