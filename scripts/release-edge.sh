#!/bin/bash

set -euo pipefail

pnpm build:packages
pnpm --dir packages/content publish --tag edge --access public --no-git-checks
