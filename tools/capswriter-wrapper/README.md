# Pi GUI CapsWriter-compatible ASR wrapper

This directory provides the local HTTP ASR service that Pi GUI voice input expects.
It is a reference wrapper around FunASR/SenseVoice-style offline ASR models.

## Contract

Pi GUI calls:

- `GET /health`
- `POST /transcribe` with raw browser audio bytes
- `POST /record/start` to start native host-microphone recording
- `POST /record/stop` to stop native recording and return the transcript

The wrapper returns:

```json
{ "text": "识别结果", "durationMs": 1234 }
```

Raw audio and transcript text are not logged by default.

Native recording uses optional `sounddevice` + `numpy` support and records from
the host where this wrapper process runs. It is intended for desktop/native use;
run the wrapper on the machine that has the microphone you want Pi GUI to use.

## Recommended WSL setup

From this directory:

```bash
python3.11 -m venv .venv
. .venv/bin/activate
python -m pip install -U pip
python -m pip install --index-url https://download.pytorch.org/whl/cpu torch torchaudio
python -m pip install -r requirements.txt
python server.py --port 8765 --model iic/SenseVoiceSmall --language chinese
```

`iic/SenseVoiceSmall` is a model id. The first transcription may download/cache the
model. To use a fully local model, replace it with the local model directory:

```bash
python server.py --port 8765 --model /home/me/models/SenseVoiceSmall --language chinese
```

## Pi GUI managed mode

Set voice input to `自动管理（推荐）` and use:

- Wrapper directory: this directory
- Service URL: `http://127.0.0.1:8765`
- Start command: `.venv/bin/python` after creating the venv, or `python` if your active Python has dependencies
- Args: `server.py --port 8765 --model iic/SenseVoiceSmall --language chinese`

If port `8765` is already used, choose another local port such as `18765` and
update both the service URL and args.

If you use a local model directory, put that directory in the args after `--model`.

## Bridge to an existing CapsWriter Offline server

If you already use the official Windows CapsWriter Offline server and its models,
this wrapper can launch `start_server.exe` and bridge Pi GUI audio into CapsWriter's
websocket protocol:

```bash
python server.py \
  --port 18765 \
  --capswriter-ws ws://<windows-host-ip>:6016 \
  --capswriter-server-exe /mnt/d/CapsWriter-Offline/start_server.exe \
  --capswriter-server-cwd /mnt/d/CapsWriter-Offline \
  --language chinese
```

Pi GUI talks to this wrapper at `http://127.0.0.1:18765`; the wrapper converts
browser audio to CapsWriter's websocket protocol. In WSL, `<windows-host-ip>` is
the Windows host address reachable from WSL, not necessarily `127.0.0.1`.

For native recording mode, `/record/start` captures audio from the wrapper host
microphone at 48 kHz float32, downmixes/downsamples it to CapsWriter-compatible
16 kHz float32 PCM on `/record/stop`, then sends it through the same CapsWriter
websocket bridge. If this wrapper runs inside WSL without microphone access,
native recording will report an unsupported/input-device error; run the wrapper
on Windows or another host with microphone access for native-quality capture.
