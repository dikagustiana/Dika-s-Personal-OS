#!/usr/bin/env python3
"""Export the FSRE building's replay data from the suite (brief 04).

Reads a checkout of dikagustiana/fsre-skills (read only) and writes the three files the Lab's
FSRE building replays: stages.json, skills.json and replay-unvr.json, in the event shape of
docs/lab/fsre-building-mount-report.md §3.3.

  python scripts/fsre/export-replay.py --suite <checkout of fsre-skills> --out src/data/fsre

Sources (repository paths, recorded in the files):
  skills/fs-reverse-engineering/scripts/manifest.py      stage ids and order (STAGES)
  skills/fs-reverse-engineering/references/pipeline.md    which skill runs each stage
  docs/dry-run-unvr/wave-2026-02/run_log.json             every transition, with the router's times
  docs/dry-run-unvr/wave-2026-02/review_notes.json        issues and escalations (finding text only)
  docs/dry-run-unvr/wave-2026-02/change_proposals.json    proposals logged by guruh
  docs/dry-run-unvr/wave-2026-02/commands.json            intake, tie-out and gate figures
  docs/dry-run-unvr/wave-2026-02/calibration.json         identity-periods run / not run

Never exported: skill bodies, references, prompts or scripts; holdout material (no file under
the holdout registry or guruh's private folder is read); anything under
docs/company-models/reference/; credentials, absolute paths, machine details. Times come only
from the router's run log; an event the router did not time has `at: null`.

Stdlib only. Exit codes: 0 written, 1 a check failed, 2 usage error.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from collections import Counter
from pathlib import Path

RUN = "unvr-dry-run"
WAVE_DIR = "docs/dry-run-unvr/wave-2026-02"
MANIFEST_PY = "skills/fs-reverse-engineering/scripts/manifest.py"
PIPELINE_MD = "skills/fs-reverse-engineering/references/pipeline.md"
GATES = {"gate1", "gate2", "gate3"}

# Display names for the router's stage ids, in British English. The ids, their order and the
# skills behind them come from the suite; only these labels are written here.
STAGE_NAMES = {
    "selected": "Selected", "doc_plan": "Document plan", "intake": "Intake", "gate1": "Gate 1",
    "normalized": "Normalised", "decomposed": "Decomposed", "benchmarked": "Benchmarked",
    "gate2": "Gate 2", "calibrated": "Calibrated", "gate3": "Gate 3", "packed": "Packed",
    "partner_reviewed": "Partner review", "closed": "Closed",
}

# One plain sentence per skill, in our own words (brief 04: never the skill bodies).
ROLES = {
    "fs-reverse-engineering": "Runs the pipeline: moves each company through the stages in order, keeps the gates and budgets, and records every transition.",
    "idx-universe": "Chooses which listed companies go into a wave, one pair per sub-industry, and records why.",
    "data-sourcing": "Plans which filings and reports each company needs and searches for missing operating figures.",
    "fs-intake": "Reads the filings into a standard chart of accounts and checks that every line ties to its source.",
    "review-manager": "Reviews the work at each of the three gates, writes review notes and escalates what only the owner can decide.",
    "fs-normalize": "Adjusts reported figures for one-off and non-operating items, with each adjustment evidenced.",
    "fs-driver-decomposition": "Breaks the statements into operating drivers such as volume, price and cost per unit.",
    "peer-benchmark": "Builds ranges for each driver from the companies in the same sub-industry.",
    "financial-modeling": "Calibrates the driver model against history and writes the workbook and its JSON twin.",
    "guruh": "Learns from review findings and proposes changes to the skills, which only the owner approves.",
    "partner": "The owner: decides escalations and proposals, and approves a model for publication.",
}


def read_json(suite: Path, rel: str):
    return json.loads((suite / rel).read_text(encoding="utf-8"))


def stage_ids(suite: Path) -> list[str]:
    tree = ast.parse((suite / MANIFEST_PY).read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "STAGES" for t in node.targets):
            return [ast.literal_eval(e) for e in node.value.elts]
    raise SystemExit("STAGES not found in manifest.py")


def stage_skills(suite: Path) -> dict[str, list[str]]:
    """`| \`stage\` | skill (+ …) | writes |` rows of the pipeline table."""
    out: dict[str, list[str]] = {}
    for line in (suite / PIPELINE_MD).read_text(encoding="utf-8").splitlines():
        m = re.match(r"\|\s*`([a-z_0-9]+)`\s*\|\s*([^|]+)\|", line)
        if not m:
            continue
        names = re.findall(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)+|guruh|Dika|router", m.group(2))
        skills = []
        for n in names:
            n = {"Dika": "partner", "router": "fs-reverse-engineering"}.get(n, n)
            if n not in skills:
                skills.append(n)
        out[m.group(1)] = skills
    return out


def scrub(text: str) -> str:
    """No absolute or runner paths in exported text."""
    text = re.sub(r"\$(OUT|REPO)/\S+", "[path]", text)
    text = re.sub(r"[A-Za-z]:\\\S+|/(?:home|Users|tmp|root)/\S+", "[path]", text)
    return text.strip()


def short_title(check_id: str, finding: str) -> str:
    first = re.split(r"(?<=[.;])\s", scrub(finding), maxsplit=1)[0].rstrip(".;")
    first = re.sub(r"^Wave-\d{4}-\d{2}:\s*", "", first)
    return f"{check_id}: {first}" if check_id else first


def figure_from(cmds: list[dict], script: str, pattern: str, arg_contains: str = "") -> list[re.Match]:
    out = []
    for c in cmds:
        if c.get("script") == script and arg_contains in " ".join(map(str, c.get("args", []))):
            m = re.search(pattern, c.get("stderr_tail") or "")
            if m:
                out.append(m)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--suite", required=True, help="checkout of dikagustiana/fsre-skills")
    ap.add_argument("--out", required=True, help="folder for stages.json, skills.json, replay-unvr.json")
    a = ap.parse_args(argv)
    suite, out = Path(a.suite), Path(a.out)
    src = lambda rel: rel.replace("\\", "/")  # noqa: E731

    ids = stage_ids(suite)
    per_stage = stage_skills(suite)
    missing = [s for s in ids if s not in per_stage]
    if missing:
        print(f"no skill for stages {missing} in {PIPELINE_MD}", file=sys.stderr)
        return 1
    stages = {"provisional": False, "source": f"{MANIFEST_PY} (STAGES); skills per stage from {PIPELINE_MD}",
              "stages": [{"id": s, "name": STAGE_NAMES[s], "order": i + 1, "skills": per_stage[s]}
                         for i, s in enumerate(ids)]}
    used = [k for st in stages["stages"] for k in st["skills"]]
    unknown = sorted({k for k in used if k not in ROLES})
    if unknown:
        print(f"no role written for {unknown}", file=sys.stderr)
        return 1
    skill_dirs = sorted(p.name for p in (suite / "skills").iterdir() if (p / "SKILL.md").is_file())
    # seats (layout.ts rule 0): the owner in the partner room; the router, which opens and closes
    # every run, in the lobby (its state machine ends with `closed`, which it runs)
    seats = {"partner": "partner", "fs-reverse-engineering": "lobby"}
    skills = {"provisional": False,
              "source": "skills/*/SKILL.md (names); each role is one sentence in our own words; seats as the building's rule 0",
              "skills": [{"name": n, "role": ROLES[n], **({"seat": seats[n]} if n in seats else {})}
                         for n in skill_dirs + ["partner"]]}
    if set(skill_dirs) - set(ROLES):
        print(f"no role written for {sorted(set(skill_dirs) - set(ROLES))}", file=sys.stderr)
        return 1

    wd = WAVE_DIR
    run_log = read_json(suite, f"{wd}/run_log.json")
    notes = read_json(suite, f"{wd}/review_notes.json")
    proposals = read_json(suite, f"{wd}/change_proposals.json")
    cmds = read_json(suite, f"{wd}/commands.json")
    cal = read_json(suite, f"{wd}/calibration.json")
    manifest = read_json(suite, f"{wd}/manifest.json")
    company = next(r for r in manifest if r["company_id"] == "UNVR")

    # Figures, each from its file.
    facts = figure_from(cmds, "xbrl_parse.py", r"(\d+) facts, (\d+) conflicting")
    rows = figure_from(cmds, "map_to_chart.py", r"(\d+) rows; unmapped concepts: (\d+)")
    traced = figure_from(cmds, "validate_dataset.py", r"(\d+) rows, (\d+) traced to source")
    tie = figure_from(cmds, "tieout.py", r"(\d+) checks, (\d+) failed .*?, (\d+) skipped")
    gate1 = figure_from(cmds, "gate1_checks.py", r"gate1 UNVR: (\w+) \((\d+) notes")
    idents = [i for i in cal["identities"]]
    ran = sum(1 for i in idents if i.get("status") != "not_run")
    if not (len(facts) == 5 and len(rows) == 5 and traced and tie and gate1):
        print("a figure was not found in commands.json", file=sys.stderr)
        return 1
    cmd_src = src(f"{wd}/commands.json")
    figures = {
        "filings": {"value": len(facts), "source": cmd_src},
        "factsLoaded": {"value": sum(int(m.group(1)) for m in facts), "source": cmd_src},
        "rows": {"value": sum(int(m.group(1)) for m in rows), "source": cmd_src},
        "unmappedConcepts": {"value": sum(int(m.group(2)) for m in rows), "source": cmd_src},
        "rowsTraced": {"value": int(traced[-1].group(2)), "of": int(traced[-1].group(1)), "source": cmd_src},
        "tieOutChecks": {"value": int(tie[-1].group(1)), "failed": int(tie[-1].group(2)),
                         "skipped": int(tie[-1].group(3)),
                         "passed": int(tie[-1].group(1)) - int(tie[-1].group(2)) - int(tie[-1].group(3)),
                         "source": cmd_src},
        "identityPeriodsRun": {"value": ran, "of": len(idents), "source": src(f"{wd}/calibration.json")},
        "escalatedNotes": {"value": sum(1 for n in notes if n["status"] == "escalated"),
                           "source": src(f"{wd}/review_notes.json")},
        "proposalsWaiting": {"value": sum(1 for p in proposals if p["status"] == "proposed"),
                             "source": src(f"{wd}/change_proposals.json")},
    }

    stage_skill = {s["id"]: s["skills"][0] for s in stages["stages"]}
    rl_src = src(f"{wd}/run_log.json")
    notes_src = src(f"{wd}/review_notes.json")
    events: list[dict] = []

    def add(kind: str, at, stage: str | None, skill: str | None, payload: dict | None, source: str,
            ticker: str | None = "UNVR"):
        e = {"id": f"e{len(events) + 1:03d}", "run": RUN, "ticker": ticker, "kind": kind, "at": at}
        if stage:
            e["stageId"] = stage
        if skill:
            e["skill"] = skill
        if payload:
            e["payload"] = payload
        e["source"] = source
        events.append(e)

    tie = figures["tieOutChecks"]
    stage_figures = {
        "intake": {k: figures[k] for k in ("filings", "factsLoaded", "rows", "unmappedConcepts", "rowsTraced")},
        # the building's figure keys (statuses.ts FIGURE_LABELS): tie-out counts are flat
        "gate1": {"tieOutChecks": {"value": tie["value"]}, "passed": {"value": tie["passed"]},
                  "failed": {"value": tie["failed"]}, "skipped": {"value": tie["skipped"]}},
        "calibrated": {"identityPeriodsRun": figures["identityPeriodsRun"]},
    }

    def strip_sources(figs: dict) -> dict:
        out = {}
        for k, v in figs.items():
            v = {kk: vv for kk, vv in v.items() if kk in ("value", "of")}
            out[k] = v["value"] if set(v) == {"value"} else v
        return out

    for t in run_log:
        stage, status = t["to"]
        frm = tuple(t["from"])
        if t["actor"] != "router" and frm == (stage, status):
            continue  # the manifest approval: recorded on the row, not a move
        skill = stage_skill.get(stage)
        if status == "in_progress":
            add("stage_started", t["at"], stage, skill, None, rl_src)
        elif status == "passed" and stage in GATES:
            esc = [n for n in notes if n["gate"] == stage and n["status"] == "escalated"]
            payload = {"figures": strip_sources(stage_figures.get(stage, {}))} if stage in stage_figures else {}
            for n in [n for n in notes if n["gate"] == stage]:
                check = n["location"].get("check_id", "") if isinstance(n["location"], dict) else ""
                add("issue_raised", None, stage, "review-manager",
                    {"title": short_title(check, n["finding"]), "detail": scrub(n["finding"]),
                     "ref": n["note_id"], "severity": n["severity"]}, notes_src)
            for n in esc:
                check = n["location"].get("check_id", "") if isinstance(n["location"], dict) else ""
                add("escalated", None, stage, "review-manager",
                    {"title": short_title(check, n["finding"]), "detail": scrub(n["finding"]),
                     "ref": n["note_id"], "severity": n["severity"]}, notes_src)
            add("gate_passed_with_escalation" if esc else "gate_passed", t["at"], stage, "review-manager",
                payload, rl_src)
        elif status == "passed":
            figs = stage_figures.get(stage)
            add("stage_completed", t["at"], stage, skill, {"figures": strip_sources(figs)} if figs else None, rl_src)
        elif status == "failed" and stage in GATES:
            add("gate_failed", t["at"], stage, "review-manager", {"reason": scrub(t.get("reason") or "")}, rl_src)
        elif status == "returned":
            add("stage_returned", t["at"], stage, skill, {"reason": scrub(t.get("reason") or "")}, rl_src)
        elif status == "blocked":
            add("stage_blocked", t["at"], stage, skill, {"reason": scrub(t.get("reason") or "")}, rl_src)
        elif status == "escalated":
            add("escalated", t["at"], stage, skill, {"title": f"{STAGE_NAMES[stage]}: review cycles exhausted",
                                                     "detail": scrub(t.get("reason") or "")}, rl_src)
        # `pending` is the queue between stages: the next stage_started moves the folder.

    cp_src = src(f"{wd}/change_proposals.json")
    for p in proposals:
        if p["status"] != "proposed":
            continue
        (skill_name, version), = p["version_bump"].items()
        first = re.split(r"(?<=[.])\s", scrub(p["rationale"]), maxsplit=1)
        title = f"{p['change_id']}: {skill_name} {version}"
        add("proposal_logged", None, None, "guruh",
            {"title": title, "mode": "flag-only" if not p["loosens_control"] else "loosens-control",
             "detail": scrub(p["rationale"]), "ref": p["change_id"]}, cp_src, ticker=None)

    replay = {
        "provisional": False,
        "run": RUN,
        "wave": "wave-2026-02",
        "company": {"ticker": company["company_id"], "name": company["company_name"]},
        "timesRecorded": True,
        "timesNote": "Times are the router's own (run_log.json). Review notes and proposals carry at: null: "
                     "the router did not time them, and their own created_at stamps come from an earlier "
                     "rebuild of the run, so they would read out of order.",
        "archetypes": sorted({r["archetype_id"] for r in manifest}),
        "figures": figures,
        "events": events,
        "source": f"{wd}/ (run_log, review_notes, change_proposals, commands, calibration, manifest)",
    }

    # Checks before writing.
    ids_seen = Counter(e["id"] for e in events)
    assert max(ids_seen.values()) == 1
    blob = json.dumps([stages, skills, replay], ensure_ascii=False)
    for bad in (r"[A-Za-z]:\\\\", r"/home/", r"\$OUT", r"\$REPO", r"sealed_value", r"holdout_registry"):
        if re.search(bad, blob):
            print(f"refused: exported text matches {bad}", file=sys.stderr)
            return 1

    out.mkdir(parents=True, exist_ok=True)
    for name, obj in (("stages.json", stages), ("skills.json", skills), ("replay-unvr.json", replay)):
        (out / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"stages {len(stages['stages'])}, skills {len(skills['skills'])}, events {len(events)} "
          f"({dict(Counter(e['kind'] for e in events))}), timed {sum(1 for e in events if e['at'])}")
    for k, v in figures.items():
        print(f"  {k}: {json.dumps({kk: vv for kk, vv in v.items() if kk != 'source'})}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
