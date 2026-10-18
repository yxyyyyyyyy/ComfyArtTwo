"""Verify the engine's safe transfer path on the real Windows CUDA runtime."""
import sys
import threading
from pathlib import Path
from unittest.mock import patch

import torch

sys.path.insert(0, str(Path(r"F:\ComfyArt\ComfyUI")))
import comfy.memory_management as memory
import comfy.model_management as models
from comfy.cli_args import args

source = torch.tensor([1.25, -2.5, 3.75], dtype=torch.float32)
source.untyped_storage()._comfy_tensor_file_slice = memory.TensorFileSlice(
    object(), threading.Lock(), 0, source.numel() * source.element_size())
destination = torch.empty_like(source, device="cuda")
args.disable_fast_disk = True
with patch("comfy_aimdo.host_buffer.read_file_to_device", side_effect=AssertionError("Native file reader must not run")):
    assert memory.read_tensor_file_slice_into(source, None, destination2=destination) is False
    models.cast_to_gathered([source], None, r2=destination.view(torch.uint8))
torch.testing.assert_close(destination.cpu(), source, rtol=0, atol=0)
print("Direct file reader bypassed; the real CUDA fallback preserved tensor values exactly")
