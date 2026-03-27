# Chaprola Cookbook — Quick Reference

## Workflow: Import → Compile → Run

```bash
# 1. Import JSON data
POST /import {userid, project, name: "STAFF", data: [{name: "Alice", salary: 95000}, ...]}

# 2. Compile source (pass primary_format for field-name addressing)
POST /compile {userid, project, name: "REPORT", source: "...", primary_format: "STAFF"}

# 3. Run program
POST /run {userid, project, name: "REPORT", primary_file: "STAFF", record: 1}
```

## Hello World (no data file)

```chaprola
MOVE "Hello from Chaprola!" U.1 20
PRINT 0
END
```

## Loop Through All Records

```chaprola
DEFINE VARIABLE rec R1
LET rec = 1
100 SEEK rec
    IF EOF GOTO 900
    MOVE BLANKS U.1 40
    MOVE P.name U.1 8
    MOVE P.salary U.12 6
    PRINT 0
    LET rec = rec + 1
    GOTO 100
900 END
```

## Filtered Report

```chaprola
GET sal FROM P.salary
IF sal LT 80000 GOTO 200    // skip low earners
MOVE P.name U.1 8
PUT sal INTO U.12 10 D 0    // D=dollar format
PRINT 0
200 LET rec = rec + 1
```

## JOIN Two Files (FIND)

```chaprola
OPEN "DEPARTMENTS" 0
FIND match FROM S.dept_code 3 USING P.dept_code
IF match EQ 0 GOTO 200      // no match
READ match                   // load matched secondary record
MOVE S.dept_name U.12 15    // now accessible
```

Compile with: `primary_format: "EMPLOYEES", secondary_format: "DEPARTMENTS"`

## Read-Modify-Write (UPDATE)

```chaprola
READ match                   // load record
GET bal FROM S.balance       // read current value
LET bal = bal + amt          // modify
PUT bal INTO S.balance 8 F 0 // write back to S memory
WRITE match                  // flush to disk
CLOSE                        // flush all at end
```

## Async for Large Datasets

```bash
# Start async job
POST /run {userid, project, name, primary_file, async: true}
# Response: {status: "running", job_id: "..."}

# Poll until done
POST /run/status {userid, project, job_id}
# Response: {status: "done", output: "..."}
```

## PUT Format Codes

| Code | Description | Example |
|------|-------------|---------|
| `D` | Dollar with commas | `$1,234.56` |
| `F` | Fixed decimal | `1234.56` |
| `I` | Integer (right-justified) | `  1234` |
| `E` | Scientific notation | `1.23E+03` |

Syntax: `PUT R1 INTO U.30 10 D 2` (R-var, location, width, format, decimals)

## Memory Regions

| Prefix | Description |
|--------|-------------|
| `P` | Primary data file (current record) |
| `S` | Secondary data file (current record) |
| `U` | User buffer (scratch for output) |
| `X` | System text (date, time, filenames) |

## Math Intrinsics

```chaprola
LET R2 = EXP R1      // e^R1
LET R2 = LOG R1      // ln(R1)
LET R2 = SQRT R1     // √R1
LET R2 = ABS R1      // |R1|
LET R3 = POW R1 R2   // R1^R2
```

## Import-Download: URL → Dataset (Parquet, Excel, CSV, JSON)

```bash
# Import Parquet from a cloud data lake
POST /import-download {
  userid, project, name: "TRIPS",
  url: "https://example.com/data.parquet",
  instructions: "Extract date, passenger_count, fare (2 decimals). Skip null fares.",
  max_rows: 100000
}

# Import Excel spreadsheet
POST /import-download {
  userid, project, name: "SALES",
  url: "https://example.com/report.xlsx",
  instructions: "Extract Country, Product, Units_Sold (integer), Profit (2 decimals)."
}
```

Supports: CSV, TSV, JSON, NDJSON, Parquet (zstd/snappy/lz4), Excel (.xlsx/.xls).
AI instructions are optional — omit to import all columns as-is.
Lambda: 10 GB /tmp, 900s timeout, 500 MB download limit.

## HULDRA Optimization — Nonlinear Parameter Fitting

HULDRA finds the best parameter values for a mathematical model by minimizing the difference between model predictions and observed data. You propose a model, HULDRA finds the coefficients.

### How It Works

1. You write a VALUE program (normal Chaprola) that reads data, computes predictions using R-variable parameters, and stores the error in an objective R-variable
2. HULDRA repeatedly runs your program with different parameter values, using gradient descent to minimize the objective
3. When the objective stops improving, HULDRA returns the optimal parameters

### R-Variable Interface

| Range | Purpose | Who sets it |
|-------|---------|-------------|
| R1–R20 | **Elements** (parameters to optimize) | HULDRA sets these before each VM run |
| R21–R40 | **Objectives** (error metrics) | Your program computes and stores these |
| R41–R50 | **Scratch space** | Your program uses these for temp variables |

### Complete Example: Fit a Linear Model

**Goal:** Find `salary = a × years_exp + b` that best fits employee data.

