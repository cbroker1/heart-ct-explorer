"""Stage 1: DICOM -> de-identified NIfTI volumes + exam summary.

usage: python pipeline/01_convert.py /path/to/medicom_export_root
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pydicom
import SimpleITK as sitk
from PIL import Image

from common import (DERIVED, NIFTI, SERIES_KEYS, deidentified_header, find_series_dirs,
                    load_ct_series, write_json)


def topogram(folder: Path, out_png: Path) -> dict:
    f = sorted(folder.iterdir())[0]
    ds = pydicom.dcmread(f)
    hu = ds.pixel_array.astype(np.float32) * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
    valid = ds.pixel_array > 0                     # padding rows are stored as raw 0
    rows = np.where(valid.any(axis=1))[0]
    cols = np.where(valid.any(axis=0))[0]
    r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    crop = hu[r0:r1, c0:c1]
    lo, hi = np.percentile(crop, [1, 99.7])
    img = np.clip((crop - lo) / (hi - lo), 0, 1)
    img = (img ** 0.8 * 255).astype(np.uint8)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img).save(out_png)
    ps = [float(x) for x in ds.PixelSpacing]
    return {
        "png": out_png.name,
        "crop": [int(r0), int(r1), int(c0), int(c1)],
        "pixelSpacing": ps,
        "orientation": [float(x) for x in ds.ImageOrientationPatient],
        "position": [float(x) for x in ds.ImagePositionPatient],
        "kvp": float(ds.get("KVP", 0) or 0),
        "shape": [int(r1 - r0), int(c1 - c0)],
    }


def main(export_root: str) -> None:
    dirs = find_series_dirs(export_root)
    NIFTI.mkdir(parents=True, exist_ok=True)
    series_meta = {}
    for folder, key in SERIES_KEYS.items():
        s = load_ct_series(dirs[folder], key)
        out = NIFTI / f"{key}.nii.gz"
        sitk.WriteImage(s.image, str(out), useCompression=True)
        series_meta[key] = s.meta
        sz = s.image.GetSize()
        print(f"{folder:4s} -> {out.name:28s} size={sz} spacing={tuple(round(x,4) for x in s.image.GetSpacing())}")

    topo = {
        "ap": topogram(dirs["S3"], DERIVED / "topogram_ap.png"),
        "lateral": topogram(dirs["S4"], DERIVED / "topogram_lat.png"),
    }

    ds = pydicom.dcmread(sorted(dirs["S5"].iterdir())[0], stop_before_pixels=True)
    exam = deidentified_header(ds)

    # The radiologist's single measurement (presentation state on AXIAL ST WO): map to patient mm.
    measurement = None
    pr = pydicom.dcmread(sorted(dirs["S1"].iterdir(), key=lambda p: int(p.name[1:]))[8])
    for ga in pr.get("GraphicAnnotationSequence", []):
        gobjs = ga.get("GraphicObjectSequence", [])
        texts = ga.get("TextObjectSequence", [])
        if not gobjs:
            continue
        uid = ga.ReferencedImageSequence[0].ReferencedSOPInstanceUID
        for f in dirs["S8"].iterdir():
            d = pydicom.dcmread(f, stop_before_pixels=True)
            if d.SOPInstanceUID != uid:
                continue
            gd = np.array(gobjs[0].GraphicData, float).reshape(-1, 2)  # (col,row) pixels
            iop = np.array(d.ImageOrientationPatient, float)
            ipp = np.array(d.ImagePositionPatient, float)
            ps = [float(x) for x in d.PixelSpacing]
            pts = [list(map(float, ipp + iop[:3] * c * ps[1] + iop[3:] * r * ps[0])) for c, r in gd]
            measurement = {
                "label": str(texts[0].UnformattedTextValue) if texts else "",
                "what": "Ascending aorta diameter (radiologist caliper)",
                "series": "axial_st",
                "instance": int(d.InstanceNumber),
                "pointsLPS": pts,
                "lengthMM": float(np.linalg.norm(np.array(pts[0]) - np.array(pts[1]))),
            }
    write_json(DERIVED / "exam.json", {
        "exam": exam,
        "series": series_meta,
        "topograms": topo,
        "radiologistMeasurement": measurement,
        # From the Siemens dose SR (S15) and ECG documentation (S10) -- transcribed, no PHI.
        "dose": {"dlpTotal_mGycm": 31.39, "ctdivol_mGy": 2.12, "ssde_mGy": 2.87,
                 "waterEquivalentDiameter_cm": 27.4, "kvp": 120, "rotationTime_s": 0.25,
                 "mode": "Prospectively ECG-triggered sequential (step-and-shoot), 4 steps"},
        "ecg": {"hrAvg": 85, "hrMin": 82, "hrMax": 88, "scanPhase": "75%",
                "reconPhase": "BestDiast 76%"},
        "clearRead": {"lungVolumeRightL": 1.9, "lungVolumeLeftL": 1.8, "findings": 0,
                      "note": "ClearRead CT (Riverain) automated nodule detection: no findings."},
    })
    print("measurement:", measurement and round(measurement["lengthMM"], 2), "mm")
    print("wrote", DERIVED / "exam.json")


if __name__ == "__main__":
    main(sys.argv[1])
