#!/usr/bin/env bash
# Probes whether the email/PASSWORD auth provider is enabled on the project —
# without touching anything. Run it before and after flipping the provider in
# the Supabase dashboard (Authentication → Providers → Email → disable
# "Email + Password", keep magic link) to VERIFY the click instead of assuming
# it.
#
# The app itself has no password path anywhere: the gate takes the owner
# passphrase or an owner-handed #collab_token link, and provision-collaborator
# neither sets nor accepts a password. But while the provider is enabled,
# /auth/v1/token?grant_type=password is reachable API surface regardless of
# what the UI offers — an entry path that was never designed. This script asks
# GoTrue which world we are in:
#
#   provider ENABLED  → an invalid-credentials style error
#                       e.g. {"error_code":"invalid_credentials", ...}
#   provider DISABLED → a provider/grant-disabled style error
#                       e.g. {"error_code":"email_provider_disabled", ...}
#
# Credentials below are DELIBERATELY bogus (the address cannot exist) and the
# anon key is public client config by design — no secret lives in this file.
set -euo pipefail

SUPABASE_URL="https://ascbthsgborseynmmthm.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzY2J0aHNnYm9yc2V5bm1tdGhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MzQxOTAsImV4cCI6MjEwMDQxMDE5MH0.-gT3HD6U9X75HTlvodz1zwvPKoPhI9uErt4RLQJDd3M"

echo "POST ${SUPABASE_URL}/auth/v1/token?grant_type=password"
echo "body: {\"email\":\"probe-does-not-exist@example.invalid\",\"password\":\"bogus-probe\"}"
echo "---"
curl -sS -w "\nHTTP %{http_code}\n" \
  -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"probe-does-not-exist@example.invalid","password":"bogus-probe"}'
