"""Stage 8: assemble the AI second read (web/public/data/read.json) from the review workflow.

Inputs
  data/derived/read/workflow_result.json  {systems: [...], calcium: [...]} from the ct-second-read workflow
  data/derived/read/synthesis.json        hand-written attending summary: headline, verdict, impression,
                                          technique, coverage, limitations, method, optional overrides
Output
  web/public/data/read.json + web/public/data/read/*.webp (evidence images)

Verification policy: each flagged finding was examined by 3 adversarial verifiers (artifact,
criteria, relevance lenses). A finding is dropped if a majority refuted it (it is then listed under
"considered and dismissed"). If it survives but the verifiers' median severity is lower, the
finding is downgraded to that median.
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

from PIL import Image

from common import DERIVED, WEB_PUBLIC, write_json

READ = DERIVED / "read"
OUT_IMG = WEB_PUBLIC / "read"
WINDOW_BY_SYSTEM = {"lung_nodules": "lung", "lung_parenchyma": "lung", "bones": "bone", "heart": "mediastinum",
                    "vessels": "mediastinum", "mediastinum": "mediastinum", "abdomen_chestwall": "soft", "technique": "soft"}
SERIES_KEYS = {"calcium", "axial_st", "axial_lung", "thin_lung", "axial_lung_mip", "cr_vessel_suppress", "cor_st", "sag_st"}


def export_image(src: str, name: str, max_side: int = 1100) -> str | None:
    p = Path(src)
    if not p.exists() or p.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        return None
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    im = Image.open(p).convert("RGB")
    s = max_side / max(im.size)
    if s < 1:
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    dst = OUT_IMG / f"{name}.webp"
    im.save(dst, "WEBP", quality=88, method=6)
    return f"read/{dst.name}"


def main():
    wf = json.loads((READ / "workflow_result.json").read_text())
    syn = json.loads((READ / "synthesis.json").read_text())
    overrides = syn.get("findingOverrides", {})        # "<system>-<idx>": {severity, category, plainEnglish, ...}
    systems_out = []
    for s in wf["systems"]:
        key = s.get("key") or s.get("system")
        verifs = {v["idx"]: v for v in s.get("verification", [])}
        findings, dismissed, notes = [], [], []
        for i, f in enumerate(s.get("findings", [])):
            fid = f"{key}-{i}"
            v = verifs.get(i)
            status, votes = "unverified", []
            sev, cat = int(f.get("severity", 0)), f.get("category", "benign-incidental")
            if v:
                votes = [{"lens": ["artifact", "criteria", "relevance"][j] if j < 3 else str(j),
                          "refuted": bool(x.get("refuted")), "note": x.get("note", "")} for j, x in enumerate(v.get("votes", []))]
                if not v.get("survives", True):
                    dismissed.append(f.get("title", fid))
                    continue
                adj = [int(x.get("adjustedSeverity", sev)) for x in v.get("votes", []) if not x.get("refuted")]
                med = int(statistics.median_low(adj)) if adj else sev
                if med < sev:
                    status, sev = "downgraded", med
                else:
                    status = "confirmed"
            o = overrides.get(fid, {})
            if o.get("drop"):
                if o.get("dropReason"):
                    notes.append({"item": f.get("title", fid), "result": o["dropReason"]})
                else:
                    dismissed.append(f.get("title", fid))
                continue
            sev = int(o.get("severity", sev)); cat = o.get("category", cat)
            images = []
            for j, src in enumerate(f.get("evidence", [])[:4]):
                rel = export_image(src, f"{key}_{i}_{j}")
                if rel:
                    images.append(rel)
            link = None
            lps = f.get("lps") or []
            series = f.get("series") if f.get("series") in SERIES_KEYS else None
            if len(lps) == 3 and series:
                plane = f.get("plane") if f.get("plane") in ("axial", "coronal", "sagittal") else "axial"
                link = {"series": series, "lps": [round(float(x), 2) for x in lps], "plane": plane,
                        "window": WINDOW_BY_SYSTEM.get(key, "soft")}
            findings.append({
                "id": fid, "title": o.get("title", f.get("title", "")), "description": o.get("description", f.get("description", "")),
                "plainEnglish": o.get("plainEnglish", f.get("plainEnglish", "")), "location": f.get("location", ""),
                "category": cat, "severity": sev, "confidence": float(f.get("confidence", 0.5)),
                "recommendation": o.get("recommendation", f.get("recommendation", "")),
                "measurements": f.get("measurements", ""),
                "verification": {"status": status, "votes": votes}, "images": images, **({"link": link} if link else {}),
            })
        max_sev = max([f["severity"] for f in findings if f["category"] != "artifact"] + [0])
        status = "attention" if max_sev >= 2 else ("minor" if max_sev == 1 else "normal")
        checked = list(s.get("checked", [])) + notes
        for t in dismissed:
            checked.append({"item": f"Considered and dismissed by the skeptic panel: {t}", "result": "not a real finding"})
        imgs = []
        for j, src in enumerate(s.get("bestImages", [])[:4]):
            rel = export_image(src, f"{key}_overview_{j}")
            if rel:
                imgs.append({"src": rel, "caption": Path(src).stem.replace("_", " ")})
        sys_over = syn.get("systemOverrides", {}).get(key, {})
        systems_out.append({
            "key": key, "title": s.get("title", key), "status": sys_over.get("status", status),
            "summary": sys_over.get("summary", s.get("summary", "")), "checked": checked,
            "measurements": s.get("measurements", []), "findings": findings, "images": sys_over.get("images", imgs),
        })
    verifs = [v for s in wf["systems"] for v in s.get("verification", [])]
    panel = {
        "reviewers": len(wf["systems"]),
        "findingsExamined": len(verifs),
        "skepticVotes": sum(len(v.get("votes", [])) for v in verifs),
        "dismissed": sum(1 for v in verifs if not v.get("survives", True)),
        "calciumAdjudicators": len(wf.get("calcium", [])),
        "imagesRendered": syn.get("imagesRendered"),
        "agents": syn.get("agents"),
        "toolCalls": syn.get("toolCalls"),
    }
    report = {
        "generated": syn.get("generated", ""),
        "panel": panel,
        "headline": syn["headline"], "verdict": syn["verdict"], "impression": syn["impression"],
        "technique": syn["technique"], "coverage": syn["coverage"], "systems": systems_out,
        "calcium": syn["calcium"], "limitations": syn["limitations"], "method": syn["method"],
        "disclaimer": syn.get("disclaimer", "Not a medical device. For curiosity and education. The official radiologist report is what counts."),
    }
    write_json(WEB_PUBLIC / "read.json", report)
    n = sum(len(s["findings"]) for s in systems_out)
    print(f"read.json: {len(systems_out)} systems, {n} findings, images in {OUT_IMG}")


if __name__ == "__main__":
    main()
