#!/usr/bin/env python3
"""Buat fixture glTF milik sendiri untuk uji impor UCF Tahap 1.

Tanpa aset pihak ketiga: geometri kotak dibuat di sini, lisensi milik proyek.
Keluaran:
  test-assets/box-tanpa-rig.gltf          — kotak 0,40 x 0,90 x 0,30 m, 1 material, tanpa rig
  test-assets/ekstensi-tak-didukung.gltf  — kotak dengan ekstensi yang tidak didukung
"""
import base64
import json
import os
import struct

OUT = os.path.join(os.path.dirname(__file__), "..", "test-assets")
os.makedirs(OUT, exist_ok=True)


def box_geometry(sx, sy, sz):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [
        ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)]),
        ((1, 0, 0), [(hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)]),
        ((-1, 0, 0), [(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)]),
        ((0, 1, 0), [(-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)]),
        ((0, -1, 0), [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)]),
    ]
    positions, normals, indices = [], [], []
    for normal, quad in faces:
        base = len(positions) // 3
        for vertex in quad:
            positions.extend(vertex)
            normals.extend(normal)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, normals, indices


def write_gltf(path, sx, sy, sz, material, extra_used=(), description=""):
    positions, normals, indices = box_geometry(sx, sy, sz)
    pos_bytes = struct.pack(f"<{len(positions)}f", *positions)
    nrm_bytes = struct.pack(f"<{len(normals)}f", *normals)
    idx_bytes = struct.pack(f"<{len(indices)}H", *indices)
    # jaga alignment 4 byte antar accessor
    pad = (-len(idx_bytes)) % 4
    blob = pos_bytes + nrm_bytes + idx_bytes + b"\x00" * pad

    doc = {
        "asset": {"version": "2.0", "generator": "UCF Tahap 1 fixture generator", "copyright": "UCF project"},
        "scene": 0,
        "scenes": [{"name": "Scene", "nodes": [0]}],
        "nodes": [{"name": description or "Kotak Uji", "mesh": 0}],
        "meshes": [
            {
                "name": "Kotak",
                "primitives": [
                    {"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}
                ],
            }
        ],
        "materials": [material],
        "buffers": [
            {
                "byteLength": len(blob),
                "uri": "data:application/octet-stream;base64," + base64.b64encode(blob).decode("ascii"),
            }
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes), "byteLength": len(nrm_bytes), "target": 34962},
            {
                "buffer": 0,
                "byteOffset": len(pos_bytes) + len(nrm_bytes),
                "byteLength": len(idx_bytes),
                "target": 34963,
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions) // 3,
                "type": "VEC3",
                "min": [-sx / 2, -sy / 2, -sz / 2],
                "max": [sx / 2, sy / 2, sz / 2],
            },
            {"bufferView": 1, "componentType": 5126, "count": len(normals) // 3, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
    }
    if extra_used:
        doc["extensionsUsed"] = list(extra_used)

    with open(path, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=1)
    print(f"{os.path.relpath(path)}: {os.path.getsize(path)} byte, {len(indices) // 3} segitiga")


write_gltf(
    os.path.join(OUT, "box-tanpa-rig.gltf"),
    0.40,
    0.90,
    0.30,
    {
        "name": "Baja_Biru",
        "pbrMetallicRoughness": {
            "baseColorFactor": [0.16, 0.55, 0.82, 1.0],
            "metallicFactor": 0.15,
            "roughnessFactor": 0.55,
        },
    },
    description="Kotak Tanpa Rig",
)

write_gltf(
    os.path.join(OUT, "ekstensi-tak-didukung.gltf"),
    0.5,
    0.5,
    0.5,
    {
        "name": "Material_Fallback",
        "pbrMetallicRoughness": {
            "baseColorFactor": [0.85, 0.55, 0.2, 1.0],
            "metallicFactor": 0.0,
            "roughnessFactor": 0.7,
        },
    },
    extra_used=["KHR_materials_pbrSpecularGlossiness", "KHR_texture_basisu"],
    description="Kotak Ekstensi Uji",
)
