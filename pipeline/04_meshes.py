"""Stage 4: surface meshes for the 3D viewer (GLB) + 3D-printable STLs.

World frame (see web/src/lib/coords.ts):  world = (L, S, A) mm relative to the heart centroid,
i.e. world.x = lps.x - c.x,  world.y = lps.z - c.z,  world.z = -(lps.y - c.y).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from scipy import ndimage as ndi
from skimage import measure

from anatomy import CATALOG, Structure, reference_image, structure_mask
from common import DERIVED, ROOT, write_json

OUT = DERIVED / "meshes"


def hex_rgba(h: str, a: float = 1.0):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [a]


def mask_to_mesh(mask: np.ndarray, ref, center_lps, sigma: float, keep: float, max_faces: int | None = None,
                 min_component_vox: int = 30, level: float = 0.5) -> trimesh.Trimesh | None:
    if mask.sum() < min_component_vox:
        return None
    # drop specks
    lab, n = ndi.label(mask)
    if n > 1:
        sizes = ndi.sum(mask, lab, range(1, n + 1))
        mask = np.isin(lab, np.where(sizes >= min_component_vox)[0] + 1)
    zz, yy, xx = np.nonzero(mask)
    m = 4
    z0, y0, x0 = max(zz.min() - m, 0), max(yy.min() - m, 0), max(xx.min() - m, 0)
    z1, y1, x1 = zz.max() + m + 1, yy.max() + m + 1, xx.max() + m + 1
    crop = mask[z0:z1, y0:y1, x0:x1].astype(np.float32)
    crop = np.pad(crop, 2)                         # closes surfaces cut by the scan range
    if sigma > 0:
        crop = ndi.gaussian_filter(crop, sigma)
    sx, sy, sz = ref.GetSpacing()
    try:
        verts, faces, _, _ = measure.marching_cubes(crop, level=level, spacing=(sz, sy, sx))
    except (ValueError, RuntimeError):
        return None
    # (z,y,x) mm in padded crop -> voxel index -> LPS
    vz = verts[:, 0] / sz + z0 - 2
    vy = verts[:, 1] / sy + y0 - 2
    vx = verts[:, 2] / sx + x0 - 2
    D = np.array(ref.GetDirection()).reshape(3, 3)
    org = np.array(ref.GetOrigin())
    ijk_mm = np.stack([vx * sx, vy * sy, vz * sz], 1)
    lps = org + ijk_mm @ D.T
    c = np.asarray(center_lps)
    world = np.stack([lps[:, 0] - c[0], lps[:, 2] - c[2], -(lps[:, 1] - c[1])], 1)
    faces = faces[:, ::-1]                         # axis swap (z,y,x)->(x,y,z) flips handedness
    target = keep
    if max_faces and len(faces) * keep > max_faces:
        target = max_faces / len(faces)
    if target < 0.98 and len(faces) > 2000:
        world, faces = fast_simplification.simplify(world.astype(np.float32), faces.astype(np.int32), target_reduction=1 - target)
    mesh = trimesh.Trimesh(vertices=world, faces=faces, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=8)
    mesh.fix_normals()
    return mesh


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ref = reference_image()
    vox_ml = float(np.prod(ref.GetSpacing())) / 1000.0

    heart = structure_mask(next(s for s in CATALOG if s.name == "heart"))
    zz, yy, xx = np.nonzero(heart)
    ci = np.array([xx.mean(), yy.mean(), zz.mean()])
    center = ref.TransformContinuousIndexToPhysicalPoint(tuple(float(v) for v in ci))
    print("heart centroid LPS", [round(v, 2) for v in center])

    scene = trimesh.Scene()
    nodes = []
    masks = {}
    for s in CATALOG:
        m = structure_mask(s)
        vol = float(m.sum() * vox_ml)
        if vol < s.min_ml:
            continue
        masks[s.name] = m
        mesh = mask_to_mesh(m, ref, center, s.sigma, s.keep, max_faces=60000, level=s.level)
        if mesh is None or len(mesh.faces) == 0:
            continue
        mat = trimesh.visual.material.PBRMaterial(name=s.name, baseColorFactor=hex_rgba(s.color),
                                                  metallicFactor=0.0, roughnessFactor=0.55, doubleSided=False)
        mesh.visual = trimesh.visual.TextureVisuals(material=mat)
        scene.add_geometry(mesh, node_name=s.name, geom_name=s.name)
        nodes.append({"name": s.name, "display": s.display, "color": s.color, "group": s.group,
                      "triangles": int(len(mesh.faces)), "volumeML": round(vol, 1),
                      "defaultVisible": s.visible, "defaultOpacity": s.opacity, "source": s.source})
        print(f"  {s.name:26s} {vol:8.1f} mL  {len(mesh.faces):7d} tris")

    raw = OUT / "anatomy_raw.glb"
    raw.write_bytes(trimesh.exchange.gltf.export_glb(scene, include_normals=True))   # smooth shading out of the box
    out = OUT / "anatomy.glb"
    cmd = ["npx", "-y", "@gltf-transform/cli@4.5.1", "meshopt", str(raw), str(out), "--level", "medium"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("gltf-transform failed, using uncompressed GLB:\n", r.stderr[-2000:])
        out.write_bytes(raw.read_bytes())
    print("glb", raw.stat().st_size // 1024, "KB ->", out.stat().st_size // 1024, "KB")

    # ---------- 3D-printable STLs (watertight, millimetres, Y = up) ----------
    groups = {
        "heart": ["heart_myocardium", "heart_ventricle_left", "heart_ventricle_right", "heart_atrium_left",
                  "heart_atrium_right", "atrial_appendage_left", "aorta", "pulmonary_artery", "pulmonary_vein",
                  "superior_vena_cava", "inferior_vena_cava"],
        "ribcage": [s.name for s in CATALOG if s.group == "bones" and s.name not in ("spinal_cord", "scapula_left", "scapula_right")],
        "lungs_airways": [s.name for s in CATALOG if s.group == "lungs"] + ["trachea", "lung_airways"],
    }
    stl_meta = []
    for g, names in groups.items():
        m = np.zeros_like(heart)
        for n in names:
            if n in masks:
                m |= masks[n]
        if g == "heart":   # fill small gaps between chambers so the print is one solid
            m = ndi.binary_closing(m, structure=np.ones((3, 3, 3)), iterations=2)
            m = ndi.binary_fill_holes(m)
        mesh = mask_to_mesh(m, ref, center, sigma=1.0, keep=1.0, max_faces=180000, min_component_vox=400)
        if mesh is None:
            continue
        p = OUT / f"print_{g}.stl"
        mesh.export(str(p))
        ext = mesh.bounding_box.extents
        stl_meta.append({"name": g, "file": p.name, "bytes": p.stat().st_size, "triangles": int(len(mesh.faces)),
                         "watertight": bool(mesh.is_watertight), "sizeMM": [round(float(e), 1) for e in ext]})
        print(f"  STL {g}: {len(mesh.faces)} tris, watertight={mesh.is_watertight}, size {ext.round(1)} mm")

    write_json(OUT / "meshes.json", {"worldCenterLPS": [round(v, 3) for v in center], "nodes": nodes, "stl": stl_meta})


if __name__ == "__main__":
    main()
