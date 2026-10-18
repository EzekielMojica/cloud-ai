#!/usr/bin/env bash
# Deletes everything the app stack created. CloudFormation refuses to delete a
# bucket that still has files in it, so the bucket gets emptied first.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_stack.sh

aws s3 rm "s3://$(output SiteBucketName)" --recursive --region "$REGION"
sam delete --stack-name "$STACK" --region "$REGION"