**Step 1: Import data**
```bash
POST /import {
  userid, project: "fit", name: "EMP",
  data: [
    {"years_exp": 2, "salary": 55000},
    {"years_exp": 5, "salary": 72000},
    {"years_exp": 8, "salary": 88000},
    {"years_exp": 12, "salary": 105000},
    {"years_exp": 15, "salary": 118000}
  ]
}
```

**Step 2: Write and compile the VALUE program**
```chaprola
// VALUE program: salary = R1 * years_exp + R2
// R1 = slope (per-year raise), R2 = base salary
// R21 = sum of squared residuals (SSR)

DEFINE VARIABLE REC R41
DEFINE VARIABLE YRS R42
DEFINE VARIABLE SAL R43
DEFINE VARIABLE PRED R44
DEFINE VARIABLE RESID R45
DEFINE VARIABLE SSR R46

LET SSR = 0
LET REC = 1
100 SEEK REC
    IF EOF GOTO 200
    GET YRS FROM P.years_exp
    GET SAL FROM P.salary
    LET PRED = R1 * YRS
    LET PRED = PRED + R2
    LET RESID = PRED - SAL
    LET RESID = RESID * RESID
    LET SSR = SSR + RESID
    LET REC = REC + 1
    GOTO 100
200 LET R21 = SSR
    END
```

Compile with: `primary_format: "EMP"`

**Step 3: Run HULDRA**
```bash
POST /optimize {
  userid, project: "fit",
  program: "SALFIT",
  primary_file: "EMP",
  elements: [
    {index: 1, label: "per_year_raise", start: 5000, min: 0, max: 20000, delta: 10},
    {index: 2, label: "base_salary", start: 40000, min: 0, max: 100000, delta: 100}
  ],
  objectives: [
    {index: 1, label: "SSR", goal: 0.0, weight: 1.0}
  ],
  max_iterations: 100
}
```

**Response:**
```json
{
  "status": "converged",
  "iterations": 12,
  "elements": [
    {"index": 1, "label": "per_year_raise", "value": 4876.5},
    {"index": 2, "label": "base_salary", "value": 46230.1}
  ],
  "objectives": [
    {"index": 1, "label": "SSR", "value": 2841050.3, "goal": 0.0}
  ],
  "elapsed_seconds": 0.02
}
```

**Result:** `salary = $4,877/year × experience + $46,230 base`

### Element Parameters Explained

| Field | Description | Guidance |
|-------|-------------|----------|
| `index` | Maps to R-variable (1 → R1, 2 → R2, ...) | Max 20 elements |
| `label` | Human-readable name | Returned in results |
| `start` | Initial guess | Closer to true value = faster convergence |
| `min`, `max` | Bounds | HULDRA clamps parameters to this range |
| `delta` | Step size for gradient computation | ~0.1% of expected value range. Too large = inaccurate gradients. Too small = numerical noise |

### Choosing Delta Values

Delta controls how HULDRA estimates gradients (via central differences). Rules of thumb:
- **Dollar amounts** (fares, salaries): `delta: 0.01` to `1.0`
- **Rates/percentages** (per-mile, per-minute): `delta: 0.001` to `0.01`
- **Counts/integers**: `delta: 0.1` to `1.0`
- **Time values** (hours, peaks): `delta: 0.05` to `0.5`

If optimization doesn't converge, try making delta smaller.

### Performance & Limits

HULDRA runs your VALUE program **1 + 2 × N_elements** times per iteration (once for evaluation, twice per element for gradient). With `max_iterations: 100`:

| Elements | VM runs/iteration | At 100 iterations |
|----------|-------------------|-------------------|
| 2 | 5 | 500 |
| 3 | 7 | 700 |
| 5 | 11 | 1,100 |
| 10 | 21 | 2,100 |

**Lambda timeout is 900 seconds.** If each VM run takes 0.01s (100 records), you're fine. If each run takes 1s (100K records), 3 elements × 100 iterations = 700s — cutting it close.

**Strategy for large datasets:** Sample first. Query 200–500 representative records into a smaller dataset, optimize against that. The coefficients transfer to the full dataset.

```bash
# Sample 500 records from a large dataset
POST /query {userid, project, file: "BIGDATA", limit: 500, offset: 100000}
# Import the sample
POST /import {userid, project, name: "SAMPLE", data: [...results...]}
# Optimize against the sample
POST /optimize {... primary_file: "SAMPLE" ...}
```

### Async Optimization

For optimizations that might exceed 30 seconds (API Gateway timeout), use async mode:

```bash
POST /optimize {
  ... async_exec: true ...
}
# Response: {status: "running", job_id: "20260325_..."}

POST /optimize/status {userid, project, job_id: "20260325_..."}
# Response: {status: "converged", elements: [...], ...}
```

### Multi-Objective Optimization

HULDRA can minimize multiple objectives simultaneously with different weights:

```bash
objectives: [
  {index: 1, label: "price_error", goal: 0.0, weight: 1.0},
  {index: 2, label: "volume_error", goal: 0.0, weight: 10.0}
]
```

Higher weight = more important. HULDRA minimizes `Q = sum(weight × (value - goal)²)`.

