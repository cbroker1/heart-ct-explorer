"""Stage 5: build everything the web app loads, under web/public/data/.

Binary grids: little-endian arrays (x fastest), optionally byte-shuffled (all low bytes, then
all high bytes; better compression), then gzip. See web/src/lib/data.ts for the reader.
Voxels outside the (dilated) body are set to -1024 HU: air/table noise compresses badly and
carries no anatomy.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import shutil
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from scipy import ndimage as ndi

from anatomy import CATALOG, reference_image, structure_mask
from common import DERIVED, NIFTI, SEG, WEB_PUBLIC, resample_like, write_json

VOL_DIR = WEB_PUBLIC / "vol"

VOLUMES = [
    # key, label, blurb, group, window
    ("calcium", "Calcium score", "The heart-only, ECG-gated scan used for calcium scoring: 3 mm slices every 1.5 mm, 0.31 mm pixels.", "heart", (200, 600)),
    ("axial_st", "Chest · soft tissue", "Axial slices across the whole scanned slab (3 mm, 39 cm field of view) with a smooth soft-tissue kernel: best for heart, vessels, mediastinum.", "chest", (40, 400)),
    ("axial_lung", "Chest · lung", "Same slices, sharp lung kernel: crisp lung detail.", "lung", (-600, 1500)),
    ("thin_lung", "Thin lung (1.5 mm)", "Thin 1.5 mm slices every 0.75 mm: the sharpest 3D detail; the 3D model was built from this.", "lung", (-600, 1500)),
    ("axial_lung_mip", "Lung MIP (10 mm)", "Maximum-intensity projection slabs: vessels look like branching tubes, nodules like dots.", "lung", (-600, 1200)),
    ("cr_vessel_suppress", "AI vessel-suppressed", "Riverain ClearRead CT software digitally removes the blood vessels so small lung nodules are easier to spot. It flagged none; the AI second read found one ~3 mm speck, too small to need follow-up.", "ai", (-600, 1200)),
    ("cor_st", "Coronal (radiologist)", "The scanner's own coronal soft-tissue reformats (4 mm), downsampled 2x for the web.", "chest", (40, 400)),
    ("sag_st", "Sagittal (radiologist)", "The scanner's own sagittal soft-tissue reformats (4 mm), downsampled 2x for the web.", "chest", (40, 400)),
]
DOWNSAMPLE_XY = {"cor_st": 2, "sag_st": 2}


def write_grid(arr: np.ndarray, img: sitk.Image, rel: str, dtype: str, shuffle: bool) -> dict:
    """arr is (z,y,x). Writes gzip(LE bytes [shuffled]) and returns GridMeta (without UI fields)."""
    path = WEB_PUBLIC / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    np_dtype = {"int16": "<i2", "uint8": "u1", "uint16": "<u2"}[dtype]
    raw = np.ascontiguousarray(arr.astype(np_dtype)).tobytes()
    if shuffle and np.dtype(np_dtype).itemsize == 2:
        raw = np.frombuffer(raw, np.uint8).reshape(-1, 2).T.copy().tobytes()
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(raw)
    nz, ny, nx = arr.shape
    return {
        "file": rel, "bytes": path.stat().st_size, "rawBytes": len(raw), "dtype": dtype,
        "shuffle": bool(shuffle and np.dtype(np_dtype).itemsize == 2),
        "dims": [int(nx), int(ny), int(nz)],
        "spacing": [float(s) for s in img.GetSpacing()],
        "origin": [float(o) for o in img.GetOrigin()],
        "direction": [float(d) for d in img.GetDirection()],
    }


def body_mask_like(img: sitk.Image) -> np.ndarray:
    body = sitk.ReadImage(str(SEG / "body.nii.gz"))
    m = sitk.GetArrayFromImage(resample_like(body, img)) > 0
    r = max(1, int(round(4.0 / img.GetSpacing()[0])))
    return ndi.binary_dilation(m, structure=np.ones((1, 3, 3)), iterations=r)


def downsample_xy(img: sitk.Image, f: int) -> sitk.Image:
    """Average-pool by f in-plane (x,y), keeping geometry consistent."""
    a = sitk.GetArrayFromImage(img).astype(np.float32)
    nz, ny, nx = a.shape
    ny2, nx2 = ny // f, nx // f
    a = a[:, : ny2 * f, : nx2 * f].reshape(nz, ny2, f, nx2, f).mean((2, 4))
    out = sitk.GetImageFromArray(np.rint(a).astype(np.int16))
    sx, sy, sz = img.GetSpacing()
    D = np.array(img.GetDirection()).reshape(3, 3)
    # new voxel centre (0,0) sits at the centre of the old f x f block
    shift = D @ np.array([(f - 1) / 2 * sx, (f - 1) / 2 * sy, 0.0])
    out.SetSpacing((sx * f, sy * f, sz))
    out.SetOrigin(tuple(np.array(img.GetOrigin()) + shift))
    out.SetDirection(img.GetDirection())
    return out


def to_u8(hu: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip(np.rint((hu - lo) / (hi - lo) * 255.0), 0, 255).astype(np.uint8)


def main():
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    exam = json.loads((DERIVED / "exam.json").read_text())
    meshes = json.loads((DERIVED / "meshes" / "meshes.json").read_text())
    center = meshes["worldCenterLPS"]

    # ---------- slice-viewer volumes ----------
    vols = []
    for key, label, blurb, group, win in VOLUMES:
        img = sitk.ReadImage(str(NIFTI / f"{key}.nii.gz"))
        if key in DOWNSAMPLE_XY:
            img = downsample_xy(img, DOWNSAMPLE_XY[key])
        a = sitk.GetArrayFromImage(img).astype(np.int16)
        a[~body_mask_like(img)] = -1024
        meta = write_grid(a, img, f"vol/{key}.i16.gz", "int16", shuffle=True)
        sm = exam["series"][key]
        meta.update({"key": key, "label": label, "description": sm["description"], "blurb": blurb,
                     "kernel": sm["kernel"], "sliceThickness": sm["sliceThickness"], "kvp": sm["kvp"],
                     "defaultWindow": list(win), "group": group})
        vols.append(meta)
        print(f"  {key:20s} {meta['dims']} {meta['bytes'] / 1e6:6.1f} MB")

    # ---------- merged anatomy labels on the thin_lung grid ----------
    ref = reference_image()
    lab = np.zeros(sitk.GetArrayFromImage(ref).shape, np.uint8)
    vox_ml = float(np.prod(ref.GetSpacing())) / 1000.0
    classes = []
    nid = 0
    for s in CATALOG:
        if s.name in ("heart",):         # whole-heart is replaced by chambers in the label map
            continue
        m = structure_mask(s)
        if m.sum() * vox_ml < s.min_ml:
            continue
        nid += 1
        lab[m] = nid
        classes.append({"id": nid, "name": s.name, "display": s.display, "color": s.color, "group": s.group,
                        "volumeML": round(float(m.sum() * vox_ml), 1), "source": s.source})
    # voxels of v2 'heart' not covered by v1 chambers -> keep as 'heart' (other cardiac tissue)
    heart_s = next(s for s in CATALOG if s.name == "heart")
    hm = structure_mask(heart_s) & (lab == 0)
    if hm.sum():
        nid += 1
        lab[hm] = nid
        classes.append({"id": nid, "name": "heart", "display": "Heart (other)", "color": heart_s.color, "group": "heart",
                        "volumeML": round(float(hm.sum() * vox_ml), 1), "source": "total"})
    # volumeML = the whole structure's AI volume (same number as the 3D model and the reports), even where a
    # more specific label is painted on top in the merged grid; paintedML = what is visible in that grid.
    for c in classes:
        c["paintedML"] = round(float((lab == c["id"]).sum() * vox_ml), 1)
    labels_meta = write_grid(lab, ref, "vol/labels.u8.gz", "uint8", shuffle=False)
    labels_meta["classes"] = classes
    print(f"  labels: {len(classes)} classes, {labels_meta['bytes'] / 1e6:.1f} MB")

    # ---------- volume-rendering grids ----------
    thin = sitk.ReadImage(str(NIFTI / "thin_lung.nii.gz"))
    a = sitk.GetArrayFromImage(thin).astype(np.float32)
    a[~body_mask_like(thin)] = -1024
    a = ndi.gaussian_filter(a, sigma=(0.9, 0.7, 0.7))       # tame the sharp lung kernel
    small = sitk.GetImageFromArray(a)
    small.CopyInformation(thin)
    small = downsample_xy(small, 2)
    HU_LO, HU_HI = -1024.0, 1976.0
    ra = sitk.GetArrayFromImage(small)
    render_meta = write_grid(to_u8(ra, HU_LO, HU_HI), small, "vol/render.u8.gz", "uint8", shuffle=False)
    render_meta.update({"huMin": HU_LO, "huMax": HU_HI})
    rl = sitk.GetArrayFromImage(sitk.Resample(_with_info(lab, ref), small, sitk.Transform(),
                                              sitk.sitkNearestNeighbor, 0, sitk.sitkUInt8))
    rlabels_meta = write_grid(rl, small, "vol/render_labels.u8.gz", "uint8", shuffle=False)
    rlabels_meta["classes"] = classes
    print(f"  render {render_meta['dims']} {render_meta['bytes'] / 1e6:.1f} MB; labels {rlabels_meta['bytes'] / 1e6:.1f} MB")

    ca = sitk.ReadImage(str(NIFTI / "calcium.nii.gz"))
    c = sitk.GetArrayFromImage(ca).astype(np.float32)
    c = ndi.gaussian_filter(c, sigma=(0.5, 1.0, 1.0))
    cimg = sitk.GetImageFromArray(c); cimg.CopyInformation(ca)
    csmall = downsample_xy(cimg, 2)
    heart_meta = write_grid(to_u8(sitk.GetArrayFromImage(csmall).astype(np.float32), HU_LO, HU_HI), csmall,
                            "vol/heart_render.u8.gz", "uint8", shuffle=False)
    heart_meta.update({"huMin": HU_LO, "huMax": HU_HI})

    # ---------- calcium candidate labels ----------
    lesions_meta = None
    cal_json = DERIVED / "calcium" / "calcium.json"
    cand_nii = DERIVED / "calcium" / "candidates_labels.nii.gz"
    if cal_json.exists() and cand_nii.exists():
        cal = json.loads(cal_json.read_text())
        cimg = sitk.ReadImage(str(cand_nii))
        lesions_meta = write_grid(sitk.GetArrayFromImage(cimg).astype(np.uint8), cimg, "vol/calcium_candidates.u8.gz", "uint8", shuffle=False)
        colors = {"coronary": "#ff3b30", "aortic": "#ff9f0a", "valvular": "#bf5af2", "noise": "#64d2ff",
                  "noise-artifact": "#64d2ff", "review": "#ffd60a", "bone": "#e5e5ea", "other": "#a1a1aa"}
        lesions_meta["classes"] = [{"id": int(cd["id"]), "name": f"cand_{cd['id']}", "display": f"Candidate #{cd['id']}",
                                    "color": colors.get(cd.get("finalClass", cd.get("ruleClass")), "#ffd60a"),
                                    "group": cd.get("finalClass", cd.get("ruleClass"))} for cd in cal["candidates"]]
        shutil.copy(cal_json, WEB_PUBLIC / "calcium.json")
        thumbs = WEB_PUBLIC / "calcium_thumbs"
        thumbs.mkdir(exist_ok=True)
        for p in (DERIVED / "calcium" / "review").glob("thumb_*.png"):
            shutil.copy(p, thumbs / p.name)
        for p in (DERIVED / "calcium" / "review").glob("cand_*.png"):
            shutil.copy(p, thumbs / p.name)

    # ---------- meshes, STLs, misc ----------
    (WEB_PUBLIC / "mesh").mkdir(exist_ok=True)
    glb = DERIVED / "meshes" / "anatomy.glb"
    shutil.copy(glb, WEB_PUBLIC / "mesh" / "anatomy.glb")
    shutil.copy(DERIVED / "meshes" / "heart.glb", WEB_PUBLIC / "mesh" / "heart.glb")
    stl_files = {}
    for s in meshes["stl"]:
        shutil.copy(DERIVED / "meshes" / s["file"], WEB_PUBLIC / "mesh" / s["file"])
        stl_files[f"stl_{s['name']}"] = f"mesh/{s['file']}"
    for p in ["topogram_ap.png", "topogram_lat.png"]:
        shutil.copy(DERIVED / p, WEB_PUBLIC / p)
    files = {"exam": "exam.json", "topogramAP": "topogram_ap.png", "topogramLat": "topogram_lat.png", **stl_files}
    if (WEB_PUBLIC / "calcium.json").exists():
        files["calcium"] = "calcium.json"
    for extra in ["read.json", "biomarkers.json", "ecg.json"]:
        if (WEB_PUBLIC / extra).exists():
            files[extra.split(".")[0]] = extra
    if (WEB_PUBLIC / "mesh" / "heart_ar.glb").exists():
        files["heartAR"] = "mesh/heart_ar.glb"

    # de-identified exam summary for the UI
    ex = dict(exam)
    ex["series"] = {k: {kk: vv for kk, vv in v.items() if kk not in ("folder",)} for k, v in exam["series"].items()}
    ex["stl"] = meshes["stl"]
    # scan range rows on each topogram (for the "where was I scanned" overlay)
    tl = next(v for v in vols if v["key"] == "thin_lung")
    z_bot = tl["origin"][2]
    z_top = z_bot + (tl["dims"][2] - 1) * tl["spacing"][2]
    for t in ex["topograms"].values():
        r0 = t["crop"][0]
        pos_z = t["position"][2]
        rs = t["pixelSpacing"][0]
        t["scanRangeRows"] = [round((pos_z - z_top) / rs - r0, 1), round((pos_z - z_bot) / rs - r0, 1)]
    write_json(WEB_PUBLIC / "exam.json", ex)

    exam_small = {k: v for k, v in exam["exam"].items()}
    manifest = {
        "version": 1,
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "title": "Heart CT Explorer",
        "exam": exam_small,
        "worldCenterLPS": center,
        "volumes": vols,
        "labels": labels_meta,
        "lesions": lesions_meta,
        "render": render_meta,
        "renderLabels": rlabels_meta,
        "heartRender": heart_meta,
        "meshes": {"file": "mesh/anatomy.glb", "bytes": (WEB_PUBLIC / "mesh" / "anatomy.glb").stat().st_size,
                   "heartFile": "mesh/heart.glb", "heartBytes": (WEB_PUBLIC / "mesh" / "heart.glb").stat().st_size,
                   "nodes": meshes["nodes"]},
        "files": files,
    }
    write_json(WEB_PUBLIC / "manifest.json", manifest)
    total = sum(p.stat().st_size for p in WEB_PUBLIC.rglob("*") if p.is_file())
    print(f"manifest written; public/data total {total / 1e6:.1f} MB")


def _with_info(arr: np.ndarray, ref: sitk.Image) -> sitk.Image:
    img = sitk.GetImageFromArray(arr)
    img.CopyInformation(ref)
    return img


if __name__ == "__main__":
    main()
