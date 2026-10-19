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

部署保留约 8GB 额外显存余量，使用 NVML 跟踪同机其他程序的占用。设计 Agent 在工具轮次之间短暂保留模型 30 秒，在图像、视频生成前显式释放本服务的 Ollama 模型，ComfyUI 关闭节点缓存，便于两个服务和原有 GPU 服务共存。机械 F 盘加载大模型较慢。

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

## 本地中文剧情配音

新增独立的 Qwen3-TTS CustomVoice 配音脚本。运行时与 4.5GB 权重放在 `F:\ComfyArt\speech`，Mac 保留脚本、模型来源与校验摘要。语音虚拟环境复用 F 盘 CUDA 13 Torch，单独安装 Transformers 4.57.3 等依赖，不替换 ComfyUI 主环境。安装和大权重下载应在 GPU 队列空闲时执行。

```sh
scp deploy/install-speech-runtime.py deploy/story-speech.py deploy/download-speech-model.py deploy/download_models.py deploy/speech-model.json 5090:F:/ComfyArt/scripts/
python3 deploy/remote.py deploy/setup-story-speech.ps1
```

在远端运行 `F:\ComfyArt\scripts\download-speech-model.py` 完成权重下载；它会校验官方 Hugging Face 修订与 ModelScope 镜像的 SHA256。模型固定为 `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` 的 `0c0e3051f131929182e2c023b9537f8b1c68adfe`，代码与权重依照其 Apache-2.0 许可证。官方说明见 <https://github.com/QwenLM/Qwen3-TTS>。

`deploy/story-speech.py` 接受 `--story` JSON 与 `--output` 目录；JSON 的 `narration` 是包含 `id`、`text`、`tone` 的列表。使用模型预置的 `Uncle_Fu` 中文男声、SDPA 和离线权重，逐段输出 WAV 与带时长的 `voice-manifest.json`。`deploy/run-story-speech.ps1` 是本次故事的调用示例。已实际生成九段、约 79 秒中文旁白。

这是独立的短片配音流水线；原有 Kokoro 和 IndexTTS 画布工作流仍按各自依赖报告安装状态。电影素材与剪辑程序保存在 Mac 的 `artifacts/story-eleventh-light-v2/`，没有替换上一版预告片。

完整配音短片已实测生成：8 个原生 960×544 动态镜头，经慢动作插帧、调色、中文字幕和声效混音输出为 1920×1080、87.75 秒 MP4。画布素材和文件导入统一使用 100 MiB 上限，与 ComfyUI 默认上传限制一致，避免其默认 10 MiB 校验拦截正常成片。

## Agent 对话与直接生成

“图像 / 视频”模式直接使用输入文字作生成提示词；Agent 模式会读取对话和所选技能，再调用工具。选择技能或携带文档会使用 Agent；“继续 / 确认 / go ahead”等简短回复也会接回 Agent，避免将确认词当作画面描述。后续对话会保留原始需求和已读取的技能要求；误提交的确认词出图和未执行工具的虚假完成记录不会作为已完成设计回放。

本地 Agent 对已选技能的执行增加了空转检查：没有创建交付物时最多纠正两次，仍不调用工具则明确报错，不将纯文字承诺标为设计完成。这只验证执行行为，不能保证品牌审美、人物一致性或完整多步设计质量；当前 4B 本地模型仍需按具体任务验收。

海报技能另要求实际调用 3:4 图像生成、等待成功并查看对应结果，方框和圆点不再满足完成条件；这项检查覆盖生成流程，主题与审美仍需看图验收。受管 Ollama 尚无已加载模型时，冷启动前检查本服务生成队列，空闲才释放 Comfy 缓存，减少两套模型争用资源导致的 CPU 回退。遇到模型内存分配错误时，只重试当前 LLM 请求一次，生成工具不会因此重复提交；仅在本服务生成队列空闲时请求释放本服务的缓存模型，不会结束其他 GPU 程序。仍失败时显示明确错误。

### 长剧本视频制作

直接点击画布顶栏固定的“视频工作台”，无需切换 Agent 模式。左侧选择“剧本与设置”，粘贴剧本并拆分；输入区的视频模式发送多镜头剧本也会打开同一工作台。原稿完整保留，镜头按顺序拆分，`【旁白】` 后的文本可单独编辑。画面、时长和旁白应在生成前检查；自动拆分不等于导演级分镜或跨镜头角色锁定。

默认 384p 为低成本预览，每镜头 5 秒，可选其他尺寸与 10/15 秒。镜头顺序生成，任务 ID、结果地址和合成 ID 保存到当前项目，支持当前镜头结束后暂停、刷新后恢复、失败镜头重试。已完成镜头不会重跑。批次最多 60 镜头，超限时要求分批，原文不会静默截断。完整剧集仍需扩充分镜和对白节奏；5 秒镜头不会标为六分钟一集。

