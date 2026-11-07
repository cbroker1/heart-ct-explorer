"""Anatomy catalog: one place that defines every structure we show.

Each entry pulls a mask from one TotalSegmentator label file (all on the thin_lung grid),
gives it a display name, colour, group, and mesh parameters. Order = paint priority for the
merged label volume (later entries overwrite earlier ones), so specific structures
(chambers, vessels, airways) win over containers (pericardium, lungs, body).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import SimpleITK as sitk

from common import SEG

SEG_FILES = {
    "total": SEG / "total.nii.gz",
    "v1": SEG / "total_v1_full.nii.gz",
    "cav": SEG / "trunk_cavities.nii.gz",
    "lv": SEG / "lung_vessels.nii.gz",
    "body": SEG / "body.nii.gz",
}
CLASSMAP_KEY = {"total": "total", "v1": "total_v1", "cav": "trunk_cavities", "lv": "lung_vessels", "body": "body"}


@dataclass
class Structure:
    name: str               # unique machine name used everywhere (mesh node, label class)
    display: str
    color: str
    group: str              # heart | vessels | airways | lungs | bones | abdomen | muscle | body
    source: str             # key into SEG_FILES
    labels: tuple           # label names inside that file (unioned)
    sigma: float = 1.0      # gaussian smoothing (voxels) before marching cubes
    keep: float = 0.35      # fraction of triangles kept by decimation
    visible: bool = True
    opacity: float = 1.0
    min_ml: float = 0.3     # drop tiny fragments
    level: float = 0.5      # marching-cubes iso level on the smoothed mask (>0.5 shrinks slightly)
    exclude: tuple = ()     # structure names whose voxels are removed from this one


def _ribs():
    out = []
    for side, s in (("left", "Left"), ("right", "Right")):
        for i in range(1, 13):
            ordn = {1: "1st", 2: "2nd", 3: "3rd"}.get(i, f"{i}th")
            out.append(Structure(f"rib_{side}_{i}", f"{s} {ordn} rib", "#eadfca", "bones", "total", (f"rib_{side}_{i}",),
                                 sigma=0.7, keep=0.35))
    return out


def _vertebrae():
    out = []
    for lvl in ["T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "L1"]:
        out.append(Structure(f"vertebrae_{lvl}", f"{lvl} vertebra", "#f0e6d2", "bones", "v1", (f"vertebrae_{lvl}",),
                             sigma=0.8, keep=0.3))
    return out


CATALOG: list[Structure] = [
    # --- containers first (lowest priority) ---
    Structure("body_trunc", "Skin & soft tissue", "#d9a58f", "body", "body", ("body_trunc",), sigma=1.6, keep=0.08,
              visible=False, opacity=0.12),
    Structure("lung_upper_lobe_left", "Left upper lobe", "#7fd3ff", "lungs", "total", ("lung_upper_lobe_left",), sigma=1.4, keep=0.12, opacity=0.14),
    Structure("lung_lower_lobe_left", "Left lower lobe", "#5ab7f0", "lungs", "total", ("lung_lower_lobe_left",), sigma=1.4, keep=0.12, opacity=0.14),
    Structure("lung_upper_lobe_right", "Right upper lobe", "#8ee6c8", "lungs", "total", ("lung_upper_lobe_right",), sigma=1.4, keep=0.12, opacity=0.14),
    Structure("lung_middle_lobe_right", "Right middle lobe", "#b8ec8c", "lungs", "total", ("lung_middle_lobe_right",), sigma=1.4, keep=0.12, opacity=0.14),
    Structure("lung_lower_lobe_right", "Right lower lobe", "#66cfb0", "lungs", "total", ("lung_lower_lobe_right",), sigma=1.4, keep=0.12, opacity=0.14),
    Structure("pericardium", "Pericardial sac & fat", "#ffd27a", "heart", "cav", ("pericardium",), sigma=1.3, keep=0.15,
              visible=False, opacity=0.25),
    Structure("heart", "Heart (whole)", "#d8434f", "heart", "total", ("heart",), sigma=1.2, keep=0.2, visible=False),
    # --- organs ---
    Structure("liver", "Liver (dome)", "#9b3f30", "abdomen", "total", ("liver",), sigma=1.3, keep=0.15),
    Structure("spleen", "Spleen (tip)", "#7a3069", "abdomen", "total", ("spleen",), sigma=1.2, keep=0.2),
    Structure("stomach", "Stomach (fundus)", "#e2a96b", "abdomen", "total", ("stomach",), sigma=1.2, keep=0.2),
    Structure("colon", "Colon (splenic flexure)", "#c79a63", "abdomen", "total", ("colon",), sigma=1.1, keep=0.25),
    Structure("autochthon_left", "Left back muscles", "#b5544a", "muscle", "total", ("autochthon_left",), sigma=1.1, keep=0.2, visible=False),
    Structure("autochthon_right", "Right back muscles", "#b5544a", "muscle", "total", ("autochthon_right",), sigma=1.1, keep=0.2, visible=False),
    Structure("esophagus", "Esophagus", "#e7a77a", "airways", "total", ("esophagus",), sigma=0.9, keep=0.35),
    # --- heart detail (TotalSegmentator v1 cardiac model) ---
    Structure("heart_myocardium", "Heart muscle (LV myocardium)", "#b8323f", "heart", "v1", ("heart_myocardium",), sigma=1.0, keep=0.3, level=0.58),
    Structure("heart_ventricle_left", "Left ventricle", "#ff5d6c", "heart", "v1", ("heart_ventricle_left",), sigma=1.0, keep=0.3, level=0.58),
    Structure("heart_ventricle_right", "Right ventricle", "#5f80ff", "heart", "v1", ("heart_ventricle_right",), sigma=1.0, keep=0.3, level=0.58),
    Structure("heart_atrium_left", "Left atrium", "#ff8f7d", "heart", "v1", ("heart_atrium_left",), sigma=1.0, keep=0.3, level=0.58),
    Structure("heart_atrium_right", "Right atrium", "#82a6ff", "heart", "v1", ("heart_atrium_right",), sigma=1.0, keep=0.3, level=0.58),
    Structure("atrial_appendage_left", "Left atrial appendage", "#ffae8f", "heart", "total", ("atrial_appendage_left",), sigma=0.9, keep=0.35, level=0.58),
    # --- great vessels ---
    Structure("aorta", "Aorta", "#ff2d3f", "vessels", "total", ("aorta",), sigma=1.0, keep=0.3, level=0.58),
    Structure("pulmonary_artery", "Pulmonary artery", "#3e6bff", "vessels", "v1", ("pulmonary_artery",), sigma=1.0, keep=0.3, level=0.58),
    Structure("pulmonary_vein", "Pulmonary veins", "#ff7759", "vessels", "total", ("pulmonary_vein",), sigma=0.9, keep=0.35, level=0.58),
    Structure("superior_vena_cava", "Superior vena cava", "#4f72d8", "vessels", "total", ("superior_vena_cava",), sigma=0.9, keep=0.35, level=0.58),
    Structure("inferior_vena_cava", "Inferior vena cava", "#4f72d8", "vessels", "total", ("inferior_vena_cava",), sigma=0.9, keep=0.35, level=0.58),
    Structure("lung_arteries", "Lung arteries", "#5a86ff", "vessels", "lv", ("lung_arteries",), sigma=0.6, keep=0.3,
              exclude=("heart_myocardium", "heart_ventricle_left", "heart_ventricle_right", "heart_atrium_left", "heart_atrium_right", "atrial_appendage_left", "aorta", "pulmonary_artery", "pulmonary_vein", "superior_vena_cava", "inferior_vena_cava", "heart")),
    Structure("lung_veins", "Lung veins", "#ff6e6e", "vessels", "lv", ("lung_veins",), sigma=0.6, keep=0.3,
              exclude=("heart_myocardium", "heart_ventricle_left", "heart_ventricle_right", "heart_atrium_left", "heart_atrium_right", "atrial_appendage_left", "aorta", "pulmonary_artery", "pulmonary_vein", "superior_vena_cava", "inferior_vena_cava", "heart")),
    # --- airways ---
    Structure("trachea", "Trachea", "#a8dcff", "airways", "total", ("trachea",), sigma=0.9, keep=0.35),
    Structure("lung_airways", "Bronchial tree", "#c9eeff", "airways", "lv", ("lung_airways",), sigma=0.6, keep=0.35, exclude=("trachea", "esophagus")),
    # --- skeleton & nerves (highest priority so bone always wins) ---
    Structure("costal_cartilages", "Costal cartilage", "#bfe3dc", "bones", "total", ("costal_cartilages",), sigma=0.8, keep=0.3),
    Structure("sternum", "Sternum", "#f3e8d0", "bones", "total", ("sternum",), sigma=0.8, keep=0.3),
    Structure("scapula_left", "Left scapula", "#eadfca", "bones", "total", ("scapula_left",), sigma=0.8, keep=0.3),
    Structure("scapula_right", "Right scapula", "#eadfca", "bones", "total", ("scapula_right",), sigma=0.8, keep=0.3),
    *_vertebrae(),
    *_ribs(),
    Structure("spinal_cord", "Spinal cord", "#ffe27a", "bones", "total", ("spinal_cord",), sigma=0.8, keep=0.35),
]


_cache: dict[str, tuple[np.ndarray, sitk.Image]] = {}


def seg_array(source: str) -> tuple[np.ndarray, sitk.Image]:
    if source not in _cache:
        img = sitk.ReadImage(str(SEG_FILES[source]))
        _cache[source] = (sitk.GetArrayFromImage(img), img)
    return _cache[source]


def _raw_mask(s: Structure) -> np.ndarray:
    from totalsegmentator.map_to_binary import class_map
    arr, _ = seg_array(s.source)
    cm = class_map[CLASSMAP_KEY[s.source]]
    ids = [k for k, v in cm.items() if v in s.labels]
    return np.isin(arr, ids)


def structure_mask(s: Structure) -> np.ndarray:
    m = _raw_mask(s)
    for name in s.exclude:
        other = next((o for o in CATALOG if o.name == name), None)
        if other is not None:
            m &= ~_raw_mask(other)
    return m


def reference_image() -> sitk.Image:
    return seg_array("total")[1]
