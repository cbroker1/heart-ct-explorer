# Heart CT Explorer ❤️‍🔥

**My cardiac CT scan, turned into an explorable 3D experience that runs entirely in the browser.**

### ▶ Live: https://cbroker1.github.io/heart-ct-explorer/

A real, low-dose, ECG-gated "calcium score" CT (37-year-old male, Siemens SOMATOM X.ceed, Nov 2026),
de-identified and rebuilt as:

| Page | What it is |
|---|---|
| **Overview** | A beating 3D heart, key numbers, and where the 13.7 cm scan slab sits on my body |
| **Slices** | A hand-written WebGL2 multiplanar viewer for all 8 CT series (951 slices): window/level, MIP/MinIP slabs, AI anatomy overlays, ruler, compare mode, deep links |
| **Anatomy 3D** | 61 AI-segmented structures (heart chambers, vessels, lungs, airways, ribs, spine…) with presets, clipping through the real CT, explode view |
| **Volume** | GPU ray-marched volume rendering: cinematic, skeleton, lungs, anatomy colours, a virtual X-ray, MIP and a heart close-up |
| **Calcium Score** | A DIY Agatston coronary calcium score from the raw pixels, every candidate shown, adjudicated by 3 independent AI reviewers |
| **AI Read** | A systematic "second read" of every series by 8 AI specialist reviewers, with each finding cross-examined by 3 AI skeptics |
| **Lab ✦** | My real ECG (digitized from the scanner printout) driving a beating heart, a life-size AR heart, a 3D-printable STL, body-by-the-numbers |

> **Not a medical device. For curiosity and education.** The official radiologist report is what counts.

## The results (for fun — sorry, radiologists)

- **DIY coronary calcium score: 0.** 41 bright specks ≥130 HU were found near the heart; all were traced to low-dose
  noise sitting on a table-step artifact. Three independent AI reviewers agreed unanimously. Nothing in or around the
  heart reaches 200 HU. At 37, a score of 0 is what most men have (75th percentile = 0; Javaid et al., *JACC* 2022).
- **AI second read: nothing concerning.** Normal heart size (CT ratio 0.39), no pericardial fluid, no valve calcium,
  normal pulmonary artery (≈26 mm), no enlarged lymph nodes, no emphysema, no fatty liver, healthy bone density.
  Three small "good to know" notes, none needing follow-up:
  ascending aorta 37–38 mm (upper-normal, < 40 mm), one 3 mm lung micronodule (Fleischner: no follow-up < 6 mm),
  and small Schmorl's nodes at T9/T11.
- Two would-be findings were **thrown out by the skeptic panel**: "healed rib fractures" (a table-seam artifact)
  and "moderate visceral fat" (normal).

## How it was made

```
DICOM (Medicom export) ─► 01_convert.py        de-identified NIfTI volumes + exam summary (LPS geometry)
                       ─► 02_segment.sh         TotalSegmentator v2: organs, bones, vessels, pericardium, airways
                       ─► 02b_segment_v1_*.sh   TotalSegmentator v1 cardiac model: LA / LV / RA / RV / myocardium
                       ─► 03_calcium.py         Agatston candidates, review sheets, threshold sweep
                          03b / 03c             cross-reconstruction checks; fold in the AI adjudication
                       ─► 04_meshes.py          marching cubes → smoothed, decimated GLB (meshopt) + printable STL
                       ─► 05_web_assets.py      byte-shuffled gzip volumes, label grids, manifest.json
                       ─► 06_ecg.py             digitize the scanner's ECG printout → ecg.json
                       ─► 07_lab_assets.py      life-size AR heart, body-by-the-numbers
                       ─► 08_read_report.py     AI second read → read.json
web/  Vite + React 19 + TypeScript, three.js / react-three-fiber, raw WebGL2 for the slice viewer and ray marcher
```

The AI review and the web app were built with [Claude Code](https://claude.com/claude-code) agent workflows:
32 agents for the clinical read (1,037 images rendered and inspected), 8 page builders, and a QA pass.

## Run it yourself

```bash
conda env create -f environment.yml && conda activate heartct
pip install torch --index-url https://download.pytorch.org/whl/cu124   # or the CPU wheel
pipeline/run_all.sh /path/to/dicom_export          # the folder containing DICOMDIR
cd web && npm ci && npm run dev                     # http://127.0.0.1:5173
web/scripts/deploy-gh-pages.sh                      # build + publish to the gh-pages branch
```

## Data & privacy

The scan is mine, and I chose to publish it. Everything here is de-identified: no names, IDs, birth dates or
institution. The raw DICOM files and the hospital's bundled viewer are **not** in this repo. Voxels outside the body
are flattened to air to shrink downloads. AI segmentations are estimates, especially on a non-contrast scan.

## Credits

[TotalSegmentator](https://github.com/wasserth/TotalSegmentator) (Wasserthal et al., *Radiology: AI* 2023) ·
[three.js](https://threejs.org) · [react-three-fiber](https://github.com/pmndrs/react-three-fiber) / drei ·
[&lt;model-viewer&gt;](https://modelviewer.dev) (BSD-3, vendored) · pydicom · SimpleITK · scikit-image · trimesh ·
gltf-transform. References: Agatston 1990 (*JACC*); Javaid 2022 (*JACC*); Fleischner Society 2017; Framingham CT
reference values. Code is MIT-licensed.
