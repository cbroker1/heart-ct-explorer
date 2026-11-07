"""Stage 7: assets for the Lab page (web/src/pages/lab).

    conda run -n heartct python pipeline/07_lab_assets.py [--only glb|bio] [--qa DIR]

(1) web/public/data/mesh/heart_ar.glb
    Heart-only model for AR / <model-viewer>: the four chambers, LV myocardium, left atrial
    appendage, aorta, pulmonary artery, pulmonary veins, SVC and IVC as separate nodes with PBR
    colours. Units are METRES (glTF's unit, so AR shows it life-size), +Y up (head), +Z out of
    the chest, centred on its own bounding-box centre. No meshopt/draco: model-viewer would have
    to download a decoder, and AR viewers (Scene Viewer / Quick Look) may not support it.

(2) web/public/data/biomarkers.json
    "My body, by the numbers": opportunistic measurements on this calcium-score CT. Every metric
    carries key, label, value, unit, plain-English caption, reference context, method, the series
    it was measured on, a confidence label ("measured" | "AI estimate" | "rough"), optional gauge
    zones, a deep link into the slice viewer and the key of a small JPEG thumbnail showing exactly
    where it was measured (thumbnails are stored once, as data URLs, in the top-level "images").
    The file also carries "arModel" (size, nodes, label hotspots of heart_ar.glb). Full-size QA
    renders go to --qa (default data/derived/lab/qa) so a human can check every number against
    the images.

Geometry: DICOM LPS millimetres throughout; meshes use the web world frame (x = patient Left,
y = Superior, z = Anterior). All masks come from the TotalSegmentator runs on the thin_lung grid
(see anatomy.py / review_tools.py); HU statistics are taken on the smooth-kernel series, never on
the sharp lung-kernel series (6-12x noisier in blood; see the LAA-950 metric).
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import importlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import trimesh
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_tools as rt  # noqa: E402
from anatomy import CATALOG, reference_image, structure_mask  # noqa: E402
from common import DERIVED, WEB_PUBLIC, write_json  # noqa: E402

meshes04 = importlib.import_module("04_meshes")          # reuse mask_to_mesh / hex_rgba

REF = reference_image()                                   # thin_lung grid (all masks live here)
REF_VOX_ML = float(np.prod(REF.GetSpacing())) / 1000.0
TODAY = dt.datetime.now().isoformat(timespec="seconds")


# --------------------------------------------------------------------------- small helpers
def unit(v) -> np.ndarray:
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def cat_mask(name: str) -> np.ndarray:
    """Boolean mask (z,y,x) on the thin_lung grid, exactly as the 3D anatomy page uses it."""
    return structure_mask(next(s for s in CATALOG if s.name == name))


def cat_color(name: str) -> str:
    return next(s for s in CATALOG if s.name == name).color


def cat_display(name: str) -> str:
    return next(s for s in CATALOG if s.name == name).display


def bool_img(m: np.ndarray, like: sitk.Image = REF) -> sitk.Image:
    img = sitk.GetImageFromArray(m.astype(np.uint8))
    img.CopyInformation(like)
    return img


def to_grid(m: np.ndarray, target: sitk.Image) -> np.ndarray:
    """Nearest-neighbour resample of a thin_lung-grid mask onto another series' grid."""
    out = sitk.Resample(bool_img(m), target, sitk.Transform(), sitk.sitkNearestNeighbor, 0, sitk.sitkUInt8)
    return sitk.GetArrayFromImage(out).astype(bool)


def valid_slices(hu: np.ndarray) -> np.ndarray:
    """(z,1,1) mask of slices that hold real data. The scanner stored the top slice of the 3 mm
    axial series as pure padding (-8192, clipped to -1024 here); counting it as lung would add
    thousands of fake 'emphysema' voxels."""
    return (hu.reshape(hu.shape[0], -1).max(1) > -1023)[:, None, None]


def erode_xy(m: np.ndarray, mm: float, spacing, z_slices: int = 0) -> np.ndarray:
    """Erode in-plane by ~mm (and optionally by whole slices in z) to stay clear of edges."""
    out = m
    r = int(round(mm / spacing[0]))
    if r > 0:
        out = ndi.binary_erosion(out, structure=np.ones((1, 3, 3)), iterations=r)
    if z_slices > 0:
        out = out & ndi.binary_erosion(m, structure=np.ones((3, 1, 1)), iterations=z_slices)
    return out


def mask_points_lps(m: np.ndarray, img: sitk.Image = REF, stride: int = 1) -> np.ndarray:
    zz, yy, xx = np.nonzero(m)
    ijk = np.stack([xx, yy, zz], 1)[::stride].astype(float) * np.array(img.GetSpacing())
    D = np.array(img.GetDirection()).reshape(3, 3)
    return np.array(img.GetOrigin()) + ijk @ D.T


def slice_z(img: sitk.Image, k: int) -> float:
    return float(img.TransformIndexToPhysicalPoint((0, 0, int(k)))[2])


def r1(x: float, n: int = 1) -> float:
    return float(round(float(x), n))


# --------------------------------------------------------------------------- thumbnails
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size: int, bold: bool = False):
    p = FONT_BOLD if bold else FONT_PATH
    return ImageFont.truetype(p, size) if Path(p).exists() else ImageFont.load_default()


class Plane:
    """An oriented 2D sampling grid in LPS: columns run along ax1, rows along ax2."""

    def __init__(self, center, ax1, ax2, w_mm: float, h_mm: float, step: float):
        self.ax1, self.ax2 = unit(ax1), unit(ax2)
        self.ax3 = np.cross(self.ax1, self.ax2)
        self.step = step
        self.n1, self.n2 = int(round(w_mm / step)), int(round(h_mm / step))
        self.origin = (np.asarray(center, float) - self.ax1 * (self.n1 - 1) * step / 2
                       - self.ax2 * (self.n2 - 1) * step / 2)

    def _ref(self) -> sitk.Image:
        r = sitk.Image(self.n1, self.n2, 1, sitk.sitkFloat32)
        r.SetSpacing((self.step, self.step, 1.0))
        r.SetOrigin(tuple(float(v) for v in self.origin))
        r.SetDirection(tuple(float(v) for v in np.column_stack([self.ax1, self.ax2, self.ax3]).flatten()))
        return r

    def sample(self, img: sitk.Image, nearest: bool = False, default: float = -1024.0) -> np.ndarray:
        interp = sitk.sitkNearestNeighbor if nearest else sitk.sitkLinear
        out = sitk.Resample(img, self._ref(), sitk.Transform(), interp, default, sitk.sitkFloat32)
        return sitk.GetArrayFromImage(out)[0]

    def mask(self, m: np.ndarray) -> np.ndarray:
        return self.sample(bool_img(m), nearest=True, default=0) > 0.5

    def px(self, p) -> tuple[float, float]:
        d = np.asarray(p, float) - self.origin
        return float(d @ self.ax1 / self.step), float(d @ self.ax2 / self.step)

    def lps(self, col: float, row: float) -> np.ndarray:
        return self.origin + self.ax1 * col * self.step + self.ax2 * row * self.step


def axial_plane(center, w_mm, h_mm, step=0.35) -> Plane:
    # radiological axial: patient Right on image left (+x = L to the right), anterior at top (+y = P down)
    return Plane(center, (1, 0, 0), (0, 1, 0), w_mm, h_mm, step)


class Thumb:
    """Windowed slice + raster overlays + vector marks drawn after resizing (crisp text)."""

    def __init__(self, plane: Plane, hu: np.ndarray, window: tuple[float, float]):
        c, w = window
        g = np.clip((hu - (c - w / 2)) / w, 0, 1)
        self.rgb = np.stack([g, g, g], -1)
        self.plane = plane
        self.vec: list[tuple] = []

    def fill(self, m, color, alpha=0.45):
        col = np.array(color, float) / 255
        self.rgb[m] = self.rgb[m] * (1 - alpha) + col * alpha

    def outline(self, m, color, width=1):
        e = m & ~ndi.binary_erosion(m, iterations=width)
        self.rgb[e] = np.array(color, float) / 255

    def line(self, p1, p2, color=(255, 214, 10), width=2, ends=True):
        self.vec.append(("line", self.plane.px(p1), self.plane.px(p2), color, width, ends))

    def text(self, p, s, color=(255, 255, 255), size=15, bold=True, anchor="mm"):
        self.vec.append(("text", self.plane.px(p), s, color, size, bold, anchor))

    def text_px(self, xy, s, color=(255, 255, 255), size=13, bold=False, anchor="la"):
        self.vec.append(("textpx", xy, s, color, size, bold, anchor))

    def render(self, size: int = 420, scalebar_mm: float | None = 20) -> Image.Image:
        h, w = self.rgb.shape[:2]
        f = size / max(h, w)
        W, H = max(1, int(round(w * f))), max(1, int(round(h * f)))
        im = Image.fromarray((self.rgb * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        for v in self.vec:
            if v[0] == "line":
                (x1, y1), (x2, y2), col, wd, ends = v[1:]
                pts = [(x1 * f, y1 * f), (x2 * f, y2 * f)]
                d.line(pts, fill=(0, 0, 0), width=wd + 2)
                d.line(pts, fill=col, width=wd)
                if ends:
                    vx, vy = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
                    n = np.hypot(vx, vy) or 1
                    ox, oy = -vy / n * 6, vx / n * 6
                    for (px, py) in pts:
                        d.line([(px - ox, py - oy), (px + ox, py + oy)], fill=col, width=wd)
            elif v[0] in ("text", "textpx"):
                (x, y), s, col, sz, bold, anchor = v[1:]
                if v[0] == "text":
                    x, y = x * f, y * f
                fnt = font(sz, bold)
                for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1), (0, 1), (1, 0)):
                    d.text((x + dx, y + dy), s, font=fnt, fill=(0, 0, 0), anchor=anchor)
                d.text((x, y), s, font=fnt, fill=col, anchor=anchor)
        if scalebar_mm:
            L = scalebar_mm / self.plane.step * f
            d.line([(12, H - 14), (12 + L, H - 14)], fill=(0, 0, 0), width=5)
            d.line([(12, H - 14), (12 + L, H - 14)], fill=(255, 255, 255), width=3)
            fnt = font(12, True)
            for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                d.text((12 + dx, H - 32 + dy), f"{scalebar_mm:g} mm", font=fnt, fill=(0, 0, 0))
            d.text((12, H - 32), f"{scalebar_mm:g} mm", font=fnt, fill=(255, 255, 255))
        return im


