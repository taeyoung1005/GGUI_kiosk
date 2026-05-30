#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-oba-4060ti}"
REMOTE_ROOT="${REMOTE_ROOT:-~/oba-weekenthon}"

echo "== remote reachability =="
ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" 'echo ssh-ok; uname -r'

echo "== gpu =="
ssh "$HOST" 'nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader'

echo "== sync module-a/contracts =="
rsync -az --delete module-a contracts "$HOST:$REMOTE_ROOT/"

echo "== bootstrap python env =="
ssh "$HOST" "cd $REMOTE_ROOT/module-a && chmod +x training/*.sh && training/remote_bootstrap.sh"

echo "== AIHub shell access =="
ssh "$HOST" "cd $REMOTE_ROOT/module-a && source .venv/bin/activate && python training/01_download.py --dataset-key 71320 --list-only"

cat <<'NEXT'

If file listing succeeds and AIHUB_API_KEY is exported on the remote host:

  ssh oba-4060ti 'cd ~/oba-weekenthon/module-a && source .venv/bin/activate && python training/01_download.py --dataset-key 71320'
  ssh oba-4060ti 'cd ~/oba-weekenthon/module-a && source .venv/bin/activate && CLASS_MODE=multiclass USE_DDP=1 training/run_pipeline.sh'

NEXT
