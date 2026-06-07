# Third-party dependencies and provenance

This wrapper is Pi GUI glue code for local speech-to-text services. It does not
bundle CapsWriter Offline, ASR model weights, PyTorch wheels, ffmpeg binaries, or
third-party source trees. Users install or provide those components separately.

This file is a practical provenance checklist, not legal advice. Before
redistributing this wrapper together with any dependency, binary, or model,
review the upstream license and model card for the exact version you distribute.

## Runtime integrations

| Component | Upstream | How Pi GUI uses it | Bundled here? | Compliance notes |
| --- | --- | --- | --- | --- |
| CapsWriter Offline | https://github.com/HaujetZhao/CapsWriter-Offline | Optional user-installed Windows server launched via `start_server.exe` or reached through its WebSocket endpoint. | No | Pi GUI implements protocol compatibility only. Do not redistribute CapsWriter binaries, models, or copied source without carrying the upstream license and notices. |
| FunASR | https://github.com/modelscope/FunASR | Optional Python package imported as `funasr.AutoModel`. | No | Installed by the user with `pip`. Include upstream license/notice if you package a Python environment. |
| ModelScope | https://github.com/modelscope/modelscope | Optional model/package resolution layer used by FunASR. | No | Model downloads and cached artifacts have their own terms; check each model card. |
| SenseVoice / `iic/SenseVoiceSmall` | https://www.modelscope.cn/models/iic/SenseVoiceSmall | Example/recommended ASR model id. | No | Model weights are not in this repository. Review the model card/license before commercial use or redistribution. |
| `fsmn-vad` | Model alias resolved by FunASR/ModelScope | Optional VAD model passed to FunASR for long utterances. | No | Review the resolved model artifact/license for the installed FunASR/ModelScope version. |
| PyTorch / torchaudio | https://pytorch.org/ | User-installed CPU/GPU runtime required by the FunASR stack. | No | Follow PyTorch installation and license terms for the exact wheel/build. |
| numpy | https://numpy.org/ | Native recording array processing and PCM conversion. | No | Installed by the user with `pip`; include dependency notices if packaged. |
| sounddevice / PortAudio | https://python-sounddevice.readthedocs.io/ / https://www.portaudio.com/ | Optional native microphone recording. | No | Requires native PortAudio support on the wrapper host. Include notices if packaged. |
| soundfile | https://python-soundfile.readthedocs.io/ | Listed Python dependency for audio stacks. | No | If kept in packaged environments, include dependency notices. |
| websockets | https://websockets.readthedocs.io/ | CapsWriter WebSocket client. | No | Installed by the user with `pip`; include dependency notices if packaged. |
| ffmpeg | https://ffmpeg.org/ | External command for audio conversion and WSLg PulseAudio recording fallback. | No | Current wrapper only shells out to a user/system install. If bundled later, choose a compatible build and include the required LGPL/GPL notices. |

## Security notes

- The FunASR path currently enables `trust_remote_code=True` when loading model
  identifiers. Remote model repositories can execute code during loading. For
  stricter environments, use a locally reviewed model directory instead of a
  remote model id.
- CapsWriter mode talks to a local/user-provided WebSocket service. Keep it on
  trusted loopback/private networks and avoid exposing it to untrusted clients.

## If code is derived from upstream examples

If any wrapper function is copied or adapted from upstream examples/source, add a
comment near that function naming the source URL/file and license, and copy the
required license/notice text into this file or a repository-level `NOTICE.md`.
