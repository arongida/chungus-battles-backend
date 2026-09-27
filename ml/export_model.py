"""Export a trained LightGBM fight model for the TypeScript bot runtime (src/bot/ml/).

Usage (from ml/):
    uv run python export_model.py models/fight.txt data/fights-v27.csv \
        --out ../src/bot/ml/models/fight-v27.json \
        --parity ../test/fixtures/fightModelParity.json

What it does, and why:
  * LightGBM can dump a model as JSON (`booster.dump_model()`): every tree, every split. That
    dump is verbose, so it is compacted to the minimum the TypeScript evaluator needs:
    a split node is {f: feature index, t: threshold, d: default_left, m: missing type, l, r},
    a leaf is {v: value}. Prediction = sigmoid(sum of the leaf each tree lands in).
  * The feature spec (names + hash, from data/feature_spec.json) is embedded. The runtime refuses
    a model whose hash differs from the features it computes — training/serving skew caught at
    load time instead of silently producing garbage.
  * A parity fixture of 200 real rows + Python's own predictions is written so a Jest test can
    prove the TypeScript evaluator reproduces LightGBM exactly.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd


def compact(node: dict) -> dict:
    if "leaf_value" in node:
        return {"v": node["leaf_value"]}
    if node.get("decision_type", "<=") != "<=":
        raise ValueError(f"unsupported split type {node.get('decision_type')!r} (categorical features are not used)")
    return {
        "f": node["split_feature"],
        "t": node["threshold"],
        "d": bool(node.get("default_left", True)),
        "m": node.get("missing_type", "None"),
        "l": compact(node["left_child"]),
        "r": compact(node["right_child"]),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model", help="LightGBM model saved with booster.save_model(...)")
    ap.add_argument("data", help="a CSV with the feature columns, used for the parity fixture")
    ap.add_argument("--spec", default="data/feature_spec.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--parity", help="where to write the parity fixture (optional)")
    ap.add_argument("--game-version", type=int, default=None)
    ap.add_argument("--note", default="", help="free text stored in the artifact (e.g. metrics)")
    args = ap.parse_args()

    booster = lgb.Booster(model_file=args.model)
    spec = json.loads(Path(args.spec).read_text())
    names = spec["names"]
    if booster.feature_name() != names:
        raise SystemExit("model features differ from feature_spec.json — was it trained on this export?")

    dump = booster.dump_model()
    objective = str(dump.get("objective", ""))
    if not (objective.startswith("binary") or objective.startswith("cross_entropy") or objective.startswith("xentropy")):
        raise SystemExit(f"expected a probability objective, got {objective!r}")

    df = pd.read_csv(args.data)
    game_version = args.game_version or int(df["gameVersion"].iloc[0])
    artifact = {
        "format": "chungus-gbdt-v1",
        "gameVersion": game_version,
        "featureSpecHash": spec["hash"],
        "featureNames": names,
        "objective": objective,
        "trainedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "note": args.note,
        "trees": [compact(t["tree_structure"]) for t in dump["tree_info"]],
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(artifact, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB, {len(artifact['trees'])} trees)")

    if args.parity:
        rows = df[names].sample(n=min(200, len(df)), random_state=0).to_numpy(dtype=np.float64)
        preds = booster.predict(rows)
        fixture = {"featureSpecHash": spec["hash"], "rows": rows.tolist(), "expected": preds.tolist()}
        Path(args.parity).parent.mkdir(parents=True, exist_ok=True)
        Path(args.parity).write_text(json.dumps(fixture))
        print(f"wrote parity fixture {args.parity} ({len(preds)} rows)")


if __name__ == "__main__":
    main()
