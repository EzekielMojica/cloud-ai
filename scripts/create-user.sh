#!/usr/bin/env bash
# Creates a login. Sign-up is turned off, so this is the only way in.
# Usage: scripts/create-user.sh teacher@school.edu
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_stack.sh

EMAIL="${1:?Usage: scripts/create-user.sh <email>}"
POOL="$(output UserPoolId)"
# Read the password without echoing it or saving it in shell history.
read -rsp "Password for $EMAIL (12+ characters): " PASSWORD; echo

aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL" \
  --username "$EMAIL" --message-action SUPPRESS \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true >/dev/null
aws cognito-idp admin-set-user-password --region "$REGION" --user-pool-id "$POOL" \
  --username "$EMAIL" --password "$PASSWORD" --permanent

echo "Created $EMAIL"
