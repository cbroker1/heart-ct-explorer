"""Review toolkit used by the AI "second read" reviewers (and handy for humans too).

    import sys; sys.path.insert(0, "<repo>/pipeline"); import review_tools as rt
    rt.series()                                   # list available series + geometry
    v = rt.vol("axial_lung")                      # Volume (HU array z,y,x + geometry)
    rt.render("axial_lung", plane="axial", index=23, window="lung", out="/tmp/x.png")
    rt.montage("axial_lung", plane="axial", indices=range(0, 46, 3), window="lung", out=...)
    rt.roi_stats("axial_st", center_lps=(x, y, z), radius_mm=5)
    rt.label_at((x, y, z))                        # anatomy labels at an LPS point
    rt.mask("aorta", like="axial_st")             # boolean mask on any series grid
    rt.diameters("aorta", "axial_st", index=13)   # cross-section metrics of a structure

Coordinates are DICOM LPS millimetres (+x patient Left, +y Posterior, +z Superior).
Arrays are (z, y, x) = (slice, row, column). Axial images are shown radiologically:
patient right on image left, anterior at top.
"""
from __future__ import annotations

import functools
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import SimpleITK as sitk
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
NIFTI = ROOT / "data" / "nifti"
SEG = ROOT / "data" / "seg"

WINDOWS = {  # name: (center, width)
    "soft": (40, 400), "mediastinum": (50, 350), "lung": (-600, 1500), "lung_narrow": (-700, 1000),
    "bone": (500, 2000), "calcium": (200, 600), "liver": (60, 160), "fat": (-100, 300),
    "emphysema": (-900, 300), "brain_like": (40, 80),
}

SERIES_INFO = {
    "calcium": "CALCIUM SCORE: 3 mm slices every 1.5 mm, 0.31 mm pixels, heart-only 158 mm FOV, Sa36d kernel",
    "axial_st": "AXIAL ST WO: 3 mm soft-tissue (Br40d), full chest width, 0.56 mm pixels",
    "axial_lung": "AXIAL LUNG WO: 3 mm lung kernel (Bl64d), full chest width",
    "thin_lung": "SURG PLANNING LUNG: 1.5 mm slices every 0.75 mm, lung kernel (sharp, noisy in soft tissue)",
    "axial_lung_mip": "AXIAL LUNG MIP: 10 mm maximum-intensity-projection slabs every 2 mm (nodule hunting)",
    "cr_vessel_suppress": "ClearRead CT vessel-suppressed version of thin_lung (vessels removed; nodules stand out)",
    "cor_st": "COR ST WO: 4 mm coronal soft-tissue reformats every 2 mm, 0.27 mm pixels",
    "sag_st": "SAG ST WO: 4 mm sagittal soft-tissue reformats every 2 mm, 0.27 mm pixels",
}

# TotalSegmentator label files available on the thin_lung grid.
SEG_FILES = {
    "total": "total.nii.gz",                # v2: organs, bones, vessels (117 classes)
    "total_v1": "total_v1_full.nii.gz",     # v1: adds heart chambers + pulmonary artery
    "trunk_cavities": "trunk_cavities.nii.gz",  # pericardium, mediastinum, thoracic cavity
    "lung_vessels": "lung_vessels.nii.gz",  # airways, airway wall, lung arteries/veins
    "body": "body.nii.gz",
    "vertebrae_body": "vertebrae_body.nii.gz",
}


@dataclass
class Volume:
    key: str
    hu: np.ndarray            # (z, y, x) float32 HU
    img: sitk.Image

    @property
    def spacing(self):  # (sx, sy, sz) mm
        return self.img.GetSpacing()

    def lps(self, i: float, j: float, k: float):
        """voxel (x=i, y=j, z=k) -> LPS mm"""
        return self.img.TransformContinuousIndexToPhysicalPoint((float(i), float(j), float(k)))

    def ijk(self, p):
        """LPS mm -> continuous voxel index (i, j, k) = (x, y, z)"""
        return self.img.TransformPhysicalPointToContinuousIndex(tuple(float(v) for v in p))


@functools.lru_cache(maxsize=8)
def vol(key: str) -> Volume:
    img = sitk.ReadImage(str(NIFTI / f"{key}.nii.gz"))
    return Volume(key, sitk.GetArrayFromImage(img).astype(np.float32), img)


def series() -> dict:
    out = {}
    for key, desc in SERIES_INFO.items():
        p = NIFTI / f"{key}.nii.gz"
        if not p.exists():
            continue
        r = sitk.ImageFileReader(); r.SetFileName(str(p)); r.ReadImageInformation()
        size, sp, org = r.GetSize(), r.GetSpacing(), r.GetOrigin()
        d = np.array(r.GetDirection()).reshape(3, 3)
        out[key] = {"desc": desc, "size_xyz": size, "spacing": [round(s, 4) for s in sp],
                    "origin": [round(o, 2) for o in org], "direction": d.round(3).tolist()}
    return out


