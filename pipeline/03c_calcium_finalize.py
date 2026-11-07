"""Stage 3c: fold the independent AI adjudication into the calcium result.

Input : data/derived/calcium/adjudication_raw.json  (list of reviewer reports from the
        ct-second-read workflow; each has candidates[{id, verdict, artery, confidence, note}],
        missedLesions[], s8Blob{}, agatstonEstimate, confidenceZero, summary)
Output: data/derived/calcium_review_decisions.json (majority vote per candidate), then re-runs
        03_calcium.py so the scores use those decisions, then adds `adjudication` and
        `percentileContext` blocks to data/derived/calcium/calcium.json.
"""
from __future__ import annotations

import collections
import json
import re
import runpy
from pathlib import Path

from common import DERIVED, write_json

HERE = Path(__file__).resolve().parent
RAW = DERIVED / "calcium" / "adjudication_raw.json"
DECISIONS = DERIVED / "calcium_review_decisions.json"

PERCENTILES = {
    "source": "Javaid A, Dardari ZA, Mitchell JD, et al. Distribution of Coronary Artery Calcium by Age, Sex, and Race "
              "Among Patients 30-45 Years Old. J Am Coll Cardiol. 2022;79(19):1873-1886 (Table 3).",
    "url": "https://doi.org/10.1016/j.jacc.2022.02.051",
    "age": 37,
    "rows": [{"group": "White men, age 37", "p75": 0, "p90": 8, "p95": 35, "p97_5": 80},
             {"group": "Black men, age 37", "p75": 0, "p90": 1, "p95": 10, "p97_5": 35}],
    "prevalenceNonzero": {"White men aged 30-45": 0.26, "Black men aged 30-45": 0.16},
    "note": "Pooled CARDIA + CAC Consortium + Walter Reed cohorts (19,725 asymptomatic adults aged 30-45). "
            "Percentiles for other groups were not estimable in that study; MESA percentiles start at age 45.",
}

# Reviewer notes are published: strip working-file references and machine paths, fix known slips.
_PATH = re.compile(r"(?:images?:\s*)?/(?:home|Users|tmp)/\S+")
_FILE = re.compile(r"\(?[\w.\-/]+\.(?:png|npy|npz|py|json|csv|nii\.gz)\)?")
_FILETOK = r"\S+\.(?:png|npy|npz|py|json|csv|gz)"
_TRAIL = re.compile(r"\s*(?:Files?|Figures?|Images?)\s*:\s*" + _FILETOK + r"(?:\s*(?:,|and)\s*" + _FILETOK + r")*\s*\.?", re.I)
FIXES = {
    "The ascending aorta measures about 34-36 mm, consistent with the radiologist's 36.1 mm caliper.":
        "At the levels this reviewer looked at, the ascending aorta measured about 34-36 mm, in line with the "
        "radiologist's 36.1 mm caliper; the AI second read found 37-38 mm at its widest point (upper-normal, below 40 mm).",
    "The scan has 4 steps of 38.4 mm": "The scan has 4 table steps of about 34 mm (38.4 mm detector width)",
}


def clean_text(t: str) -> str:
    for a, b in FIXES.items():
        t = t.replace(a, b)
    t = _TRAIL.sub(" ", t)
    t = _PATH.sub("", t)
    t = _FILE.sub("", t)
    t = re.sub(r"\(\s*[,;]?\s*\)", "", t)                 # empty parentheses left behind
    t = re.sub(r"\s+([,.;:])", r"\1", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip(" ,;")


def clean(obj):
    if isinstance(obj, str):
        return clean_text(obj)
    if isinstance(obj, list):
        out = [clean(x) for x in obj]
        return [x for x in out if not (isinstance(x, str) and len(x) < 3)]
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    return obj


VERDICT_TO_CLASS = {"coronary": "coronary", "aortic": "aortic", "valvular": "valvular",
                    "noise-artifact": "noise", "bone": "bone", "other": "other"}


def main():
    reviewers = clean(json.loads(RAW.read_text()))
    votes: dict[int, list[dict]] = collections.defaultdict(list)
    for r in reviewers:
        for c in r.get("candidates", []):
            votes[int(c["id"])].append({"reviewer": r.get("reviewer") or r.get("_key", "?"), "verdict": c["verdict"],
                                        "artery": c.get("artery") or "", "confidence": c.get("confidence", 0),
                                        "note": c.get("note", "")})
    decisions = {}
    for cid, vs in votes.items():
        tally = collections.Counter(v["verdict"] for v in vs)
        verdict, n = tally.most_common(1)[0]
        # Coronary calls need a strict majority of all reviewers who looked at it.
        if verdict == "coronary" and n <= len(vs) / 2:
            verdict = "noise-artifact"
        arteries = collections.Counter(v["artery"] for v in vs if v["verdict"] == "coronary" and v["artery"])
        decisions[str(cid)] = {
            "class": VERDICT_TO_CLASS.get(verdict, "other"),
            "artery": arteries.most_common(1)[0][0] if verdict == "coronary" and arteries else None,
            "note": f"{n}/{len(vs)} reviewers: {verdict}",
            "votes": vs,
        }
    write_json(DECISIONS, decisions)
    print(f"decisions for {len(decisions)} candidates ->", DECISIONS)

    runpy.run_path(str(HERE / "03_calcium.py"), run_name="__main__")

    cal_path = DERIVED / "calcium" / "calcium.json"
    cal = json.loads(cal_path.read_text())
    for c in cal["candidates"]:
        d = decisions.get(str(c["id"]))
        if d:
            c["reviewVotes"] = d["votes"]
    missed = [m for r in reviewers for m in r.get("missedLesions", [])]
    real_missed = [m for m in missed if str(m.get("verdict", "")).lower().startswith("coronary")]
    cal["adjudication"] = {
        "reviewers": [{"key": r.get("_key", r.get("reviewer", "?")), "lens": r.get("_lens", ""),
                       "agatstonEstimate": r.get("agatstonEstimate", 0), "confidenceZero": r.get("confidenceZero", 0),
                       "summary": r.get("summary", "")} for r in reviewers],
        "consensus": (f"{len(reviewers)} independent AI reviewers judged all {len(cal['candidates'])} candidates: "
                      + (f"{n_cor} coronary lesion(s) after majority vote." if (n_cor := sum(1 for c in cal['candidates'] if c.get('finalClass') == 'coronary'))
                         else "none is coronary calcium.")
                      + (" They also noted a few calcified costal cartilages in the chest wall, outside the heart (normal, not scored)."
                         if missed and not real_missed else
                         (f" They proposed {len(real_missed)} extra coronary lesion(s) outside the candidate list." if real_missed else ""))),
        "missedLesions": missed,
        "s8Blob": [r.get("s8Blob") for r in reviewers if r.get("s8Blob")],
    }
    for c in cal["candidates"]:            # a 'chamber' only makes sense for specks inside the heart
        if c.get("fracInHeart", 0) == 0 and c.get("fracInPericardium", 0) == 0:
            c["chamber"] = "outside"
    cal["percentileContext"] = PERCENTILES
    cal["reviewed"] = True
    write_json(cal_path, cal)
    print("calcium.json finalized: totals", cal["totals"])


if __name__ == "__main__":
    main()
