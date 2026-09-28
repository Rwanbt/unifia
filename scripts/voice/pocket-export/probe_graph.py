"""Probe the exported flow_lm_main graph to locate the source of AR divergence.

The text-conditioning pass is bit-exact after the monkeypatch fix, so the
KV-cache *write* is correct. Only the autoregressive step still diverges
(~5e-3 relative). Two candidate causes:

  A. the graph computes the transformer in reduced precision, so fp16
     accumulation across 6 layers explains the residual; or
  B. a single attention/mask op is subtly different, which would show up as a
     structural difference rather than a uniform precision floor.

This reports the declared graph dtypes and the dtype of every initializer, so
the two cases can be told apart from the artifact itself.
"""

import sys
from collections import Counter

import onnx
from onnx import numpy_helper

PATH = sys.argv[1] if len(sys.argv) > 1 else r"D:\App\unifia\voice-runtime\.build-temp\pocket-export\models-en2\flow_lm_main.onnx"

model = onnx.load(PATH, load_external_data=False)

print(f"=== {PATH}")
print(f"ir_version={model.ir_version} opsets="
      f"{[(o.domain or 'ai.onnx', o.version) for o in model.opset_import]}")

print("\n--- graph inputs ---")
for value in model.graph.input:
    tt = value.type.tensor_type
    dims = [d.dim_value or d.dim_param for d in tt.shape.dim]
    print(f"  {value.name:22s} elem={onnx.TensorProto.DataType.Name(tt.elem_type):8s} {dims}")

print("\n--- graph outputs ---")
for value in model.graph.output:
    tt = value.type.tensor_type
    dims = [d.dim_value or d.dim_param for d in tt.shape.dim]
    print(f"  {value.name:22s} elem={onnx.TensorProto.DataType.Name(tt.elem_type):8s} {dims}")

init_counts = Counter()
fp16_inits = []
for tensor in model.graph.initializer:
    name = onnx.TensorProto.DataType.Name(tensor.data_type)
    init_counts[name] += 1
    if tensor.data_type == onnx.TensorProto.FLOAT16:
        fp16_inits.append(tensor.name)

print(f"\n--- initializers ({sum(init_counts.values())} total) ---")
for dtype, count in init_counts.most_common():
    print(f"  {dtype:8s} {count}")
if fp16_inits:
    print(f"  fp16 initializer sample: {fp16_inits[:6]}")

ops = Counter(node.op_type for node in model.graph.node)
print(f"\n--- top operators ({len(model.graph.node)} nodes) ---")
for op, count in ops.most_common(14):
    print(f"  {op:18s} {count}")

cast_nodes = [n for n in model.graph.node if n.op_type == "Cast"]
to_fp16 = [n for n in cast_nodes
           if any(a.i == 10 for a in n.attribute if a.name == "to")]
print(f"\n--- precision casts ---")
print(f"  Cast nodes: {len(cast_nodes)}")
print(f"  casts TO fp16: {len(to_fp16)}")
for node in to_fp16[:8]:
    print(f"    {node.name or node.output[0][:40]}")
