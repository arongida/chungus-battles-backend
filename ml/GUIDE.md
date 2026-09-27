# Learning guide: training the fight-outcome model

You'll write four notebooks. Each section is a set of **checkpoints**: what to do, why, what you
should see, and the usual traps. Hints stay short on purpose. Try first, then ask Claude to review
or explain when you're stuck.

Open Jupyter with `cd ml && uv run jupyter lab`, and create notebooks in `ml/notebooks/`.

**First cell of every notebook** (notebooks run from `ml/notebooks/`, so `helpers.py` is one
folder up):

```python
import sys
sys.path.append("..")

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from helpers import load, feature_names, swap_sides
```

Jupyter basics: **Shift+Enter** runs a cell. Variables live in the kernel in the order you *ran*
cells (the `[n]` numbers), not their position. When in doubt, use **Kernel → Restart Kernel and
Run All Cells**. The last line of a cell is displayed automatically.

---

## The problem, in one paragraph

A fight is a function of two builds plus luck. You have thousands of examples of (build A,
build B, who won). A **supervised model** learns a function `f(features) → P(A wins)` from those
examples, so it can predict matchups it has never seen. Then the bot asks, for every choice it
could make: "which resulting board wins most often against the field?"

**Two data sources:**

| File | Rows | Label | Strength | Weakness |
|---|---|---|---|---|
| `data/fights-v27.csv` | real fights | 0 / 1 | this is what actually happens in the game | noisy (one coin flip per row); side A is always the live player |
| `data/farm-v27.csv` | farmed matchups | share of `repeats` fights A won | low noise; both sides played as "player" | synthetic pairings (random, not matchmaking) |

`helpers.py` has `load()`, `feature_names()` and `swap_sides()`.

---

## Notebook 1: `01_explore_baselines.ipynb` (Step 4)

Type each cell yourself (typing it is how it sticks) and run it with **Shift+Enter**. After each
one, read the output and answer the ❓ question in a **Markdown cell**: change the cell type in the
toolbar dropdown from "Code" to "Markdown". Those notes are your learning log.

### Cell 1: setup
The setup cell from the top of this guide.

