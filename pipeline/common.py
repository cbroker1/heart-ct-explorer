"""Shared helpers for the heart-ct-explorer pipeline.

Everything works in DICOM patient space (LPS, millimetres). Volumes are kept as
SimpleITK images so physical geometry (origin / spacing / direction) is never lost
when we resample masks between series that share a frame of reference.
"""
from __future__ import annotations

import glob
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pydicom
import SimpleITK as sitk

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
NIFTI = DATA / "nifti"
SEG = DATA / "seg"
DERIVED = DATA / "derived"
WEB_PUBLIC = ROOT / "web" / "public" / "data"

# Friendly keys for the series in this exam. Folder names come from the Medicom export.
SERIES_KEYS = {
    "S5": "calcium",            # CALCIUM SCORE, 3 mm / 1.5 mm, 0.31 mm px, Sa36d
    "S8": "axial_st",           # AXIAL ST WO, 3 mm soft tissue
    "S9": "axial_lung",         # AXIAL LUNG WO, 3 mm lung kernel
    "S11": "cor_st",            # COR ST WO, 4 mm coronal reformat
    "S12": "sag_st",            # SAG ST WO, 4 mm sagittal reformat
    "S13": "axial_lung_mip",    # AXIAL LUNG MIP, 10 mm slab MIP
    "S14": "thin_lung",         # SURG PLANNING LUNG, 1.5 mm / 0.75 mm, Bl64d
    "S16": "cr_vessel_suppress",  # ClearRead CT vessel suppressed
}

# Tags that may identify a person. We never copy these into anything we publish.
PHI_KEYWORDS = {
    "PatientName", "PatientID", "PatientBirthDate", "OtherPatientIDsSequence",
    "IssuerOfPatientID", "AccessionNumber", "ReferringPhysicianName",
    "OperatorsName", "PerformingPhysicianName", "InstitutionName",
    "InstitutionAddress", "StationName", "PhysiciansOfRecord",
    "RequestingPhysician", "StudyID", "DeviceSerialNumber",
}


def find_series_dirs(dicom_root: str | os.PathLike) -> dict[str, Path]:
    root = Path(dicom_root)
    st = root / "DICOM" / "ST1"
    if not st.exists():
        raise SystemExit(f"Expected Medicom layout at {st}")
    return {p.name: p for p in sorted(st.iterdir()) if p.is_dir()}


@dataclass
class Series:
    key: str
    folder: str
    description: str
    image: sitk.Image                 # int16 HU, LPS geometry
    meta: dict = field(default_factory=dict)


def _hu(ds) -> np.ndarray:
    arr = ds.pixel_array.astype(np.float32)
    slope = float(getattr(ds, "RescaleSlope", 1) or 1)
    inter = float(getattr(ds, "RescaleIntercept", 0) or 0)
    return arr * slope + inter


def load_ct_series(folder: Path, key: str) -> Series:
    """Load a CT image series into an int16 HU SimpleITK image with exact geometry."""
    files = sorted(glob.glob(str(folder / "*")))
    slices = [pydicom.dcmread(f) for f in files]
    slices = [d for d in slices if hasattr(d, "ImagePositionPatient")]
    if not slices:
        raise ValueError(f"{folder} has no positioned images")

    iop = np.array(slices[0].ImageOrientationPatient, dtype=np.float64)
    row_dir, col_dir = iop[:3], iop[3:]
    normal = np.cross(row_dir, col_dir)
    slices.sort(key=lambda d: float(np.dot(np.array(d.ImagePositionPatient, float), normal)))
    pos = np.array([np.array(d.ImagePositionPatient, float) for d in slices])
    proj = pos @ normal
    gaps = np.diff(proj)
    if len(gaps):
        dz = float(np.median(gaps))
        if np.max(np.abs(gaps - dz)) > 0.01 * max(dz, 1e-3):
            print(f"  ! {key}: non-uniform slice gaps {gaps.min():.3f}..{gaps.max():.3f}")
    else:
        dz = float(getattr(slices[0], "SliceThickness", 1.0) or 1.0)

    ps = [float(x) for x in slices[0].PixelSpacing]  # [row spacing, col spacing]
    vol = np.stack([_hu(d) for d in slices], axis=0)  # (z, rows, cols)
    vol = np.clip(np.rint(vol), -1024, 4095).astype(np.int16)

    img = sitk.GetImageFromArray(vol)
    img.SetSpacing((ps[1], ps[0], dz))
    img.SetOrigin(tuple(pos[0]))
    d = np.column_stack([row_dir, col_dir, normal])
    img.SetDirection(tuple(d.flatten()))

    ds0 = slices[0]
    wc = ds0.get("WindowCenter", None)
    ww = ds0.get("WindowWidth", None)
    first = lambda v: float(v[0]) if isinstance(v, pydicom.multival.MultiValue) else (float(v) if v is not None else None)
    meta = {
        "key": key,
        "folder": folder.name,
        "description": str(ds0.get("SeriesDescription", "")),
        "seriesNumber": int(ds0.get("SeriesNumber", 0) or 0),
        "kernel": str(ds0.get("ConvolutionKernel", "")),
        "sliceThickness": float(ds0.get("SliceThickness", 0) or 0),
        "sliceSpacing": dz,
        "pixelSpacing": [ps[1], ps[0]],
        "size": [int(ds0.Columns), int(ds0.Rows), len(slices)],
        "kvp": float(ds0.get("KVP", 0) or 0),
        "imageType": list(ds0.get("ImageType", [])),
        "window": [first(wc), first(ww)],
        "origin": list(map(float, pos[0])),
        "direction": list(map(float, d.flatten())),
        "reconDiameter": float(ds0.get("ReconstructionDiameter", 0) or 0),
    }
    return Series(key=key, folder=folder.name, description=meta["description"], image=img, meta=meta)


def deidentified_header(ds) -> dict:
    """A small, PHI-free summary of the exam for display."""
    keep = {}
    for kw in ["Modality", "StudyDescription", "BodyPartExamined", "Manufacturer",
               "ManufacturerModelName", "SoftwareVersions", "ProtocolName", "PatientSex",
               "PatientAge", "StudyDate", "KVP", "CTDIvol", "RevolutionTime",
               "SingleCollimationWidth", "TotalCollimationWidth", "PatientPosition"]:
        v = ds.get(kw, None)
        if v is None or v == "":
            continue
        if isinstance(v, pydicom.multival.MultiValue):
            v = [str(x) for x in v]
        elif isinstance(v, (pydicom.valuerep.DSfloat, pydicom.valuerep.IS)):
            v = float(v)
        else:
            v = str(v)
        keep[kw] = v
    assert not (set(keep) & PHI_KEYWORDS)
    return keep


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)


def read_image(path: Path) -> sitk.Image:
    return sitk.ReadImage(str(path))


def resample_like(moving: sitk.Image, reference: sitk.Image, nearest: bool = True,
                  default: float = 0) -> sitk.Image:
    """Resample `moving` onto `reference`'s grid using physical coordinates."""
    interp = sitk.sitkNearestNeighbor if nearest else sitk.sitkLinear
    return sitk.Resample(moving, reference, sitk.Transform(), interp, default, moving.GetPixelID())
