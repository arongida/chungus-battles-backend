"""Small helpers for the notebooks — the fiddly bits that aren't the point of the exercise."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

DATA = Path(__file__).parent / "data"


def feature_names() -> list[str]:
    """The model's input columns, in order (written by the export/farm scripts)."""
    return json.loads((DATA / "feature_spec.json").read_text())["names"]


def load(game_version: int = 27) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(organic fights, farmed matchups). Organic: one real fight per row, label 0/1.
    Farm: one matchup per row, label = share of `repeats` fights side A won (a soft label)."""
    organic = pd.read_csv(DATA / f"fights-v{game_version}.csv", parse_dates=["createdAt"])
    farm_file = DATA / f"farm-v{game_version}.csv"
    farm = pd.read_csv(farm_file, parse_dates=["createdAt"]) if farm_file.exists() else pd.DataFrame()
    # .copy() consolidates the ~240 columns into one block; without it pandas warns
    # "DataFrame is highly fragmented" on every later .assign().
    return organic.copy(), farm.copy()


def swap_sides(df: pd.DataFrame, names: list[str]) -> pd.DataFrame:
    """The same matchups seen from the other side: a_* <-> b_*, differences and log-ratios negated,
    label -> 1 - label, player ids swapped. Appending this to the training data teaches the model
    that P(A beats B) = 1 - P(B beats A)."""
    out = df.copy()
    for name in names:
        if name.startswith("a_"):
            other = "b_" + name[2:]
            out[name], out[other] = df[other].values, df[name].values
        elif name.startswith("diff_") or name.startswith("log_"):
            out[name] = -df[name]
    if "label" in out:
        out["label"] = 1 - df["label"]
    for a, b in (("aOriginalPlayerId", "bOriginalPlayerId"), ("aIsBot", "bIsBot")):
        if a in out and b in out:
            out[a], out[b] = df[b].values, df[a].values
    if "winsA" in out and "repeats" in out:
        out["winsA"] = df["repeats"] - df["draws"] - df["winsA"]
    return out


def organic_splits(organic: pd.DataFrame):
    """The Notebook 1 split, exactly: 20% of characters -> test, then 25% of the rest -> val,
    grouped by side A's character. Returns (train, val, test). Same seeds, so every notebook
    gets the identical split."""
    from sklearn.model_selection import GroupShuffleSplit

    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=0)
    trainval_idx, test_idx = next(gss.split(organic, groups=organic["aOriginalPlayerId"]))
    trainval, test = organic.iloc[trainval_idx], organic.iloc[test_idx]
    gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=1)
    train_idx, val_idx = next(gss.split(trainval, groups=trainval["aOriginalPlayerId"]))
    return trainval.iloc[train_idx], trainval.iloc[val_idx], test


def characters(*dfs: pd.DataFrame) -> set:
    """Every character id that appears on either side of these rows."""
    ids = set()
    for df in dfs:
        ids |= set(df["aOriginalPlayerId"]) | set(df["bOriginalPlayerId"])
    return ids
