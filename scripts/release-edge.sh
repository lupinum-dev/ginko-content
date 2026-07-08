#!/bin/bash

set -euo pipefail

node scripts/preflight-release.mjs
pnpm build:packages
pnpm --dir packages/content publish --tag edge --access public
