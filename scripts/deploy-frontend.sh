#!/usr/bin/env bash
# Builds the Vue app, uploads it to the S3 bucket, and tells CloudFront to drop
# its cached copy so visitors get the new version.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_stack.sh

scripts/write-env.sh
(cd frontend && npm run build)

aws s3 sync frontend/dist "s3://$(output SiteBucketName)" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$(output DistributionId)" --paths "/*" >/dev/null

echo "Live at $(output SiteUrl) (CloudFront can take a minute to pick up changes)"
