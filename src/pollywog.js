// pollywog.js — JavaScript port of pollywog core
// Programmatically build, manipulate, and automate Leapfrog .lfcalc files
// UMD module: works as <script> tag, CommonJS require(), or ES module adapter

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Pollywog = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ─── Constants ──────────────────────────────────────────────────────────────

  var HEADER = new Uint8Array([
    0x25, 0x6c, 0x66, 0x63, 0x61, 0x6c, 0x63, 0x2d, 0x31, 0x2e, 0x30, 0x0a,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  var ITEM_ORDER = { variable: 0, calculation: 1, filter: 2 };

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function ensureList(x) {
    return Array.isArray(x) ? x : [x];
  }

  function ensureStrList(x) {
    var arr = Array.isArray(x) ? x.slice() : [x];
    if (typeof arr[0] !== "string") arr.unshift("");
    if (typeof arr[arr.length - 1] !== "string") arr.push("");
    return arr;
  }

  function isNumber(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean")
      return false;
    return !isNaN(Number(v));
  }

  function hasFunctionCall(v) {
    if (typeof v !== "string") return false;
    return /\b\w+\s*\(.*\)/.test(v);
  }

  function ensureBrackets(v, ignoreFunctions) {
    v = v.trim();
    if (ignoreFunctions && hasFunctionCall(v)) return v;
    if (!(v.startsWith("[") && v.endsWith("]"))) v = "[" + v + "]";
    return v;
  }

  function ensureVariables(variables, ignoreFunctions) {
    return ensureList(variables).map(function (v) {
      if (isNumber(v)) return String(v);
      return ensureBrackets(v, ignoreFunctions);
    });
  }

  function toDict(items, guardStrings) {
    var out = ensureList(items).map(function (item) {
      return item && typeof item.toDict === "function" ? item.toDict() : item;
    });
    if (guardStrings) {
      if (typeof out[0] !== "string") out.unshift("");
      if (typeof out[out.length - 1] !== "string") out.push("");
    }
    return out;
  }

  // ─── getDependencies ────────────────────────────────────────────────────────

  function getDependencies(item) {
    var deps = new Set();
    if (item instanceof Item) {
      item.expression.forEach(function (child) {
        getDependencies(child).forEach(function (d) {
          deps.add(d);
        });
      });
    } else if (item instanceof If) {
      item.rows.forEach(function (row) {
        getDependencies(row).forEach(function (d) {
          deps.add(d);
        });
      });
      getDependencies(item.otherwise).forEach(function (d) {
        deps.add(d);
      });
    } else if (item instanceof IfRow) {
      getDependencies(item.condition).forEach(function (d) {
        deps.add(d);
      });
      getDependencies(item.value).forEach(function (d) {
        deps.add(d);
      });
    } else if (Array.isArray(item)) {
      item.forEach(function (elem) {
        getDependencies(elem).forEach(function (d) {
          deps.add(d);
        });
      });
    } else if (typeof item === "string") {
      var re = /\[([^\[\]]+)\]/g;
      var match;
      while ((match = re.exec(item)) !== null) {
        deps.add(match[1]);
      }
    }
    return deps;
  }

  // ─── dispatchExpression ─────────────────────────────────────────────────────

  function dispatchExpression(data) {
    if (data && typeof data === "object" && !Array.isArray(data) && data.type) {
      if (EXPRESSIONS[data.type]) {
        return EXPRESSIONS[data.type].fromDict(data);
      }
      throw new Error("Unknown expression type: " + data.type);
    }
    return data;
  }

  // ─── rename ─────────────────────────────────────────────────────────────────

  function rename(item, mapper, regex) {
    if (item instanceof Item) {
      var newExpression = item.expression.map(function (child) {
        return rename(child, mapper, regex);
      });
      return item.replace({ expression: newExpression });
    } else if (item instanceof If) {
      var newRows = item.rows.map(function (row) {
        return rename(row, mapper, regex);
      });
      var newOtherwise = rename(item.otherwise, mapper, regex);
      return new If(newRows, newOtherwise);
    } else if (item instanceof IfRow) {
      var newCondition = rename(item.condition, mapper, regex);
      var newValue = rename(item.value, mapper, regex);
      return new IfRow(newCondition, newValue);
    } else if (Array.isArray(item)) {
      return item.map(function (elem) {
        return rename(elem, mapper, regex);
      });
    } else if (typeof item === "string") {
      return item.replace(/\[([^\[\]]+)\]/g, function (full, varName) {
        if (typeof mapper === "function") {
          return "[" + mapper(varName) + "]";
        } else if (regex) {
          Object.keys(mapper).forEach(function (pattern) {
            varName = varName.replace(new RegExp(pattern, "g"), mapper[pattern]);
          });
          return "[" + varName + "]";
        } else {
          return "[" + (mapper[varName] !== undefined ? mapper[varName] : varName) + "]";
        }
      });
    }
    return item;
  }

  // ─── IfRow ──────────────────────────────────────────────────────────────────

  function IfRow(condition, value) {
    if (!(this instanceof IfRow)) return new IfRow(condition, value);
    this.condition = condition;
    this.value = value;
  }

  IfRow.prototype.toDict = function () {
    return {
      type: "if_row",
      test: { type: "list", children: toDict(this.condition) },
      result: { type: "list", children: toDict(this.value, true) },
    };
  };

  IfRow.fromDict = function (data) {
    if (data.type !== "if_row")
      throw new Error("Expected type 'if_row', got " + data.type);
    var condition = ensureList(data.test.children).map(dispatchExpression);
    var value = ensureStrList(data.result.children).map(dispatchExpression);
    return new IfRow(condition, value);
  };

  IfRow.prototype.copy = function () {
    return new IfRow(
      this.condition.map(function (c) {
        return c && typeof c.copy === "function" ? c.copy() : c;
      }),
      this.value.map(function (v) {
        return v && typeof v.copy === "function" ? v.copy() : v;
      })
    );
  };

  // ─── If ─────────────────────────────────────────────────────────────────────

  function If(a, b, c) {
    if (!(this instanceof If)) return new If(a, b, c);
    var rows, otherwise;
    if (arguments.length === 3) {
      // 3-arg mode: If(condition, then, otherwise)
      rows = [[a, b]];
      otherwise = c;
    } else if (arguments.length === 2) {
      // 2-arg mode: If(rows, otherwise)
      rows = a;
      otherwise = b;
    } else {
      throw new Error(
        "If must be initialized with either (rows, otherwise) or (condition, then, otherwise)"
      );
    }

    var ifrows = [];
    ensureList(rows).forEach(function (row) {
      if (row instanceof IfRow) {
        ifrows.push(row);
      } else if (
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        row.type === "if_row"
      ) {
        ifrows.push(IfRow.fromDict(row));
      } else if (Array.isArray(row) && row.length === 2) {
        ifrows.push(new IfRow(row[0], row[1]));
      } else {
        throw new Error("Invalid row format");
      }
    });
    this.rows = ifrows;
    this.otherwise = otherwise;
  }

  If.prototype.toDict = function () {
    return {
      type: "if",
      rows: this.rows.map(function (r) {
        return r.toDict();
      }),
      otherwise: { type: "list", children: toDict(this.otherwise, true) },
    };
  };

  If.fromDict = function (data) {
    if (data.type !== "if")
      throw new Error("Expected type 'if', got " + data.type);
    var rows = ensureList(data.rows).map(function (row) {
      return row instanceof IfRow
        ? row
        : typeof row === "object" && row.type === "if_row"
          ? IfRow.fromDict(row)
          : row;
    });
    var otherwise = ensureStrList(data.otherwise.children).map(
      dispatchExpression
    );
    return new If(rows, otherwise);
  };

  If.prototype.copy = function () {
    return new If(
      this.rows.map(function (r) {
        return r && typeof r.copy === "function" ? r.copy() : r;
      }),
      this.otherwise.map(function (o) {
        return o && typeof o.copy === "function" ? o.copy() : o;
      })
    );
  };

  // ─── Item (base class) ─────────────────────────────────────────────────────

  function Item(name, expression, commentItem, commentEquation) {
    if (!(this instanceof Item)) return new Item(name, expression, commentItem, commentEquation);
    this.name = name || "";
    this.expression = expression == null ? [] : ensureList(expression);
    this.commentItem = commentItem || "";
    this.commentEquation = commentEquation || "";
  }

  Item.prototype.itemType = null;
  Item.prototype.calculationType = null;

  Item.prototype.toDict = function () {
    if (this.itemType === null)
      throw new Error("itemType must be defined in subclass");
    var children = toDict(this.expression, true);
    var item = {
      type: this.itemType,
      name: this.name,
      equation: {
        type: "equation",
        comment: this.commentEquation,
        statement: { type: "list", children: children },
      },
      comment: this.commentItem,
    };
    if (this.calculationType) item.calculation_type = this.calculationType;
    return item;
  };

  Item._fromDict = function (Constructor, data) {
    if (Constructor.prototype.itemType !== null && data.type !== Constructor.prototype.itemType)
      throw new Error(
        "Expected item type " + Constructor.prototype.itemType + ", got " + data.type
      );
    var expression = ensureList(
      data.equation.statement.children
    ).map(dispatchExpression);
    return new Constructor(
      data.name,
      expression,
      data.comment || "",
      (data.equation && data.equation.comment) || ""
    );
  };

  Object.defineProperty(Item.prototype, "dependencies", {
    get: function () {
      return getDependencies(this);
    },
  });

  Item.prototype.copy = function () {
    var Ctor = this.constructor;
    return new Ctor(
      this.name,
      this.expression.map(function (c) {
        return c && typeof c.copy === "function" ? c.copy() : c;
      }),
      this.commentItem,
      this.commentEquation
    );
  };

  Item.prototype.replace = function (changes) {
    var Ctor = this.constructor;
    return new Ctor(
      changes.name !== undefined ? changes.name : this.name,
      changes.expression !== undefined ? changes.expression : this.expression,
      changes.commentItem !== undefined ? changes.commentItem : this.commentItem,
      changes.commentEquation !== undefined
        ? changes.commentEquation
        : this.commentEquation
    );
  };

  Item.prototype.rename = function (name, variables, regex) {
    var newItem = this.copy();
    if (name !== undefined && name !== null) {
      newItem.name = name;
    } else if (variables != null) {
      var varName = newItem.name;
      if (typeof variables === "function") {
        var newVarName = variables(varName);
        if (newVarName != null) newItem.name = newVarName;
      } else if (regex) {
        Object.keys(variables).forEach(function (pattern) {
          var result = varName.replace(new RegExp(pattern, "g"), variables[pattern]);
          if (result !== varName) varName = result;
        });
        newItem.name = varName;
      } else {
        if (variables[varName] !== undefined) newItem.name = variables[varName];
      }
    }
    if (variables != null) {
      return rename(newItem, variables, regex);
    }
    return newItem;
  };

  // ─── NumberCalc ─────────────────────────────────────────────────────────────

  function NumberCalc(name, expression, commentItem, commentEquation) {
    if (!(this instanceof NumberCalc))
      return new NumberCalc(name, expression, commentItem, commentEquation);
    Item.call(this, name, expression, commentItem, commentEquation);
  }
  NumberCalc.prototype = Object.create(Item.prototype);
  NumberCalc.prototype.constructor = NumberCalc;
  NumberCalc.prototype.itemType = "calculation";
  NumberCalc.prototype.calculationType = "number";
  NumberCalc.fromDict = function (data) {
    return Item._fromDict(NumberCalc, data);
  };

  // ─── Category ───────────────────────────────────────────────────────────────

  function Category(name, expression, commentItem, commentEquation) {
    if (!(this instanceof Category))
      return new Category(name, expression, commentItem, commentEquation);
    Item.call(this, name, expression, commentItem, commentEquation);
  }
  Category.prototype = Object.create(Item.prototype);
  Category.prototype.constructor = Category;
  Category.prototype.itemType = "calculation";
  Category.prototype.calculationType = "string";
  Category.fromDict = function (data) {
    return Item._fromDict(Category, data);
  };

  // ─── Variable ───────────────────────────────────────────────────────────────

  function Variable(name, expression, commentItem, commentEquation) {
    if (!(this instanceof Variable))
      return new Variable(name, expression, commentItem, commentEquation);
    Item.call(this, name, expression, commentItem, commentEquation);
  }
  Variable.prototype = Object.create(Item.prototype);
  Variable.prototype.constructor = Variable;
  Variable.prototype.itemType = "variable";
  Variable.fromDict = function (data) {
    return Item._fromDict(Variable, data);
  };

  // ─── Filter ─────────────────────────────────────────────────────────────────

  function Filter(name, expression, commentItem, commentEquation) {
    if (!(this instanceof Filter))
      return new Filter(name, expression, commentItem, commentEquation);
    Item.call(this, name, expression, commentItem, commentEquation);
  }
  Filter.prototype = Object.create(Item.prototype);
  Filter.prototype.constructor = Filter;
  Filter.prototype.itemType = "filter";
  Filter.fromDict = function (data) {
    return Item._fromDict(Filter, data);
  };

  // ─── Class registries ──────────────────────────────────────────────────────

  var CLASSES = {
    variable: Variable,
    filter: Filter,
    if: If,
    if_row: IfRow,
  };

  var EXPRESSIONS = {
    if: If,
  };

  // ─── CalcSet ────────────────────────────────────────────────────────────────

  function CalcSet(items) {
    if (!(this instanceof CalcSet)) return new CalcSet(items);
    this.items = items == null ? [] : ensureList(items);
  }

  CalcSet.prototype.copy = function () {
    return new CalcSet(
      this.items.map(function (item) {
        return item.copy();
      })
    );
  };

  CalcSet.prototype.get = function (name) {
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].name === name) return this.items[i];
    }
    throw new Error("Item with name '" + name + "' not found.");
  };

  CalcSet.prototype.topologicalSort = function () {
    var itemsByName = {};
    this.items.forEach(function (item) {
      if (item.name) itemsByName[item.name] = item;
    });
    var sorted = [];
    var visited = new Set();
    var tempMark = new Set();

    function visit(item) {
      if (visited.has(item.name)) return;
      if (tempMark.has(item.name))
        throw new Error(
          "Cyclic dependency detected involving '" + item.name + "'"
        );
      tempMark.add(item.name);
      var deps = getDependencies(item);
      deps.forEach(function (dep) {
        if (itemsByName[dep]) visit(itemsByName[dep]);
      });
      tempMark.delete(item.name);
      visited.add(item.name);
      sorted.push(item);
    }

    this.items.forEach(function (item) {
      visit(item);
    });
    var unnamed = this.items.filter(function (item) {
      return !item.name;
    });
    sorted.push.apply(sorted, unnamed);
    return new CalcSet(sorted);
  };

  CalcSet.prototype.toDict = function (sortItems) {
    if (sortItems === undefined) sortItems = true;
    var items = toDict(this.items);
    if (sortItems) {
      items.sort(function (a, b) {
        var oa = ITEM_ORDER[a.type] !== undefined ? ITEM_ORDER[a.type] : 99;
        var ob = ITEM_ORDER[b.type] !== undefined ? ITEM_ORDER[b.type] : 99;
        return oa - ob;
      });
    }
    return { type: "calculation-set", items: items };
  };

  CalcSet.fromDict = function (data) {
    if (data.type !== "calculation-set")
      throw new Error(
        "Expected type 'calculation-set', got " + data.type
      );
    var items = [];
    data.items.forEach(function (item) {
      var itemType = item.type;
      if (CLASSES[itemType]) {
        items.push(CLASSES[itemType].fromDict(item));
      } else if (itemType === "calculation") {
        if (item.calculation_type === "number") {
          items.push(NumberCalc.fromDict(item));
        } else if (item.calculation_type === "string") {
          items.push(Category.fromDict(item));
        } else {
          throw new Error(
            "Unknown calculation type: " + item.calculation_type
          );
        }
      } else {
        throw new Error("Unknown item type: " + itemType);
      }
    });
    return new CalcSet(items);
  };

  CalcSet.prototype.toJSON = function (sortItems, indent) {
    if (sortItems === undefined) sortItems = true;
    if (indent === undefined) indent = 0;
    return indent
      ? JSON.stringify(this.toDict(sortItems), null, indent)
      : JSON.stringify(this.toDict(sortItems));
  };

  CalcSet.prototype.rename = function (items, variables, regex) {
    var newItems = [];
    this.items.forEach(function (item) {
      var name = item.name;
      // Rename item names
      if (items != null) {
        if (typeof items === "function") {
          var newName = items(name);
          if (newName != null) name = newName;
        } else if (regex) {
          Object.keys(items).forEach(function (pattern) {
            var result = name.replace(new RegExp(pattern, "g"), items[pattern]);
            if (result !== name) name = result;
          });
        } else {
          if (items[name] !== undefined) name = items[name];
        }
      }
      // Rename item name using variables mapping
      var varName = name;
      if (variables != null && item instanceof Item) {
        if (typeof variables === "function") {
          var newVarName = variables(varName);
          if (newVarName != null) varName = newVarName;
        } else if (regex) {
          Object.keys(variables).forEach(function (pattern) {
            var result = varName.replace(
              new RegExp(pattern, "g"),
              variables[pattern]
            );
            if (result !== varName) varName = result;
          });
        } else {
          if (variables[varName] !== undefined) varName = variables[varName];
        }
      }
      var finalName = item instanceof Item ? varName : name;
      newItems.push(item.rename(finalName, variables, regex));
    });
    return new CalcSet(newItems);
  };

  // ─── Compression helpers ────────────────────────────────────────────────────

  var _isNode =
    typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.node != null;

  function zlibCompress(data) {
    if (_isNode) {
      var zlib = require("zlib");
      return Promise.resolve(zlib.deflateSync(Buffer.from(data)));
    }
    // Browser: CompressionStream
    var blob = new Blob([data]);
    var cs = new CompressionStream("deflate");
    var stream = blob.stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function zlibDecompress(data) {
    if (_isNode) {
      var zlib = require("zlib");
      return Promise.resolve(zlib.inflateSync(Buffer.from(data)));
    }
    // Browser: DecompressionStream
    var blob = new Blob([data]);
    var ds = new DecompressionStream("deflate");
    var stream = blob.stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  // ─── CalcSet I/O ────────────────────────────────────────────────────────────

  CalcSet.prototype.toLfcalc = function (sortItems) {
    if (sortItems === undefined) sortItems = true;
    var jsonStr = this.toJSON(sortItems);
    var encoded = new TextEncoder().encode(jsonStr);
    return zlibCompress(encoded).then(function (compressed) {
      var result = new Uint8Array(HEADER.length + compressed.length);
      result.set(HEADER, 0);
      result.set(new Uint8Array(compressed), HEADER.length);
      return result;
    });
  };

  CalcSet.readLfcalc = function (buffer) {
    var bytes =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var compressed = bytes.slice(HEADER.length);
    return zlibDecompress(compressed).then(function (decompressed) {
      var jsonStr = new TextDecoder().decode(decompressed);
      var data = JSON.parse(jsonStr);
      return CalcSet.fromDict(data);
    });
  };

  // Browser convenience: read from File object
  CalcSet.readLfcalcFile = function (file) {
    return file.arrayBuffer().then(function (buf) {
      return CalcSet.readLfcalc(buf);
    });
  };

  // Browser convenience: download as .lfcalc
  CalcSet.prototype.toLfcalcBlob = function (sortItems) {
    return this.toLfcalc(sortItems).then(function (bytes) {
      return new Blob([bytes], { type: "application/octet-stream" });
    });
  };

  CalcSet.prototype.downloadLfcalc = function (filename, sortItems) {
    if (!filename) filename = "calcset.lfcalc";
    return this.toLfcalcBlob(sortItems).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  };

  // Node.js convenience: write to file path
  CalcSet.prototype.writeLfcalc = function (filepath, sortItems) {
    if (!_isNode)
      return Promise.reject(new Error("writeLfcalc is only available in Node.js"));
    var fs = require("fs");
    return this.toLfcalc(sortItems).then(function (bytes) {
      fs.writeFileSync(filepath, Buffer.from(bytes));
    });
  };

  // Node.js convenience: read from file path
  CalcSet.readLfcalcPath = function (filepath) {
    if (!_isNode)
      return Promise.reject(new Error("readLfcalcPath is only available in Node.js"));
    var fs = require("fs");
    var buf = fs.readFileSync(filepath);
    return CalcSet.readLfcalc(buf);
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function Sum(variables, opts) {
    opts = opts || {};
    if (!variables || variables.length === 0)
      throw new Error("At least one variable must be provided.");
    var ignoreFunctions =
      opts.ignoreFunctions !== undefined ? opts.ignoreFunctions : true;
    var vars = ensureVariables(variables, ignoreFunctions);
    var expr = "(" + vars.join(" + ") + ")";
    if (opts.name == null) return expr;
    return new NumberCalc(
      opts.name,
      [expr],
      "",
      opts.comment || "Sum of " + vars.join(", ")
    );
  }

  function Product(variables, opts) {
    opts = opts || {};
    if (!variables || variables.length === 0)
      throw new Error("At least one variable must be provided.");
    var ignoreFunctions =
      opts.ignoreFunctions !== undefined ? opts.ignoreFunctions : true;
    var vars = ensureVariables(variables, ignoreFunctions);
    var expr = "(" + vars.join(" * ") + ")";
    if (opts.name == null) return expr;
    return new NumberCalc(
      opts.name,
      [expr],
      "",
      opts.comment || "Product of " + vars.join(", ")
    );
  }

  function Average(variables, opts) {
    opts = opts || {};
    if (!variables || variables.length === 0)
      throw new Error("At least one variable must be provided.");
    var ignoreFunctions =
      opts.ignoreFunctions !== undefined ? opts.ignoreFunctions : true;
    var vars = ensureVariables(variables, ignoreFunctions);
    var expr = "(" + vars.join(" + ") + ") / " + vars.length;
    if (opts.name == null) return expr;
    return new NumberCalc(
      opts.name,
      [expr],
      "",
      opts.comment || "Average of " + vars.join(", ")
    );
  }

  function WeightedSum(variables, weights, opts) {
    opts = opts || {};
    if (
      !variables ||
      !weights ||
      variables.length === 0 ||
      variables.length !== weights.length
    )
      throw new Error(
        "variables and weights must be non-empty and of equal length."
      );
    var ignoreFunctions =
      opts.ignoreFunctions !== undefined ? opts.ignoreFunctions : true;
    var ws = ensureVariables(weights, ignoreFunctions);
    var vars = ensureVariables(variables, ignoreFunctions);
    var terms = vars.map(function (v, i) {
      return v + " * " + ws[i];
    });
    var expr = "(" + terms.join(" + ") + ")";
    if (opts.name == null) return expr;
    return new NumberCalc(
      opts.name,
      [expr],
      "",
      opts.comment ||
        "Weighted sum of " + vars.join(", ") + " with weights " + ws.join(", ")
    );
  }

  function WeightedAverage(variables, weights, opts) {
    opts = opts || {};
    if (
      !variables ||
      !weights ||
      variables.length === 0 ||
      variables.length !== weights.length
    )
      throw new Error(
        "variables and weights must be non-empty and of equal length."
      );
    var ignoreFunctions =
      opts.ignoreFunctions !== undefined ? opts.ignoreFunctions : true;
    var ws = ensureVariables(weights, ignoreFunctions);
    var vars = ensureVariables(variables, ignoreFunctions);
    var sumWeights = ws.join(" + ");
    var terms = vars.map(function (v, i) {
      return v + " * " + ws[i];
    });
    var expr = "(" + terms.join(" + ") + ") / (" + sumWeights + ")";
    if (opts.name == null) return expr;
    return new NumberCalc(
      opts.name,
      [expr],
      "",
      opts.comment ||
        "Weighted average of " +
          vars.join(", ") +
          " with weights " +
          ws.join(", ")
    );
  }

  function Normalize(variable, minValue, maxValue, opts) {
    opts = opts || {};
    var ignoreFunctions =
      opts.ignoreFunctions !== undefined ? opts.ignoreFunctions : true;
    var v = ensureBrackets(variable, ignoreFunctions);
    var expr =
      "(" + v + " - " + minValue + ") / (" + maxValue + " - " + minValue + ")";
    if (opts.name == null) return expr;
    return new NumberCalc(
      opts.name,
      [expr],
      "",
      opts.comment ||
        "Normalize " +
          v +
          " to [0, 1] using min=" +
          minValue +
          ", max=" +
          maxValue
    );
  }

  function Scale(variable, factor, opts) {
    opts = opts || {};
    var factorExpr =
      typeof factor === "string" ? "[" + factor + "]" : String(factor);
    var expr = "[" + variable + "] * " + factorExpr;
    if (opts.name == null) return expr;
    return new NumberCalc(
      opts.name,
      [expr],
      "",
      opts.comment || "Scale " + variable + " by " + factor
    );
  }

  function CategoryFromThresholds(variable, thresholds, categories, opts) {
    opts = opts || {};
    if (categories.length !== thresholds.length + 1)
      throw new Error(
        "categories must have one more element than thresholds"
      );
    var ignoreFunctions =
      opts.ignoreFunctions !== undefined ? opts.ignoreFunctions : true;
    var baseVariable = variable;
    var v = ensureBrackets(variable, ignoreFunctions);
    var rows = [];
    var prev = null;
    for (var i = 0; i < thresholds.length; i++) {
      var cond;
      if (prev === null) {
        cond = v + " <= " + thresholds[i];
      } else {
        cond =
          "(" +
          v +
          " > " +
          prev +
          ") and (" +
          v +
          " <= " +
          thresholds[i] +
          ")";
      }
      rows.push(new IfRow([cond], [categories[i]]));
      prev = thresholds[i];
    }
    var otherwise = [categories[categories.length - 1]];
    var ifBlock = new If(rows, otherwise);
    if (opts.name == null) return ifBlock;
    return new Category(
      opts.name,
      [ifBlock],
      "",
      opts.comment ||
        "Classify " + baseVariable + " by thresholds " + JSON.stringify(thresholds)
    );
  }

  // ─── Exports ────────────────────────────────────────────────────────────────

  return {
    // Constants
    HEADER: HEADER,
    ITEM_ORDER: ITEM_ORDER,

    // Classes
    CalcSet: CalcSet,
    Number: NumberCalc,
    NumberCalc: NumberCalc,
    Category: Category,
    Variable: Variable,
    Filter: Filter,
    If: If,
    IfRow: IfRow,
    Item: Item,

    // Helpers
    Sum: Sum,
    Product: Product,
    Average: Average,
    WeightedSum: WeightedSum,
    WeightedAverage: WeightedAverage,
    Normalize: Normalize,
    Scale: Scale,
    CategoryFromThresholds: CategoryFromThresholds,

    // Utilities
    getDependencies: getDependencies,
    ensureList: ensureList,
    ensureStrList: ensureStrList,
    ensureVariables: ensureVariables,
    ensureBrackets: ensureBrackets,
    isNumber: isNumber,
    hasFunctionCall: hasFunctionCall,
    toDict: toDict,
    rename: rename,
  };
});