@functools.lru_cache(maxsize=16)
def _seg(task: str) -> sitk.Image:
    return sitk.ReadImage(str(SEG / SEG_FILES[task]))


@functools.lru_cache(maxsize=1)
def _classmaps():
    from totalsegmentator.map_to_binary import class_map
    return class_map


def label_names(task: str) -> dict[int, str]:
    return dict(_classmaps()[task])


def _find(name: str):
    """Locate a structure name across label files -> (task, id)."""
    cm = _classmaps()
    for task in ["total_v1", "total", "trunk_cavities", "lung_vessels", "body", "vertebrae_body"]:
        names = cm[task] if task != "total_v1" else cm["total_v1"]
        for k, v in names.items():
            if v == name:
                return task, int(k)
    raise KeyError(f"unknown structure {name!r}")


@functools.lru_cache(maxsize=64)
def _mask_img(name: str, like: str) -> np.ndarray:
    task, lid = _find(name)
    seg = _seg(task)
    ref = vol(like).img
    m = sitk.BinaryThreshold(seg, lid, lid, 1, 0)
    if like != "thin_lung":
        m = sitk.Resample(m, ref, sitk.Transform(), sitk.sitkNearestNeighbor, 0, sitk.sitkUInt8)
    return sitk.GetArrayFromImage(m).astype(bool)


def mask(name: str, like: str = "thin_lung") -> np.ndarray:
    """Boolean mask (z,y,x) of a TotalSegmentator structure on the grid of series `like`.
    Names: e.g. heart, aorta, pulmonary_artery, heart_ventricle_left, liver, spleen,
    lung_upper_lobe_left, trachea, esophagus, pericardium, vertebrae_T8, rib_left_6, sternum,
    lung_airways, lung_arteries, body_trunc, vertebrae_body ..."""
    return _mask_img(name, like)


def label_at(p) -> dict:
    """All anatomy labels at an LPS point."""
    out = {}
    for task in SEG_FILES:
        seg = _seg(task)
        idx = seg.TransformPhysicalPointToIndex(tuple(float(v) for v in p))
        if all(0 <= idx[a] < seg.GetSize()[a] for a in range(3)):
            v = int(seg[idx])
            if v:
                out[task] = label_names(task if task != "total_v1" else "total_v1").get(v, v)
    return out


def roi_stats(key: str, center_lps, radius_mm: float = 5.0) -> dict:
    v = vol(key)
    c = np.array(v.ijk(center_lps))  # x,y,z
    sx, sy, sz = v.spacing
    zz, yy, xx = np.ogrid[: v.hu.shape[0], : v.hu.shape[1], : v.hu.shape[2]]
    d2 = ((xx - c[0]) * sx) ** 2 + ((yy - c[1]) * sy) ** 2 + ((zz - c[2]) * sz) ** 2
    m = d2 <= radius_mm ** 2
    vals = v.hu[m]
    if vals.size == 0:
        return {"n": 0}
    return {"n": int(vals.size), "mean": round(float(vals.mean()), 1), "sd": round(float(vals.std()), 1),
            "min": round(float(vals.min()), 1), "max": round(float(vals.max()), 1),
            "median": round(float(np.median(vals)), 1)}


def mask_stats(name: str, key: str, erode_mm: float = 0.0) -> dict:
    """HU statistics of `key` inside a structure (optionally eroded to avoid edges)."""
    v = vol(key)
    m = mask(name, like=key)
    if erode_mm > 0:
        r = max(1, int(round(erode_mm / v.spacing[0])))
        m = ndi.binary_erosion(m, structure=np.ones((1, 3, 3)), iterations=r)
    vals = v.hu[m]
    vox_ml = float(np.prod(v.spacing)) / 1000.0
    if vals.size == 0:
        return {"n": 0}
    return {"n": int(vals.size), "volume_ml": round(float(m.sum() * vox_ml), 1),
            "mean": round(float(vals.mean()), 1), "sd": round(float(vals.std()), 1),
            "p5": round(float(np.percentile(vals, 5)), 1), "p50": round(float(np.percentile(vals, 50)), 1),
            "p95": round(float(np.percentile(vals, 95)), 1)}


