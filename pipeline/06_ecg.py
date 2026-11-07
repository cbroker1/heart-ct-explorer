"""Stage 6: digitize the scanner's ECG printout into web/public/data/ecg.json.

The SOMATOM saved the ECG it used for prospective triggering as three small RGB
secondary-capture images (series "ECG CALCIUM SCORE", ImageType CT_SOM ECGDOC):
white trace on black, a dot over every R wave it detected, the beat-to-beat heart
rate printed between the dots, and green bars where the X-ray fired.

What this script does
  1. Reads the three images (pixels only; no DICOM header field is copied out except
     the series description and scanner model).
  2. Finds the 7 strip rows (3 + 3 + 1) and checks they are one continuous recording.
  3. Traces the white line column by column (steep QRS strokes are rebuilt from their
     extremes, gaps under the bar borders are interpolated), removes baseline wander
     using the PR segment of every beat, and normalises the amplitude.
  4. Calibrates time from the printed heart rates (RR = 60 / HR) against the spacing
     of the scanner's R markers, then resamples to 250 Hz.
  5. Measures R peaks, P and T waves, the exposure windows (green bars) and their
     phase within the R-R interval.
  6. Writes ecg.json, cleaned strip images (ecg/strip_N.png) and debug overlays.

usage: python pipeline/06_ecg.py [/path/to/medicom_export_root] [--debug-dir DIR]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

from common import DERIVED, ROOT, WEB_PUBLIC, find_series_dirs

ECG_FOLDER = "S10"                 # "ECG CALCIUM SCORE" in this Medicom export
FS = 250                           # output sample rate (Hz)
ROW_PITCH = 112                    # vertical distance between strip rows (px)

# ---------------------------------------------------------------------------------------
# Text printed on the images, transcribed by eye from 6x zoomed renders (the digits are
# ~7 px tall). The per-beat numbers are checked automatically below against the spacing of
# the scanner's own R markers: every one must agree within 2 bpm or the script stops.
HEADER = {
    "hrXray": {"avg": 85, "min": 82, "max": 88},       # "HR X-ray (bpm): Avg 85 Min 82 Max 88"
    "channel": 2,                                       # "Channel: 2"
    "signalStrength": "4 of 5",                         # "Strength: 4 of 5"
    "scanPhase": "75% - 75%",                           # "Scan Phase: 75% - 75%"
    "reconPhase": "BestDiast 76%",                      # "Recon Phase: BestDiast 76%"
}
# Heart rate printed between consecutive R markers, in reading order across all 7 rows.
# ("73" straddles the I1 -> I2 boundary: "7" ends image 1, "3" starts image 2.)
PRINTED_HR = [65, 70, 69, 65,  64, 64, 63, 67,  69, 68, 68, 70, 73,
              78, 80, 79, 76, 74,  78, 80, 86, 87, 88,  86, 85, 83, 82, 83, 83,
              86, 85, 88]
# Table positions printed at the left of the rows that contain exposures (mm), top then
# bottom label. Row 6 (I2, 3rd row) holds exposures 1-3, row 7 (I3) holds exposure 4.
TABLE_LABELS = {5: (-1819.8, -1716.2), 6: (-1716.2, -1681.8)}


# ----------------------------------------------------------------------------- helpers
def load_images(export_root: Path) -> list[tuple[str, np.ndarray]]:
    dirs = find_series_dirs(export_root)
    folder = dirs[ECG_FOLDER]
    out = []
    for f in folder.iterdir():
        ds = pydicom.dcmread(f)
        assert "ECG" in str(ds.get("SeriesDescription", "")).upper(), f"{f} is not the ECG series"
        assert ds.SamplesPerPixel == 3 and ds.Rows == 512 and ds.Columns == 512
        out.append((int(ds.InstanceNumber), f.name, ds.pixel_array.copy(),
                    str(ds.get("SeriesDescription", "")), str(ds.get("ManufacturerModelName", ""))))
    out.sort()
    return out


def white_dots(img: np.ndarray) -> list[tuple[float, float]]:
    """Scanner R markers: isolated, fully white 2x2 squares above the trace."""
    w = img.min(axis=2) >= 250
    lab, n = ndi.label(w)
    dots = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        h, wd = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h == 2 and wd == 2 and (lab[sl] == i + 1).sum() == 4:
            y0, x0 = sl[0].start, sl[1].start
            # isolated: apart from its anti-aliased halo, nothing else bright in an 8x8 neighbourhood
            nb = img[max(0, y0 - 3):y0 + 5, max(0, x0 - 3):x0 + 5].max(axis=2) > 120
            if nb.sum() == 4:
                dots.append((x0 + 0.5, y0 + 0.5))
    return dots


def label_glyphs(img: np.ndarray, y_lo: int, y_hi: int, x_lo: int, x_hi: int, dots) -> list[tuple[float, float]]:
    """Bright text clusters (the HR numbers) in a label band -> list of (x_min, x_max)."""
    band = img[y_lo:y_hi, x_lo:x_hi].max(axis=2) > 60
    for (dx, dy) in dots:                       # blank the dots and their anti-aliased halo
        if y_lo <= dy < y_hi:
            yy, xx = int(dy - 0.5) - y_lo, int(dx - 0.5) - x_lo
            band[max(0, yy - 1):yy + 3, max(0, xx - 1):xx + 3] = False
    cols = np.where(band.any(axis=0))[0]
    if not len(cols):
        return []
    groups, start, prev = [], cols[0], cols[0]
    for c in cols[1:]:
        if c > prev + 3:                        # digit gap is 1-2 px, number gap is >> 3 px
            groups.append((start + x_lo, prev + x_lo))
            start = c
        prev = c
    groups.append((start + x_lo, prev + x_lo))
    return [(float(a), float(b)) for a, b in groups]


def bar_segments(cell: np.ndarray) -> list[tuple[int, int]]:
    """Exposure bars: columns with a green tint, gaps of <= 2 px merged -> [(x0, x1)] inclusive."""
    R, G, B = (cell[..., i].astype(int) for i in range(3))
    green = (G - np.maximum(R, B)) > 15
    gcols = np.where(green.sum(axis=0) >= 8)[0]
    segs: list[list[int]] = []
    for c in gcols:
        if segs and c - segs[-1][1] <= 3:
            segs[-1][1] = c
        else:
            segs.append([c, c])
    return [(a, b) for a, b in segs if b - a >= 6]


def trace_strength(cell: np.ndarray, bars: list[tuple[int, int]]) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel 'how much white trace is here' in [0, 1], with the bar background removed.

    Outside the bars the background is black, so strength = luminance / 255. Inside a bar the
    background is a vertical gradient (constant along x), estimated per column with a vertical
    median filter that ignores the 2-3 px trace; strength = (L - L_bg) / (255 - L_bg).
    Returns (strength, valid) where valid=False marks bar border rows (never trace there).
    """
    L = cell.astype(np.float32).mean(axis=2)
    S = L / 255.0
    valid = np.ones_like(L, dtype=bool)
    for (x0, x1) in bars:
        for x in range(max(0, x0 - 1), min(cell.shape[1], x1 + 2)):
            col = L[:, x]
            nz = np.where(cell[:, x].max(axis=1) > 10)[0]
            bg = ndi.median_filter(col, size=11, mode="nearest")
            s = (col - bg) / np.maximum(255.0 - bg, 40.0)
            S[:, x] = np.clip(s, 0, 1)
            if len(nz):
                # bar outline rows (top/bottom) + 2 px margin are not usable
                top, bot = nz.min(), nz.max()
                valid[max(0, top - 1):top + 3, x] = False
                valid[max(0, bot - 2):bot + 2, x] = False
    return np.clip(S, 0, 1), valid


