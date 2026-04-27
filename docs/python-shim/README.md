# arborist_mimic — Python shim for Arborist's mimic-io JSON

Loads a tree exported from Arborist (Export → mimic-io JSON) as a
sklearn-shaped estimator, without depending on scikit-learn itself.

## Quick start

```python
from arborist_mimic import load

tree = load("domain.mimic-io.json")

# Predict on rows (list of dicts keyed by feature name)
pred = tree.predict([
    {"Fe_pct": 62.0, "SiO2_pct": 3.5, "weathering": "oxide"},
    {"Fe_pct": 45.0, "SiO2_pct": 12.0, "weathering": "fresh"},
])

# Or on a pandas DataFrame (columns matching feature_names_)
import pandas as pd
df = pd.read_csv("samples.csv")
pred = tree.predict(df[tree.feature_names_])
proba = tree.predict_proba(df[tree.feature_names_])
```

## What it supports

- Classification trees (Gini criterion) and regression trees (variance).
- Numeric splits and Arborist's categorical splits (string equality;
  `category[i]` in the JSON identifies the chosen value, `threshold[i]`
  is `null`).
- `predict()`, `predict_proba()` (classification only), and a `tree_`
  attribute with sklearn-shaped flat arrays (`children_left`,
  `children_right`, `feature`, `threshold`, `value`, `impurity`,
  `n_node_samples`).

## What it doesn't do

- `fit()` / `partial_fit()`: this is a load-and-predict shim, not a
  trainer. Train in Arborist; predict here.
- Sample weights, cost-complexity pruning, monotonicity constraints.
- The `bonsai` metadata block (forced splits, forced classes, pruned
  nodes) is preserved in the JSON but ignored at predict time — the tree
  structure already reflects every edit.

## Dependencies

`numpy` is optional. With it installed, `predict()` returns an ndarray
and `classes_` is an ndarray. Without it, both fall back to plain
Python lists / tuples.

## Format

See `docs/SPEC-v2.md` §4 in the Arborist repo for the full mimic-io
schema. The `category` field is an Arborist extension; vanilla sklearn
trees won't have it.