def data_url(im: Image.Image, quality: int = 80) -> str:
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


class Shots:
    """Collect thumbnails: data URL for the web + full-size PNG for QA."""

    def __init__(self, qa: Path):
        self.qa = qa
        self.images: dict[str, dict] = {}
        qa.mkdir(parents=True, exist_ok=True)

    def add(self, name: str, im: Image.Image, caption: str, web_size: int = 400, quality: int = 78) -> str:
        """Returns the key metrics use to reference the image (stored once in report['images'])."""
        im.save(self.qa / f"{name}.png")
        small = im.copy()
        small.thumbnail((web_size, web_size), Image.LANCZOS)
        self.images[name] = {"src": data_url(small, quality), "caption": caption, "w": small.width, "h": small.height}
        return name


# =========================================================================== (1) AR heart GLB
AR_PARTS = [  # (structure, triangle budget) -> ~115k triangles total
    ("heart_myocardium", 21000),
    ("heart_ventricle_left", 9000),
    ("heart_ventricle_right", 17000),
    ("heart_atrium_left", 9000),
    ("heart_atrium_right", 12000),
    ("atrial_appendage_left", 3000),
    ("aorta", 15000),
    ("pulmonary_artery", 12000),
    ("pulmonary_vein", 8000),
    ("superior_vena_cava", 4500),
    ("inferior_vena_cava", 4500),
]
AR_DISPLAY = {"heart_myocardium": "Left ventricle muscle"}
# Who wins where two structures touch (outermost first). Each structure is carved 1 voxel away from
# everything earlier in this list, so independently smoothed surfaces can't interpenetrate (no
# z-fighting speckle in the viewer) and the LV cavity stays tucked inside its muscle.
AR_CARVE_ORDER = ["heart_ventricle_right", "heart_atrium_right", "aorta", "pulmonary_artery", "heart_myocardium",
                  "heart_atrium_left", "atrial_appendage_left", "pulmonary_vein", "superior_vena_cava",
                  "inferior_vena_cava", "heart_ventricle_left"]
# hotspot: (structure, label, preferred outward direction in the world frame x=L, y=S, z=A)
AR_HOTSPOTS = [
    ("heart_ventricle_right", "Right ventricle", (-0.15, -0.35, 1.0)),
    ("heart_myocardium", "Left ventricle", (0.9, -0.55, 0.35)),
    ("heart_atrium_right", "Right atrium", (-1.0, 0.0, 0.35)),
    ("heart_atrium_left", "Left atrium", (0.15, 0.25, -1.0)),
    ("aorta", "Aorta", (-0.25, 1.0, 0.6)),
    ("pulmonary_artery", "Pulmonary artery", (0.45, 0.8, 0.6)),
    ("superior_vena_cava", "Superior vena cava", (-0.7, 1.0, 0.1)),
    ("inferior_vena_cava", "Inferior vena cava", (-0.35, -1.0, 0.1)),
    ("atrial_appendage_left", "Left atrial appendage", (1.0, 0.35, 0.55)),
]


