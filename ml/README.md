# ml/ — fight-outcome model for the bot

Training workspace for the model that predicts **P(build A beats build B)**, which the
`learned-v1` bot policy uses to rank its choices. Never deployed: excluded from the Docker image;
the server only ever loads the exported model JSON in `src/bot/ml/models/`.

Start with **[GUIDE.md](GUIDE.md)** — the step-by-step learning path.

## One-time setup (macOS)

```bash
brew install uv libomp   # uv manages Python; LightGBM needs the OpenMP runtime
cd ml && uv sync         # creates .venv with Python 3.12 + pandas/lightgbm/sklearn/jupyter
```

## Pipeline

| Step | Command (from the backend repo root unless noted) | Output |
|---|---|---|
| Export real fights | `npx tsx scripts/ml/exportFightDataset.ts --db prod` | `ml/data/fights-v27.csv`, `feature_spec.json` |
| Farm matchups | `npx tsx scripts/ml/fightFarm.ts --db prod --matchups 6000 --concurrency 24` | appends to `ml/data/farm-v27.csv` |
| Notebooks | `cd ml && uv run jupyter lab` | a trained model, e.g. `ml/models/fight.txt` |
| Export model | `cd ml && uv run python export_model.py models/fight.txt data/fights-v27.csv --out ../src/bot/ml/models/fight-v27.json --parity ../test/fixtures/fightModelParity-v27.json` | model JSON + parity fixture |
| Check parity | `npx jest test/fightModel.test.ts` | TypeScript == Python predictions |
| A/B test | `POST /admin/bots {"runs":100,"policyId":"learned-v1"}` vs `heuristic-v2` | `botruns` docs |

Both scripts only **read** the database (`--db dev|prod` picks the env file). The farm boots its
own minimal server on port 2590 — never the full app, whose startup clears live session claims.

## Where things live

- `src/ml/board.ts` — `CombatBoard`, the one shape a character takes for the model.
- `src/ml/features.ts` — `featurize(a, b, round)`: the **only** feature code, shared by export,
  farm and the live bot. Changing it changes `FEATURE_SPEC_HASH`; old models then refuse to load.
- `src/ml/db/FightSample.ts` — durable per-fight training samples written by every live fight.
- `src/bot/ml/gbdt.ts`, `fightModel.ts` — the TypeScript model runtime.
- `src/bot/learned/LearnedPolicyV1.ts` — the bot policy that uses it.
