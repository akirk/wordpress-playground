#!/bin/bash
set -e

cd "$(dirname "$0")/../../.."

echo "Building remote..."
npx nx run playground-remote:build:standalone --skip-nx-cache

echo "Building website (persistent mode)..."
cd packages/playground/website
# CORS_PROXY_URL can be set via environment variable
npx vite build --mode persistent --outDir ../../../dist/packages/playground/website
cd ../../..

echo "Assembling wasm-wordpress-net..."
cd dist/packages/playground
rm -rf wasm-wordpress-net
mkdir wasm-wordpress-net
cp -r client wasm-wordpress-net/
cp -r remote/* wasm-wordpress-net/
cp -r website/* wasm-wordpress-net/
cp -r website-extras/* wasm-wordpress-net/ 2>/dev/null || true
cat remote/.htaccess website/.htaccess > wasm-wordpress-net/.htaccess

echo "Done! Output: dist/packages/playground/wasm-wordpress-net/"