def column_runs(S: np.ndarray, valid: np.ndarray, thr: float = 0.22):
    """For every column: (top, bottom, weighted centroid, length) of the trace run, or None."""
    H, W = S.shape
    out: list[tuple[float, float, float, int] | None] = [None] * W
    prev_c = None
    for x in range(W):
        m = (S[:, x] >= thr) & valid[:, x]
        ys = np.where(m)[0]
        if not len(ys):
            continue
        # split into runs; pick the heaviest (or the one nearest the previous centroid)
        splits = np.where(np.diff(ys) > 1)[0]
        runs = np.split(ys, splits + 1)
        def score(r):
            w = S[r, x].sum()
            if prev_c is not None:
                w -= 0.02 * abs((r.mean()) - prev_c)
            return w
        r = max(runs, key=score)
        w = S[r, x]
        c = float((r * w).sum() / w.sum())
        out[x] = (float(r[0]), float(r[-1]), c, int(r[-1] - r[0] + 1))
        prev_c = c
    return out


def trace_polyline(runs, x_first: int, x_last: int, half_width: float = 1.0):
    """Turn per-column runs into a monotone polyline [(x, y)] (image y, down = positive).

    Flat columns (run <= 5 px) contribute their intensity-weighted centroid. Consecutive steep
    columns (the QRS) are replaced by key points at their extremes, in temporal order:
    [Q trough] -> R peak -> [S trough]. Columns without a trace are simply skipped (linear
    interpolation fills them).
    """
    steep = [r is not None and r[3] > 5 for r in runs]
    pts: list[tuple[float, float, str]] = []
    keypoints: list[tuple[float, float, str]] = []
    zones = []
    x = x_first
    while x <= x_last:
        if steep[x]:
            a = x
            while x + 1 <= x_last and (steep[x + 1] or (x + 2 <= x_last and steep[x + 2])):
                x += 1
            zones.append((a, x))
        x += 1
    in_zone = np.zeros(len(runs), dtype=bool)
    for a, b in zones:
        in_zone[a:b + 1] = True
    for x in range(x_first, x_last + 1):
        r = runs[x]
        if r is not None and not in_zone[x]:
            pts.append((float(x), r[2], "flat"))

    def nearest_flat(x0, step):
        x = x0
        while x_first <= x <= x_last:
            r = runs[x]
            if r is not None and not in_zone[x]:
                return r[2]
            x += step
        return None

    zone_info = []
    for a, b in zones:
        cols = [x for x in range(a, b + 1) if runs[x] is not None]
        tops = np.array([runs[x][0] for x in cols])
        bots = np.array([runs[x][1] for x in cols])
        top_min = tops.min()
        xs_peak = [c for c, t in zip(cols, tops) if t <= top_min + 0.5]
        x_peak = float(np.mean(xs_peak))
        y_peak = top_min + half_width
        entry = nearest_flat(a - 1, -1)
        exit_ = nearest_flat(b + 1, +1)
        entry = entry if entry is not None else runs[a][1]
        exit_ = exit_ if exit_ is not None else runs[b][1]
        kps = []
        before = [(c, bt) for c, bt in zip(cols, bots) if c < x_peak]
        after = [(c, bt) for c, bt in zip(cols, bots) if c > x_peak]
        if before:
            bmax = max(bt for _, bt in before)
            if bmax - half_width > entry + 1.5:
                xq = float(np.mean([c for c, bt in before if bt >= bmax - 0.5]))
                kps.append((xq, bmax - half_width, "Q"))
        kps.append((x_peak, y_peak, "R"))
        if after:
            amax = max(bt for _, bt in after)
            if amax - half_width > exit_ + 1.0:
                xs = float(np.mean([c for c, bt in after if bt >= amax - 0.5]))
                kps.append((xs, amax - half_width, "S"))
        # keep the polyline strictly monotone in x
        for i in range(1, len(kps)):
            if kps[i][0] <= kps[i - 1][0]:
                kps[i] = (kps[i - 1][0] + 0.34, kps[i][1], kps[i][2])
        keypoints += kps
        zone_info.append({"a": a, "b": b, "entry": entry, "exit": exit_, "kps": kps})
    allpts = sorted(pts + keypoints, key=lambda p: p[0])
    return allpts, zone_info


