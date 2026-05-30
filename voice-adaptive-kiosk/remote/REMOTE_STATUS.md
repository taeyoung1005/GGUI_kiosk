# Remote Module A Status

Updated: 2026-05-30

## SSH

- Host alias: `oba-4060ti`
- HostName: `100.117.133.18`
- User: `taeyoung4060ti`
- Key: `~/.ssh/oba_4060ti_ed25519`
- Key login was verified before the reboot.

## GPU Driver

Observed issue:

- Booted kernel was `6.17.0-23-generic`.
- Installed NVIDIA modules were for `6.17.0-22-generic`.
- `nvidia-smi` failed with driver communication error.

Actions taken:

- Ran `apt-get update`.
- Installed current HWE kernel and matching NVIDIA stack:
  - `linux-image-6.17.0-29-generic`
  - `linux-modules-6.17.0-29-generic`
  - `linux-modules-nvidia-580-open-6.17.0-29-generic`
  - `linux-modules-nvidia-580-open-generic-hwe-24.04`
  - `nvidia-driver-580-open`
- Reboot was issued.

Current blocker:

- After reboot, Tailscale showed the node as offline. Continue by checking the physical server boot state, then run:

```bash
ssh oba-4060ti 'uname -r; nvidia-smi'
```

Expected kernel after recovery: `6.17.0-29-generic`.

Latest check:

- Tailscale still reports the node offline.
- `tailscale ping 100.117.133.18` times out.
- `ssh oba-4060ti` times out on port 22.
- Latest retry still shows `offline, last seen 8m ago`; SSH still times out.
- Latest retry still shows `offline, last seen 9m ago`; `tailscale ping` returns no reply twice and SSH still times out.

## Module A Sync

Synced to:

```text
~/oba-weekenthon/module-a
~/oba-weekenthon/contracts
```

Remote syntax verification passed:

```bash
cd ~/oba-weekenthon/module-a
python3 -m py_compile app.py inference/*.py training/*.py
```

## Next Remote Commands

After SSH returns and `nvidia-smi` works:

```bash
cd ~/oba-weekenthon/module-a
chmod +x training/remote_bootstrap.sh training/run_pipeline.sh
training/remote_bootstrap.sh
```

Then AIHub access:

```bash
export AIHUB_API_KEY='...'
python training/01_download.py --dataset-key 71320 --list-only
```

Once the dataset key is known:

```bash
python training/01_download.py --dataset-key 71320
CLASS_MODE=multiclass USE_DDP=1 training/run_pipeline.sh
```

Local parser validation:

- `training/02_index.py` correctly parsed a synthetic AIHub-shaped JSON containing `MediaUrl`, `Speakers[].Agegroup`, `Dialogs[].StartTime/EndTime`, and `Speakertext`.
- `training/04_split.py` produced train/valid/test JSONL files from that manifest.
- `training/validate_manifest.py` now checks split manifests for missing audio files, minimum rows, and speaker leakage.
- `python3 -m unittest discover -s module-a/tests -v` passes locally.

Resume helper:

```bash
voice-adaptive-kiosk/remote/resume_module_a.sh
```
