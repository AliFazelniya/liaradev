#!/bin/sh
# Optional: local project detection. Builds Railpack (MIT) from source into .data/bin/railpack. Needs Go; no account, no API.
set -e
mkdir -p .data/bin
GOBIN="$(pwd)/.data/bin" go install github.com/railwayapp/railpack/cmd/cli@latest
mv .data/bin/cli .data/bin/railpack
echo "installed: .data/bin/railpack"
