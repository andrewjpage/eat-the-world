#!/usr/bin/env bash
# Write .env.local from the running local Supabase stack.
set -euo pipefail
eval "$(npx supabase status -o env)"
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
SUPABASE_DB_URL=${DB_URL}
MAILPIT_URL=${MAILPIT_URL:-${INBUCKET_URL:-http://127.0.0.1:54324}}
CRON_SECRET=local-cron-secret
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
EOF
echo "wrote .env.local"
