#!/usr/bin/env bash
# Deletes the app stack from your laptop. The Teardown workflow does the same.
# CloudFormation refuses to delete a bucket that still has files in it, so the
# bucket gets emptied first.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_stack.sh

aws s3 rm "s3://$(output SiteBucketName)" --recursive --region "$REGION"
aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION"
echo "Deleted $STACK"
