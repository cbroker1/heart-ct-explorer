#!/usr/bin/env bash
# Rebuild everything from a Medicom/IHE-PDI DICOM export.
#   usage: pipeline/run_all.sh /path/to/export_root      (the folder that contains DICOMDIR)
# Needs the `heartct` conda env (environment.yml) and, for heart chambers, the `heartct-v1` env
# that 02b creates on first run. Steps marked [AI] were done by Claude Code agent workflows; their
# outputs (data/derived/calcium/adjudication_raw.json, data/derived/read/*.json) are inputs here.
set -euo pipefail
cd "$(dirname "$0")/.."
EXPORT=${1:?path to DICOM export root}
PY="conda run --no-capture-output -n heartct python"
$PY pipeline/01_convert.py "$EXPORT"                # DICOM -> de-identified NIfTI + exam.json
conda run --no-capture-output -n heartct bash pipeline/02_segment.sh   # TotalSegmentator v2 tasks
bash pipeline/02b_segment_v1_chambers.sh            # TotalSegmentator v1 heart chambers
(cd pipeline && $PY 03_calcium.py)                  # Agatston candidates + review sheets
(cd pipeline && $PY 03b_calcium_crosscheck.py)      # cross-reconstruction checks, contact sheets
# [AI] independent adjudication of candidates -> data/derived/calcium/adjudication_raw.json
if [ -f data/derived/calcium/adjudication_raw.json ]; then (cd pipeline && $PY 03c_calcium_finalize.py); fi
(cd pipeline && $PY 04_meshes.py)                   # GLB + STL
(cd pipeline && $PY 05_web_assets.py)               # web volumes, labels, manifest
[ -f pipeline/06_ecg.py ] && (cd pipeline && $PY 06_ecg.py "$EXPORT" || $PY 06_ecg.py)   # ECG digitization
[ -f pipeline/07_lab_assets.py ] && (cd pipeline && $PY 07_lab_assets.py)              # AR heart, body numbers
# [AI] systematic second read -> data/derived/read/workflow_result.json + synthesis.json
if [ -f data/derived/read/synthesis.json ]; then (cd pipeline && $PY 08_read_report.py); fi
(cd pipeline && $PY 05_web_assets.py)               # refresh manifest file list
echo "done -> web/public/data"
