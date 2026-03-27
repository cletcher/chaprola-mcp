# Chaprola API — Endpoint Reference

Base URL: `https://api.chaprola.org`

Auth: `Authorization: Bearer chp_your_api_key` on all protected endpoints.

## Public Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /hello` | Health check. Optional `?name=X` query param |
| `POST /register` | `{username, passcode}` → `{api_key}`. Passcode: 16-128 chars |
| `POST /login` | `{username, passcode}` → `{api_key}`. **Invalidates previous key** |
| `POST /check-username` | `{username}` → `{available: bool}` |
| `POST /delete-account` | `{username, passcode}` → deletes account + all data |
| `POST /baa-text` | `{}` → `{baa_version, text}`. Get BAA for human review |
| `POST /report` | `{userid, project, name}` → program output. Program must be published |

## Protected Endpoints (auth required)

### BAA
| Endpoint | Body | Response |
|----------|------|----------|
| `POST /sign-baa` | `{userid, signatory_name, signatory_title?, organization?}` | `{status: "signed", baa_version, signed_at}` |
| `POST /baa-status` | `{userid}` | `{signed: bool, ...details}` |

### Data Import/Export
| Endpoint | Body | Response |
|----------|------|----------|
| `POST /import` | `{userid, project, name, data, format?, expires_in_days?}` | `{records, fields, record_length}` |
| `POST /import-url` | `{userid, project, name}` | `{upload_url, staging_key, expires_in}` |
| `POST /import-process` | `{userid, project, name, format?}` | Same as /import |
| `POST /import-download` | `{userid, project, name, url, instructions?, max_rows?}` | Same as /import |
| `POST /export` | `{userid, project, name}` | `{data: [...records]}` |
| `POST /list` | `{userid, project, pattern?}` | `{files: [...], total}` |
| `POST /download` | `{userid, project, file, type}` | `{download_url, expires_in, size_bytes}` |

### Compile & Run
| Endpoint | Body | Response |
|----------|------|----------|
| `POST /compile` | `{userid, project, name, source, primary_format?, secondary_format?}` | `{instructions, bytes}` |
| `POST /run` | `{userid, project, name, primary_file?, record?, async?, nophi?}` | `{output, registers}` or `{job_id}` |
| `POST /run/status` | `{userid, project, job_id}` | `{status: "running"/"done", output?}` |
| `POST /publish` | `{userid, project, name, primary_file?, record?}` | `{report_url}` |
| `POST /unpublish` | `{userid, project, name}` | `{status: "ok"}` |
| `POST /export-report` | `{userid, project, name, primary_file?, format?, title?, nophi?}` | `{output, files_written}` |

### Query & Data Operations
| Endpoint | Body | Response |
|----------|------|----------|
| `POST /query` | `{userid, project, file, where?, select?, aggregate?, order_by?, limit?, join?, pivot?, mercury?}` | `{records, total}` |
| `POST /sort` | `{userid, project, file, sort_by}` | `{status: "ok"}` |
| `POST /index` | `{userid, project, file, field}` | `{status: "ok"}` |
| `POST /merge` | `{userid, project, file_a, file_b, output, key}` | `{status: "ok"}` |

### Optimization (HULDRA)
| Endpoint | Body | Response |
|----------|------|----------|
| `POST /optimize` | `{userid, project, program, primary_file, elements, objectives, max_iterations?, async?}` | `{status, iterations, final_q, elements, objectives}` |
| `POST /optimize/status` | `{userid, project, job_id}` | `{status: "running"/"converged"}` |

### Email
| Endpoint | Body | Response |
|----------|------|----------|
| `POST /email/inbox` | `{address, limit?, before?}` | `{emails: [...], total}` |
| `POST /email/read` | `{address, message_id}` | `{email: {from, to, subject, text, html}}` |
| `POST /email/send` | `{from, to, subject, text, html?}` | `{status: "sent", message_id}` |
| `POST /email/delete` | `{address, message_id}` | `{status: "deleted"}` |

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Invalid input |
| 401 | Invalid or missing API key. Re-login with `/login` |
| 403 | BAA not signed, or userid mismatch |
| 404 | Resource not found |
| 409 | Username taken (registration) or BAA already signed |
| 429 | Rate limited. Auth: 5 rps. Others: 20 rps |
| 500 | Server error |

## Key Rules

- `userid` in every request body must match the authenticated user (403 if not)
- API keys never expire. Login generates a new key and invalidates the old one
- Data endpoints require a signed BAA (403 if unsigned)
- All `.DA` files expire after 90 days by default
