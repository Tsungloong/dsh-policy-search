#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo '请先运行 npm ci 安装依赖。'
  exit 1
fi
exec node src/cli.js --demo
