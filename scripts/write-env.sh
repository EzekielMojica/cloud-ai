#!/usr/bin/env bash
# Copies the stack outputs the frontend needs into frontend/.env.local.
# Run it after every `sam deploy` that changes the Cognito pool or the Lambda URL.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_stack.sh

cat > frontend/.env.local <<ENV
VITE_USER_POOL_ID=$(output UserPoolId)
VITE_USER_POOL_CLIENT_ID=$(output UserPoolClientId)
VITE_API_URL=$(output ApiUrl)
ENV
echo "Wrote frontend/.env.local:"
cat frontend/.env.local
