"""arborist_mimic — load Arborist's mimic-io JSON as a sklearn-shaped tree.

Usage
-----
    from arborist_mimic import load
    tree = load("domain.mimic-io.json")
    pred = tree.predict(X)         # X: list of dicts, pandas DataFrame, or ndarray
    proba = tree.predict_proba(X)  # classification only

Arborist's tree differs from sklearn's in two ways the JSON format
acknowledges:
- Categorical splits exist (Arborist trees grown on lithology codes etc.).
  These show up as `category[i] != null` and `threshold[i] == null`. The
  shim reads the row's value at that feature and routes left if equal,
  right otherwise — matching Arborist's split semantics.
- Bonsai edits (forced splits, forced classes, pruned nodes) are recorded
  in a `bonsai` metadata block; predictions ignore it (the tree structure
  already reflects every edit).

No sklearn dependency. NumPy is used for the return shapes; if you don't
have it, `predict()` still returns a list and `classes_` is a tuple.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Sequence

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError:  # pragma: no cover
    np = None
    _HAS_NUMPY = False


class ArboristTree:
    """Duck-typed sklearn DecisionTreeClassifier / DecisionTreeRegressor."""

    def __init__(self, payload: dict):
        if payload.get("format") != "mimic-io":
            raise ValueError("not a mimic-io JSON payload")
        self._raw = payload
        self.feature_names_ = list(payload.get("feature_names", []))
        self.target_name_ = payload.get("target_name")
        self.is_regression = payload.get("mode") == "regression"
        names = payload.get("class_names") or []
        self.classes_ = (
            np.array(names) if _HAS_NUMPY else tuple(names)
        )
        self.n_features_in_ = payload.get("n_features", len(self.feature_names_))
        self.n_classes_ = payload.get("n_classes", len(names))
        t = payload["tree"]
        self._left = t["children_left"]
        self._right = t["children_right"]
        self._feature = t["feature"]
        self._threshold = t["threshold"]
        self._category = t.get("category", [None] * len(self._feature))
        self._value = t["value"]
        self._impurity = t.get("impurity", [])
        self._n_node_samples = t.get("n_node_samples", [])

    # ── classification / prediction ───────────────────────────────────────

    def _route(self, row) -> int:
        """Walk the tree for one row and return the leaf index."""
        idx = 0
        while self._left[idx] != -1:
            feat = self._feature[idx]
            feat_name = self.feature_names_[feat]
            v = _get(row, feat_name)
            cat = self._category[idx]
            if cat is not None:
                go_left = (v == cat)
            else:
                thr = self._threshold[idx]
                go_left = float(v) <= float(thr)
            idx = self._left[idx] if go_left else self._right[idx]
        return idx

    def predict(self, X):
        rows = _iter_rows(X, self.feature_names_)
        out = []
        for row in rows:
            leaf = self._route(row)
            counts = self._value[leaf]
            if self.is_regression:
                out.append(float(counts[0]))
            else:
                winner = max(range(len(counts)), key=lambda i: counts[i])
                out.append(self.classes_[winner])
        return np.array(out) if _HAS_NUMPY else out

    def predict_proba(self, X):
        if self.is_regression:
            raise ValueError("predict_proba is undefined for regression trees")
        rows = _iter_rows(X, self.feature_names_)
        out = []
        for row in rows:
            leaf = self._route(row)
            counts = list(self._value[leaf])
            total = sum(counts)
            out.append([c / total for c in counts] if total > 0
                       else [1.0 / len(counts)] * len(counts))
        return np.array(out) if _HAS_NUMPY else out

    # ── introspection ─────────────────────────────────────────────────────

    @property
    def tree_(self):
        """Sklearn-shaped tree object (read-only)."""
        return _SklearnLikeTree(self)

    def __repr__(self):
        kind = "Regressor" if self.is_regression else "Classifier"
        return (
            f"ArboristTree(kind={kind}, "
            f"n_features={self.n_features_in_}, "
            f"n_classes={self.n_classes_}, "
            f"n_nodes={len(self._left)})"
        )


class _SklearnLikeTree:
    """Read-only wrapper that exposes sklearn's `tree_` field shape."""

    def __init__(self, t: ArboristTree):
        self._t = t
        self.node_count = len(t._left)
        self.children_left = t._left
        self.children_right = t._right
        self.feature = t._feature
        self.threshold = t._threshold
        self.value = t._value
        self.impurity = t._impurity
        self.n_node_samples = t._n_node_samples


# ── loaders ──────────────────────────────────────────────────────────────

def load(path: str | Path) -> ArboristTree:
    with open(path) as f:
        return ArboristTree(json.load(f))


def loads(text: str) -> ArboristTree:
    return ArboristTree(json.loads(text))


# ── helpers ──────────────────────────────────────────────────────────────

def _get(row, key):
    if hasattr(row, "__getitem__"):
        try:
            return row[key]
        except (KeyError, TypeError, IndexError):
            pass
    return getattr(row, key)


def _iter_rows(X, feature_names: Sequence[str]) -> Iterable[Any]:
    """Normalise X to an iterable of dict-like rows.

    Accepts: pandas DataFrame, numpy ndarray, list of dicts, list of lists.
    """
    if hasattr(X, "iterrows"):  # pandas DataFrame
        return (row.to_dict() for _, row in X.iterrows())
    if _HAS_NUMPY and isinstance(X, np.ndarray) and X.ndim == 2:
        return (dict(zip(feature_names, row)) for row in X)
    if isinstance(X, dict):
        return [X]
    if isinstance(X, (list, tuple)):
        if len(X) == 0:
            return []
        first = X[0]
        if isinstance(first, dict):
            return X
        # treat as list-of-lists
        return (dict(zip(feature_names, row)) for row in X)
    return X  # fall back: assume iterable of dict-like
