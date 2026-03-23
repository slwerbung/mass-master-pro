

## Plan: Sync all Edge Functions and Backend to Current Repo State

### Summary of Current State

After reviewing all 13 edge functions, the database schema, config.toml, and secrets, here is what needs to happen:

---

### 1. Deploy All 13 Edge Functions

All edge functions will be deployed to ensure the live versions match the repository exactly:

- `validate-admin`
- `validate-employee`
- `validate-session`
- `validate-guest`
- `validate-customer`
- `admin-manage`
- `customer-data`
- `guest-data`
- `update-guest-info`
- `list-employees`
- `ensure-customer-assignment`
- `send-notification`

No code changes needed — just deployment.

### 2. Fix config.toml — Missing Function Entries

Two edge functions are missing `verify_jwt = false` entries in `supabase/config.toml`:

- `send-notification`
- `ensure-customer-assignment`

These will be added so that the functions are callable without a JWT (they handle auth internally via tokens).

### 3. Database Migrations

All 19 existing migrations appear to be applied. No new migrations needed. The schema matches the current code expectations.

### 4. Secrets

All required secrets are already configured:
- `SESSION_SIGNING_SECRET` — present
- `ADMIN_PASSWORD` — present
- `GUEST_TOKEN_SECRET` — present

No changes needed.

### 5. No Other Changes

No UI, refactoring, or behavioral changes will be made.

---

### Technical Details

**File changes:**
- `supabase/config.toml` — add two missing function config blocks:
  ```
  [functions.send-notification]
  verify_jwt = false

  [functions.ensure-customer-assignment]
  verify_jwt = false
  ```

**Deployments:**
- All 13 edge functions deployed via the deploy tool

