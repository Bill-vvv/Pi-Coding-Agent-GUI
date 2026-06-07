#!/usr/bin/env python3
"""Pi GUI CapsWriter-compatible local ASR wrapper.

This is a small HTTP service for Pi GUI voice input. It intentionally uses only
Python's standard-library web server so users do not need FastAPI/Flask just to
expose the Pi GUI contract.

Contract:
- GET /health -> { ok, ready, message? }
- POST /transcribe -> raw browser audio bytes, returns { text, durationMs }
- POST /record/start -> start native host-microphone recording
- POST /record/stop -> stop native recording and return { text, durationMs }

ASR backend:
- FunASR AutoModel, loaded lazily on first transcription, or CapsWriter WebSocket bridge.
- Model comes from --model, PI_GUI_VOICE_MODEL_PATH, or X-Voice-Model-Path.
- Native recording requires optional sounddevice + numpy on the wrapper host.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_AUDIO_BYTES = 100 * 1024 * 1024
NATIVE_RECORDING_SAMPLE_RATE = 48_000
CAPSWRITER_SAMPLE_RATE = 16_000
DEFAULT_WSLG_PULSE_SERVER = "unix:/mnt/wslg/PulseServer"


def native_pulse_server() -> str | None:
    configured = os.environ.get("PULSE_SERVER", "").strip()
    if configured:
        return configured
    if Path("/mnt/wslg/PulseServer").exists():
        return DEFAULT_WSLG_PULSE_SERVER
    return None


def native_pulse_source() -> str:
    return os.environ.get("PI_GUI_VOICE_PULSE_SOURCE", "default").strip() or "default"


def native_pulse_recording_available() -> bool:
    return shutil.which("ffmpeg") is not None and native_pulse_server() is not None


class FfmpegPulseStream:
    def __init__(self, pulse_source: str, pulse_server: str | None) -> None:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg is required for native PulseAudio recording")
        env = os.environ.copy()
        if pulse_server and not env.get("PULSE_SERVER"):
            env["PULSE_SERVER"] = pulse_server
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "pulse",
            "-i",
            pulse_source,
            "-ac",
            "1",
            "-ar",
            str(CAPSWRITER_SAMPLE_RATE),
            "-f",
            "f32le",
            "-",
        ]
        self._stdout_chunks: list[bytes] = []
        self._stderr_chunks: list[bytes] = []
        self._process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.PIPE, env=env)
        self._stdout_thread = threading.Thread(target=self._read_pipe, args=(self._process.stdout, self._stdout_chunks, None), daemon=True)
        self._stderr_thread = threading.Thread(target=self._read_pipe, args=(self._process.stderr, self._stderr_chunks, 16 * 1024), daemon=True)
        self._stdout_thread.start()
        self._stderr_thread.start()
        time.sleep(0.15)
        if self._process.poll() is not None:
            self.close()
            raise RuntimeError(f"native PulseAudio recording failed: {self.error_message() or self._process.returncode}")

    @staticmethod
    def _read_pipe(pipe: Any, chunks: list[bytes], max_bytes: int | None) -> None:
        if pipe is None:
            return
        total = 0
        while True:
            chunk = pipe.read(8192)
            if not chunk:
                return
            if max_bytes is None:
                chunks.append(chunk)
                continue
            remaining = max_bytes - total
            if remaining <= 0:
                continue
            chunks.append(chunk[:remaining])
            total += len(chunk[:remaining])

    def stop(self) -> None:
        if self._process.poll() is None:
            try:
                if self._process.stdin is not None:
                    self._process.stdin.write(b"q\n")
                    self._process.stdin.flush()
                    self._process.stdin.close()
                self._process.wait(timeout=5)
            except Exception:
                if self._process.poll() is None:
                    self._process.terminate()
                    try:
                        self._process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self._process.kill()
                        self._process.wait(timeout=5)
        self._stdout_thread.join(timeout=2)
        self._stderr_thread.join(timeout=2)

    def close(self) -> None:
        self.stop()
        for pipe in (self._process.stdout, self._process.stderr):
            try:
                if pipe is not None:
                    pipe.close()
            except Exception:
                pass

    def audio_bytes(self) -> bytes:
        return b"".join(self._stdout_chunks)

    def error_message(self) -> str:
        return b"".join(self._stderr_chunks).decode("utf-8", errors="replace").strip()


class NativeRecorder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stream: Any | None = None
        self._chunks: list[Any] = []
        self._started_at: float | None = None

    def start(self) -> dict[str, Any]:
        try:
            return self._start_sounddevice()
        except Exception as exc:
            if not native_pulse_recording_available():
                raise
            return self._start_pulse_fallback(exc)

    def _start_sounddevice(self) -> dict[str, Any]:
        try:
            import numpy as np  # noqa: F401
            import sounddevice as sd
        except Exception as exc:  # pragma: no cover - depends on user's environment
            raise RuntimeError(f"native recording requires sounddevice and numpy: {exc}") from exc

        with self._lock:
            if self._stream is not None:
                raise RuntimeError("native recording is already active")
            self._chunks = []
            self._started_at = time.time()

            device = sd.query_devices(kind="input")
            channels = max(1, min(2, int(device.get("max_input_channels", 1))))

            def callback(indata: Any, _frames: int, _time_info: Any, _status: Any) -> None:
                with self._lock:
                    if self._stream is not None:
                        self._chunks.append(indata.copy())

            try:
                stream = sd.InputStream(
                    samplerate=NATIVE_RECORDING_SAMPLE_RATE,
                    blocksize=int(0.05 * NATIVE_RECORDING_SAMPLE_RATE),
                    dtype="float32",
                    channels=channels,
                    callback=callback,
                )
                stream.start()
                self._stream = stream
            except Exception:
                self._stream = None
                self._chunks = []
                self._started_at = None
                raise

            return {"ok": True, "recording": True, "startedAt": int(self._started_at * 1000)}

    def _start_pulse_fallback(self, sounddevice_error: Exception) -> dict[str, Any]:
        with self._lock:
            if self._stream is not None:
                raise RuntimeError("native recording is already active")
            self._chunks = []
            self._started_at = time.time()
            try:
                self._stream = FfmpegPulseStream(native_pulse_source(), native_pulse_server())
            except Exception as exc:
                self._started_at = None
                raise RuntimeError(f"native recording fallback failed after sounddevice error ({sounddevice_error}): {exc}") from exc
            return {"ok": True, "recording": True, "startedAt": int(self._started_at * 1000)}

    def stop(self) -> tuple[bytes, int]:
        with self._lock:
            stream = self._stream
            chunks = self._chunks
            started_at = self._started_at
            self._stream = None
            self._chunks = []
            self._started_at = None

        if stream is None or started_at is None:
            raise RuntimeError("native recording is not active")

        if isinstance(stream, FfmpegPulseStream):
            stream.close()
            pcm16k = stream.audio_bytes()
            if len(pcm16k) < int(0.1 * CAPSWRITER_SAMPLE_RATE) * 4:
                message = stream.error_message()
                suffix = f": {message}" if message else ""
                raise RuntimeError(f"native recording captured too little audio{suffix}")
            duration_ms = int((len(pcm16k) / 4 / CAPSWRITER_SAMPLE_RATE) * 1000)
            return pcm16k, duration_ms

        try:
            stream.stop()
        finally:
            stream.close()

        if not chunks:
            raise RuntimeError("native recording captured no audio")

        try:
            import numpy as np
        except Exception as exc:  # pragma: no cover - depends on user's environment
            raise RuntimeError(f"native recording requires numpy: {exc}") from exc

        audio = np.concatenate(chunks, axis=0)
        if audio.ndim == 2:
            mono = np.mean(audio, axis=1, dtype=np.float32)
        else:
            mono = audio.astype(np.float32, copy=False).reshape(-1)
        pcm16k = mono[:: int(NATIVE_RECORDING_SAMPLE_RATE / CAPSWRITER_SAMPLE_RATE)].astype(np.float32, copy=False)
        if pcm16k.size < int(0.1 * CAPSWRITER_SAMPLE_RATE):
            raise RuntimeError("native recording captured too little audio")
        duration_ms = int((pcm16k.size / CAPSWRITER_SAMPLE_RATE) * 1000)
        return pcm16k.tobytes(), duration_ms


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pi GUI CapsWriter-compatible ASR wrapper")
    parser.add_argument("--host", default=DEFAULT_HOST, help="listen host, default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="listen port, default: 8765")
    parser.add_argument(
        "--model",
        default=os.environ.get("PI_GUI_VOICE_MODEL_PATH") or "",
        help="FunASR model path or model id, e.g. iic/SenseVoiceSmall",
    )
    parser.add_argument(
        "--capswriter-ws",
        default=os.environ.get("PI_GUI_CAPSWRITER_WS") or "",
        help="Bridge to an existing CapsWriter Offline websocket server, e.g. ws://127.0.0.1:6016 or ws://auto:6016",
    )
    parser.add_argument(
        "--capswriter-server-exe",
        default=os.environ.get("PI_GUI_CAPSWRITER_SERVER_EXE") or "",
        help="Optional CapsWriter Offline start_server.exe to launch before bridging",
    )
    parser.add_argument(
        "--capswriter-server-cwd",
        default=os.environ.get("PI_GUI_CAPSWRITER_SERVER_CWD") or "",
        help="Working directory for start_server.exe; defaults to exe directory",
    )
    parser.add_argument("--device", default=os.environ.get("PI_GUI_VOICE_DEVICE", "cpu"), help="cpu or cuda:0")
    parser.add_argument("--language", default=os.environ.get("PI_GUI_VOICE_LANGUAGE", "chinese"), help="Unified language hint: auto, chinese, english, japanese, ...")
    parser.add_argument("--max-audio-bytes", type=int, default=MAX_AUDIO_BYTES)
    return parser.parse_args()


class AsrEngine:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.model_id_or_path = args.model.strip()
        self.capswriter_ws = args.capswriter_ws.strip()
        self.capswriter_server_exe = args.capswriter_server_exe.strip()
        self.capswriter_server_cwd = args.capswriter_server_cwd.strip()
        self.capswriter_process: subprocess.Popen[Any] | None = None
        self.native_recorder = NativeRecorder()
        self.model: Any | None = None
        self.last_error: str | None = None

    def health(self) -> dict[str, Any]:
        if self.capswriter_ws:
            if self.capswriter_server_exe:
                self.ensure_capswriter_server_started()
            reachable, message = capswriter_ws_reachable(self.capswriter_ws)
            return {"ok": True, "ready": reachable, "message": message}
        if not self.model_id_or_path:
            return {"ok": True, "ready": False, "message": "ASR model is not configured"}
        try:
            import funasr  # noqa: F401
        except Exception as exc:  # pragma: no cover - depends on user's environment
            return {"ok": True, "ready": False, "message": f"FunASR is not installed: {exc}"}
        if self.last_error:
            return {"ok": True, "ready": False, "message": self.last_error}
        return {"ok": True, "ready": True, "modelLoaded": self.model is not None}

    def ensure_model(self, override_model: str | None = None) -> Any:
        model_id_or_path = (override_model or self.model_id_or_path).strip()
        if not model_id_or_path:
            raise RuntimeError("ASR model is not configured")
        if override_model and override_model != self.model_id_or_path:
            # Header override is mainly for external services. Keep it simple and
            # rebuild if the caller switches model.
            self.model = None
            self.model_id_or_path = override_model
        if self.model is not None:
            return self.model
        try:
            from funasr import AutoModel

            kwargs: dict[str, Any] = {
                "model": self.model_id_or_path,
                "trust_remote_code": True,
                "device": self.args.device,
            }
            # VAD improves long utterances. If the bundled VAD alias is unavailable,
            # FunASR will raise and the error is shown in Pi GUI status.
            kwargs["vad_model"] = "fsmn-vad"
            kwargs["vad_kwargs"] = {"max_single_segment_time": 30000}
            self.model = AutoModel(**kwargs)
            self.last_error = None
            return self.model
        except Exception as exc:
            self.last_error = f"ASR model load failed: {exc}"
            raise RuntimeError(self.last_error) from exc

    def transcribe(self, audio: bytes, mime_type: str, override_model: str | None = None) -> str:
        if self.capswriter_ws:
            if self.capswriter_server_exe:
                self.ensure_capswriter_server_started()
            self.capswriter_ws = resolve_capswriter_ws_url(self.capswriter_ws)
            return asyncio.run(transcribe_with_capswriter_ws(self.capswriter_ws, audio, mime_type, self.args.language))
        suffix = suffix_for_mime(mime_type)
        with tempfile.NamedTemporaryFile(prefix="pi-gui-voice-", suffix=suffix, delete=False) as temp:
            temp.write(audio)
            temp_path = temp.name
        try:
            model = self.ensure_model(override_model)
            result = model.generate(input=temp_path, language=self.args.language, batch_size_s=60)
            return extract_text(result)
        finally:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass

    def start_recording(self) -> dict[str, Any]:
        if self.capswriter_ws and self.capswriter_server_exe:
            self.ensure_capswriter_server_started()
        return self.native_recorder.start()

    def stop_recording(self) -> dict[str, Any]:
        pcm, duration_ms = self.native_recorder.stop()
        if self.capswriter_ws:
            if self.capswriter_server_exe:
                self.ensure_capswriter_server_started()
            self.capswriter_ws = resolve_capswriter_ws_url(self.capswriter_ws)
            text = asyncio.run(transcribe_capswriter_pcm(self.capswriter_ws, pcm, self.args.language))
        else:
            text = self.transcribe_native_pcm(pcm)
        return {"text": text.strip(), "durationMs": duration_ms}

    def transcribe_native_pcm(self, pcm: bytes) -> str:
        with tempfile.NamedTemporaryFile(prefix="pi-gui-native-voice-", suffix=".wav", delete=False) as temp:
            temp_path = temp.name
        try:
            write_float32_pcm_wav(temp_path, pcm, CAPSWRITER_SAMPLE_RATE)
            model = self.ensure_model()
            result = model.generate(input=temp_path, language=self.args.language, batch_size_s=60)
            return extract_text(result)
        finally:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass

    def ensure_capswriter_server_started(self) -> None:
        reachable, _ = capswriter_ws_reachable(self.capswriter_ws)
        if reachable:
            return
        if self.capswriter_process and self.capswriter_process.poll() is None:
            wait_for_capswriter_ws(self.capswriter_ws)
            return
        exe = Path(self.capswriter_server_exe)
        if not exe.exists():
            raise RuntimeError(f"CapsWriter server exe does not exist: {exe}")
        cwd = Path(self.capswriter_server_cwd) if self.capswriter_server_cwd else exe.parent
        self.capswriter_process = subprocess.Popen(
            [str(exe)],
            cwd=str(cwd),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )
        wait_for_capswriter_ws(self.capswriter_ws)


def suffix_for_mime(mime_type: str) -> str:
    mime = mime_type.lower()
    if "wav" in mime:
        return ".wav"
    if "mpeg" in mime or "mp3" in mime:
        return ".mp3"
    if "ogg" in mime:
        return ".ogg"
    if "mp4" in mime or "m4a" in mime:
        return ".m4a"
    return ".webm"


def extract_text(result: Any) -> str:
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        text = result.get("text")
        if isinstance(text, str):
            return text.strip()
    if isinstance(result, list):
        parts: list[str] = []
        for item in result:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"].strip())
            elif isinstance(item, str):
                parts.append(item.strip())
        return "".join(parts).strip()
    return ""


def wait_for_capswriter_ws(ws_url: str, timeout_s: float = 90) -> None:
    deadline = time.monotonic() + timeout_s
    last_message = ""
    while time.monotonic() < deadline:
        reachable, message = capswriter_ws_reachable(ws_url)
        if reachable:
            return
        last_message = message
        time.sleep(1)
    raise RuntimeError(last_message or "CapsWriter websocket did not become reachable")


def capswriter_ws_reachable(ws_url: str) -> tuple[bool, str]:
    try:
        resolved = resolve_capswriter_ws_url(ws_url)
        return True, f"CapsWriter websocket reachable: {resolved}"
    except Exception as exc:
        return False, f"CapsWriter websocket is not reachable: {exc}"


def resolve_capswriter_ws_url(ws_url: str) -> str:
    errors: list[str] = []
    for candidate in capswriter_ws_candidates(ws_url):
        try:
            asyncio.run(check_capswriter_ws_handshake(candidate))
            return candidate
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
    raise RuntimeError("; ".join(errors[-4:]) or "no CapsWriter websocket candidates")


def capswriter_ws_candidates(ws_url: str) -> list[str]:
    url = urlparse(ws_url)
    scheme = url.scheme if url.scheme in {"ws", "wss"} else "ws"
    host = (url.hostname or "auto").lower()
    port = url.port or 6016
    path = url.path or ""
    hosts: list[str] = []
    if host not in {"auto", "windows", "winhost", "host"}:
        hosts.append(host)
    hosts.extend(env_capswriter_hosts())
    hosts.extend(windows_ipv4_hosts())
    hosts.extend(default_gateway_hosts())
    hosts.extend(resolv_nameserver_hosts())
    hosts.extend(["127.0.0.1", "localhost"])

    candidates: list[str] = []
    seen: set[str] = set()
    for item in hosts:
        clean = item.strip().strip("[]").lower()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        candidates.append(f"{scheme}://{clean}:{port}{path}")
    return candidates


def env_capswriter_hosts() -> list[str]:
    raw = os.environ.get("PI_GUI_CAPSWRITER_HOSTS", "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def windows_ipv4_hosts() -> list[str]:
    cmd = Path("/mnt/c/Windows/System32/cmd.exe")
    if not cmd.exists():
        return []
    try:
        completed = subprocess.run([str(cmd), "/c", "ipconfig"], check=False, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
    except Exception:
        return []
    text = completed.stdout.decode("gbk", errors="ignore")
    return re.findall(r"IPv4[^:\r\n]*:\s*([0-9]+(?:\.[0-9]+){3})", text)


def default_gateway_hosts() -> list[str]:
    try:
        completed = subprocess.run(["ip", "route", "show", "default"], check=False, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=2)
    except Exception:
        return []
    return re.findall(r"default via ([0-9]+(?:\.[0-9]+){3})", completed.stdout)


def resolv_nameserver_hosts() -> list[str]:
    try:
        text = Path("/etc/resolv.conf").read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    return re.findall(r"^nameserver\s+([0-9]+(?:\.[0-9]+){3})", text, flags=re.MULTILINE)


async def check_capswriter_ws_handshake(ws_url: str) -> None:
    try:
        import websockets
    except Exception as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(f"websockets is not installed: {exc}") from exc
    async with websockets.connect(ws_url, subprotocols=["binary"], proxy=None, max_size=None, max_queue=None, open_timeout=3):
        return


async def transcribe_with_capswriter_ws(ws_url: str, audio: bytes, mime_type: str, language: str) -> str:
    pcm = decode_audio_to_capswriter_pcm(audio, mime_type)
    return await transcribe_capswriter_pcm(ws_url, pcm, language)


async def transcribe_capswriter_pcm(ws_url: str, pcm: bytes, language: str) -> str:
    # Protocol-compatibility note: this constructs a request for a user-provided
    # CapsWriter Offline WebSocket server. Pi GUI does not bundle CapsWriter
    # binaries/models/source. If this message shape is later copied or adapted
    # from a specific upstream file or example, add the source URL and license to
    # THIRD_PARTY.md.
    try:
        import websockets
    except Exception as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(f"websockets is not installed: {exc}") from exc

    task_id = str(uuid.uuid4())
    message = {
        "task_id": task_id,
        "source": "mic",
        "data": base64.b64encode(pcm).decode("ascii"),
        "is_final": True,
        "time_start": time.time(),
        "seg_duration": 15.0,
        "seg_overlap": 2.0,
        "context": "",
        "language": language or "auto",
    }
    try:
        async with websockets.connect(ws_url, subprotocols=["binary"], proxy=None, max_size=None, max_queue=None, open_timeout=10) as websocket:
            await websocket.send(json.dumps(message, ensure_ascii=False))
            deadline = time.monotonic() + 120
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("ASR service request timed out")
                raw = await asyncio.wait_for(websocket.recv(), timeout=remaining)
                data = json.loads(raw)
                if data.get("task_id") != task_id:
                    continue
                if data.get("is_final"):
                    text = data.get("text")
                    if not isinstance(text, str):
                        raise RuntimeError("CapsWriter response did not include text")
                    return text.strip()
    except asyncio.TimeoutError as exc:
        raise RuntimeError("ASR service request timed out") from exc


def decode_audio_to_capswriter_pcm(audio: bytes, mime_type: str) -> bytes:
    suffix = suffix_for_mime(mime_type)
    with tempfile.NamedTemporaryFile(prefix="pi-gui-voice-in-", suffix=suffix, delete=False) as src:
        src.write(audio)
        src_path = src.name
    try:
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            src_path,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "-",
        ]
        completed = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return completed.stdout
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg is required for CapsWriter bridge audio conversion") from exc
    except subprocess.CalledProcessError as exc:
        error = exc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"audio conversion failed: {error or exc.returncode}") from exc
    finally:
        try:
            Path(src_path).unlink(missing_ok=True)
        except Exception:
            pass


def write_float32_pcm_wav(path: str, pcm: bytes, sample_rate: int) -> None:
    try:
        import numpy as np
    except Exception as exc:  # pragma: no cover - depends on user's environment
        raise RuntimeError(f"native recording requires numpy: {exc}") from exc

    samples = np.frombuffer(pcm, dtype=np.float32)
    clipped = np.clip(samples, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype("<i2")
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm16.tobytes())


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict[str, Any]) -> None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def recording_error_response(error: Exception) -> tuple[int, str]:
    message = str(error).lower()
    if "asr service request timed out" in message:
        return 504, "upstream_timeout"
    if "capswriter websocket" in message or "websockets is not installed" in message or "no capswriter websocket" in message:
        return 503, "upstream_unavailable"
    if "asr model" in message or "funasr" in message or "capswriter response" in message:
        return 502, "upstream_error"
    if "already active" in message:
        return 409, "native_recording_already_active"
    if "not active" in message:
        return 409, "native_recording_not_active"
    unsupported_device_markers = (
        "requires sounddevice",
        "no default input device",
        "query_devices",
        "error querying device",
        "invalid input device",
        "invalid device",
        "portaudio",
        "no input device",
        "native recording fallback failed",
        "native pulseaudio recording failed",
        "ffmpeg is required for native pulseaudio recording",
    )
    if any(marker in message for marker in unsupported_device_markers):
        return 501, "native_recording_unsupported"
    if "captured no audio" in message or "too little audio" in message:
        return 422, "empty_transcript"
    return 500, "native_recording_error"


def make_handler(engine: AsrEngine):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path != "/health":
                json_response(self, 404, {"ok": False, "message": "not found"})
                return
            json_response(self, 200, engine.health())

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/record/start":
                try:
                    json_response(self, 200, engine.start_recording())
                except Exception as exc:
                    status, code = recording_error_response(exc)
                    json_response(self, status, {"ok": False, "message": str(exc), "code": code})
                return
            if path == "/record/stop":
                try:
                    json_response(self, 200, engine.stop_recording())
                except Exception as exc:
                    status, code = recording_error_response(exc)
                    json_response(self, status, {"ok": False, "message": str(exc), "code": code})
                return
            if path != "/transcribe":
                json_response(self, 404, {"ok": False, "message": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if length <= 0:
                json_response(self, 400, {"ok": False, "message": "audio body is empty"})
                return
            if length > engine.args.max_audio_bytes:
                json_response(self, 413, {"ok": False, "message": "audio body is too large"})
                return
            audio = self.rfile.read(length)
            mime_type = self.headers.get("Content-Type", "application/octet-stream")
            model_override = self.headers.get("X-Voice-Model-Path") or None
            started = time.perf_counter()
            try:
                text = engine.transcribe(audio, mime_type, model_override)
                json_response(self, 200, {"text": text, "durationMs": int((time.perf_counter() - started) * 1000)})
            except Exception as exc:
                json_response(self, 500, {"ok": False, "message": str(exc)})

        def log_message(self, fmt: str, *args: Any) -> None:
            # Avoid logging request bodies or transcript text. Keep minimal route logs.
            print(f"{self.client_address[0]} {self.command} {urlparse(self.path).path} {fmt % args}")

    return Handler


def main() -> None:
    args = parse_args()
    engine = AsrEngine(args)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine))
    print(f"Pi GUI ASR wrapper listening on http://{args.host}:{args.port}")
    if args.model:
        print("ASR model configured")
    else:
        print("ASR model not configured; pass --model or PI_GUI_VOICE_MODEL_PATH")
    server.serve_forever()


if __name__ == "__main__":
    main()
