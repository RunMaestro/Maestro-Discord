# Voice transcription

Voice messages posted in agent channels are transcribed locally with [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and forwarded to the agent as text. The original audio file is **not** sent to the agent — only the transcribed text — and a `🎧` reaction marks the message while transcription runs.

If the dependencies below are missing, the bridge starts normally and voice messages fall through to the regular attachment path with a one-line advisory. No other functionality is affected.

> **Provider scope**: today only the [Discord provider](discord.md) emits voice messages (via Discord's `IsVoiceMessage` flag). Future providers can opt in by mapping their own voice-flag attachments to `IncomingMessage.attachments[].isVoice` and reusing `src/core/transcription.ts`.

## Behavior

- Only messages flagged as voice by the platform (Discord: `IsVoiceMessage`) are transcribed. Bare `.ogg` uploads go through the normal attachment path.
- Voice attachments larger than 25 MB are rejected up-front (the per-channel queue would otherwise be blocked for several minutes of ffmpeg/whisper work).
- Mixed messages (voice + image/file) are supported: transcription is forwarded as text and non-voice attachments are downloaded for the agent as usual.

## Setup — production install

1. Install `ffmpeg` and `whisper-cli` on your `PATH` **before** running the installer:

   - **macOS** (Homebrew): `brew install ffmpeg whisper-cli`
   - **Linux/Windows**: install ffmpeg via your package manager; build whisper-cli from the [whisper.cpp](https://github.com/ggerganov/whisper.cpp) repo (then symlink the binary into `~/.local/bin`) or use [Linuxbrew](https://docs.brew.sh/Homebrew-on-Linux).

2. Run the installer one-liner. It detects both binaries on `PATH` and asks whether to enable voice. If you say yes, it asks whether you already have a `ggml-*.bin` model — paste the absolute path to reuse it, or let it download `ggml-base.en.bin` (~142 MB) into `~/.local/share/maestro-relay/models/`.

   Resolved **absolute** paths are written into `~/.config/maestro-relay/.env` so the systemd/launchd service finds them regardless of `PATH`.

3. Non-interactive escape hatches:

```bash
MAESTRO_RELAY_VOICE=1 \
MAESTRO_RELAY_MODEL=/abs/path/to/ggml-base.en.bin \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/RunMaestro/Maestro-Relay/main/install.sh)"
```

   `MAESTRO_RELAY_VOICE=0` opts out; omitting `MAESTRO_RELAY_MODEL` triggers the download.

## Setup — source install

There's no wizard. Download a model and set the paths yourself:

```bash
mkdir -p ./models
curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# in .env (use `which ffmpeg` / `which whisper-cli` for absolute paths):
FFMPEG_PATH=/usr/bin/ffmpeg
WHISPER_CLI_PATH=/home/you/.local/bin/whisper-cli
WHISPER_MODEL_PATH=models/ggml-base.en.bin
```

## Configuration

| Key                  | Default                     | Purpose                                          |
| -------------------- | --------------------------- | ------------------------------------------------ |
| `FFMPEG_PATH`        | `ffmpeg`                    | Path to ffmpeg binary                            |
| `WHISPER_CLI_PATH`   | `whisper-cli`               | Path to whisper-cli binary                       |
| `WHISPER_MODEL_PATH` | `models/ggml-base.en.bin`   | Path to a whisper `.bin` model                   |
| `WHISPER_LANGUAGE`   | `auto`                      | Whisper language code, or `auto` for detection   |

The bridge probes these at startup; any missing piece is logged as `⚠️ Transcription disabled: …` and transcription is skipped at runtime.
