#!/usr/bin/env bash
# Optional: heart chambers via TotalSegmentator v1.5.7 (open weights, nnU-Net v1) in its own env.
# v2's open "total" task only has a whole-heart label; v1's cardiac model splits it into
# LA / LV / RA / RV / myocardium / pulmonary artery / aorta.
# Weights live in their own folder so they never collide with v2's ~/.totalsegmentator.
set -uo pipefail
cd "$(dirname "$0")/.."
ENV=heartct-v1
export TOTALSEG_WEIGHTS_PATH=${TOTALSEG_WEIGHTS_PATH:-$HOME/.totalsegmentator_v1}
if ! conda env list | grep -q "^$ENV "; then
  conda create -y -n $ENV python=3.10 >/dev/null
  conda run -n $ENV python -m pip install -q "torch==2.1.2" --index-url https://download.pytorch.org/whl/cpu
  conda run -n $ENV python -m pip install -q "TotalSegmentator==1.5.7" "numpy<2" "SimpleITK<2.4" "nibabel<5.3" "setuptools<70"
fi
W=$TOTALSEG_WEIGHTS_PATH/nnUNet/3d_fullres
if [ ! -d "$W/Task253_TotalSegmentator_part3_cardiac_1139subj/nnUNetTrainerV2_ep4000_nomirror__nnUNetPlansv2.1" ]; then
  mkdir -p "$W" && curl -sSL -o "$W/t253.zip" \
    https://github.com/wasserth/TotalSegmentator/releases/download/v1.5.6-weights/Task253_TotalSegmentator_part3_cardiac_1139subj.zip \
    && (cd "$W" && unzip -q -o t253.zip && rm t253.zip)
fi
mkdir -p data/seg_v1
conda run --no-capture-output -n $ENV TotalSegmentator -i data/nifti/thin_lung.nii.gz -o data/seg_v1/total_v1.nii.gz --ml
# anatomy.py / review_tools.py read the chambers from data/seg/total_v1_full.nii.gz
cp data/seg_v1/total_v1.nii.gz data/seg/total_v1_full.nii.gz
