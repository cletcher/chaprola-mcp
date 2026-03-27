# Chaprola Gotchas — Hard-Won Lessons

## Language

### No parentheses in LET
Chaprola's LET supports one operation: `LET var = a OP b`. Use temp variables for complex math.
```chaprola
// WRONG: LET result = price * (qty + bonus)
// RIGHT:
LET temp = qty + bonus
LET result = price * temp
```

### IF EQUAL compares a literal to a location
Cannot compare two memory locations. Copy to U buffer first.
```chaprola
MOVE P.txn_type U.76 6
IF EQUAL "CREDIT" U.76 GOTO 200
```

### MOVE length must match field width
`MOVE P.name U.1 20` copies 20 chars starting at the field — if `name` is 8 chars wide, the extra 12 bleed into adjacent fields. Always match the format file width.

### DEFINE VARIABLE names must not collide with field names
If the format has a `balance` field, don't `DEFINE VARIABLE balance R3`. Use `bal` instead. The compiler confuses the alias with the field name.

### R-variables are floating point
All R1–R50 are 64-bit floats. `7 / 2 = 3.5`. Use PUT with `I` format to display as integer.

### Statement numbers are labels, not line numbers
Only number lines that are GOTO/CALL targets. Don't number every line.

### FIND returns 0 on no match
Always check `IF match EQ 0` after FIND before calling READ.

### PRINT 0 clears the U buffer
After PRINT 0, the buffer is empty. No need to manually clear between prints unless reusing specific positions.

## Import

### Field widths come from the longest value
Import auto-sizes fields to the max value length. For specific widths (e.g., 8-char balance starting at 0), import as zero-padded string: `"balance": "00000000"`.

### Use explicit OPEN record length for string-imported numbers
When numeric data is imported as strings, auto-detect (`OPEN "file" 0`) may miscalculate. Use the `record_length` from the import response: `OPEN "ACCOUNTS" 33`.

## API

### userid must match authenticated user
Every request body's `userid` must equal your username. 403 on mismatch.

### Login invalidates the old key
`POST /login` generates a new API key. The old one is dead. Save the new one immediately.

### BAA required for data operations
All import/export/compile/run/query/email endpoints return 403 without a signed BAA. Check with `/baa-status` first.

### Async for large datasets
`POST /run` with `async: true` for >100K records. API Gateway has a 30-second timeout; async bypasses it. Poll `/run/status` until `status: "done"`.

### secondary_format is a string
Pass `secondary_format: "DEPARTMENTS"` (a single string), not an array, to `/compile`.

### Data files expire
Default 90 days. Set `expires_in_days` on import to override. Expired files are deleted daily at 03:00 UTC.

## Secondary Files

### One at a time
Only one secondary file can be open. CLOSE before opening another. Save any needed values in R-variables or U buffer first.

### CLOSE flushes writes
Always CLOSE before END if you wrote to the secondary file. Unflushed writes are lost.

## HULDRA Optimization

### Use R41–R50 for scratch variables, not R1–R20
R1–R20 are reserved for HULDRA elements. R21–R40 are reserved for objectives. Your VALUE program's DEFINE VARIABLE declarations must use R41–R50 only.
```chaprola
// WRONG: DEFINE VARIABLE counter R1  (HULDRA will overwrite this)
// RIGHT: DEFINE VARIABLE counter R41
```

### Sample large datasets before optimizing
HULDRA runs your program `1 + 2 × N_elements` times per iteration. With 3 elements and 100 iterations, that's 700 VM runs. If each run processes 1M records (7+ seconds), total time = 5,000+ seconds — well beyond the 900-second Lambda timeout. Query 200–500 records into a sample dataset and optimize against that.

### Delta too large = bad convergence
If HULDRA doesn't converge or oscillates, reduce `delta`. Start with ~0.1% of the expected parameter range. For dollar amounts, try `delta: 0.01`. For rates, try `delta: 0.001`.

### Always initialize SSR to zero
Your VALUE program accumulates squared residuals across all records. If you forget `LET SSR = 0` before the loop, SSR carries garbage from a previous HULDRA iteration (R-variables persist between runs within an optimization).

### Filter bad data in the VALUE program
Negative fares, zero distances, and other anomalies will corrupt your fit. Add guards:
```chaprola
GET FARE FROM P.fare
IF FARE LE 0 GOTO 300    // skip bad records
// ... compute residual ...
300 LET REC = REC + 1
```

## Email

### Content moderation on outbound
All outbound emails are AI-screened. Blocked emails return 403.

### Rate limits
20 emails/day per user, 3 emails/minute. Exceeding returns 429.

### PHI in email
Emails containing PHI identifiers (names, SSNs, dates of birth, etc.) are blocked by the content moderator.