### Interpreting Results

- **`status: "converged"`** — Optimal parameters found. The objective stopped improving.
- **`status: "timeout"`** — Hit 900s wall clock. Results are the best found so far — often still useful.
- **`total_objective`** — The raw Q value. Compare across runs, not in absolute terms. Lower = better fit.
- **`SSR` (objective value)** — Sum of squared residuals. Divide by record count for mean squared error. Take the square root for RMSE in the same units as your data.
- **`dq_dx` on elements** — Gradient. Values near zero mean the parameter is well-optimized. Large values may indicate the bounds are too tight.

### Model Catalog — Which Formula to Try

HULDRA fits any model expressible with Chaprola's math: `+`, `-`, `*`, `/`, `EXP`, `LOG`, `SQRT`, `ABS`, `POW`, and `IF` branching. Use this catalog to pick the right model for your data shape.

| Model | Formula | When to use | Chaprola math |
|-------|---------|-------------|---------------|
| **Linear** | `y = R1*x + R2` | Proportional relationships, constant rate | `*`, `+` |
| **Multi-linear** | `y = R1*x1 + R2*x2 + R3` | Multiple independent factors | `*`, `+` |
| **Quadratic** | `y = R1*x^2 + R2*x + R3` | Accelerating/decelerating curves, area scaling | `*`, `+`, `POW` |
| **Exponential growth** | `y = R1 * EXP(R2*x)` | Compound growth, population, interest | `EXP`, `*` |
| **Exponential decay** | `y = R1 * EXP(-R2*x) + R3` | Drug clearance, radioactive decay, cooling | `EXP`, `*`, `-` |
| **Power law** | `y = R1 * POW(x, R2)` | Scaling laws (Zipf, Kleiber), fractal relationships | `POW`, `*` |
| **Logarithmic** | `y = R1 * LOG(x) + R2` | Diminishing returns, perception (Weber-Fechner) | `LOG`, `*`, `+` |
| **Gaussian** | `y = R1 * EXP(-(x-R2)^2/(2*R3^2))` | Bell curves, distributions, demand peaks | `EXP`, `*`, `/` |
| **Logistic (S-curve)** | `y = R1 / (1 + EXP(-R2*(x-R3)))` | Adoption curves, saturation, carrying capacity | `EXP`, `/`, `+` |
| **Inverse** | `y = R1/x + R2` | Boyle's law, unit cost vs volume | `/`, `+` |
| **Square root** | `y = R1 * SQRT(x) + R2` | Flow rates (Bernoulli), risk vs portfolio size | `SQRT`, `*`, `+` |

**How to choose:** Look at your data's shape.
- Straight line → linear or multi-linear
- Curves upward faster and faster → exponential growth or quadratic
- Curves upward then flattens → logarithmic, square root, or logistic
- Drops fast then levels off → exponential decay or inverse
- Has a peak/hump → Gaussian
- Straight on log-log axes → power law

### Nonlinear VALUE Program Patterns

**Exponential decay:** `y = R1 * exp(-R2 * x) + R3`
```chaprola
LET ARG = R2 * X
LET ARG = ARG * -1
LET PRED = EXP ARG
LET PRED = PRED * R1
LET PRED = PRED + R3
```

**Power law:** `y = R1 * x^R2`
```chaprola
LET PRED = POW X R2
LET PRED = PRED * R1
```

**Gaussian:** `y = R1 * exp(-(x - R2)^2 / (2 * R3^2))`
```chaprola
LET DIFF = X - R2
LET DIFF = DIFF * DIFF
LET DENOM = R3 * R3
LET DENOM = DENOM * 2
LET ARG = DIFF / DENOM
LET ARG = ARG * -1
LET PRED = EXP ARG
LET PRED = PRED * R1
```

**Logistic S-curve:** `y = R1 / (1 + exp(-R2 * (x - R3)))`
```chaprola
LET ARG = X - R3
LET ARG = ARG * R2
LET ARG = ARG * -1
LET DENOM = EXP ARG
LET DENOM = DENOM + 1
LET PRED = R1 / DENOM
```

**Logarithmic:** `y = R1 * ln(x) + R2`
```chaprola
LET PRED = LOG X
LET PRED = PRED * R1
LET PRED = PRED + R2
```

All patterns follow the same loop structure: SEEK records, GET fields, compute PRED, accumulate `(PRED - OBS)^2` in SSR, store SSR in R21 at the end.

### Agent Workflow Summary

1. **Inspect** — Call `/format` to see what fields exist
2. **Sample** — Use `/query` with `limit` to get a manageable subset (200–500 records)
3. **Import sample** — `/import` the subset as a new small dataset
4. **Hypothesize** — Propose a model relating the fields
5. **Write VALUE program** — Loop through records, compute predicted vs actual, accumulate SSR in R21
6. **Compile** — `/compile` with `primary_format` pointing to the sample
7. **Optimize** — `/optimize` with elements, objectives, and the sample as primary_file
8. **Interpret** — Read the converged element values — those are your model coefficients
9. **Iterate** — If SSR is high, try a different model (add terms, try nonlinear)
