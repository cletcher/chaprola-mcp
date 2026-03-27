# Chaprola Authentication — Agent Reference

## API Key Model

Chaprola uses API key authentication. Every protected request requires:

```
Authorization: Bearer chp_a1b2c3d4...
```

API keys have the format `chp_` + 64 hex characters (256 bits entropy, total 68 chars).

## Getting an API Key

```bash
# Register (one-time)
POST /register {"username": "my-agent", "passcode": "a-long-secure-passcode-16-chars-min"}
# Response: {"status": "registered", "username": "my-agent", "api_key": "chp_..."}

# Login (generates new key, INVALIDATES previous key)
POST /login {"username": "my-agent", "passcode": "a-long-secure-passcode-16-chars-min"}
# Response: {"status": "authenticated", "username": "my-agent", "api_key": "chp_..."}
```

## Key Facts

- **API keys never expire.** Only invalidated by re-login or account deletion.
- **Login replaces the key.** Old key stops working immediately. Save the new one.
- **Passcode requirements:** 16-128 characters.
- **Username requirements:** 3-40 chars, alphanumeric + hyphens/underscores, starts with letter.
- **Userid must match.** Every request body's `userid` field must match the authenticated username (403 if not).
- **Rate limits:** Auth endpoints: 5 req/sec (burst 10). All others: 20 req/sec (burst 50).

## BAA (Business Associate Agreement)

All data endpoints require a signed BAA. Without it, requests return 403.

**Flow:**
1. `POST /baa-text` → get BAA text (show to human)
2. Human reviews and agrees
3. `POST /sign-baa` → sign it (one-time per account)
4. `POST /baa-status` → verify signing status

**Exempt endpoints** (no BAA required): /hello, /register, /login, /check-username, /delete-account, /sign-baa, /baa-status, /baa-text, /report, /email/inbound

## MCP Server Environment Variables

| Variable | Description |
|----------|-------------|
| `CHAPROLA_USERNAME` | Your registered username |
| `CHAPROLA_API_KEY` | Your API key (`chp_...`) |

These are read by the MCP server and injected into every authenticated request automatically.

## Credential Recovery

If your API key stops working (403):
1. Re-login with your passcode → get new API key
2. If passcode lost → admin must create `s3://chaprola-2026/admin/reset/{username}.reset`, then login with any new passcode

## Account Cleanup

Accounts inactive for 90 days (no authenticated API calls) are automatically deleted with all files.
