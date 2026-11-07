"""Stage 3b: cross-checks for the calcium analysis.

* Same Agatston candidate search on a *different reconstruction* (AXIAL ST WO: 3 mm
  non-overlapping, Br40d kernel) -- an independent look at the same photons.
* Maximum-intensity projections of the pericardial sac (bone removed): any calcified plaque
  would show up as a bright dot in at least one projection.
* Full-coverage contact sheets of the heart region with the 130 HU overlay, for human/AI review.
"""
from __future__ import annotations
import numpy as np, SimpleITK as sitk
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from common import DERIVED, NIFTI, SEG, read_image, resample_like, write_json
from totalsegmentator.map_to_binary import class_map

OUT = DERIVED / "calcium"
def ids(task, names=None, prefixes=None):
    return [k for k, v in class_map[task].items() if (names and v in names) or (prefixes and v.startswith(tuple(prefixes)))]
BONES = ["rib", "vertebrae", "sternum", "costal", "scapula", "clavicula", "humerus"]

def masks_on(ref):
    tot = sitk.GetArrayFromImage(resample_like(read_image(SEG / "total.nii.gz"), ref))
    cav = sitk.GetArrayFromImage(resample_like(read_image(SEG / "trunk_cavities.nii.gz"), ref))
    sx = ref.GetSpacing()[0]
    heart = np.isin(tot, ids("total", names=["heart"])); peri = np.isin(cav, ids("trunk_cavities", names=["pericardium"]))
    rb = int(round(2.0 / sx)); r5 = int(round(5.0 / sx))
    bone = ndi.binary_dilation(np.isin(tot, ids("total", prefixes=BONES)), structure=np.ones((1, 2*rb+1, 2*rb+1)))
    roi = ndi.binary_dilation(peri | heart, structure=np.ones((3, 2*r5+1, 2*r5+1))) & ~bone
    return roi, peri, heart

def blobs(hu, roi, px_area, T=130.0, min_area=1.0):
    out = []
    for z in range(hu.shape[0]):
        l, n = ndi.label((hu[z] >= T) & roi[z], structure=np.ones((3, 3)))
        if not n: continue
        idx = np.arange(1, n + 1)
        a = ndi.sum(np.ones_like(l), l, idx) * px_area; p = ndi.maximum(hu[z], l, idx)
        out += [(z, float(ai), float(pi)) for ai, pi in zip(a, p) if ai >= min_area]
    return out

def main():
    res = {}
    for key in ["calcium", "axial_st"]:
        img = read_image(NIFTI / f"{key}.nii.gz"); hu = sitk.GetArrayFromImage(img).astype(np.float32)
        roi, peri, heart = masks_on(img)
        sx, sy, dz = img.GetSpacing()
        b = blobs(hu, roi, sx * sy)
        peaks = sorted([p for _, _, p in b], reverse=True)
        interior = ndi.distance_transform_edt(heart, sampling=(dz, sy, sx)) > 15
        res[key] = {"spacing": [sx, sy, dz], "blobs130": len(b), "maxPeakHU": round(peaks[0], 1) if peaks else None,
                    "blobsPeak200plus": sum(p >= 200 for p in peaks), "noiseSD": round(float(hu[interior].std()), 1),
                    "top5Peaks": [round(p, 1) for p in peaks[:5]]}
        print(key, res[key])
        if key == "calcium":
            # MIPs of the pericardial region with bone removed
            vol = np.where(roi, hu, -1000)
            mips = {"axial": vol.max(0), "coronal": vol.max(1)[::-1], "sagittal": vol.max(2)[::-1]}
            for name, m in mips.items():
                g = np.clip((m + 100) / 500, 0, 1)
                rgb = np.stack([g] * 3, -1); rgb[m >= 130] = rgb[m >= 130] * 0.3 + np.array([1, .2, .2]) * .7
                im = Image.fromarray((rgb * 255).astype(np.uint8))
                if name != "axial":  # stretch z (1.5 mm) to in-plane pixel size
                    im = im.resize((im.width, int(im.height * dz / sx)), Image.BILINEAR)
                im.save(OUT / f"mip_{name}.png")
            # contact sheets: every slice, cropped to the pericardial bbox
            zz, yy, xx = np.nonzero(roi)
            y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
            tiles = []
            for z in range(hu.shape[0]):
                s = hu[z, y0:y1, x0:x1]; g = np.clip((s + 160) / 400, 0, 1); rgb = np.stack([g] * 3, -1)
                hit = (s >= 130) & roi[z, y0:y1, x0:x1]; rgb[hit] = [1, .15, .15]
                im = Image.fromarray((rgb * 255).astype(np.uint8)).resize((340, int(340 * (y1 - y0) / (x1 - x0))), Image.BILINEAR)
                ImageDraw.Draw(im).text((4, 4), f"slice {z}  z={img.TransformIndexToPhysicalPoint((0,0,z))[2]:.1f}", fill=(255, 255, 0))
                tiles.append(im)
            per = 24; cols = 6
            for si in range(0, len(tiles), per):
                chunk = tiles[si:si + per]; rows = (len(chunk) + cols - 1) // cols
                th = chunk[0].height
                sheet = Image.new("RGB", (cols * 340, rows * th), (0, 0, 0))
                for i, t in enumerate(chunk): sheet.paste(t, ((i % cols) * 340, (i // cols) * th))
                sheet.save(OUT / f"sheet_{si // per + 1}.png")
    write_json(OUT / "crosscheck.json", res)

if __name__ == "__main__":
    main()