全镜头完成后，后端调用已安装的 `F:\ComfyArt\speech` Qwen3-TTS 环境生成逐镜中文旁白，按旁白时长放慢对应原生镜头，混合原视频环境声，烧录中文字幕后输出 MP4。没有旁白文本的镜头保留原声。界面明确显示原生镜头总时长与最终成片时长；多角色对白尚不自动分配音色。可关闭旁白生成只保留环境声的版本。合成由后端异步任务执行，刷新页面不会重复启动配音。

视频任务提交前只释放本 ComfyUI 空闲模型缓存与本项目受管 Ollama；有排队/运行任务时不干扰现有队列。当前 Windows / CUDA 运行组合保留 DynamicVRAM，显式预留 8GB 显存余量，并进行本项目模型资源交接，不结束同机其他 GPU 服务。此设置需要在 GPU 队列空闲时重启本项目生效。

视频模型可使用可选 SSD 缓存：`python deploy/cache-video-models.py --cache D:\ComfyArtCache\video`。脚本逐文件 SHA-256 校验，保留 F 盘原件，写入 `F:\ComfyArt\comfyart-video-cache.yaml`；本项目启动脚本只在该配置存在时优先读取缓存，不改动其他项目的模型路径。删除或移走此配置并重启本项目即可恢复 F 盘读取。缓存文件与进度文件都不包含 SSH 凭据。

工作台顶部固定显示已完成镜头数、当前节点阶段、采样步数、镜头用时与最近服务响应时间。加载和解码没有实际百分比时显示步骤，不估造进度。左侧可切换各镜头并预览、下载；“只生成下一个镜头”便于逐镜验收。收起工作台不会卸载制作任务，顶栏继续显示阶段；页面仍须保持打开，刷新后点击继续会接回已保存任务。

镜头提交前生成并保存客户端 UUID，提交响应丢失时只查询同一个编号；GET 轮询断线自动重连，未确认终止前不清空任务编号。服务重启丢失运行记录时明确提示重试当前镜头，保留已有视频。配音合成也使用客户端 UUID 和内容校验防止重复启动，并显示已完成旁白段数及混音、拼接、字幕导出步骤。

本项目 Windows 后台任务在异常退出后按一分钟间隔最多尝试重启三次。恢复后，工作台会识别已丢失的运行记录并提示重试该镜头；不会自动重新提交不确定的生成任务。正常手动停止不触发任务重试。

### 六分钟第一集漫剧

`productions/cellar-episode-01/` 保留用户第一集原稿、扩写后的 34 段旁白及对白、人物设定和六场景画面规范。`deploy/render-comic-episode.py` 在 5090 独立后台任务中按顺序生成剧情漫画、分角色中文配音、六段关键动作动画，再调用 `deploy/render-comic-timeline.py` 合成一集。工作台通过短连接 JSON 接口读取进度，读完立即关闭文件，避免 Windows 视频文件服务持有句柄时阻止原子替换；写入端对短暂文件占用进行有限重试。收起和刷新页面不会重复提交。

在 5090 上运行 `deploy/start-comic-episode.ps1`，一次启动整集流程。`-Phase images` 用于先做画面验收，`-RegisterOnly` 更新任务定义而不启动。后台任务名为 `ComfyArt-Episode-cellar-episode-01`，暂停和继续只针对这个任务。ComfyUI 连接中断时保留任务编号，确认运行记录丢失后只重试缺失素材一次，不结束同机其他 GPU 程序。`F:\ComfyArt\ComfyUI\output\comfyart\cellar-episode-01` 保存画面、动画、逐段 WAV、字幕、完整成片及验证记录。

本集目标为 720×1280、24fps、360 秒，采用动态漫画：六段约 10 秒的原生图生动画与剧情插画的镜头推拉结合。图生动画不会整体拉长到六分钟；其余时长由漫画对白、旁白及悬疑节奏组织。角色使用本地 Qwen3-TTS 预置音色，字幕跟随各段实际语音时长；对白改变时会验证文本与音色后重做相应声音。日本语风格的无歌词哼唱为本地合成。原稿情节中的伤害以离画声音、监控远景和遗留物表达，不制作露骨画面。

关键动作按一场一个 GPU 请求依次生成，避免同批多个条件编码叠加内存。`worker.out.log` / `worker.err.log` 记录独立进程退出信息，后台包装脚本会把异常退出转成可见失败状态。配音全部缓存命中时不会加载语音模型。`--illustrated-only` 可单独导出明确标注的 `illustrated.mp4` 配音动态漫画预览；它不冒充原生人物动作，工作台将预览和最终动作版区分展示。