def diameters(name: str, key: str, index: int, plane: str = "axial") -> dict:
    """Cross-section metrics of the largest connected piece of `name` on one slice:
    area-equivalent diameter, max Feret diameter and min caliper (approx.), all in mm."""
    v = vol(key)
    m = mask(name, like=key)
    sl = _slice(m, plane, index)
    lab, n = ndi.label(sl)
    if n == 0:
        return {"present": False}
    sizes = ndi.sum(sl, lab, range(1, n + 1))
    comps = []
    px = _plane_spacing(v, plane)
    for ci in np.argsort(sizes)[::-1][:3]:
        c = lab == (ci + 1)
        yy, xx = np.nonzero(c)
        pts = np.stack([xx * px[0], yy * px[1]], 1)
        area = c.sum() * px[0] * px[1]
        # Feret diameters by projection over angles
        angs = np.deg2rad(np.arange(0, 180, 2))
        proj = pts @ np.stack([np.cos(angs), np.sin(angs)])
        widths = proj.max(0) - proj.min(0) + np.mean(px)
        comps.append({"area_mm2": round(float(area), 1), "eqDiameter_mm": round(float(2 * np.sqrt(area / np.pi)), 1),
                      "maxFeret_mm": round(float(widths.max()), 1), "minFeret_mm": round(float(widths.min()), 1),
                      "centroid_px_xy": [round(float(xx.mean()), 1), round(float(yy.mean()), 1)]})
    return {"present": True, "components": comps}


def _plane_spacing(v: Volume, plane: str):
    sx, sy, sz = v.spacing
    return {"axial": (sx, sy), "coronal": (sx, sz), "sagittal": (sy, sz)}[plane]


def _slice(a: np.ndarray, plane: str, index: int) -> np.ndarray:
    """2D image in display orientation: axial (y down = posterior), coronal/sagittal (superior up)."""
    if plane == "axial":
        return a[index]
    if plane == "coronal":
        return a[:, index, :][::-1]
    if plane == "sagittal":
        return a[:, :, index][::-1]
    raise ValueError(plane)


def _font(size=14):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _win(img, window):
    c, w = WINDOWS[window] if isinstance(window, str) else window
    return np.clip((img - (c - w / 2)) / w, 0, 1)