def build_ar_glb(out_path: Path) -> dict:
    manifest = json.loads((WEB_PUBLIC / "manifest.json").read_text())
    center = manifest["worldCenterLPS"]
    raw = {name: structure_mask(next(s for s in CATALOG if s.name == name)) for name, _ in AR_PARTS}
    carved, taken = {}, np.zeros_like(next(iter(raw.values())))
    for name in AR_CARVE_ORDER:
        m = raw[name] & ~ndi.binary_dilation(taken, iterations=1)
        carved[name] = m
        taken |= m
    parts = []
    for name, budget in AR_PARTS:
        s = next(s for s in CATALOG if s.name == name)
        m = carved[name]
        mesh = meshes04.mask_to_mesh(m, REF, center, s.sigma, keep=1.0, max_faces=budget)
        if mesh is None or len(mesh.faces) == 0:
            print(f"  ! {name}: no mesh")
            continue
        parts.append((s, mesh, float(raw[name].sum() * REF_VOX_ML)))
        print(f"  {name:24s} {len(mesh.faces):6d} tris")

    allv = np.concatenate([p[1].vertices for p in parts])
    lo, hi = allv.min(0), allv.max(0)
    c = (lo + hi) / 2
    size_mm = hi - lo

    scene = trimesh.Scene()
    nodes, hotspots = [], []
    for s, mesh, vol in parts:
        v = (np.asarray(mesh.vertices) - c) * 0.001           # mm -> m, centred on the bbox centre
        tm = trimesh.Trimesh(vertices=v, faces=np.asarray(mesh.faces), process=True)
        tm.fix_normals()
        rough = 0.42 if s.group == "vessels" else 0.5
        mat = trimesh.visual.material.PBRMaterial(name=s.name, baseColorFactor=meshes04.hex_rgba(s.color),
                                                  metallicFactor=0.0, roughnessFactor=rough, doubleSided=False)
        tm.visual = trimesh.visual.TextureVisuals(material=mat)
        scene.add_geometry(tm, node_name=s.name, geom_name=s.name)
        nodes.append({"name": s.name, "display": AR_DISPLAY.get(s.name, s.display), "color": s.color,
                      "group": s.group, "triangles": int(len(tm.faces)), "volumeML": r1(vol)})
        for hs_name, label, pref in AR_HOTSPOTS:
            if hs_name != s.name:
                continue
            dirn = unit(pref)
            cen = tm.vertices.mean(0)
            rel = tm.vertices - cen
            radial = rel / np.maximum(np.linalg.norm(rel, axis=1, keepdims=True), 1e-9)
            score = 0.65 * (radial @ dirn) + 0.35 * (tm.vertex_normals @ dirn)
            i = int(np.argmax(score))
            hotspots.append({"name": s.name, "label": label,
                             "position": [round(float(x), 5) for x in tm.vertices[i]],
                             "normal": [round(float(x), 4) for x in tm.vertex_normals[i]]})

    glb = scene.export(file_type="glb", include_normals=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(glb)
    tris = sum(n["triangles"] for n in nodes)
    # sanity: reload and check units / bounds
    chk = trimesh.load(str(out_path), force="scene")
    ext = chk.extents
    print(f"  heart_ar.glb: {tris} tris, {len(glb) / 1e6:.2f} MB, extents (m) {np.round(ext, 4)}")
    assert len(glb) < 4_000_000, "GLB too large"
    assert np.all(ext < 0.25) and np.all(ext > 0.05), "GLB should be in metres"
    return {
        "file": "mesh/heart_ar.glb", "bytes": len(glb), "triangles": int(tris),
        "units": "metres", "up": "+Y (head)", "front": "+Z (out of the chest)",
        "sizeMM": [r1(x) for x in size_mm],   # [width L-R, height S-I, depth A-P]
        "sizeNote": "Bounding box of the heart with the stubs of its great vessels that were inside the scan "
                    "(the aorta includes the part running down behind the heart).",
        "nodes": nodes, "hotspots": hotspots,
    }


# =========================================================================== (2) biomarkers
class Bio:
    def __init__(self, qa: Path):
        self.shots = Shots(qa)
        self.exam = json.loads((WEB_PUBLIC / "exam.json").read_text())
        self.metrics: list[dict] = []
        self.ct = {k: rt.vol(k) for k in ("calcium", "axial_st")}

    def add(self, **kw):
        kw.setdefault("viz", "gauge" if kw.get("gauge") else "none")
        self.metrics.append(kw)
        print(f"  {kw['key']:26s} {kw.get('display', kw['value'])} {kw['unit']}  [{kw['confidence']}]")

    # ------------------------------------------------------------------ heart
    def heart(self):
        names = ["heart", "heart_myocardium", "heart_ventricle_left", "heart_ventricle_right",
                 "heart_atrium_left", "heart_atrium_right", "atrial_appendage_left"]
        M = {n: cat_mask(n) for n in names}
        ml = {n: float(M[n].sum() * REF_VOX_ML) for n in names}
        self.heart_masks = M

        # thumbnail: calcium slice where all four chambers are best represented
        cal = self.ct["calcium"]
        ch = ["heart_atrium_right", "heart_atrium_left", "heart_ventricle_right", "heart_ventricle_left"]
        grid = {n: to_grid(M[n], cal.img) for n in ch + ["heart_myocardium"]}
        areas = np.stack([grid[n].sum((1, 2)) for n in ch], 1)
        k = int(np.argmax(areas.min(1)))
        hz = M["heart"].any((1, 2))
        pts = mask_points_lps(M["heart"], stride=50)
        cxy = pts[:, :2].mean(0)
        z = slice_z(cal.img, k)
        pl = axial_plane((cxy[0], cxy[1], z), 150, 135, 0.3)
        th = Thumb(pl, pl.sample(cal.img), (40, 350))
        short = {"heart_atrium_right": "RA", "heart_atrium_left": "LA", "heart_ventricle_right": "RV",
                 "heart_ventricle_left": "LV", "heart_myocardium": ""}
        for n in ["heart_myocardium"] + ch:
            m2 = pl.mask(M[n])
            col = tuple(int(cat_color(n)[i:i + 2], 16) for i in (1, 3, 5))
            th.fill(m2, col, 0.42)
            th.outline(m2, col)
            if short[n] and m2.any():
                yy, xx = np.nonzero(m2)
                th.text(pl.lps(xx.mean(), yy.mean()), short[n], size=17)
        th.text_px((10, 8), f"Calcium-score series · axial z = {z:.1f} mm", size=12)
        img_ch = self.shots.add("heart_chambers", th.render(),
                                "AI outlines of the chambers on one slice of the calcium scan (RA/RV blue = "
                                "oxygen-poor side, LA/LV red = oxygen-rich side).")
        link = {"series": "calcium", "lps": [r1(cxy[0]), r1(cxy[1]), r1(z)], "plane": "axial", "window": "soft"}

        chambers = [  # anatomical layout: patient right on the left of the screen
            {"key": "RA", "name": "heart_atrium_right", "label": "Right atrium", "ml": r1(ml["heart_atrium_right"]),
             "color": cat_color("heart_atrium_right"), "role": "receives blood from the body"},
            {"key": "LA", "name": "heart_atrium_left", "label": "Left atrium", "ml": r1(ml["heart_atrium_left"]),
             "color": cat_color("heart_atrium_left"), "role": "receives blood from the lungs"},
            {"key": "RV", "name": "heart_ventricle_right", "label": "Right ventricle", "ml": r1(ml["heart_ventricle_right"]),
             "color": cat_color("heart_ventricle_right"), "role": "pumps blood to the lungs"},
            {"key": "LV", "name": "heart_ventricle_left", "label": "Left ventricle", "ml": r1(ml["heart_ventricle_left"]),
             "color": cat_color("heart_ventricle_left"), "role": "pumps blood to the body"},
        ]
        total4 = sum(c["ml"] for c in chambers)
        phase = self.exam.get("ecg", {}).get("reconPhase", "76%")
        self.add(key="heart_volume", group="heart", label="Whole heart", value=round(ml["heart"]), unit="mL",
                 caption=f"Everything inside the heart's outline: four chambers plus walls. About "
                         f"{ml['heart'] / 355:.1f} soda cans' worth.",
                 context="Adult hearts are roughly fist-sized; volume depends on body size and on the moment in "
                         "the heartbeat. This is a size description, not a test result.",
                 method=f"TotalSegmentator v2 'heart' mask on the 1.5 mm thin series (0.74 x 0.74 x 0.75 mm voxels), "
                        f"voxel count x voxel volume. Image reconstructed at {phase} of the R-R interval (mid-diastole).",
                 confidence="AI estimate", series="thin_lung", status="info", image=img_ch, link=link)
        self.add(key="heart_chambers", group="heart", label="Blood in the four chambers", value=round(total4),
                 unit="mL", viz="chambers", detail={"chambers": chambers, "phase": phase},
                 caption="How much blood each chamber held at the moment the picture was taken (heart relaxing, "
                         "about three-quarters of the way through the beat).",
                 context="Without contrast dye, blood and heart muscle look the same grey on CT, so the AI infers the "
                         "inner walls from shape. Treat these as ballpark numbers; echo or MRI measure chambers properly, "
                         "and their normal ranges don't transfer directly to this.",
                 method="TotalSegmentator v1 cardiac model (LA, LV, RA, RV) on the thin series; voxel counts. "
                        f"Non-contrast, low-dose, ECG-triggered at {phase}.",
                 confidence="AI estimate", series="thin_lung", status="info", image=img_ch, link=link)
        myo = ml["heart_myocardium"]
        mass = myo * 1.05
        self.add(key="lv_mass", group="heart", label="Left-ventricle muscle mass", value=round(mass), unit="g",
                 display=f"{mass:.0f}",
                 caption=f"The main pumping muscle: {myo:.0f} mL of tissue, which weighs about {mass:.0f} g "
                         f"(heart muscle is 1.05 g per mL).",
                 context="Healthy adult men typically measure roughly 90-180 g on cardiac MRI (exact ranges vary by "
                         "method and body size). A thick, heavy wall can follow years of high blood pressure.",
                 method="TotalSegmentator v1 'heart_myocardium' (left-ventricular wall incl. septum) volume x 1.05 g/mL. "
                        "On non-contrast CT the inner wall border is inferred by the AI, so the split between muscle and "
                        "cavity is uncertain by perhaps +-20%.",
                 confidence="AI estimate", series="thin_lung", status="typical", statusLabel="in the typical range",
                 gauge={"min": 40, "max": 240, "zones": [
                     {"from": 40, "to": 90, "tone": "neutral", "label": "light"},
                     {"from": 90, "to": 180, "tone": "good", "label": "typical men (MRI)"},
                     {"from": 180, "to": 240, "tone": "warn", "label": "heavy"}], "ticks": [90, 180]},
                 image=img_ch, link=link)

    # ------------------------------------------------------------------ epicardial fat
    def fat(self):
        cal = self.ct["calcium"]
        sp = cal.spacing
        vml = float(np.prod(sp)) / 1000
        peri = to_grid(cat_mask("pericardium"), cal.img)
        H = np.zeros_like(peri)
        for n, m in self.heart_masks.items():
            H |= to_grid(m, cal.img)
        He = erode_xy(H, 3.0, sp)                                       # heart interior only
        fat = (cal.hu >= -190) & (cal.hu <= -30)
        eat = fat & peri & ~He
        v_eat = float(eat.sum() * vml)
        v_all = float((fat & peri).sum() * vml)
        v_strict = float((fat & peri & ~H).sum() * vml)
        mean_hu = float(cal.hu[eat].mean())
        # check the pericardium sits inside the 158 mm calcium field of view
        peri_ref = cat_mask("pericardium")
        assert abs(peri.sum() * vml - peri_ref.sum() * REF_VOX_ML) < 2.0, "pericardium clipped by calcium FOV"
        # blood-pool noise for the method text
        lv_core = erode_xy(to_grid(cat_mask("heart_ventricle_left"), cal.img), 4.0, sp, 1)
        noise = float(cal.hu[lv_core].std())
        thin = rt.vol("thin_lung")
        lv_thin = erode_xy(cat_mask("heart_ventricle_left"), 4.0, thin.spacing, 1)
        noise_thin = float(thin.hu[lv_thin].std())

        k = int(np.argmax(eat.sum((1, 2))))
        z = slice_z(cal.img, k)
        pts = mask_points_lps(peri_ref, stride=40)
        cxy = pts[:, :2].mean(0)
        pl = axial_plane((cxy[0], cxy[1], z), 140, 128, 0.3)
        hu2 = pl.sample(cal.img)
        th = Thumb(pl, hu2, (-40, 400))
        p2 = pl.mask(peri_ref)
        e2 = p2 & (hu2 >= -190) & (hu2 <= -30)
        # remove the heart-interior part on the thumbnail too
        hin = np.zeros_like(e2)
        for n, m in self.heart_masks.items():
            hin |= pl.mask(m)
        hin = ndi.binary_erosion(hin, iterations=int(round(3.0 / pl.step)))
        e2 &= ~hin
        th.fill(e2, (255, 200, 40), 0.65)
        th.outline(p2, (56, 214, 255))
        th.text_px((10, 8), f"Calcium-score series · z = {z:.1f} mm", size=12)
        th.text_px((10, 26), "yellow = fat inside the pericardium", size=12, color=(255, 210, 80))
        img = self.shots.add("epicardial_fat", th.render(),
                             "Fat (yellow) inside the pericardial sac (cyan outline), the fat that hugs the heart "
                             "and its coronary arteries.")
        self.add(key="epicardial_fat", group="fat_liver", label="Fat around the heart (epicardial)",
                 value=round(v_eat), unit="mL",
                 caption=f"About {v_eat:.0f} mL of fat sits inside the heart's sac, packed around the coronary "
                         f"arteries: roughly {v_eat / 15:.0f} tablespoons.",
                 context="Studies of middle-aged adults typically find roughly 50-150 mL, rising with age and weight. "
                         "More epicardial fat goes with more coronary plaque; there is no single agreed cut-off "
                         "and definitions differ between studies.",
                 method=(f"Calcium-score series (3 mm slices every 1.5 mm, 0.31 mm pixels, soft Sa36d kernel): the "
                         f"reconstruction epicardial-fat studies use on calcium scans. Its noise is low "
                         f"(SD {noise:.0f} HU in blood) and its 158 mm field of view contains the whole pericardium; the "
                         f"sharp thin series (SD {noise_thin:.0f} HU) would scatter muscle and air into the fat window. "
                         f"Fat = voxels from -190 to -30 HU inside the AI pericardium mask (TotalSegmentator "
                         f"trunk_cavities), excluding the heart's interior (chamber/heart masks eroded by 3 mm, so fat "
                         f"in the grooves on the heart's surface still counts). Subtracting the full heart masks instead "
                         f"gives {v_strict:.0f} mL (they swallow some groove fat); counting every fat voxel in the sac "
                         f"gives {v_all:.0f} mL. Mean fat density {mean_hu:.0f} HU."),
                 confidence="AI estimate", series="calcium", status="typical", statusLabel="in the typical range",
                 gauge={"min": 0, "max": 250, "zones": [
                     {"from": 0, "to": 50, "tone": "neutral", "label": "lean"},
                     {"from": 50, "to": 150, "tone": "good", "label": "typical adults"},
                     {"from": 150, "to": 250, "tone": "warn", "label": "high"}], "ticks": [50, 100, 150, 200]},
                 detail={"allFatInSac_mL": r1(v_all), "excludingFullHeartMasks_mL": r1(v_strict),
                         "meanHU": r1(mean_hu), "noiseSD_HU": r1(noise)},
                 image=img, link={"series": "calcium", "lps": [r1(cxy[0]), r1(cxy[1]), r1(z)], "plane": "axial",
                                  "window": "fat"})

    # ------------------------------------------------------------------ liver & spleen
    def liver(self):
        st = self.ct["axial_st"]
        sp = st.spacing
        out = {}
        for n in ("liver", "spleen"):
            m = to_grid(cat_mask(n), st.img)
            me = erode_xy(m, 5.0, sp, z_slices=1)
            h = st.hu[me]
            out[n] = {"mask": me, "full": m, "mean": float(h.mean()), "median": float(np.median(h)),
                      "sd": float(h.std()), "n": int(me.sum()), "ml": float(me.sum() * np.prod(sp) / 1000),
                      "slices": [int(i) for i in np.nonzero(me.any((1, 2)))[0]]}
        L, S = out["liver"]["mean"], out["spleen"]["mean"]
        diff = L - S
        # thumbnail: slice with the most combined ROI
        both = out["liver"]["mask"].sum((1, 2)) * (out["spleen"]["mask"].sum((1, 2)) > 0)
        k = int(np.argmax(both))
        z = slice_z(st.img, k)
        pl = axial_plane((-15.0, -175.0, z), 340, 250, 0.6)
        th = Thumb(pl, pl.sample(st.img), (60, 260))
        for n, col in (("liver", (255, 150, 60)), ("spleen", (190, 120, 255))):
            sl = np.zeros_like(out[n]["mask"]); sl[k] = out[n]["mask"][k]
            m2 = pl.sample(bool_img(sl, st.img), nearest=True, default=0) > 0.5
            th.fill(m2, col, 0.22)
            th.outline(m2, col, 2)
            if m2.any():
                yy, xx = np.nonzero(m2)
                th.text(pl.lps(xx.mean(), yy.mean()), f"{'Liver' if n == 'liver' else 'Spleen'} {out[n]['mean']:.0f} HU",
                        size=16)
        th.text_px((10, 8), f"Chest soft-tissue series · z = {z:.1f} mm (bottom of the scan)", size=12)
        img = self.shots.add("liver_spleen", th.render(460), quality=70, caption=(
                             "Measurement regions (outlined) in the top of the liver and the tip of the spleen, "
                             "kept 5 mm away from every edge."))
        link = {"series": "axial_st", "lps": [-15.0, -175.0, r1(z)], "plane": "axial", "window": "liver"}
        method_common = ("Chest soft-tissue series (3 mm, Br40d kernel, 120 kV: the energy the published cut-offs "
                         "assume). AI masks (TotalSegmentator) shrunk 5 mm in-plane and one slice up/down so no "
                         "edge, rib or lung pixels leak in; mean HU of all remaining voxels. Only the top of the "
                         "liver and spleen are inside this heart scan.")
        self.add(key="liver_hu", group="fat_liver", label="Liver density", value=round(L), unit="HU",
                 caption="Fat makes the liver look darker on CT. A healthy liver is brighter than 40 HU.",
                 context="Non-contrast CT: liver under 40 HU suggests at least moderate fatty liver; healthy livers "
                         "usually sit around 50-70 HU.",
                 method=method_common + f" Liver: {out['liver']['n']:,} voxels ({out['liver']['ml']:.0f} mL), "
                                        f"SD {out['liver']['sd']:.0f} HU, median {out['liver']['median']:.0f} HU.",
                 confidence="measured", series="axial_st",
                 status="typical" if L >= 40 else "high", statusLabel="no sign of fatty liver" if L >= 40 else "suggests fatty liver",
                 gauge={"min": 0, "max": 90, "zones": [
                     {"from": 0, "to": 40, "tone": "warn", "label": "fatty liver likely"},
                     {"from": 40, "to": 90, "tone": "good", "label": "normal"}], "ticks": [40]},
                 image=img, link=link)
        self.add(key="spleen_hu", group="fat_liver", label="Spleen density (reference)", value=round(S), unit="HU",
                 caption="The spleen doesn't store fat, so it's the yardstick the liver is compared against.",
                 context="Typical non-contrast spleen: about 40-60 HU.",
                 method=method_common + f" Spleen: {out['spleen']['n']:,} voxels ({out['spleen']['ml']:.0f} mL), "
                                        f"SD {out['spleen']['sd']:.0f} HU.",
                 confidence="measured", series="axial_st", status="info", image=img, link=link)
        self.add(key="liver_minus_spleen", group="fat_liver", label="Liver minus spleen", value=round(diff),
                 unit="HU", display=f"{diff:+.0f}",
                 caption=("Liver brighter than spleen: the healthy pattern." if diff >= 0 else
                          "Liver slightly darker than spleen." if diff > -10 else
                          "Liver clearly darker than spleen, a sign of fat in the liver."),
                 context="Below -10 HU (liver much darker than spleen) suggests fatty liver; healthy livers usually "
                         "read a few HU brighter than the spleen.",
                 method=method_common, confidence="measured", series="axial_st",
                 status="typical" if diff > -10 else "high",
                 statusLabel="normal pattern" if diff > -10 else "suggests fatty liver",
                 gauge={"min": -30, "max": 30, "zones": [
                     {"from": -30, "to": -10, "tone": "warn", "label": "fatty liver likely"},
                     {"from": -10, "to": 0, "tone": "neutral", "label": "grey zone"},
                     {"from": 0, "to": 30, "tone": "good", "label": "normal"}], "ticks": [-10, 0]},
                 image=img, link=link)

    # ------------------------------------------------------------------ spine
    def spine(self):
        st = self.ct["axial_st"]
        sp = st.spacing
        v1 = sitk.GetArrayFromImage(rt._seg("total_v1"))
        ids = {v: k for k, v in rt.label_names("total_v1").items()}
        body = sitk.GetArrayFromImage(rt._seg("vertebrae_body")) == 1
        zmin, zmax = slice_z(REF, 0), slice_z(REF, REF.GetSize()[2] - 1)
        levels = []
        level_masks = {}
        for L in ["T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"]:
            m = body & (v1 == ids[f"vertebrae_{L}"])
            vol = float(m.sum() * REF_VOX_ML)
            if vol < 3.0:
                continue
            zz = np.nonzero(m.any((1, 2)))[0]
            z0, z1 = slice_z(REF, zz.min()), slice_z(REF, zz.max())
            partial = (z1 >= zmax - 1.0) or (z0 <= zmin + 1.0)
            ms = erode_xy(to_grid(m, st.img), 3.0, sp, z_slices=1)
            h = st.hu[ms]
            if h.size < 200:
                continue
            levels.append({"level": L, "meanHU": r1(h.mean()), "medianHU": r1(np.median(h)), "sd": r1(h.std()),
                           "n": int(ms.sum()), "bodyML": r1(vol), "partial": bool(partial),
                           "zRange": [r1(z0), r1(z1)]})
            level_masks[L] = m
        full = [l for l in levels if not l["partial"]]
        avg = float(np.mean([l["meanHU"] for l in full]))
        # thumbnail: native sagittal soft-tissue slice through the spinal canal
        cord = cat_mask("spinal_cord")
        cp = mask_points_lps(cord, stride=20).mean(0)
        sag = sitk.ReadImage(str(rt.NIFTI / "sag_st.nii.gz"))
        allb = np.zeros_like(body)
        for m in level_masks.values():
            allb |= m
        bp = mask_points_lps(allb, stride=20)
        center = (cp[0], float(bp[:, 1].mean()) - 4, (zmin + zmax) / 2)
        pl = Plane(center, (0, 1, 0), (0, 0, -1), 120, 150, 0.3)     # anterior left, superior top
        th = Thumb(pl, pl.sample(sag), (300, 1500))
        palette = [(56, 214, 255), (62, 224, 143)]
        for i, l in enumerate(levels):
            m2 = pl.mask(level_masks[l["level"]])
            col = palette[i % 2] if not l["partial"] else (150, 160, 175)
            th.outline(m2, col, 2)
            if m2.any():
                yy, xx = np.nonzero(m2)
                p = pl.lps(xx.min() - 4, yy.mean())
                th.text(p, f"{l['level']}  {l['meanHU']:.0f} HU", size=15, color=col, anchor="rm")
        th.text_px((10, 8), "Sagittal soft-tissue series · spine", size=12)
        img = self.shots.add("spine_levels", th.render(420),
                             "Each vertebral body the scan covers, labelled with its inner (trabecular) bone density. "
                             "Grey = only partly inside the scan.")
        self.add(key="spine_density", group="bones", label="Spine bone density",
                 value=round(avg), unit="HU",
                 caption=f"Average inner-bone density of the fully scanned vertebrae "
                         f"({full[0]['level']}-{full[-1]['level']}): comfortably dense.",
                 context="An opportunistic screen, not a DEXA scan. At the L1 vertebra, values above ~160 HU make "
                         "osteoporosis unlikely and values under ~110 HU make it likely; mid-back vertebrae read about "
                         "the same or a little higher than L1, so the comparison is approximate.",
                 method=("Vertebral bodies from TotalSegmentator's vertebrae_body task, split into levels with the v1 "
                         "vertebra labels (v1's level boundaries matched the rib attachments for ribs 7-11; v2 "
                         "mislabelled the top two bodies). Masks moved onto the chest soft-tissue series (3 mm, Br40d, "
                         "120 kV), shrunk 3 mm in-plane and one slice in z to drop the hard outer shell; mean HU of the "
                         "spongy bone inside. Bodies cut by the edge of the scan are shown but not averaged."),
                 confidence="measured", series="axial_st", viz="levels",
                 status="typical" if avg >= 160 else ("borderline" if avg >= 110 else "low"),
                 statusLabel="healthy density" if avg >= 160 else "lower than ideal",
                 gauge={"min": 0, "max": 320, "zones": [
                     {"from": 0, "to": 110, "tone": "warn", "label": "low"},
                     {"from": 110, "to": 160, "tone": "neutral", "label": "grey zone"},
                     {"from": 160, "to": 320, "tone": "good", "label": "healthy"}], "ticks": [110, 160]},
                 detail={"levels": levels, "thresholds": [{"hu": 160, "label": "osteoporosis unlikely above (L1)"},
                                                          {"hu": 110, "label": "osteoporosis likely below (L1)"}]},
                 image=img, link={"series": "sag_st", "lps": [r1(center[0]), r1(center[1]), r1(center[2])],
                                  "plane": "sagittal", "window": "bone"})

    # ------------------------------------------------------------------ lungs
    def lungs(self):
        lobes = [("lung_upper_lobe_right", "RUL", "R"), ("lung_middle_lobe_right", "RML", "R"),
                 ("lung_lower_lobe_right", "RLL", "R"), ("lung_upper_lobe_left", "LUL", "L"),
                 ("lung_lower_lobe_left", "LLL", "L")]
        M = {n: cat_mask(n) for n, _, _ in lobes}
        vols = {n: float(M[n].sum() * REF_VOX_ML) for n in M}
        R = sum(vols[n] for n, _, s in lobes if s == "R") / 1000
        Lf = sum(vols[n] for n, _, s in lobes if s == "L") / 1000
        cr = self.exam.get("clearRead", {})
        lung = np.zeros_like(next(iter(M.values())))
        for m in M.values():
            lung |= m
        thin = rt.vol("thin_lung")
        zz = np.nonzero(lung.any((1, 2)))[0]
        cover_mm = (zz.max() - zz.min() + 1) * thin.spacing[2]
        # thumbnail: coronal slab through the lungs (thin series, lightly smoothed for display)
        cp = mask_points_lps(lung, stride=200).mean(0)
        pl = Plane((cp[0], cp[1] + 8, cp[2]), (1, 0, 0), (0, 0, -1), 330, 160, 0.6)
        thin_s = sitk.SmoothingRecursiveGaussian(thin.img, 0.8)
        th = Thumb(pl, pl.sample(thin_s), (-600, 1500))
        for n, short, side in lobes:
            m2 = pl.mask(M[n])
            col = tuple(int(cat_color(n)[i:i + 2], 16) for i in (1, 3, 5))
            th.fill(m2, col, 0.38)
            th.outline(m2, col)
            if m2.any():
                yy, xx = np.nonzero(m2)
                th.text(pl.lps(xx.mean(), yy.mean()), short, size=15)
        th.text_px((10, 8), "Coronal view of the scanned lungs (front-to-back slice)", size=12)
        img = self.shots.add("lung_lobes", th.render(460),
                             "The five lung lobes as far as the scan reaches. The tops of the lungs are above the scan.")
        detail = {"lobes": [{"key": short, "name": n, "label": cat_display(n), "side": side, "ml": r1(vols[n]),
                             "color": cat_color(n)} for n, short, side in lobes],
                  "rightL": round(R, 2), "leftL": round(Lf, 2),
                  "clearRead": {"rightL": cr.get("lungVolumeRightL"), "leftL": cr.get("lungVolumeLeftL")},
                  "coverageMM": r1(cover_mm)}
        self.add(key="lung_volume", group="lungs", label="Lung volume inside the scan", value=round(R + Lf, 2),
                 unit="L", display=f"{R + Lf:.1f}",
                 caption=f"Right {R:.1f} L + left {Lf:.1f} L of lung inside the {cover_mm / 10:.0f} cm slab the scan "
                         f"covered. The scan targets the heart, so the lung tops are cut off.",
                 context=(f"The hospital's ClearRead CT software reported {cr.get('lungVolumeRightL')} L right and "
                          f"{cr.get('lungVolumeLeftL')} L left: close to these AI numbers, and also limited to the "
                          f"scanned part. Whole lungs hold roughly 6 L in a deep breath, so this is not a lung-function "
                          f"test."),
                 method="TotalSegmentator v2 lobe masks on the 1.5 mm thin series; voxel counts. Breath-hold "
                        "inspiration, partial coverage (heart scan range only).",
                 confidence="AI estimate", series="thin_lung", viz="lobes", status="info", detail=detail, image=img,
                 link={"series": "thin_lung", "lps": [r1(cp[0]), r1(cp[1] + 8), r1(cp[2])], "plane": "coronal",
                       "window": "lung"})
        self.lung_mask = lung
        self.lobe_masks = M

    def emphysema(self):
        airway = cat_mask("lung_airways") | cat_mask("trachea")
        par = self.lung_mask & ~ndi.binary_dilation(airway, iterations=1)
        res = {}
        for key in ("axial_st", "axial_lung"):
            v = rt.vol(key)
            m = erode_xy(to_grid(par, v.img), v.spacing[0] * 2.01, v.spacing) & valid_slices(v.hu)   # 2 voxels in-plane: drops the kernel's dark undershoot rim along the pleura
            h = v.hu[m]
            res[key] = {"laa950": 100 * float((h < -950).mean()), "mean": float(h.mean()),
                        "p15": float(np.percentile(h, 15)), "n": int(m.sum())}
        st = rt.vol("axial_st")
        per_lobe = []
        for n, m in self.lobe_masks.items():
            mm = erode_xy(to_grid(m & par, st.img), st.spacing[0] * 2.01, st.spacing) & valid_slices(st.hu)
            h = st.hu[mm]
            per_lobe.append({"name": n, "label": cat_display(n), "laa950": r1(100 * (h < -950).mean()),
                             "meanHU": r1(h.mean())})
        # image noise of both kernels: SD inside the (uniform) blood of the aorta, edges eroded
        ao = cat_mask("aorta")
        noise = {}
        for key in ("axial_st", "axial_lung"):
            v = rt.vol(key)
            am = erode_xy(to_grid(ao, v.img), 4.0, v.spacing, z_slices=1)
            noise[key] = float(v.hu[am].std())
        soft, sharp = res["axial_st"], res["axial_lung"]
        # thumbnail
        # thumbnail slice: most lung, but clear of the liver dome (a dome tip clipped by a 3 mm slice
        # looks like a hazy ball in the lung window and would only cause worry)
        area = to_grid(par, st.img).sum((1, 2)).astype(float)
        liver_g = to_grid(cat_mask("liver"), st.img).any((1, 2))
        near_liver = ndi.binary_dilation(liver_g, iterations=3)
        area[near_liver] = -1
        k = int(np.argmax(area))
        z = slice_z(st.img, k)
        pl = axial_plane((-12.0, -175.0, z), 330, 230, 0.6)
        hu2 = pl.sample(st.img)
        th = Thumb(pl, hu2, (-700, 1000))
        m2 = pl.mask(par)
        low = m2 & (hu2 < -950)
        th.fill(low, (255, 70, 90), 0.9)
        th.outline(m2, (56, 214, 255))
        th.text_px((10, 8), f"Soft-tissue series, lung window · z = {z:.1f} mm", size=12)
        th.text_px((10, 26), "red = lung pixels darker than -950 HU", size=12, color=(255, 120, 130))
        img = self.shots.add("emphysema_map", th.render(460),
                             "Red marks lung pixels below -950 HU on the smooth-kernel series. They are scattered "
                             "specks, mostly in the front of the lungs (normal gravity effect plus image noise), "
                             "not clustered holes.")
        self.add(key="laa950", group="lungs", label="Emphysema index (LAA-950)", value=r1(soft["laa950"]), unit="%",
                 display=f"{soft['laa950']:.1f}",
                 caption="Share of lung so dark (below -950 HU) that it could be emphysema, the air-trapping damage "
                         "from smoking. Here it is mostly image noise.",
                 context=("Under about 5% is generally read as normal on standard-dose, smooth-kernel scans. This scan is "
                          "low-dose and only covers part of the lungs, both of which push the number up. The same "
                          f"calculation on the sharp lung-kernel series gives a meaningless {sharp['laa950']:.0f}% because "
                          f"its noise (SD {noise['axial_lung']:.0f} HU in blood vs {noise['axial_st']:.0f} HU on the smooth "
                          "series) pushes normal lung below -950 HU."),
                 method=(f"Lung = the five AI lobe masks minus airways (dilated 1 voxel), shrunk 2 voxels in-plane (drops the dark undershoot rim the image filter leaves along the pleura; same approach as the AI second read); the scanner's blank padding slice at the top is skipped; "
                         f"percentage of voxels below -950 HU. Reported on the 3 mm smooth Br40d series "
                         f"(emphysema scoring calls for a smooth kernel); mean lung density {soft['mean']:.0f} HU, "
                         f"15th percentile {soft['p15']:.0f} HU. Sharp Bl64d lung series for comparison: "
                         f"{sharp['laa950']:.0f}% (15th percentile clipped at {sharp['p15']:.0f} HU)."),
                 confidence="rough", series="axial_st",
                 status="typical" if soft["laa950"] < 5 else "borderline",
                 statusLabel="under the usual cut-off" if soft["laa950"] < 5 else "near the usual cut-off",
                 gauge={"min": 0, "max": 15, "zones": [
                     {"from": 0, "to": 5, "tone": "good", "label": "normal"},
                     {"from": 5, "to": 10, "tone": "neutral", "label": "mild"},
                     {"from": 10, "to": 15, "tone": "warn", "label": "emphysema"}], "ticks": [5, 10]},
                 detail={"softKernel": {k2: r1(v2) for k2, v2 in soft.items() if k2 != "n"},
                         "sharpKernel": {k2: r1(v2) for k2, v2 in sharp.items() if k2 != "n"},
                         "bloodNoiseSD": {k2: r1(v2) for k2, v2 in noise.items()}, "perLobe": per_lobe},
                 image=img, link={"series": "axial_st", "lps": [-12.0, -175.0, r1(z)], "plane": "axial",
                                  "window": "lung"})

    # ------------------------------------------------------------------ vessels
    def aorta(self):
        rm = self.exam.get("radiologistMeasurement") or {}
        p1, p2 = (np.array(p, float) for p in rm["pointsLPS"])
        dmm = float(rm["lengthMM"])
        st = self.ct["axial_st"]
        z = float(p1[2])
        mid = (p1 + p2) / 2
        # AI cross-check: the aorta outline on the same slice, component under the caliper midpoint
        ao = to_grid(cat_mask("aorta"), st.img)
        k = int(round(st.ijk(mid)[2]))
        lab, n = ndi.label(ao[k])
        i, j, _ = st.ijk(mid)
        L = lab[int(round(j)), int(round(i))]
        xcheck = None
        if L:
            c = lab == L
            yy, xx = np.nonzero(c)
            pts = np.stack([xx * st.spacing[0], yy * st.spacing[1]], 1)
            angs = np.deg2rad(np.arange(0, 180, 2))
            proj = pts @ np.stack([np.cos(angs), np.sin(angs)])
            widths = proj.max(0) - proj.min(0) + st.spacing[0]
            area = c.sum() * st.spacing[0] * st.spacing[1]
            xcheck = {"eqDiameter": r1(2 * np.sqrt(area / np.pi)), "minFeret": r1(widths.min()), "maxFeret": r1(widths.max())}
        pl = axial_plane((mid[0] + 8, mid[1] + 10, z), 120, 100, 0.25)
        th = Thumb(pl, pl.sample(st.img), (50, 350))
        th.line(p1, p2, (255, 214, 10), 2)
        th.text(mid + np.array([0, -24.0, 0]), f"{dmm:.1f} mm", size=17, color=(255, 214, 10))
        th.text_px((10, 8), f"Chest soft-tissue series · z = {z:.2f} mm (radiologist's slice)", size=12)
        img = self.shots.add("ascending_aorta", th.render(),
                             "The radiologist's caliper across the ascending aorta, on the exact slice they used.")
        self.aorta_mm = dmm
        self.add(key="ascending_aorta", group="vessels", label="Ascending aorta", value=r1(dmm), unit="mm",
                 caption="The main artery leaving the heart, measured across by the radiologist.",
                 context="In adult men the ascending aorta is usually under about 40 mm (it grows slowly with age and "
                         "body size); radiologists start calling it dilated from around 40-45 mm.",
                 method=("Radiologist's caliper on the chest soft-tissue series (instance 13), recovered from the "
                         "DICOM presentation state." + (
                             f" AI cross-check on the same slice: area-equivalent diameter {xcheck['eqDiameter']} mm "
                             f"(narrowest-widest {xcheck['minFeret']}-{xcheck['maxFeret']} mm)." if xcheck else "")),
                 confidence="measured", series="axial_st", status="typical" if dmm < 40 else "borderline",
                 statusLabel="normal size" if dmm < 40 else "upper limit",
                 gauge={"min": 20, "max": 50, "zones": [
                     {"from": 20, "to": 40, "tone": "good", "label": "normal"},
                     {"from": 40, "to": 45, "tone": "neutral", "label": "borderline"},
                     {"from": 45, "to": 50, "tone": "warn", "label": "dilated"}], "ticks": [30, 40, 45]},
                 detail={"aiCrossCheck": xcheck, "by": "radiologist"}, image=img,
                 link={"series": "axial_st", "lps": [r1(mid[0]), r1(mid[1]), r1(z, 2)], "plane": "axial",
                       "window": "mediastinum"})

    def pulmonary_artery(self):
        res = measure_mpa(self.ct["calcium"], cat_mask("pulmonary_artery"), self.shots)
        D = res["diameter"]
        ratio = D / self.aorta_mm
        self.add(key="main_pa", group="vessels", label="Main pulmonary artery", value=r1(D), unit="mm",
                 caption="The artery carrying blood from the heart to the lungs, measured just before it splits in two. "
                         "A wide one can be a sign of high blood pressure in the lungs.",
                 context="Framingham Heart Study (non-contrast heart CT, like this one): normal upper limit 29 mm in "
                         "men (27 mm in women).",
                 method=res["method"], confidence="measured", series="calcium",
                 status="typical" if D < 29 else "high", statusLabel="normal size" if D < 29 else "enlarged",
                 gauge={"min": 15, "max": 40, "zones": [
                     {"from": 15, "to": 29, "tone": "good", "label": "normal (men)"},
                     {"from": 29, "to": 40, "tone": "warn", "label": "enlarged"}], "ticks": [20, 29, 35]},
                 detail={k: v for k, v in res.items() if k not in ("method", "image")}, image=res["image"],
                 link={"series": "calcium", "lps": res["centerLPS"], "plane": "axial", "window": "mediastinum"})
        self.add(key="pa_ao_ratio", group="vessels", label="Pulmonary artery : aorta ratio", value=round(ratio, 2),
                 unit="", display=f"{ratio:.2f}",
                 caption="The pulmonary artery should be narrower than the aorta beside it.",
                 context="Framingham: ratios under 0.9 are normal; above 1.0 suggests raised lung blood pressure.",
                 method=f"Main pulmonary artery ({D:.1f} mm, above) divided by the radiologist's ascending aorta "
                        f"({self.aorta_mm:.1f} mm) at the same level.",
                 confidence="measured", series="calcium", status="typical" if ratio < 0.9 else "high",
                 statusLabel="normal" if ratio < 0.9 else "raised",
                 gauge={"min": 0.5, "max": 1.3, "zones": [
                     {"from": 0.5, "to": 0.9, "tone": "good", "label": "normal"},
                     {"from": 0.9, "to": 1.0, "tone": "neutral", "label": "borderline"},
                     {"from": 1.0, "to": 1.3, "tone": "warn", "label": "raised"}], "ticks": [0.9, 1.0]},
                 link={"series": "calcium", "lps": res["centerLPS"], "plane": "axial", "window": "mediastinum"})

    # ------------------------------------------------------------------ radiation
    def radiation(self) -> dict:
        d = self.exam["dose"]
        dlp = float(d["dlpTotal_mGycm"])
        k = 0.014
        e = dlp * k
        bg_year = 3.1
        eq = [
            {"key": "background_days", "label": "days of natural background radiation", "value": r1(e / (bg_year / 365), 0),
             "unit": "days", "per": "US average 3.1 mSv per year", "icon": "sun"},
            {"key": "chest_xrays", "label": "chest X-rays", "value": r1(e / 0.02, 0), "unit": "X-rays",
             "per": "0.02 mSv each (front view)", "icon": "xray"},
            {"key": "flights", "label": "coast-to-coast flights", "value": r1(e / 0.035, 1), "unit": "flights",
             "per": "about 0.035 mSv per US cross-country flight (cosmic rays)", "icon": "plane"},
            {"key": "bananas", "label": "bananas", "value": round(e * 1000 / 0.1, -1), "unit": "bananas",
             "per": "0.1 µSv each (natural potassium-40)", "icon": "banana"},
        ]
        self.add(key="dlp", group="radiation", label="Scanner dose report (DLP)", value=dlp, unit="mGy·cm",
                 display=f"{dlp:.2f}",
                 caption="The scanner's own tally of radiation delivered along the scanned length.",
                 context=f"CTDIvol {d['ctdivol_mGy']} mGy, size-specific dose {d['ssde_mGy']} mGy for a "
                         f"{d['waterEquivalentDiameter_cm']} cm-wide body. A typical full chest CT is several times higher.",
                 method=f"Siemens dose report (DICOM structured report): {d['mode']}, {d['kvp']} kV, "
                        f"{d['rotationTime_s']} s rotation.",
                 confidence="measured", series="dose report", status="info", viz="specs",
                 detail={"items": [
                     {"k": "CTDIvol", "v": d["ctdivol_mGy"], "unit": "mGy", "hint": "dose inside a standard plastic phantom"},
                     {"k": "Size-specific dose", "v": d["ssde_mGy"], "unit": "mGy",
                      "hint": f"adjusted to my {d['waterEquivalentDiameter_cm']} cm water-equivalent body width"},
                     {"k": "Tube voltage", "v": d["kvp"], "unit": "kV", "hint": "standard for calcium scoring"},
                     {"k": "Rotation", "v": d["rotationTime_s"], "unit": "s", "hint": "one turn of the X-ray tube"},
                     {"k": "Mode", "v": "ECG-triggered, 4 steps", "unit": "",
                      "hint": "X-rays only fired at the chosen moment of each heartbeat"}]})
        self.add(key="effective_dose", group="radiation", label="Effective dose", value=round(e, 2), unit="mSv",
                 display=f"{e:.2f}", viz="radiation",
                 caption=f"About {e / (bg_year / 365):.0f} days of the natural radiation everyone absorbs anyway.",
                 context="Effective dose converts the scan into whole-body risk terms. The everyday comparisons use "
                         "rounded reference values.",
                 method=(f"DLP {dlp} mGy·cm x k = {k} mSv/(mGy·cm), the standard adult chest conversion factor. "
                         f"Some cardiac-imaging groups use a heart-specific k = 0.026, which would give "
                         f"{dlp * 0.026:.1f} mSv; still a low dose."),
                 confidence="rough", series="dose report", status="info",
                 detail={"equivalents": eq, "k": k, "dlp": dlp, "kCardiac": 0.026, "mSvCardiacK": r1(dlp * 0.026, 2),
                         "backgroundPerYear_mSv": bg_year})
        return {"dlp_mGycm": dlp, "k": k, "effective_mSv": round(e, 3), "equivalents": eq}


# --------------------------------------------------------------------------- MPA measurement
def measure_mpa(cal, pa_mask: np.ndarray, shots: Shots) -> dict:
    """Main pulmonary artery diameter, perpendicular to the vessel's own axis, just before the
    bifurcation (double-oblique reformat of the calcium-score series: soft kernel, 0.31 mm pixels).

    1. Start in the lowest 6 mm of the AI pulmonary-artery mask (just above the valve), heading
       toward the mask's centroid within 25 mm.
    2. Find the true vessel axis as the direction whose perpendicular cut through the mask has the
       smallest area (a slanted cut through a tube is always larger), re-centre on the cut's
       centroid, and repeat while stepping up the trunk.
    3. Walk along that axis in 2 mm steps. The cross-section stays round until the trunk starts to
       split: the bifurcation is where the widest/narrowest ratio first exceeds 1.35 (twice in a row).
    4. On the 4 planes 2-8 mm before the split (each re-squared to the local axis), measure (a) the
       AI outline's area-equivalent diameter and (b) edge-to-edge diameters from intensity profiles
       in 36 directions (edge = half-way between blood and the darker tissue outside, fat or lung),
       keeping only directions with a clear edge on both sides. Diameter = mean of (a) and the
       median of (b), averaged over the planes.
    """
    img = cal.img
    pa_img = bool_img(pa_mask)
    P = mask_points_lps(pa_mask)
    zmin = P[:, 2].min()
    base = P[P[:, 2] < zmin + 6].mean(0)
    near = P[np.linalg.norm(P - base, axis=1) < 25]
    axis = unit(near.mean(0) - base)
    STEP = 0.25

    def frame(d):
        a = unit(np.cross(d, [0, 0, 1.0]))
        b = unit(np.cross(d, a))
        return a, (b if b[2] >= 0 else -b)

    def section(p, d, half=32.0, step=STEP):
        a, b = frame(d)
        pl = Plane(p, a, b, 2 * half, 2 * half, step)
        mk = pl.sample(pa_img, nearest=True, default=0) > 0.5
        lab, n = ndi.label(mk)
        if n == 0:
            return None
        cx = cy = (pl.n1 - 1) / 2
        best, bd = None, 1e9
        for L in range(1, n + 1):
            yy, xx = np.nonzero(lab == L)
            if len(yy) * step * step < 20:
                continue
            dist = np.min(np.hypot(yy - cy, xx - cx)) * step
            if dist < bd:
                best, bd = L, dist
        if best is None or bd > 8:
            return None
        comp = lab == best
        yy, xx = np.nonzero(comp)
        pts = np.stack([xx * step, yy * step], 1)
        angs = np.deg2rad(np.arange(0, 180, 3))
        proj = pts @ np.stack([np.cos(angs), np.sin(angs)])
        w = proj.max(0) - proj.min(0) + step
        area = comp.sum() * step * step
        return {"plane": pl, "comp": comp, "area": float(area), "eqD": 2 * np.sqrt(area / np.pi),
                "fmin": float(w.min()), "fmax": float(w.max()), "ratio": float(w.max() / max(w.min(), 1e-6)),
                "center": pl.lps(xx.mean(), yy.mean()), "cxy": (xx.mean(), yy.mean())}

    def min_area_axis(p, d, cone=36.0, step_deg=3.0):
        a, b = frame(d)
        best = (1e18, d)
        for ta in np.arange(-cone, cone + 1e-6, step_deg):
            for tb in np.arange(-cone, cone + 1e-6, step_deg):
                if ta * ta + tb * tb > cone * cone:
                    continue
                dd = unit(d + np.tan(np.deg2rad(ta)) * a + np.tan(np.deg2rad(tb)) * b)
                s = section(p, dd, half=24.0, step=0.5)
                if s is not None and s["area"] < best[0]:
                    best = (s["area"], dd)
        return best[1]

    # 1-2) square up on the trunk while stepping upward from the valve end
    p = base + axis * 8
    for _ in range(4):
        axis = min_area_axis(p, axis)
        s = section(p, axis)
        p = s["center"] + axis * 4
    axis = min_area_axis(p, axis, cone=12, step_deg=1.5)
    anchor = section(p, axis)["center"]
    # 3) walk forward to the bifurcation
    t_bif = None
    prev = None
    for t in np.arange(0, 60, 2.0):
        s = section(anchor + t * axis, axis)
        if s is None:
            break
        if prev is not None and prev[1]["ratio"] > 1.35 and s["ratio"] > 1.35:
            t_bif = prev[0]
            break
        prev = (t, s)
    if t_bif is None:
        t_bif = prev[0]
    # also walk backward so the long-axis figure can show the trunk
    def edge_diams(s):
        pl, comp = s["plane"], s["comp"]
        hu = ndi.gaussian_filter(pl.sample(img), 0.5 / STEP)
        cx, cy = s["cxy"]
        inner = ndi.binary_erosion(comp, iterations=int(4 / STEP))
        lumen = float(np.median(hu[inner])) if inner.any() else float(np.median(hu[comp]))
        rs = np.arange(0, 26, STEP / 2)
        rad = {}
        for deg in range(0, 360, 5):
            th = np.deg2rad(deg)
            prof = ndi.map_coordinates(hu, [cy + np.sin(th) * rs / STEP, cx + np.cos(th) * rs / STEP], order=1,
                                       mode="nearest")
            drop = np.nonzero(prof < lumen - 50)[0]
            if not len(drop):
                rad[deg] = None
                continue
            i0 = drop[0]
            j = i0
            while j + 1 < len(prof) and prof[j + 1] <= prof[j] and rs[j] - rs[i0] < 4:
                j += 1
            lo = prof[j]
            if lumen - lo < 80:                     # no clear fat/lung boundary (e.g. touching the aorta)
                rad[deg] = None
                continue
            half = (lumen + lo) / 2
            kx = int(np.nonzero(prof < half)[0][0])
            f = (prof[kx - 1] - half) / (prof[kx - 1] - prof[kx] + 1e-6) if kx > 0 else 0
            rad[deg] = float(rs[max(kx - 1, 0)] + f * STEP / 2)
        diams = [(deg, rad[deg] + rad[deg + 180]) for deg in range(0, 180, 5)
                 if rad[deg] is not None and rad[deg + 180] is not None]
        return lumen, diams

    planes = []
    for t in (t_bif - 8, t_bif - 6, t_bif - 4, t_bif - 2):
        p_t = anchor + t * axis
        d_t = min_area_axis(p_t, axis, cone=10, step_deg=2.0)
        s = section(p_t, d_t)
        if s is None:
            continue
        s["axis"] = d_t
        lumen, diams = edge_diams(s)
        ed = float(np.median([d for _, d in diams])) if len(diams) >= 4 else float("nan")
        est = (s["eqD"] + ed) / 2 if np.isfinite(ed) else s["eqD"]
        planes.append({"t": float(t), "eqD": r1(s["eqD"]), "edgeMedian": r1(ed) if np.isfinite(ed) else None,
                       "edgeDirections": len(diams), "minFeret": r1(s["fmin"]), "maxFeret": r1(s["fmax"]),
                       "lumenHU": r1(lumen), "estimate": r1(est), "_s": s, "_diams": diams})
    D = float(np.mean([p["estimate"] for p in planes]))
    lo_, hi_ = min(p["estimate"] for p in planes), max(p["estimate"] for p in planes)
    best = min(planes, key=lambda p: abs(p["estimate"] - D))
    s = best["_s"]
    elev = float(np.degrees(np.arcsin(axis[2])))

    # ---- figure: long-axis view (left) + perpendicular section with caliper (right)
    a = unit(np.cross(axis, [0, 0, 1.0]))
    b = unit(np.cross(axis, a))
    if b[2] < 0:
        b = -b
    mid_c = s["center"]
    longp = Plane(mid_c - axis * 6, axis, -b, 90, 70, 0.25)   # columns along the vessel, rows downward
    th1 = Thumb(longp, longp.sample(img), (50, 350))
    m1 = longp.mask(pa_mask)
    th1.outline(m1, (90, 140, 255))
    for p in planes:
        pc = anchor + p["t"] * axis
        th1.line(pc - b * 16, pc + b * 16, (255, 214, 10) if p is best else (150, 128, 40), 1, ends=False)
    th1.text_px((10, 8), "Along the pulmonary artery (heart left, lungs right)", size=12)
    im1 = th1.render(400, scalebar_mm=20)
    pl = s["plane"]
    th2 = Thumb(pl, pl.sample(img), (50, 350))
    th2.outline(s["comp"], (90, 140, 255))
    # draw the caliper along the clean direction closest to the final value
    deg, dd = min(best["_diams"], key=lambda x: abs(x[1] - D)) if best["_diams"] else (0, s["eqD"])
    thr = np.deg2rad(deg)
    cxy = np.array(s["cxy"])
    dirv = np.array([np.cos(thr), np.sin(thr)])
    pA = pl.lps(*(cxy - dirv * dd / 2 / STEP))
    pB = pl.lps(*(cxy + dirv * dd / 2 / STEP))
    th2.line(pA, pB, (255, 214, 10), 2)
    th2.text(pl.lps(cxy[0], cxy[1] + 5 / STEP), f"{D:.1f} mm", size=18, color=(255, 214, 10))
    th2.text_px((10, 8), "Cross-section, perpendicular to the vessel", size=12)
    im2 = th2.render(400, scalebar_mm=10)
    W = im1.width + im2.width + 6
    H = max(im1.height, im2.height)
    comp_im = Image.new("RGB", (W, H), (7, 9, 13))
    comp_im.paste(im1, (0, (H - im1.height) // 2))
    comp_im.paste(im2, (im1.width + 6, (H - im2.height) // 2))
    image = shots.add("pulmonary_artery", comp_im,
                      "Left: the pulmonary artery along its length, with the measurement planes. Right: the cut "
                      "straight across it, with the caliper. Blue = AI outline.", web_size=640)
    center = [r1(x) for x in s["center"]]
    method = (f"Double-oblique reformat of the calcium-score series (soft kernel, 0.31 mm pixels). Vessel axis fitted "
              f"through the centres of perpendicular cross-sections of the AI pulmonary-artery mask (tilted "
              f"{elev:.0f} degrees upward); bifurcation detected where the section stops being round. On 4 planes "
              f"2-8 mm before the split: AI-outline equivalent diameter "
              f"{min(p['eqD'] for p in planes)}-{max(p['eqD'] for p in planes)} mm and edge-to-edge profile "
              f"diameters (median per plane) "
              f"{min(p['edgeMedian'] for p in planes if p['edgeMedian'])}-{max(p['edgeMedian'] for p in planes if p['edgeMedian'])} mm; "
              f"final value = their average ({lo_:.1f}-{hi_:.1f} mm across planes). Outer-wall diameter, as in the "
              f"Framingham study (the wall can't be told apart from blood without contrast).")
    print(f"  MPA: {D:.1f} mm ({lo_:.1f}-{hi_:.1f}), axis {np.round(axis, 3)}, elevation {elev:.0f}°, t_bif {t_bif}")
    for p in planes:
        print(f"     t={p['t']:5.1f} eqD {p['eqD']} edge {p['edgeMedian']} ({p['edgeDirections']} dirs) "
              f"feret {p['minFeret']}-{p['maxFeret']} -> {p['estimate']}")
    return {"diameter": D, "range": [r1(lo_), r1(hi_)], "axis": [round(float(x), 3) for x in axis],
            "elevationDeg": r1(elev), "centerLPS": center,
            "planes": [{k: v for k, v in p.items() if not k.startswith("_")} for p in planes],
            "method": method, "image": image}


GROUPS = [
    {"key": "heart", "label": "Heart", "blurb": "Sizes from the AI's 3D outline of my heart, frozen mid-relaxation."},
    {"key": "fat_liver", "label": "Fat & liver", "blurb": "Fat around the heart, and whether the liver is storing fat."},
    {"key": "bones", "label": "Bones", "blurb": "A free bone-density check from the spine in the picture."},
    {"key": "lungs", "label": "Lungs", "blurb": "How much lung the scan caught, and how airy it is."},
    {"key": "vessels", "label": "Vessels", "blurb": "The two big arteries leaving the heart."},
    {"key": "radiation", "label": "Radiation", "blurb": "What this scan cost in radiation, in everyday units."},
]


def build_biomarkers(qa: Path, ar_meta: dict | None) -> dict:
    b = Bio(qa)
    b.heart()
    b.fat()
    b.liver()
    b.spine()
    b.lungs()
    b.emphysema()
    b.aorta()
    b.pulmonary_artery()
    rad = b.radiation()
    ecg = b.exam.get("ecg", {})
    out = {
        "version": 1,
        "generated": TODAY,
        "source": "pipeline/07_lab_assets.py",
        "exam": {"studyDate": b.exam["exam"].get("StudyDate"), "age": b.exam["exam"].get("PatientAge"),
                 "sex": b.exam["exam"].get("PatientSex"), "kvp": b.exam["exam"].get("KVP"),
                 "phase": ecg.get("reconPhase"), "heartRate": ecg.get("hrAvg")},
        "disclaimer": "Opportunistic measurements on a low-dose, non-contrast heart scan, for curiosity and education. "
                      "Not a medical device and not a diagnosis; the official radiologist report is what counts.",
        "confidenceLegend": {
            "measured": "Read directly from the images with a defined method (or by the radiologist).",
            "AI estimate": "Depends on an AI outline that can't be fully checked on a scan without contrast dye.",
            "rough": "Ballpark only: the method or the scan type limits accuracy.",
        },
        "groups": GROUPS,
        "metrics": b.metrics,
        "radiation": rad,
        "images": b.shots.images,
    }
    if ar_meta:
        out["arModel"] = ar_meta
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", choices=["glb", "bio"], default=None)
    ap.add_argument("--qa", default=str(DERIVED / "lab" / "qa"))
    args = ap.parse_args()
    qa = Path(args.qa)
    bio_path = WEB_PUBLIC / "biomarkers.json"
    ar_meta = None
    if args.only in (None, "glb"):
        print("== heart_ar.glb")
        ar_meta = build_ar_glb(WEB_PUBLIC / "mesh" / "heart_ar.glb")
    elif bio_path.exists():
        ar_meta = json.loads(bio_path.read_text()).get("arModel")
    if args.only in (None, "bio"):
        print("== biomarkers.json")
        out = build_biomarkers(qa, ar_meta)
    else:
        out = json.loads(bio_path.read_text()) if bio_path.exists() else {"version": 1, "metrics": []}
        out["arModel"] = ar_meta
    write_json(bio_path, out)
    print(f"wrote {bio_path} ({bio_path.stat().st_size / 1024:.0f} KB); QA renders in {qa}")


if __name__ == "__main__":
    main()
