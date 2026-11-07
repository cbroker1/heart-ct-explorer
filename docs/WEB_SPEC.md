# Heart CT Explorer: web build spec (shared by all page builders)

## What we're building
A static single-page app (deployed to GitHub Pages) that lets a curious, non-medical person explore
**their own** cardiac CT scan: slices, a 3D anatomy model, volume rendering, a DIY calcium score,
an AI "second read" report, and a Lab of surprises. It should feel like premium sci-fi medical
software: dark, glassy, smooth, delightful. It must still be honest and clear.

Owner/viewer: a 37-year-old man, the patient himself. He said the data may be public. All data is
already de-identified (no names, IDs or birth dates). Never add any.

## Stack (installed; do NOT add dependencies or run `npm install`)
React 19 + TypeScript (strict) + Vite 7, three 0.187, @react-three/fiber 9, @react-three/drei 10,
zustand 5. `playwright-core` is a dev dep, for screenshots only.
`<model-viewer>` is vendored at `public/vendor/model-viewer-4.4.0.min.js` (self-contained bundle,
includes its own three). Load it lazily with a `<script type="module">` tag only on the page that
needs it. Never `import` it.

## Repo layout & ownership rules
```
web/
  index.html, vite.config.ts, tsconfig.json, package.json     <- shared, DO NOT EDIT
  src/main.tsx, src/App.tsx (routes)                           <- shared, DO NOT EDIT
  src/styles.css (design tokens + primitives)                  <- shared, DO NOT EDIT
  src/lib/data.ts   manifest types + loaders (loadManifest, loadGrid, loadJSON, dataUrl)
  src/lib/coords.ts LPS <-> world, voxel <-> LPS helpers
  src/lib/store.ts  zustand store (manifest, cursor LPS, selectedStructure, selectedLesion, sliceSeries)
  src/components/ui.tsx  Slider, Toggle, Segmented, LoaderOverlay, Stat, ErrorBox, HeartIcon, navigate
  src/pages/<Page>.tsx                                         <- YOUR entry file (default export)
  src/pages/<page>/...                                         <- YOUR folder: components, shaders, css
  public/data/                                                 <- generated data (read-only for you,
                                                                  except files your brief explicitly assigns)
```
- Only edit your own page entry file and your own `src/pages/<page>/` folder (lowercase folder name).
  Put page CSS in `src/pages/<page>/<page>.css` and import it from your page. Prefix your class
  names (e.g. `.slc-...`, `.ana-...`) so pages never collide.
- If a shared file has a bug or is missing something, do NOT edit it. Work around it locally and
  list the issue in your final report.
- Pipeline scripts (Python) live in `pipeline/`. Only create the new scripts your brief names.

## Data contract (read `src/lib/data.ts` first, it is the source of truth)
- `useApp(s => s.manifest)` is loaded before any page renders (App.tsx guarantees it).
- `manifest.volumes[]`: int16 HU grids for the slice viewer (`calcium`, `axial_st`, `axial_lung`,
  `thin_lung`, `axial_lung_mip`, `cr_vessel_suppress`, `cor_st`, `sag_st`). Load with
  `loadGrid(meta, onProgress)`, which returns an `Int16Array` (x fastest, then y, then z) and is cached.
  Sizes are 12-36 MB each, so load lazily with a progress bar (`LoaderOverlay`).
- `manifest.labels`: uint8 anatomy label grid on the thin_lung grid, plus `classes[]` (id, name,
  display, color, group, volumeML). 0 = background.
- `manifest.lesions`: uint8 grid on the calcium grid of calcium *candidate* ids, plus `classes[]`
  (id, display, color, group = final class). Details are in `public/data/calcium.json`.
- `manifest.render` / `manifest.renderLabels`: 256x256x183 uint8 volume (HU mapped linearly from
  huMin=-1024..huMax=1976 to 0..255, lightly smoothed) and labels on the same grid, for ray marching.
  `manifest.heartRender`: 256x256x91 uint8 heart-only high-res volume (same HU mapping).
- `manifest.meshes`: `mesh/anatomy.glb` (meshopt-compressed; drei's `useGLTF` decodes meshopt
  automatically) with one node per structure. Node name = `meshes.nodes[].name`, which carries
  display, color, group, volumeML, defaultVisible, defaultOpacity.
- Misc files (fetch with `loadJSON('x.json')` / `dataUrl('x.png')`): `exam.json` (de-identified exam,
  dose, ECG facts, topogram geometry incl. `scanRangeRows`, radiologist caliper in LPS, ClearRead result),
  `calcium.json`, `topogram_ap.png`, `topogram_lat.png`, `calcium_thumbs/thumb_NNN.png` and
  `cand_NNN.png`, `mesh/print_heart.stl` (watertight), and later `read.json`, `biomarkers.json`, `ecg.json`.