### Cell 2: load the data
```python
organic, farm = load()
names = feature_names()
print(organic.shape, farm.shape, len(names))
```
`load()` returns two **DataFrames** (pandas' tables). `.shape` is (rows, columns). You should see
about 2,200 real fights, 6,000 farmed matchups and 228 features.

### Cell 3: look at a few rows
```python
organic[["kind", "round", "label", "log_kill_time_ratio", "log_heur_power_ratio"]].head(10)
```
`df[[...]]` picks columns and `.head(10)` shows the first 10 rows.
- `label` is 1 when side A won.
- `log_kill_time_ratio` is positive when A should kill B faster than B kills A.
- `log_heur_power_ratio` is the v2 bot's own opinion of the matchup.

❓ Find a row where the numbers say "A should win" but `label` is 0. Upsets exist; the model can
only ever give probabilities.

### Cell 4: who wins?
```python
organic.groupby("kind").label.agg(["count", "mean"])
```
`groupby("kind")` splits the table into bot fights and human (`run`) fights. The mean of a 0/1
column is the win rate.

❓ Humans win about 64% as side A, bots only about 44%. Why might a human beat the snapshot in
front of them more often than a bot does? What does that say about the bot?

### Cell 5: what the farm labels look like
```python
farm.label.hist(bins=20)
plt.xlabel("share of the matchup's fights that A won")
plt.ylabel("matchups")
plt.show()
```
❓ Most farmed matchups are 4–0 one way or the other. What does that say about how random a
single fight is, compared with how much the builds decide it?

### Cell 6: a helper to measure win rate against any number
```python
def win_rate_by(df, column, bins=10):
    """Sort the fights by `column`, cut them into `bins` equal-sized groups,
    and return each group's average `column` value and win rate."""
    groups = pd.qcut(df[column], q=bins, duplicates="drop")
    return df.groupby(groups, observed=True).agg(
        x=(column, "mean"),
        win_rate=("label", "mean"),
        fights=("label", "size"),
    )

win_rate_by(organic, "log_kill_time_ratio")
```
`pd.qcut` cuts into **quantiles**: each group holds the same number of fights. That's what you want
when the values are unevenly spread.

### Cell 7: plot it
```python
ax = win_rate_by(organic, "log_kill_time_ratio").plot(x="x", y="win_rate", marker="o", label="kill-time ratio")
win_rate_by(organic, "log_heur_power_ratio").plot(x="x", y="win_rate", marker="o", label="v2 heuristic", ax=ax)
ax.axhline(0.5, color="grey", linestyle="--")
ax.set_xlabel("feature value (positive = A looks stronger)")
ax.set_ylabel("A's win rate")
plt.show()
```
`ax=ax` draws the second line on the same chart.

❓ Both curves rise, but they flatten out around 20% and 80% instead of reaching 0% and 100%.
Even a "sure" win is lost about 1 time in 5. Why could that be? Think about what these two numbers
don't know about: talents, item skills, dodge luck.

### Cell 8: do some talents seem to matter?
```python
def talent_effect(df, talent_id):
    has = df[f"a_t_{talent_id}"] == 1
    return pd.Series({
        "fights_with": has.sum(),
        "win_rate_with": df.label[has].mean(),
        "fights_without": (~has).sum(),
        "win_rate_without": df.label[~has].mean(),
    })

pd.DataFrame({talent: talent_effect(organic, talent) for talent in [15, 401, 38]}).T
```
15 = Strong!, 401 = Berserk, 38 = Comrade. Try talents you know (ids are in
`src/talents/types/TalentTypes.ts`).

❓ Comrade looks like a winner and Strong! like a loser. Do you believe that? Two traps:
**small samples** (under 100 fights is noisy) and **correlation ≠ causation** (who picks Comrade,
and when?). The model will fall into the same traps, which is one reason the farm data helps.

### Cell 9: split the data, without leakage
```python
from sklearn.model_selection import GroupShuffleSplit

# 1. Hold out 20% of CHARACTERS as the final test set.
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=0)
trainval_idx, test_idx = next(gss.split(organic, groups=organic["aOriginalPlayerId"]))
trainval, test = organic.iloc[trainval_idx], organic.iloc[test_idx]

# 2. Split the rest into train and validation, the same way.
gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=1)
train_idx, val_idx = next(gss.split(trainval, groups=trainval["aOriginalPlayerId"]))
train, val = trainval.iloc[train_idx], trainval.iloc[val_idx]

print(len(train), len(val), len(test))
print("characters in both train and test:", len(set(train.aOriginalPlayerId) & set(test.aOriginalPlayerId)))
```
Why **groups**: one character appears in many rows, one per round. A plain random split would put
round 3 of a character in training and round 4 of the same character in test. The model would then
be tested on builds it has nearly seen: **leakage**, and scores that are too good. Grouping by
character keeps each one entirely on one side. The overlap printed should be 0.

The three sets have three jobs:
- **train**: the model learns from it.
- **val**: you compare models and tune on it.
- **test**: you touch it **once**, at the very end of notebook 2. That's your honest score.

### Cell 10: a "future" holdout
```python
ordered = organic.sort_values("createdAt")
future = ordered.iloc[int(len(ordered) * 0.85):]   # the newest 15% of fights
print(len(future), "fights since", future.createdAt.min())
```
The bot will play *future* fights, so notebook 2 also checks the model on the newest data.

### Cell 11: the baselines (the numbers every later model must beat)
```python
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss

def score(name, y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)   # log loss is infinite at exactly 0 or 1
    return {"model": name,
            "log_loss": log_loss(y, p, labels=[0, 1]),
            "auc": roc_auc_score(y, p),
            "brier": brier_score_loss(y, p)}

results = []

# Baseline 0: ignore the fight entirely, always predict the training win rate.
results.append(score("0: always the average", val.label, np.full(len(val), train.label.mean())))

# Baselines 1 and 2: a logistic regression on ONE number each.
for column in ["log_heur_power_ratio", "log_kill_time_ratio"]:
    lr = LogisticRegression().fit(train[[column]], train.label)
    results.append(score(f"LR on {column}", val.label, lr.predict_proba(val[[column]])[:, 1]))

pd.DataFrame(results).round(4)
```
- **Logistic regression** fits an S-curve from one number to a probability: the smooth version of
  your Cell 7 plot.
- `predict_proba(...)[:, 1]` is the predicted P(A wins).

How to read the metrics:
- **log loss**: lower is better; 0.693 is a coin flip. It punishes confident wrong answers.
- **AUC**: 0.5 is random, 1.0 means every winner is ranked above every loser.
- **Brier**: squared error of the probabilities; 0.25 is a coin flip.

You should see the two one-number baselines at roughly log loss 0.60 and AUC 0.77.

❓ Copy the table into a Markdown cell. The LightGBM model in notebook 2 has to beat the **LR on
log_heur_power_ratio** row. That row is "what the current bot already knows".

### Cell 12 (stretch): the same scores for human fights only
```python
human_val = val[val.kind == "run"]
lr = LogisticRegression().fit(train[["log_heur_power_ratio"]], train.label)
score("LR heur, humans only", human_val.label, lr.predict_proba(human_val[["log_heur_power_ratio"]])[:, 1])
```
❓ Better or worse than on all fights? Humans are the players the bot has to beat.

When you're done, save with **Cmd+S**. Tell Claude your answers to the ❓ questions if you want a
second opinion on them.

---

## Notebook 2: `02_lightgbm.ipynb` (Step 5)

Goal: train a gradient-boosted tree model that beats your Notebook 1 baselines, and prove it
honestly. Same routine: type each cell, run it, answer the ❓ in a Markdown cell.

### Cell 1: setup
```python
import sys
sys.path.append("..")

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss
from helpers import load, feature_names, swap_sides, organic_splits
```

### Cell 2: data, and the same split as Notebook 1
```python
organic, farm = load()
names = feature_names()
train, val, test = organic_splits(organic)   # exactly the split you built in Notebook 1
print(len(train), len(val), len(test))
```
`organic_splits` in `helpers.py` is your Notebook 1 Cell 9 code with the same random seeds. Every
notebook now gets the identical split, so scores stay comparable.

### Cell 3: the scoring helpers
```python
def score(name, y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {"model": name,
            "log_loss": log_loss(y, p, labels=[0, 1]),
            "auc": roc_auc_score(y, p),
            "brier": brier_score_loss(y, p)}

def predict(model, df):
    """P(A wins), asked from both sides and averaged, exactly as the bot will ask it."""
    p_ab = model.predict(df[names], num_iteration=model.best_iteration or None)
    p_ba = model.predict(swap_sides(df, names)[names], num_iteration=model.best_iteration or None)
    return (p_ab + (1 - p_ba)) / 2
```
Why ask twice: the model should agree that P(A beats B) = 1 − P(B beats A), but trees are never
perfectly symmetric. Averaging both views enforces it. The TypeScript runtime does the same.

### Cell 4: keep the farm from leaking
```python
held_out = set(val.aOriginalPlayerId) | set(test.aOriginalPlayerId)

def without_characters(farm_rows, ids):
    return farm_rows[~(farm_rows.aOriginalPlayerId.isin(ids) | farm_rows.bOriginalPlayerId.isin(ids))]

farm_train = without_characters(farm, held_out)
print(len(farm_train), "of", len(farm), "farm matchups are safe to train on")
```
The farm fought random stored characters, including characters in your val and test sets. If the
model trains on "Bob's build beats X" from the farm, then scores itself on Bob's real fights, that's
**leakage** again. Expect only about a third of the farm to survive. That's the price of an honest
score.

### Cell 5: build the training table
```python
def build(organic_rows, farm_rows, farm_weight=1.0):
    both = pd.concat([
        organic_rows.assign(weight=1.0),
        farm_rows.assign(weight=farm_rows.repeats / 4 * farm_weight),
    ], ignore_index=True)
    # Every matchup from both sides: teaches P(A beats B) = 1 - P(B beats A).
    return pd.concat([both, swap_sides(both, names)], ignore_index=True)

table = build(train, farm_train)
print(table.shape, "mean label:", table.label.mean().round(3))
```
- **Weights:** a farm row summarises 4 fights, so it carries more evidence than one real fight.
  `farm_weight` lets you turn the farm up or down later.
- **Swapping:** the mean label becomes exactly 0.5, because every row appears with its mirror. That
  removes the "side A usually wins" bias you found in Notebook 1.

❓ Why must the swap happen *after* the split, never before?

### Cell 6: train the first model
```python
PARAMS = {
    "objective": "cross_entropy",   # accepts soft labels like 0.75 (plain "binary" does not)
    "learning_rate": 0.05,
    "num_leaves": 15,
    "min_data_in_leaf": 50,
    "feature_fraction": 0.8,
    "feature_pre_filter": False,    # lets you change min_data_in_leaf between runs
    "verbose": -1,
    "seed": 0,
}

def fit(params, table, valid_df, rounds=2000):
    dtrain = lgb.Dataset(table[names], label=table.label, weight=table.weight,
                         feature_name=names, free_raw_data=False)
    dval = lgb.Dataset(valid_df[names], label=valid_df.label, reference=dtrain)
    history = {}
    model = lgb.train(params, dtrain, rounds,
                      valid_sets=[dtrain, dval], valid_names=["train", "val"],
                      callbacks=[lgb.early_stopping(100, verbose=False),
                                 lgb.record_evaluation(history)])
    return model, history

model, history = fit(PARAMS, table, val)
print("trees used:", model.best_iteration)
```
What happens here: LightGBM adds one small tree at a time, each correcting the errors of the ones
before it. After every tree it scores the validation set. **Early stopping** ends training when 100
trees in a row haven't improved validation loss, and keeps the best point. Expect several hundred
trees, trained in seconds.

### Cell 7: watch overfitting happen
```python
plt.plot(history["train"]["cross_entropy"], label="train")
plt.plot(history["val"]["cross_entropy"], label="validation")
plt.axvline(model.best_iteration, color="grey", linestyle="--", label="best")
plt.xlabel("trees"); plt.ylabel("loss (lower is better)"); plt.legend(); plt.show()
```
❓ Train loss keeps falling almost to zero, while validation loss flattens and then creeps up. What
is the model doing with those extra trees? That gap is **overfitting**, seen with your own eyes.

### Cell 8: the moment of truth, against the baseline
```python
baseline = LogisticRegression().fit(train[["log_heur_power_ratio"]], train.label)
pd.DataFrame([
    score("baseline: LR on heuristic", val.label, baseline.predict_proba(val[["log_heur_power_ratio"]])[:, 1]),
    score("LightGBM", val.label, predict(model, val)),
]).round(4)
```
Expect a big jump: log loss from about 0.60 to about 0.26, AUC from about 0.77 to about 0.96.

❓ A jump this big should make you *suspicious* before it makes you happy. What would leakage look
like here? (Cells 13 and 14 are your checks.)

### Cell 9: tune two knobs
```python
rows = []
for num_leaves in [7, 15, 31]:
    for min_data in [20, 50, 150]:
        m, _ = fit(dict(PARAMS, num_leaves=num_leaves, min_data_in_leaf=min_data), table, val)
        s = score("", val.label, predict(m, val))
        rows.append({"num_leaves": num_leaves, "min_data_in_leaf": min_data,
                     "trees": m.best_iteration, "log_loss": s["log_loss"], "auc": s["auc"]})
pd.DataFrame(rows).sort_values("log_loss").round(4)
```
- `num_leaves`: how complex each tree can get.
- `min_data_in_leaf`: how much evidence a rule needs before the model believes it.

❓ The differences are small (third decimal). Lesson: once you have a decent model, **data and
features matter more than knobs**. Put the best combination into `PARAMS` and re-run Cell 6.

### Cell 10: is the farm worth it?
```python
rows = []
for farm_weight in [0, 0.5, 1, 2, 4]:
    rows_used = farm_train if farm_weight else farm_train.iloc[:0]
    m, _ = fit(PARAMS, build(train, rows_used, farm_weight or 1), val)
    s = score("", val.label, predict(m, val))
    rows.append({"farm_weight": farm_weight, "trees": m.best_iteration,
                 "log_loss": s["log_loss"], "auc": s["auc"]})
pd.DataFrame(rows).round(4)
```
❓ How much does the manufactured data help (compare weight 0 with the rest)? That result is why
Step 3 existed. Keep the best weight (1 is fine if they're close).

### Cell 11: the untouched test set (open it exactly once)
```python
table = build(train, farm_train)          # rebuild with your chosen settings
model, history = fit(PARAMS, table, val)
pd.DataFrame([
    score("baseline", test.label, baseline.predict_proba(test[["log_heur_power_ratio"]])[:, 1]),
    score("LightGBM", test.label, predict(model, test)),
]).round(4)
```
This is your honest number: you never tuned anything on these fights. If it is close to the
validation number, you didn't fool yourself.

### Cell 12: calibration (does 70% mean 70%?)
```python
from sklearn.calibration import calibration_curve

p_test = predict(model, test)
observed, predicted = calibration_curve(test.label, p_test, n_bins=8, strategy="quantile")
plt.plot(predicted, observed, marker="o", label="model")
plt.plot([0, 1], [0, 1], color="grey", linestyle="--", label="perfect")
plt.xlabel("predicted P(A wins)"); plt.ylabel("how often A actually won"); plt.legend(); plt.show()
```
Each dot is a group of fights with similar predictions. On the diagonal means the probabilities are
honest. The bot needs this, because it compares sizes: "this board is 72%, that one 65%".

### Cell 13: leakage check 1, the future
```python
ordered = organic.sort_values("createdAt")
cutoff = ordered.createdAt.iloc[int(len(ordered) * 0.85)]
past, future = organic[organic.createdAt < cutoff], organic[organic.createdAt >= cutoff]

past_table = build(past, without_characters(farm, set(future.aOriginalPlayerId)))
dpast = lgb.Dataset(past_table[names], label=past_table.label, weight=past_table.weight, feature_name=names)
future_model = lgb.train(PARAMS, dpast, num_boost_round=model.best_iteration)
past_baseline = LogisticRegression().fit(past[["log_heur_power_ratio"]], past.label)

pd.DataFrame([
    score("baseline", future.label, past_baseline.predict_proba(future[["log_heur_power_ratio"]])[:, 1]),
    score("LightGBM", future.label, predict(future_model, future)),
]).round(4)
```
Trained only on fights *before* a date and scored on fights *after* it: the bot's real situation.
If the model still wins clearly here, the result isn't an artifact of the split.

### Cell 14: leakage check 2, which features does it lean on?
```python
importance = pd.Series(model.feature_importance("gain"), index=names).sort_values(ascending=False)
(importance / importance.sum()).head(15).plot.barh()
plt.gca().invert_yaxis(); plt.xlabel("share of the model's total gain"); plt.show()
```
Leakage usually shows up as one odd feature doing all the work. Here the top features should be the
fight maths (`log_heur_power_ratio`, `log_kill_time_ratio`, kill seconds, EHP), which is healthy.

❓ `cooldownReduction` ranks high. The v2 bot barely values it. What does the game do with it? (Hint:
active skills. See `common/cooldown.ts`.)

### Cell 15: where is it weak?
```python
checked = test.assign(p=predict(model, test))
checked["round_group"] = pd.cut(checked["round"], [0, 3, 6, 9, 20])
for column in ["kind", "round_group"]:
    print(checked.groupby(column, observed=True).apply(
        lambda g: pd.Series({"fights": len(g), "log_loss": score("", g.label, g.p)["log_loss"]}),
        include_groups=False).round(3), "\n")
```
❓ Which rounds are hardest to predict, and are there many fights there? Late rounds have few
fights: that's where more data (a longer farm run) would help most.

### Cell 16: look inside, partial dependence
```python
def partial_dependence(model, df, feature, points=20):
    grid = np.linspace(df[feature].quantile(0.05), df[feature].quantile(0.95), points)
    curve = []
    for value in grid:
        changed = df.copy()
        changed[feature] = value
        stat = feature[2:]                       # "a_strength" -> "strength"
        if f"diff_{stat}" in changed:            # keep the matching difference column consistent
            changed[f"diff_{stat}"] = changed[f"a_{stat}"] - changed[f"b_{stat}"]
        curve.append(predict(model, changed).mean())
    return grid, curve

sample = test.sample(200, random_state=0)
for feature in ["a_cooldownReduction", "a_strength"]:
    grid, curve = partial_dependence(model, sample, feature)
    plt.plot(grid, curve, marker="o", label=feature)
plt.ylabel("average P(A wins)"); plt.legend(); plt.show()
```
"Hold everything else fixed, slide one number, and watch the prediction."

❓ Cooldown reduction clearly lifts P(win), but strength looks almost **flat**. Does strength not
matter? No. The model reads strength *through* the derived features (`a_raw_dps`,
`a_kill_seconds`, `log_kill_time_ratio`), and this cell only changes the raw column, creating
impossible rows where strength rose but damage didn't. A real lesson: with correlated features, one
column at a time can lie. The bot never has this problem, because it recomputes every feature for
each board it considers.

### Cell 17: save the model
```python
model.save_model("../models/fight.txt")
```
(Create the `ml/models/` folder first if Jupyter complains.)

**Acceptance gate:** your test log loss clearly beats the baseline, the future check agrees, and the
calibration dots hug the diagonal. Write the final numbers in a Markdown cell.

---

## Notebook 3: `03_export.ipynb` (Step 6)

Goal: turn the model into the JSON file the bot loads, and prove the TypeScript runtime computes
exactly what Python does.

### Cell 1: setup, plus Notebook 2's building blocks
```python
import sys
sys.path.append("..")
import pandas as pd
import lightgbm as lgb
from helpers import load, feature_names, swap_sides, organic_splits

organic, farm = load()
names = feature_names()
train, val, test = organic_splits(organic)
```

### Cell 2: retrain on everything except test
```python
BEST_PARAMS = {...}     # paste PARAMS from Notebook 2, after your tuning
BEST_TREES = 650        # paste model.best_iteration from Notebook 2's Cell 11

trainval = pd.concat([train, val])
farm_rows = farm[~(farm.aOriginalPlayerId.isin(set(test.aOriginalPlayerId))
                   | farm.bOriginalPlayerId.isin(set(test.aOriginalPlayerId)))]
both = pd.concat([trainval.assign(weight=1.0),
                  farm_rows.assign(weight=farm_rows.repeats / 4)], ignore_index=True)
table = pd.concat([both, swap_sides(both, names)], ignore_index=True)

final = lgb.train(BEST_PARAMS,
                  lgb.Dataset(table[names], label=table.label, weight=table.weight, feature_name=names),
                  num_boost_round=int(BEST_TREES * 1.1))
final.save_model("../models/fight.txt")
```
Why retrain: validation data was only held back to choose settings. Now that the settings are
chosen, it's more training data. No early stopping this time (there's no validation set left), so
use the tree count you found, plus about 10% for the extra data.

### Cell 3: export
```python
!cd .. && uv run python export_model.py models/fight.txt data/fights-v27.csv \
    --out ../src/bot/ml/models/fight-v27.json \
    --parity ../test/fixtures/fightModelParity-v27.json \
    --note "test logloss 0.xx, AUC 0.xx"
```
A leading `!` runs a **shell command** from the notebook. It should print the file size (under 1 MB)
and "wrote parity fixture".

### Cell 4: prove Python == TypeScript
```python
!cd ../.. && npx jest test/fightModel.test.ts 2>&1 | tail -15
```
Look for `committed model fight-v27.json matches its Python parity fixture` passing. The fixture holds
200 real rows and Python's predictions; the test runs the same rows through the TypeScript
evaluator. Expect differences around 1e-16: floating-point dust.

Then tell Claude. The next step is committing the model and running the bots.

---

## Notebook 4: `04_ab_test.ipynb` (Step 9)

Goal: learn how to decide whether one bot is *really* better than another. You can practise right
away on data that already exists: v2.0 vs v2.1 of the heuristic bot. Later you'll run the same
notebook on `learned-v1` vs `heuristic-v2`.

### Cell 1: setup and connect to the dev database (read-only)
```python
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from dotenv import dotenv_values
from pymongo import MongoClient

uri = dotenv_values("../../.env.development")["DB_CONNECTION_STRING"]
db = MongoClient(uri)["chungus"]
```
`dotenv_values` reads the connection string from the backend's env file, so it never has to appear
in the notebook.

### Cell 2: load the bot runs
```python
runs = pd.DataFrame(db.botruns.find(
    {"policyId": {"$in": ["heuristic-v2", "learned-v1"]}, "outcome": {"$in": ["win", "dead"]}},
    {"_id": 0, "policyId": 1, "policyVersion": 1, "archetypeId": 1, "avatarUrl": 1,
     "wins": 1, "outcome": 1, "createdAt": 1},
))
runs["arm"] = runs.policyId + " " + runs.policyVersion
runs.groupby("arm").wins.agg(["count", "mean", "std"]).round(2)
```
An **arm** is one variant in the experiment. Only finished runs (`win` or `dead`) count; aborted
ones would drag the average down unfairly.

❓ v2.1 averages about 5.7 wins against v2.0's 4.8. Is v2.1 better? Look at the `std` column
before you answer.

### Cell 3: a picture of the spread
```python
for arm, group in runs.groupby("arm"):
    plt.hist(group.wins, bins=range(0, 14), alpha=0.5, label=f"{arm} (n={len(group)})")
plt.xlabel("wins in the run"); plt.ylabel("runs"); plt.legend(); plt.show()
```
The two histograms overlap heavily. One lucky run moves an average of 13 a lot.

### Cell 4: bootstrap confidence interval
```python
rng = np.random.default_rng(0)

def bootstrap_difference(old, new, n=10_000):
    """Resample each arm with replacement many times; how much does the difference in
    averages move around? The middle 95% of those differences is the confidence interval."""
    old, new = np.asarray(old), np.asarray(new)
    diffs = [rng.choice(new, len(new)).mean() - rng.choice(old, len(old)).mean() for _ in range(n)]
    return np.percentile(diffs, [2.5, 50, 97.5])

old = runs[runs.arm == "heuristic-v2 2.0.0"].wins
new = runs[runs.arm == "heuristic-v2 2.1.0"].wins
low, middle, high = bootstrap_difference(old, new)
print(f"v2.1 minus v2.0: {middle:+.2f} wins (95% interval {low:+.2f} to {high:+.2f})")
```
The **bootstrap** pretends your runs are the whole world. It re-draws fake experiments from them and
sees how much the answer wobbles. No formulas needed.

❓ The interval runs from about −0.3 to +2.1: it **crosses zero**. So we can't claim v2.1 is better,
only that it's probably not worse. How many runs per arm would make the interval about half as wide?
(Hint: width shrinks with √n.)

### Cell 5: per archetype (and a warning)
```python
runs[runs.arm == "heuristic-v2 2.1.0"].groupby("archetypeId").wins.agg(["count", "mean"]).round(2)
```
❓ With 2–3 runs per archetype, these means are nearly meaningless. Resist reading stories into
them. That's the **small sample** trap from Notebook 1 again.

### The real experiment (after Notebook 3)
Claude starts the batches on dev: `POST /admin/bots {"runs": 100, "policyId": "learned-v1"}`, then the
same for `heuristic-v2`, back to back so both face the same opponents. Re-run this notebook with
`old = heuristic-v2 2.1.0` and `new = learned-v1 1.0.0`. **Ship rule:** only if the 95% interval is
entirely above zero.

---

## Glossary

- **Feature:** a number describing the input. **Label:** the answer to learn.
- **Overfitting:** memorising the training data; looks great on train, worse on new data.
- **Leakage:** test information sneaking into training, which makes scores unrealistically good.
- **Calibration:** predicted probabilities match observed frequencies.
- **Log-odds (logit):** `log(p / (1 − p))`. The bot scores boards in log-odds so differences stay visible near 0% and 100%.
- **Soft label:** a probability target (0.75) instead of a hard 0/1.
- **Distribution shift:** the data the model is used on differs from what it was trained on. Expect this once the bot starts building what the model likes. The cure is farming fights on those boards and retraining.