def render(key: str, plane: str = "axial", index: int | None = None, window="soft", out: str | None = None,
           crop_mm: Sequence[float] | None = None, center_lps=None, size: int = 768,
           overlays: Iterable[tuple[str, tuple[int, int, int]]] = (), fill_overlays: bool = False,
           marks: Iterable = (), title: str | None = None, slab_mip_mm: float = 0.0) -> Image.Image:
    """Render one slice (or a thin MIP slab) with physical aspect ratio.

    index: slice index along the plane normal (axial k, coronal j, sagittal i). If None and
           center_lps given, picks the slice through that point; else middle slice.
    crop_mm: (width, height) field of view in mm around center_lps (or slice center).
    overlays: [(structure_name, (r,g,b)), ...] drawn as outlines (or translucent fill).
    marks: [(x_lps, y_lps, z_lps, "label"), ...] drawn as rings if they lie near the slice.
    """
    v = vol(key)
    nz, ny, nx = v.hu.shape
    if index is None:
        if center_lps is not None:
            i, j, k = v.ijk(center_lps)
            index = int(round({"axial": k, "coronal": j, "sagittal": i}[plane]))
        else:
            index = {"axial": nz // 2, "coronal": ny // 2, "sagittal": nx // 2}[plane]
    nmax = {"axial": nz, "coronal": ny, "sagittal": nx}[plane]
    index = int(np.clip(index, 0, nmax - 1))
    if slab_mip_mm > 0:
        sp = {"axial": v.spacing[2], "coronal": v.spacing[1], "sagittal": v.spacing[0]}[plane]
        h = max(0, int(round(slab_mip_mm / sp / 2)))
        lo, hi = max(0, index - h), min(nmax, index + h + 1)
        img = np.max(np.stack([_slice(v.hu, plane, t) for t in range(lo, hi)]), 0)
    else:
        img = _slice(v.hu, plane, index)
    g = _win(img, window)
    rgb = np.stack([g, g, g], -1)
    for name, color in overlays:
        try:
            m = _slice(mask(name, like=key), plane, index)
        except KeyError:
            continue
        col = np.array(color) / 255.0
        if fill_overlays:
            rgb[m] = rgb[m] * 0.55 + col * 0.45
        edge = m & ~ndi.binary_erosion(m)
        rgb[edge] = col
    px = _plane_spacing(v, plane)
    h_, w_ = g.shape
    # crop
    x0, x1, y0, y1 = 0, w_, 0, h_
    if crop_mm is not None:
        if center_lps is not None:
            ci, cj, ck = v.ijk(center_lps)
            cx, cy = {"axial": (ci, cj), "coronal": (ci, nz - 1 - ck), "sagittal": (cj, nz - 1 - ck)}[plane]
        else:
            cx, cy = w_ / 2, h_ / 2
        hw, hh = crop_mm[0] / px[0] / 2, crop_mm[1] / px[1] / 2
        x0, x1 = int(max(0, cx - hw)), int(min(w_, cx + hw))
        y0, y1 = int(max(0, cy - hh)), int(min(h_, cy + hh))
    rgb = rgb[y0:y1, x0:x1]
    W_mm, H_mm = (x1 - x0) * px[0], (y1 - y0) * px[1]
    scale = size / max(W_mm, H_mm)
    W, H = max(1, int(W_mm * scale)), max(1, int(H_mm * scale))
    im = Image.fromarray((rgb * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    d = ImageDraw.Draw(im)
    f = _font(13)
    for mk in marks:
        p, lab = mk[:3], (mk[3] if len(mk) > 3 else "")
        i, j, k = v.ijk(p)
        pos_n = {"axial": k, "coronal": j, "sagittal": i}[plane]
        if abs(pos_n - index) * {"axial": v.spacing[2], "coronal": v.spacing[1], "sagittal": v.spacing[0]}[plane] > 6:
            continue
        u, w2 = {"axial": (i, j), "coronal": (i, nz - 1 - k), "sagittal": (j, nz - 1 - k)}[plane]
        X, Y = (u - x0) * px[0] * scale, (w2 - y0) * px[1] * scale
        d.ellipse([X - 14, Y - 14, X + 14, Y + 14], outline=(0, 255, 255), width=2)
        if lab:
            d.text((X + 16, Y - 8), str(lab), fill=(0, 255, 255), font=f)
    # orientation + scale bar
    ori = {"axial": ("R", "L", "A", "P"), "coronal": ("R", "L", "S", "I"), "sagittal": ("A", "P", "S", "I")}[plane]
    d.text((4, H // 2 - 7), ori[0], fill=(255, 200, 0), font=f); d.text((W - 14, H // 2 - 7), ori[1], fill=(255, 200, 0), font=f)
    d.text((W // 2 - 4, 2), ori[2], fill=(255, 200, 0), font=f); d.text((W // 2 - 4, H - 16), ori[3], fill=(255, 200, 0), font=f)
    bar = 10 if W_mm < 80 else 50
    d.line([(10, H - 12), (10 + bar * scale, H - 12)], fill=(255, 255, 255), width=3)
    d.text((12, H - 30), f"{bar} mm", fill=(255, 255, 255), font=f)
    pos = v.lps(*{"axial": (nx / 2, ny / 2, index), "coronal": (nx / 2, index, nz / 2), "sagittal": (index, ny / 2, nz / 2)}[plane])
    coord = {"axial": f"z={pos[2]:.1f}", "coronal": f"y={pos[1]:.1f}", "sagittal": f"x={pos[0]:.1f}"}[plane]
    label = title or f"{key} {plane} #{index} {coord} W{WINDOWS[window] if isinstance(window, str) else window}"
    if slab_mip_mm:
        label += f" MIP{slab_mip_mm:g}mm"
    d.text((6, 4), label, fill=(255, 255, 0), font=f)
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        im.save(out)
    return im


def montage(key: str, plane: str = "axial", indices: Iterable[int] = (), window="soft", out: str | None = None,
            cols: int = 4, tile: int = 420, **kw) -> Image.Image:
    tiles = [render(key, plane, i, window, size=tile, **kw) for i in indices]
    if not tiles:
        raise ValueError("no indices")
    tw = max(t.width for t in tiles); th = max(t.height for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    M = Image.new("RGB", (cols * tw, rows * th), (8, 8, 10))
    for n, t in enumerate(tiles):
        M.paste(t, ((n % cols) * tw, (n // cols) * th))
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        M.save(out)
    return M


def structure_volumes() -> dict:
    """Volumes (mL) of every labelled structure, per label file."""
    out = {}
    for task in SEG_FILES:
        a = sitk.GetArrayFromImage(_seg(task))
        vox = float(np.prod(_seg(task).GetSpacing())) / 1000.0
        ids, cnt = np.unique(a, return_counts=True)
        names = label_names(task)
        out[task] = {names.get(int(i), str(i)): round(float(c * vox), 1) for i, c in zip(ids, cnt) if i}
    return out


def find_slice(key: str, z_lps: float) -> int:
    v = vol(key)
    return int(round(v.ijk((0.0, 0.0, z_lps))[2])) if v.img.GetDirection()[8] > 0.5 else -1


if __name__ == "__main__":
    print(json.dumps(series(), indent=1))