### Geometry (critical)
- Patient space = DICOM **LPS mm** (+x patient Left, +y Posterior, +z Superior).
  Voxel (i,j,k) centre = `origin + D · (i·sx, j·sy, k·sz)`, D = `direction` (row-major; columns are
  the axis directions). See `indexToLps` / `lpsToIndex` in coords.ts. Most grids are axial with
  D = identity. `cor_st` / `sag_st` are not. Handle the general D.
- three.js world = mm, centred on `manifest.worldCenterLPS` (heart centroid):
  `world = (x_L, z_S, -y_P)` relative to the centre (`lpsToWorld` / `worldToLps`). +Y is up (head),
  +Z points out of the patient's chest toward the default camera, +X is the patient's LEFT (shown on
  screen right when looking at the front). The GLB vertices are already in this world frame.
- Radiological display conventions for 2D: axial = patient Right on screen left, anterior at top.
  Coronal = patient Right on screen left, superior at top. Sagittal = anterior on screen left,
  superior at top.

### Shared state & deep links
- `cursor` in the store is the shared focus point (LPS). Any page may set it.
- Deep link into the slice explorer: `#/slices?series=<key>&lps=<x>,<y>,<z>&plane=<axial|coronal|sagittal>&window=<preset>`
  (all params optional). Window presets: `soft` (40/400), `mediastinum` (50/350), `lung` (-600/1500),
  `bone` (500/2000), `calcium` (200/600), `liver` (60/160), `fat` (-100/300). Use
  `navigate('/slices?...')` from ui.tsx. The Slices page must honor these params.

## Design system
Use the CSS variables and classes in `src/styles.css`: `.panel`, `.card`, `.btn` (`.primary`, `.cyan`,
`.ghost`, `.small`), `.seg`, `.chip` (`.good`, `.warn`, `.bad`, `.info`), `.stat`, `.eyebrow`, `.muted`,
`.grid-2/3/4`, `.viewer` / `.stage` / `.side` (full-bleed viewer layout with sidebar; it stacks on
mobile), `.tooltip`, `table.data`, `.disclaimer`, `.page-pad` (centred content column). Fonts: Inter + JetBrains Mono.
- Colours: `--heart` coral red (#ff4d5e) is the brand accent, `--cyan` is the data/interaction accent,
  `--amber` is for warnings and `--green` for good news. Dark backgrounds only.
- Motion: subtle and purposeful (fades, easing camera moves). Respect `prefers-reduced-motion`.
- Must work at desktop 1440x900 AND phone 390x844 (no horizontal scroll; touch: one-finger
  rotate/scroll, pinch zoom where relevant).
- Every number shown should carry units, and a tooltip or caption saying what it means in plain English.
- Full-bleed pages (Slices, Anatomy 3D, Volume) render inside `<main>` with `position:absolute; inset:0`
  (use `.viewer`). Scrolling pages (Overview, Calcium, AI Read, Lab) render inside `.page-scroll`.

## Medical framing (important)
This is for curiosity and education, **not** a diagnosis. Show a short disclaimer where medical
interpretation appears ("Not a medical device. The official radiologist report is what counts."),
but don't drown the experience in warnings. Be accurate, calm and specific. Never invent findings
or numbers. Only display what is in the data files. When a number is approximate (AI segmentation on
a non-contrast, low-dose scan), say "AI estimate".

## Performance
- WebGL2 is required, so show a friendly message if it's unavailable.
- Load big volumes only when needed. Free GPU resources on unmount (dispose textures/geometries).
- Keep pages at 60 fps on a laptop. Offer a quality toggle for heavy renderers.

## Testing protocol (do this, and iterate until it looks great)
1. Typecheck: `cd web && npx tsc -b` must pass with zero errors.
2. Run your own dev server on your assigned port:
   `cd web && npx vite --port <PORT> --strictPort > /tmp/vite-<PORT>.log 2>&1 &` (polling watcher is preconfigured).
3. Screenshots + console capture with real GPU WebGL:
   `node scripts/shot.mjs "http://127.0.0.1:<PORT>/#/<route>" <out.png> --wait=4000 [--size=390x844] [--click="css sel|css sel"] [--eval="js expression"]`
   It prints console errors, page errors, failed requests and the WebGL renderer. View the PNG with the Read tool.
   Big volumes take a few seconds to load, so use `--wait=8000` or `--waitfor=<selector>`.
4. Check desktop AND mobile sizes, interact via `--click` / `--eval` (e.g. dispatch wheel events,
   set state through exposed debug hooks), and make sure there are no console errors.
5. Kill your dev server when done (`pkill -f "vite --port <PORT>"`).
Put screenshots in `a scratch folder outside the repo (e.g. /tmp/shots/<page>/)`.
