#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"

echo "Installing PDF Composer dependencies..."
npm config list --location=project
npm config get registry --location=project
npm config get save-exact --location=project
npm install

echo "Linking the pdf-composer command..."
npm link

echo "PDF Composer is ready. Run: pdf-composer --help"
