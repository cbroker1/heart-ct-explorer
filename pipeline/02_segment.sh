#!/usr/bin/env bash
# Stage 2: anatomical segmentation with TotalSegmentator (open tasks only).
# Runs on CPU by default so it never competes with other GPU workloads; pass DEVICE=gpu to change.
set -euo pipefail
cd "$(dirname "$0")/.."
IN=data/nifti/thin_lung.nii.gz
DEVICE=${DEVICE:-cpu}
mkdir -p data/seg
for TASK in total trunk_cavities lung_vessels body vertebrae_body pleural_pericard_effusion; do
  OUT=data/seg/${TASK}.nii.gz
  if [ -f "$OUT" ]; then echo "skip $TASK"; continue; fi
  echo "=== $TASK $(date +%T)"
  TotalSegmentator -i "$IN" -o "$OUT" --ml -ta "$TASK" -d "$DEVICE" --nr_thr_saving 4 || echo "!!! $TASK failed"
  echo "=== done $TASK $(date +%T)"
done