# --------------------------------------------------------------------------------- main
def main(export_root: Path, debug_dir: Path) -> None:
    images = load_images(export_root)
    assert len(images) == 3, f"expected 3 ECG images, found {len(images)}"
    print("ECG images:", [(i, n) for i, n, *_ in images])
    series_desc, model = images[0][3], images[0][4]

    # ---- layout: plot x-range, rows (from the dots), strip order -----------------------
    strips = []           # dicts with img, image name, row index, cell y0, x-range, dots, bars
    for inst, name, img, *_ in images:
        dots = white_dots(img)
        row_ys = sorted({round(dy) for _, dy in dots})
        # cluster dot rows
        rows: list[float] = []
        for y in row_ys:
            if not rows or y - rows[-1] > 20:
                rows.append(y)
        bright = img.max(axis=2) > 60
        for r, ry in enumerate(rows):
            y0 = int(round(ry - 8.5))                  # cell top: label band starts ~5 px above the dot
            y1 = y0 + ROW_PITCH
            cell = img[y0 + 14:y1].copy()              # the trace area (below the labels)
            cols = np.where(bright[y0 + 14:y1, 90:].any(axis=0))[0] + 90
            strips.append({
                "image": name, "inst": inst, "row": r, "y0": y0, "y1": y1, "img": img,
                "trace_y0": y0 + 14, "cell": cell,
                "dots": sorted([(dx, dy) for dx, dy in dots if abs(dy - ry) < 3]),
                "colsMin": int(cols.min()), "colsMax": int(cols.max()),
            })
    assert len(strips) == 7, f"expected 7 strip rows, found {len(strips)}"
    x_left = min(s["colsMin"] for s in strips)
    x_right = max(s["colsMax"] for s in strips)
    width = x_right - x_left + 1
    assert width == 400, f"unexpected plot width {width}"
    print(f"plot area x = {x_left}..{x_right} ({width} px per row), {len(strips)} rows")

    # ---- per-strip tracing -------------------------------------------------------------------
    allpts_X = []                  # (X_cont, y_rel) for the whole recording (y relative to cell)
    zones_X = []
    dots_X = []
    bars_X = []
    glyphs_X = []
    for s_idx, s in enumerate(strips):
        X0 = s_idx * width
        s["X0"] = X0
        cell = s["cell"]
        bars = bar_segments(cell)
        S, valid = trace_strength(cell, bars)
        runs = column_runs(S, valid)
        xs_with = [x for x in range(x_left, x_right + 1) if runs[x] is not None]
        x_last = max(xs_with)
        s["xLast"] = x_last
        pts, zinfo = trace_polyline(runs, x_left, x_last)
        s["pts"], s["zones"], s["runs"], s["bars"] = pts, zinfo, runs, bars
        for (x, y, kind) in pts:
            allpts_X.append((X0 + x - x_left, y, kind))
        for z in zinfo:
            zones_X.append({**z, "X0": X0, "strip": s_idx})
        for (dx, dy) in s["dots"]:
            dots_X.append(X0 + dx - x_left)
        # bar details: dark band = full green extent; light box = columns of the cream top outline
        for (bx0, bx1) in bars:
            sx0, sx1 = max(0, bx0 - 2), bx1 + 2
            sub = cell[:, sx0:sx1 + 1].astype(int)
            nz_rows = np.where(sub.max(axis=(1, 2)) > 10)[0]
            top = nz_rows.min()
            cream = np.where(sub[top].min(axis=1) > 150)[0] + sx0
            box = (int(cream.min()), int(cream.max())) if len(cream) else (bx0, bx1)
            # the outlined box is drawn on top of the dark band and can hide its right end
            dx0, dx1 = min(bx0, box[0]), max(bx1, box[1])
            bars_X.append({"strip": s_idx, "dark": (X0 + dx0 - x_left - 0.5, X0 + dx1 - x_left + 0.5),
                           "box": (X0 + box[0] - x_left - 0.5, X0 + box[1] - x_left + 0.5),
                           "px": (bx0, bx1), "boxPx": box, "yTop": int(top + s["trace_y0"])})
        ry = s["dots"][0][1] if s["dots"] else s["y0"] + 8.5
        for (g0, g1) in label_glyphs(s["img"], int(ry - 5), int(ry + 6), x_left - 4, x_right + 4, s["dots"]):
            glyphs_X.append((X0 + g0 - x_left, X0 + g1 - x_left))
    allpts_X.sort(key=lambda p: p[0])
    dots_X = np.array(sorted(dots_X))
    print(f"scanner R markers: {len(dots_X)}")

    # ---- continuity check: trace level at each row end vs next row start --------------------
    continuity = []
    for a, b in zip(strips[:-1], strips[1:]):
        ya = [p[1] for p in a["pts"] if p[0] >= x_right - 2]
        yb = [p[1] for p in b["pts"] if p[0] <= x_left + 2]
        continuity.append(round(float(np.mean(yb) - np.mean(ya)), 2))
    print("row-to-row level jump (px):", continuity)

    # ---- HR labels -> intervals ------------------------------------------------------------
    # merge glyph clusters that touch across a row boundary (the "7|3")
    glyphs_X.sort()
    merged: list[list[float]] = []
    for g0, g1 in glyphs_X:
        if merged and g0 - merged[-1][1] <= 4:
            merged[-1][1] = max(merged[-1][1], g1)
        else:
            merged.append([g0, g1])
    label_centers = [0.5 * (a + b) for a, b in merged]
    assert len(label_centers) == len(PRINTED_HR) == len(dots_X) - 1, \
        f"labels {len(label_centers)} / transcribed {len(PRINTED_HR)} / intervals {len(dots_X) - 1}"
    for i, c in enumerate(label_centers):
        assert dots_X[i] < c < dots_X[i + 1], f"label {i} at X={c} is not inside interval {i}"

    # ---- time calibration: px/s from printed HR vs marker spacing ----------------------------
    rr_px = np.diff(dots_X)
    rr_s_printed = 60.0 / np.array(PRINTED_HR, float)
    k_fit = float((rr_px * rr_s_printed).sum() / (rr_s_printed ** 2).sum())   # LS through origin
    k_mean = float(np.mean(rr_px / rr_s_printed))
    resid_ms = (rr_px / k_fit - rr_s_printed) * 1000
    # each break-spanning interval tests continuity: fit a per-break gap g
    breaks = [i for i in range(len(rr_px)) if int(dots_X[i] // width) != int(dots_X[i + 1] // width)]
    gap_px = [float(rr_s_printed[i] * k_fit - rr_px[i]) for i in breaks]
    print(f"px/s: LS fit {k_fit:.2f}, mean {k_mean:.2f}; residual RMS {np.sqrt(np.mean(resid_ms**2)):.1f} ms, "
          f"max {np.abs(resid_ms).max():.1f} ms; implied gaps at {len(breaks)} row breaks (px): "
          f"{[round(g, 1) for g in gap_px]}")
    K = 100.0 if abs(k_fit - 100.0) < 0.5 else k_fit     # display time base: 100 px/s = 10 ms/px
    hr_measured = 60.0 / (rr_px / K)
    worst = np.abs(hr_measured - np.array(PRINTED_HR)).max()
    assert worst <= 2.0, f"printed HR disagrees with marker spacing by {worst:.1f} bpm"
    print(f"using {K} px/s; printed vs measured HR worst difference {worst:.2f} bpm")

    # ---- R peaks from the QRS zones ----------------------------------------------------------
    Xs = np.array([p[0] for p in allpts_X])
    Ys = np.array([p[1] for p in allpts_X])
    r_list = []
    for z in zones_X:
        for (x, y, kind) in z["kps"]:
            if kind == "R":
                X = z["X0"] + x - x_left
                amp = 0.5 * (z["entry"] + z["exit"]) - y
                r_list.append((X, y, amp, z))
    amps = np.array([r[2] for r in r_list])
    # QRS zones are ~50 px tall; steep T-wave down-slopes also form short 'zones' of ~8 px
    keep = amps > 0.45 * np.percentile(amps, 90)
    for r, k in zip(r_list, keep):
        r[3]["major"] = bool(k)
    r_list = [r for r, k in zip(r_list, keep) if k]
    R_X = np.array([r[0] for r in r_list])
    print(f"R peaks found: {len(R_X)} (scanner markers {len(dots_X)})")
    assert len(R_X) == len(dots_X)
    marker_offset_px = R_X - dots_X
    print(f"R peak minus scanner marker: mean {marker_offset_px.mean():.2f} px, range "
          f"{marker_offset_px.min():.1f}..{marker_offset_px.max():.1f}")

    # ---- baseline (PR segment just before each QRS onset) + normalisation ---------------------
    def y_at(X):
        return np.interp(X, Xs, Ys)
    onset_X = np.array([r[3]["X0"] + r[3]["a"] - x_left - 1 for r in r_list])   # last flat column before QRS
    base_pts = []
    for X_on in onset_X:
        win = np.arange(X_on - 4, X_on + 0.5, 0.5)                      # 40 ms before onset
        base_pts.append(float(np.median(y_at(win))))
    base_raw = np.array(base_pts)
    # running median over 3 beats: removes slow wander but keeps brief, real dips in the trace
    base_pts = np.array([np.median(base_raw[max(0, i - 1):i + 2]) for i in range(len(base_raw))])

    def baseline(X):
        return np.interp(X, onset_X, base_pts)

    r_height_px = float(np.median(baseline(R_X) - np.array([r[1] for r in r_list])))
    print(f"median R height {r_height_px:.1f} px")

    # ---- resample to FS ----------------------------------------------------------------------
    X_end = strips[-1]["X0"] + strips[-1]["xLast"] - x_left
    duration = X_end / K
    n = int(np.floor(duration * FS)) + 1
    t = np.arange(n) / FS
    # snap QRS key points to the sample grid so the sharp R tips survive resampling
    Xs_s = Xs.copy()
    for i, p in enumerate(allpts_X):
        if p[2] in ("R", "Q", "S"):
            Xs_s[i] = np.round(p[0] / K * FS) / FS * K
    order = np.argsort(Xs_s, kind="stable")
    Xs_s, Ys_s = Xs_s[order], Ys[order]
    Xs_s = np.maximum.accumulate(Xs_s + np.arange(len(Xs_s)) * 1e-6)
    y_t = np.interp(t * K, Xs_s, Ys_s)
    sig = (baseline(t * K) - y_t) / r_height_px

    # ---- per-beat timing: P, T waves, QRS width -------------------------------------------
    R_t = R_X / K
    dots_t = dots_X / K
    def sig_at(tt):
        return np.interp(tt, t, sig)
    beats = []
    p_found = 0
    qrs_ms = []
    for i in range(len(R_t)):
        r = R_t[i]
        on_t = onset_X[i] / K
        # P wave: highest point 0.26 s before R .. 25 ms before QRS onset, measured against the
        # local PR-segment level (robust to brief baseline dips)
        w = (t >= r - 0.26) & (t <= on_t - 0.025)
        p_t = p_a = None
        if w.any():
            j = np.argmax(sig[w])
            pr_level = float(np.median(sig[(t >= on_t - 0.03) & (t <= on_t - 0.005)]))
            if sig[w][j] - pr_level > 0.035:
                p_t, p_a = float(t[w][j]), float(sig[w][j])
                p_found += 1
        rr_next = (R_t[i + 1] - r) if i + 1 < len(R_t) else (r - R_t[i - 1])
        w = (t >= r + 0.12) & (t <= r + min(0.45, 0.62 * rr_next))
        t_t = t_a = None
        if w.any():
            j = np.argmax(sig[w])
            if sig[w][j] > 0.04:
                t_t, t_a = float(t[w][j]), float(sig[w][j])
        # QRS end: first time after the S trough where the signal is back within 0.05 of baseline
        z = r_list[i][3]
        end_x = z["b"] + 1
        kps = z["kps"]
        last_kp = max(k[0] for k in kps)
        tt = (z["X0"] + last_kp - x_left) / K
        # J point: first moment after the last QRS key point where the trace flattens out
        i0 = int(np.ceil(tt * FS))
        qrs_end = (z["X0"] + end_x - x_left) / K
        for j in range(i0, min(i0 + int(0.08 * FS), len(sig) - 3)):
            if abs(sig[j + 3] - sig[j]) / (3.0 / FS) < 1.2:
                qrs_end = t[j]
                break
        qrs_ms.append((qrs_end - on_t) * 1000)
        beats.append({"r": round(float(r), 4), "marker": round(float(dots_t[i]), 3),
                      "amp": round(float(sig_at(r)), 3),
                      "p": None if p_t is None else round(p_t, 3), "pAmp": None if p_a is None else round(p_a, 3),
                      "t": None if t_t is None else round(t_t, 3), "tAmp": None if t_a is None else round(t_a, 3),
                      "qrsOnset": round(float(on_t), 3)})
    rr = np.diff(R_t)
    intervals = []
    for i in range(len(rr)):
        intervals.append({"from": i, "to": i + 1, "start": round(float(R_t[i]), 4), "end": round(float(R_t[i + 1]), 4),
                          "rr": round(float(rr[i]), 4), "hrPrinted": PRINTED_HR[i],
                          "hrMeasured": round(float(60.0 / (rr_px[i] / K)), 1),
                          "markerStart": round(float(dots_t[i]), 3), "markerEnd": round(float(dots_t[i + 1]), 3)})

    # ---- exposures --------------------------------------------------------------------------
    exposures = []
    by_strip: dict[int, list] = {}
    for b in bars_X:
        by_strip.setdefault(b["strip"], []).append(b)
    k_exp = 0
    for s_idx in sorted(by_strip):
        lst = sorted(by_strip[s_idx], key=lambda b: b["dark"][0])
        tab = TABLE_LABELS.get(s_idx)
        for j, b in enumerate(lst):
            k_exp += 1
            d0, d1 = b["dark"][0] / K, b["dark"][1] / K
            b0, b1 = b["box"][0] / K, b["box"][1] / K
            c = 0.5 * (d0 + d1)
            i = int(np.searchsorted(dots_t, c) - 1)
            m0, m1 = dots_t[i], dots_t[i + 1]
            rr_m = m1 - m0
            prev_rr = m0 - dots_t[i - 1]
            pred_c = m0 + 0.75 * prev_rr
            ex = {
                "n": k_exp,
                "xray": [round(d0, 3), round(d1, 3)],
                "recon": [round(b0, 3), round(b1, 3)],
                "durationMs": round((d1 - d0) * 1000),
                "reconMs": round((b1 - b0) * 1000),
                "interval": i,
                "hrPrinted": PRINTED_HR[i],
                "phase": {
                    "xrayStart": round((d0 - m0) / rr_m, 3), "xrayCenter": round((c - m0) / rr_m, 3),
                    "xrayEnd": round((d1 - m0) / rr_m, 3),
                    "reconCenter": round((0.5 * (b0 + b1) - m0) / rr_m, 3),
                },
                "predicted": {"rrFromPreviousBeat": round(float(prev_rr), 3), "centerAt75pct": round(float(pred_c), 3),
                              "errorMs": round(float((c - pred_c) * 1000))},
            }
            if tab:
                t0, t1 = tab
                step = (t1 - t0) / len(lst)
                ta, tb = t0 + j * step, t0 + (j + 1) * step
                ex["tablePosition"] = [round(ta, 1), round(tb, 1)]
                ex["zRangeLPS"] = sorted([round(-ta, 1), round(-tb, 1)])
            exposures.append(ex)
    print("exposures:")
    for e in exposures:
        print("  ", e["n"], e["xray"], e["durationMs"], "ms  phase", e["phase"], "pred err", e["predicted"]["errorMs"],
              "ms  z", e.get("zRangeLPS"))

    # ---- rhythm summary ---------------------------------------------------------------------
    prem = [i for i in range(1, len(rr)) if rr[i] < 0.8 * rr[i - 1]]
    rhythm = {
        "beats": int(len(R_t)),
        "rrIntervals": int(len(rr)),
        "hrPrintedRange": [int(min(PRINTED_HR)), int(max(PRINTED_HR))],
        "hrFirst8Avg": round(float(np.mean(PRINTED_HR[:8])), 1),
        "hrLast8Avg": round(float(np.mean(PRINTED_HR[-8:])), 1),
        "rrRange": [round(float(rr.min()), 3), round(float(rr.max()), 3)],
        "maxBeatToBeatChangeMs": round(float(np.abs(np.diff(rr)).max() * 1000)),
        "prematureBeats": len(prem),
        "pWaveBeforeEveryQRS": p_found == len(R_t),
        "pWavesFound": p_found,
        "qrsWidthMsMedian": round(float(np.median(qrs_ms))),
        "qrsWidthMsRange": [round(float(np.min(qrs_ms))), round(float(np.max(qrs_ms)))],
        "prIntervalMsMedian": round(float(np.median([(b["qrsOnset"] - b["p"]) * 1000 for b in beats if b["p"] is not None]))),
        "note": ("Single-channel monitoring ECG from the scanner, not a diagnostic 12-lead ECG: "
                 "no amplitude calibration, unknown filtering, 10 ms per pixel. PR is measured from the P-wave PEAK "
                 "to QRS onset (shorter than a clinical PR interval, which starts at P onset)."),
    }
    print("rhythm:", json.dumps(rhythm))

    # ---- per-row per-column output ------------------------------------------------------------
    rows_out = []
    for s_idx, s in enumerate(strips):
        X0 = s["X0"]
        ncol = s["xLast"] - x_left + 1
        xcol = np.arange(ncol, dtype=float)
        pts = s["pts"]
        px = np.array([p[0] - x_left for p in pts]); py = np.array([p[1] for p in pts])
        ycol = np.interp(xcol, px, py)
        for (x, y, kind) in pts:                    # take the extreme in the column holding a QRS key point
            if kind in ("R", "Q", "S"):
                ycol[int(round(x - x_left))] = y
        amp = (baseline(X0 + xcol) - ycol) / r_height_px
        rows_out.append({
            "strip": s_idx + 1, "image": f"I{s['inst']}", "row": s["row"] + 1,
            "t0": round(X0 / K, 3), "t1": round((X0 + ncol - 1) / K, 3),
            "cropBoxPx": [int(x_left), int(s["y0"]), int(x_right + 1), int(s["y1"])],
            "png": f"ecg/strip_{s_idx + 1}.png",
            "yOffsetInPng": int(s["trace_y0"] - s["y0"]),
            "yPx": [round(float(v + s["trace_y0"] - s["y0"]), 1) for v in ycol],
            "amp": [round(float(v), 3) for v in amp],
        })

    # ---- write outputs ---------------------------------------------------------------------
    out_dir = WEB_PUBLIC / "ecg"
    out_dir.mkdir(parents=True, exist_ok=True)
    for s_idx, s in enumerate(strips):
        crop = s["img"][s["y0"]:s["y1"], x_left:x_right + 1].copy()
        crop[crop.max(axis=2) < 6] = 0              # flatten near-black noise
        Image.fromarray(crop).save(out_dir / f"strip_{s_idx + 1}.png", optimize=True)

    ecg = {
        "version": 1,
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "source": {
            "what": "The scanner's own ECG printout (3 secondary-capture images), digitized from pixels.",
            "series": series_desc, "scanner": model, "images": 3, "rows": len(strips),
            "deidentified": "Pixels contain no name, ID or date; no DICOM header field except series description and model is used.",
        },
        "header": HEADER,
        "calibration": {
            "pxPerSecond": K, "pxPerSecondFit": round(k_fit, 3), "pxPerSecondMean": round(k_mean, 3),
            "fitResidualMsRms": round(float(np.sqrt(np.mean(resid_ms ** 2))), 1),
            "fitResidualMsMax": round(float(np.abs(resid_ms).max()), 1),
            "rowWidthPx": width, "rowSeconds": width / K,
            "rowBreakGapPx": [round(g, 2) for g in gap_px],
            "rowJoinLevelJumpPx": continuity,
            "rPeakHeightPx": round(r_height_px, 2),
            "amplitude": "normalized: 0 = PR-segment baseline of each beat (interpolated between beats), 1 = median R-peak height",
        },
        "fs": FS,
        "duration": round(float(t[-1]), 3),
        "signal": [round(float(v), 3) for v in sig],
        "beats": beats,
        "intervals": intervals,
        "exposures": exposures,
        "rhythm": rhythm,
        "rows": rows_out,
        "assumptions": [
            "The 7 strip rows are one continuous recording, 400 px (4.0 s) per row. Evidence: the label '73' is split "
            "across the I1/I2 boundary, the trace level matches at every row join, and every R-R interval that "
            "spans a row break matches its printed heart rate (implied gaps ~0 px).",
            f"Time base: printed HR (RR = 60/HR) fitted against the spacing of the scanner's R markers gives "
            f"{k_fit:.2f} px/s (RMS residual {np.sqrt(np.mean(resid_ms ** 2)):.0f} ms, within the 1 px marker "
            f"quantisation), so the display runs at exactly {K:g} px/s = 10 ms per pixel.",
            "Per-beat heart rates are the numbers the scanner printed (transcribed from zoomed renders); every one "
            "matches our own marker spacing within 2 bpm.",
            "The trace is the centre of the white line in each pixel column. Steep QRS strokes are rebuilt from "
            "their extremes (R tip, Q/S troughs); columns hidden under a bar outline are interpolated.",
            "Amplitude has no mV calibration (none is printed), so it is normalised to the median R-peak height.",
            "Green bars: the dark-green band is drawn as the X-ray exposure window (centred at 75% of the "
            "scanner's predicted R-R, matching 'Scan Phase 75%'); the lighter outlined box inside it is most likely "
            "the image-data (reconstruction) window ('Recon Phase BestDiast 76%').",
            "Table positions: the first three exposures cover -1819.8 to -1716.2 mm, the fourth -1716.2 to -1681.8 mm; "
            "they are split evenly per exposure (34.5 mm steps). Patient z (DICOM LPS) = -table position, which "
            "matches the calcium-score slices (z 1683.25-1818.25 mm, 3 mm thick).",
            "R-peak times come from the digitized trace; the scanner's markers sit "
            f"{-marker_offset_px.mean() * 10:.0f} ms earlier on average (it triggers on the R upstroke).",
        ],
    }
    path = WEB_PUBLIC / "ecg.json"
    with open(path, "w") as f:
        json.dump(ecg, f, separators=(",", ":"))
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} KB), {len(sig)} samples @ {FS} Hz, {duration:.2f} s")

    # ---- debug overlays -----------------------------------------------------------------------
    debug_dir.mkdir(parents=True, exist_ok=True)
    Z = 3
    tiles = []
    for s_idx, s in enumerate(strips):
        crop = s["img"][s["y0"]:s["y1"], x_left - 2:x_right + 3]
        im = Image.fromarray(crop).resize((crop.shape[1] * Z, crop.shape[0] * Z), Image.NEAREST).convert("RGB")
        d = ImageDraw.Draw(im)
        oy = s["trace_y0"] - s["y0"]
        def P(x, y):
            return ((x - (x_left - 2) + 0.5) * Z, (y + oy + 0.5) * Z)
        line = [P(p[0], p[1]) for p in s["pts"]]
        d.line(line, fill=(255, 40, 40), width=1)
        # baseline
        X0 = s["X0"]
        bl = [P(x, baseline(X0 + x - x_left)) for x in range(x_left, s["xLast"] + 1, 4)]
        d.line(bl, fill=(60, 120, 255), width=1)
        for z in s["zones"]:
            for (x, y, kind) in z["kps"]:
                cx, cy = P(x, y)
                col = (255, 230, 0) if kind == "R" else (255, 140, 0)
                d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], outline=col, width=2)
        for (dx, dy) in s["dots"]:
            cx, cy = P(dx, dy - s["trace_y0"])
            d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], outline=(0, 220, 255), width=2)
        for b in s["bars"]:
            x0, y0 = P(b[0] - 0.5, 0)
            x1, y1 = P(b[1] + 0.5, crop.shape[0] - oy - 1)
            d.rectangle([x0, y0, x1, y1], outline=(255, 0, 255), width=1)
        tiles.append(im)
        im.save(debug_dir / f"overlay_strip_{s_idx + 1}.png")
    W = max(t_.width for t_ in tiles)
    sheet = Image.new("RGB", (W, sum(t_.height for t_ in tiles)), (30, 0, 0))
    yy = 0
    for t_ in tiles:
        sheet.paste(t_, (0, yy)); yy += t_.height
    sheet.save(debug_dir / "overlay_all.png")
    # resampled signal plot (whole recording) for a sanity check
    Hh, Ww = 220, 2676
    plot = Image.new("RGB", (Ww, Hh), (0, 0, 0))
    d = ImageDraw.Draw(plot)
    for e in exposures:
        d.rectangle([e["xray"][0] * K, 0, e["xray"][1] * K, Hh], fill=(0, 70, 30))
    yz = lambda v: Hh * 0.72 - v * Hh * 0.55
    d.line([(0, yz(0)), (Ww, yz(0))], fill=(40, 40, 120))
    d.line([(ti * K, yz(v)) for ti, v in zip(t, sig)], fill=(80, 255, 140), width=1)
    for b in beats:
        d.line([(b["r"] * K, 0), (b["r"] * K, 12)], fill=(255, 230, 0))
        if b["p"]:
            d.ellipse([b["p"] * K - 2, yz(b["pAmp"]) - 2, b["p"] * K + 2, yz(b["pAmp"]) + 2], outline=(255, 120, 255))
        if b["t"]:
            d.ellipse([b["t"] * K - 2, yz(b["tAmp"]) - 2, b["t"] * K + 2, yz(b["tAmp"]) + 2], outline=(120, 200, 255))
    plot.save(debug_dir / "signal_250hz.png")
    print("debug overlays in", debug_dir)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    default_root = ROOT.parent / ROOT.parent.name
    ap.add_argument("export_root", nargs="?", default=str(default_root))
    ap.add_argument("--debug-dir", default=str(DERIVED / "ecg_debug"))
    a = ap.parse_args()
    main(Path(a.export_root), Path(a.debug_dir))
