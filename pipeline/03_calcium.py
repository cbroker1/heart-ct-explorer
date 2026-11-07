"""Stage 3: an independent, for-fun Agatston coronary artery calcium analysis.

What this does (and what a radiologist's workstation does too, minus the human clicking):
  1. Threshold the ECG-gated calcium series at 130 HU (Agatston 1990).
  2. Keep 2D connected blobs with area >= 1 mm^2, restricted to the pericardial sac
     (TotalSegmentator `trunk_cavities.pericardium` + whole heart, dilated) and away from bone.
  3. Group slice-blobs into 3D candidates and measure them (peak HU, area, slice span,
     depth inside the heart muscle/blood pool, distance to the aorta, chamber, ...).
  4. Triage each candidate with explicit rules, render review crops, and (optionally) merge
     human/AI review decisions from data/derived/calcium_review_decisions.json.
  5. Score = sum(area_mm2 * density_weight(peak HU)) over coronary lesions, with the standard
     overlap correction for 1.5 mm increments on 3 mm slices; also report volume & mass scores.

Not a medical device. Not a diagnosis. Just math on pixels.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

from common import DERIVED, NIFTI, SEG, read_image, resample_like, write_json

try:
    from totalsegmentator.map_to_binary import class_map
except Exception:  # pragma: no cover
    class_map = None

THRESH = 130.0
MIN_AREA = 1.0                     # mm^2
SLICE_THICKNESS = 3.0              # mm (header)
MASS_CAL = 0.743                   # mg HA / cm^3 per HU -- typical 120 kV value; no phantom here
OUT = DERIVED / "calcium"
CONN2D = np.ones((3, 3), bool)
STRUCT_2D_IN_3D = np.zeros((3, 3, 3), bool); STRUCT_2D_IN_3D[1] = True


def weight(peak: float) -> int:
    if peak < 130: return 0
    if peak < 200: return 1
    if peak < 300: return 2
    if peak < 400: return 3
    return 4


def label_ids(task: str, prefixes=None, names=None) -> list[int]:
    cm = class_map[task]
    out = []
    for k, v in cm.items():
        if names and v in names: out.append(k)
        if prefixes and v.startswith(tuple(prefixes)): out.append(k)
    return out


def font(size=14):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def window(img: np.ndarray, level: float, width: float) -> np.ndarray:
    return np.clip((img - (level - width / 2)) / width, 0, 1)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "review").mkdir(exist_ok=True)
    ca = read_image(NIFTI / "calcium.nii.gz")
    hu = sitk.GetArrayFromImage(ca).astype(np.float32)          # (z, y, x)
    sx, sy, dz = ca.GetSpacing()
    px_area = sx * sy
    overlap_factor = dz / SLICE_THICKNESS                         # 1.5 / 3 = 0.5
    nz, ny, nx = hu.shape

    tot = sitk.GetArrayFromImage(resample_like(read_image(SEG / "total.nii.gz"), ca))
    cav = sitk.GetArrayFromImage(resample_like(read_image(SEG / "trunk_cavities.nii.gz"), ca))
    heart = np.isin(tot, label_ids("total", names=["heart"]))
    aorta = np.isin(tot, label_ids("total", names=["aorta"]))
    peri = np.isin(cav, label_ids("trunk_cavities", names=["pericardium"]))
    bone_raw = np.isin(tot, label_ids("total", prefixes=["rib", "vertebrae", "sternum", "costal", "scapula", "clavicula", "humerus"]))
    # 2 mm in-plane margin around bone (partial-volume edges of cortical bone light up)
    r_bone = int(round(2.0 / sx))
    bone = ndi.binary_dilation(bone_raw, structure=np.ones((1, 2 * r_bone + 1, 2 * r_bone + 1)))
    liver = np.isin(tot, label_ids("total", names=["liver"]))

    chambers = None
    v1 = SEG.parent / "seg_v1" / "total_v1.nii.gz"
    if v1.exists() and class_map is not None:
        chambers = sitk.GetArrayFromImage(resample_like(read_image(v1), ca))

    # Search region: pericardial sac + heart, 5 mm in-plane / 1 slice margin, minus bone.
    r5 = int(round(5.0 / sx))
    roi = ndi.binary_dilation(peri | heart, structure=np.ones((3, 2 * r5 + 1, 2 * r5 + 1)))
    roi &= ~bone

    # Depth inside the heart (mm): coronaries run on the surface / in epicardial fat (depth ~0).
    depth = ndi.distance_transform_edt(heart, sampling=(dz, sy, sx)).astype(np.float32)
    aorta_dist = ndi.distance_transform_edt(~aorta, sampling=(dz, sy, sx)).astype(np.float32)

    # Noise estimate in the heart interior (blood + myocardium are ~homogeneous unenhanced)
    interior = depth > 15
    noise_sd = float(hu[interior].std())
    noise_mean = float(hu[interior].mean())

    # ---------- 2D blobs per slice (Agatston works slice-by-slice) ----------
    above = (hu >= THRESH) & roi
    lab2 = np.zeros(hu.shape, np.int32)
    blobs = []
    nid = 0
    for z in range(nz):
        l, n = ndi.label(above[z], structure=CONN2D)
        if n == 0: continue
        idx = np.arange(1, n + 1)
        counts = ndi.sum(np.ones_like(l), l, idx)
        peaks = ndi.maximum(hu[z], l, idx)
        means = ndi.mean(hu[z], l, idx)
        for i, c, p, m in zip(idx, counts, peaks, means):
            area = float(c * px_area)
            if area < MIN_AREA: continue
            nid += 1
            mask = l == i
            lab2[z][mask] = nid
            yy, xx = np.nonzero(mask)
            blobs.append({"id": nid, "z": z, "area": area, "peak": float(p), "mean": float(m),
                          "cy": float(yy.mean()), "cx": float(xx.mean()), "npx": int(c)})

    # ---------- group into 3D candidates ----------
    lab3, n3 = ndi.label(lab2 > 0, structure=np.ones((3, 3, 3), bool))
    for b in blobs:
        zz = b["z"]; m = lab2[zz] == b["id"]
        b["cand"] = int(np.bincount(lab3[zz][m]).argmax())
    cands = []
    v1names = class_map.get("total_v1", {}) if class_map else {}
    for cid in range(1, n3 + 1):
        m = lab3 == cid
        zz, yy, xx = np.nonzero(m)
        bl = [b for b in blobs if b["cand"] == cid]
        if not bl: continue
        cen_idx = (float(xx.mean()), float(yy.mean()), float(zz.mean()))
        cen = ca.TransformContinuousIndexToPhysicalPoint(cen_idx)
        pk = max(bl, key=lambda b: b["peak"])
        dvals = depth[m]
        rec = {
            "id": cid,
            "slices": sorted({b["z"] for b in bl}),
            "nSlices": len({b["z"] for b in bl}),
            "peakHU": round(pk["peak"], 1),
            "peakSlice": pk["z"],
            "meanHU": round(float(hu[m].mean()), 1),
            "areaSum_mm2": round(sum(b["area"] for b in bl), 2),
            "maxArea_mm2": round(max(b["area"] for b in bl), 2),
            "volume_mm3": round(float(m.sum() * px_area * dz), 2),
            "centerLPS": [round(c, 2) for c in cen],
            "centerVoxel": [round(c, 1) for c in cen_idx],
            "depthInHeart_mm": {"min": round(float(dvals.min()), 1), "mean": round(float(dvals.mean()), 1)},
            "fracInHeart": round(float(heart[m].mean()), 2),
            "fracInPericardium": round(float(peri[m].mean()), 2),
            "fracInAorta": round(float(aorta[m].mean()), 2),
            "fracInLiver": round(float(liver[m].mean()), 2),
            "distToAorta_mm": round(float(aorta_dist[m].min()), 1),
            "blobs": [{"z": b["z"], "area": round(b["area"], 2), "peak": round(b["peak"], 1)} for b in bl],
        }
        if chambers is not None:
            vals = chambers[m]
            nzv = vals[vals > 0]
            rec["chamber"] = v1names.get(int(np.bincount(nzv).argmax()), "none") if nzv.size else "outside"
        # ---- explicit triage rules ----
        reasons = []
        if rec["peakHU"] < 200 and rec["depthInHeart_mm"]["min"] >= 3.0:
            reasons.append("faint (<200 HU) and >=3 mm deep inside heart muscle/blood pool, where no coronary artery runs")
        if rec["peakHU"] < 180 and rec["nSlices"] == 1:
            reasons.append("faint (<180 HU) and present on a single 3 mm slice only")
        if rec["fracInLiver"] > 0.5:
            reasons.append("inside the liver")
        if rec["fracInAorta"] > 0.5:
            reasons.append("inside the aorta (would be aortic, not coronary)")
        rec["ruleClass"] = "noise" if reasons and rec["fracInAorta"] <= 0.5 else ("aortic" if rec["fracInAorta"] > 0.5 else "review")
        rec["ruleReasons"] = reasons
        cands.append(rec)

    # ---------- review crops ----------
    f12, f16 = font(12), font(16)
    crop_mm = 36.0
    half = int(round(crop_mm / sx / 2))
    for c in cands:
        z = c["peakSlice"]
        cx, cy = int(round(c["centerVoxel"][0])), int(round(c["centerVoxel"][1]))
        panels = []
        for dzi in (-1, 0, 1):
            zi = min(max(z + dzi, 0), nz - 1)
            sl = hu[zi]
            y0, y1 = max(cy - half, 0), min(cy + half, ny)
            x0, x1 = max(cx - half, 0), min(cx + half, nx)
            crop = sl[y0:y1, x0:x1]
            g = window(crop, 40, 400)
            rgb = np.stack([g] * 3, -1)
            ab = crop >= THRESH
            mine = lab3[zi, y0:y1, x0:x1] == c["id"]
            rgb[ab & ~mine] = rgb[ab & ~mine] * 0.4 + np.array([0.9, 0.2, 0.2]) * 0.6
            rgb[mine] = [1.0, 0.85, 0.1]
            im = Image.fromarray((rgb * 255).astype(np.uint8)).resize((300, 300), Image.NEAREST)
            d = ImageDraw.Draw(im)
            d.text((5, 4), f"slice {zi} ({'peak' if dzi == 0 else ('below' if dzi < 0 else 'above')})", fill=(255, 255, 0), font=f12)
            panels.append(im)
            if dzi == 0:
                raw = Image.fromarray((window(crop, 40, 400) * 255).astype(np.uint8)).resize((300, 300), Image.BICUBIC).convert("RGB")
                ImageDraw.Draw(raw).text((5, 4), "same slice, no overlay", fill=(255, 255, 0), font=f12)
        # context: whole FOV at the peak slice with a box
        ctx = window(hu[z], 40, 400)
        ctx_rgb = np.stack([ctx] * 3, -1)
        ctx_rgb[(hu[z] >= THRESH) & (lab3[z] == c["id"])] = [1.0, 0.85, 0.1]
        cim = Image.fromarray((ctx_rgb * 255).astype(np.uint8)).resize((300, 300), Image.BILINEAR)
        s = 300 / nx
        ImageDraw.Draw(cim).rectangle([(cx - half) * s, (cy - half) * s, (cx + half) * s, (cy + half) * s], outline=(0, 255, 255), width=2)
        ImageDraw.Draw(cim).text((5, 4), "context (whole 158 mm FOV)", fill=(0, 255, 255), font=f12)
        sheet = Image.new("RGB", (300 * 5, 340), (10, 10, 14))
        for i, p in enumerate([cim, raw] + panels):
            sheet.paste(p, (i * 300, 40))
        ImageDraw.Draw(sheet).text((8, 10), f"candidate #{c['id']}: peak {c['peakHU']:.0f} HU, area(sum) {c['areaSum_mm2']} mm2, "
                                   f"{c['nSlices']} slice(s), depth in heart {c['depthInHeart_mm']['min']} mm, "
                                   f"dist to aorta {c['distToAorta_mm']} mm" + (f", chamber {c.get('chamber')}" if 'chamber' in c else ''),
                                   fill=(230, 230, 230), font=f16)
        sheet.save(OUT / "review" / f"cand_{c['id']:03d}.png")
        # small web thumbnail (no text) for the Calcium page
        panels[1].resize((160, 160), Image.NEAREST).save(OUT / "review" / f"thumb_{c['id']:03d}.png")

    # ---------- threshold sweep (fun: watch noise appear as you lower the bar) ----------
    sweep = []
    for T in [90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 250, 300]:
        ab = (hu >= T) & roi
        n_blobs = 0; naive = 0.0
        for z in range(nz):
            l, n = ndi.label(ab[z], structure=CONN2D)
            if n == 0: continue
            idx = np.arange(1, n + 1)
            cnt = ndi.sum(np.ones_like(l), l, idx) * px_area
            pk = ndi.maximum(hu[z], l, idx)
            ok = cnt >= MIN_AREA
            n_blobs += int(ok.sum())
            naive += float(sum(a * weight(p) for a, p in zip(cnt[ok], pk[ok]))) * overlap_factor
        sweep.append({"thresholdHU": T, "blobs": n_blobs, "naiveScoreIfAllCounted": round(naive, 1)})

    # ---------- decisions + scoring ----------
    dec_path = DERIVED / "calcium_review_decisions.json"
    decisions = json.loads(dec_path.read_text()) if dec_path.exists() else {}
    coronary_arteries = {"LM", "LAD", "LCX", "RCA", "PDA", "OM", "D1", "D2", "RAMUS"}
    per_artery: dict[str, dict] = {}
    for c in cands:
        d = decisions.get(str(c["id"]))
        if d:
            c["finalClass"] = d["class"]; c["artery"] = d.get("artery"); c["reviewNote"] = d.get("note", "")
            c["reviewVotes"] = d.get("votes")
        else:
            c["finalClass"] = c["ruleClass"]; c["artery"] = None
        if c["finalClass"] == "coronary":
            art = c["artery"] or "unassigned"
            pa = per_artery.setdefault(art, {"agatston": 0.0, "agatstonEven": 0.0, "agatstonOdd": 0.0, "volume_mm3": 0.0, "mass_mg": 0.0, "lesions": 0})
            pa["lesions"] += 1
            for b in c["blobs"]:
                s = b["area"] * weight(b["peak"])
                pa["agatston"] += s * overlap_factor
                pa["agatstonEven" if b["z"] % 2 == 0 else "agatstonOdd"] += s
            m = lab3 == c["id"]
            pa["volume_mm3"] += float(m.sum() * px_area * dz)
            pa["mass_mg"] += float(hu[m].mean() * m.sum() * px_area * dz / 1000.0 * MASS_CAL)
    total = {k: round(sum(v[k] for v in per_artery.values()), 1) for k in ["agatston", "agatstonEven", "agatstonOdd", "volume_mm3", "mass_mg"]} if per_artery else \
        {"agatston": 0.0, "agatstonEven": 0.0, "agatstonOdd": 0.0, "volume_mm3": 0.0, "mass_mg": 0.0}

    # lesion label volume for the web overlay (candidate id per voxel, uint8 capped)
    lab_u8 = np.where(lab3 > 0, np.minimum(lab3, 255), 0).astype(np.uint8)
    lab_img = sitk.GetImageFromArray(lab_u8); lab_img.CopyInformation(ca)
    sitk.WriteImage(lab_img, str(OUT / "candidates_labels.nii.gz"), useCompression=True)
    # plain ">=130 HU" map (for the 'everything bright' overlay)
    write_json(OUT / "calcium.json", {
        "method": {
            "series": "CALCIUM SCORE (Siemens Sa36d, 120 kV-equivalent, 3 mm slices every 1.5 mm, 0.31 mm pixels)",
            "thresholdHU": THRESH, "minAreaMM2": MIN_AREA, "sliceThickness": SLICE_THICKNESS,
            "sliceIncrement": dz, "overlapCorrection": overlap_factor,
            "densityWeights": "130-199 HU: 1, 200-299: 2, 300-399: 3, >=400: 4",
            "massCalibration_mgPerHUcm3": MASS_CAL,
            "searchRegion": "pericardial sac + whole heart (TotalSegmentator), 5 mm margin, excluding bone (+2 mm)",
        },
        "noise": {"heartInteriorMeanHU": round(noise_mean, 1), "heartInteriorSD_HU": round(noise_sd, 1),
                  "thresholdInSigmasAboveBlood": round((THRESH - noise_mean) / noise_sd, 2)},
        "candidates": cands,
        "totals": total,
        "perArtery": {k: {kk: round(vv, 1) if isinstance(vv, float) else vv for kk, vv in v.items()} for k, v in per_artery.items()},
        "thresholdSweep": sweep,
        "reviewed": bool(decisions),
    })
    print(f"noise: mean {noise_mean:.1f} sd {noise_sd:.1f} -> threshold is {(THRESH-noise_mean)/noise_sd:.1f} sigma above blood")
    print(f"2D blobs {len(blobs)}  3D candidates {len(cands)}  rule classes:",
          {k: sum(1 for c in cands if c['ruleClass'] == k) for k in ['noise', 'review', 'aortic']})
    print("totals:", total, "per artery:", per_artery)
    for s in sweep: print("  sweep", s)


if __name__ == "__main__":
    main()
