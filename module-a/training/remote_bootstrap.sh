#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip wheel
python -m pip install -r requirements.txt
mkdir -p vendor
if [ ! -d vendor/vox-profile-release/.git ]; then
  git clone https://github.com/tiantiaf0627/vox-profile-release.git vendor/vox-profile-release
fi

python -m py_compile app.py inference/*.py training/*.py
echo "module-a bootstrap complete"
