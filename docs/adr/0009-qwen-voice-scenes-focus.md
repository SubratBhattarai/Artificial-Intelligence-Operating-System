# ADR 0009 — Qwen3-TTS voice, Scenes, Focus mode

## Decisions
- **Qwen3-TTS is optional and local.** It runs in a small Python helper (`tts/qwen_server.py`) inside a private virtual environment under `<userData>/tts`. AI OS starts it with an argument list (no shell), it listens on `127.0.0.1` on a random port, and every request needs a per-run random token.
- **Voice = a clip you choose.** Qwen3-TTS has no female American English preset (its English presets are male), so the Base model clones a 5–10 s reference clip you supply. Use only a voice you have the right to use. An optional transcript improves quality.
- **Models:** "Fast" = Qwen3-TTS-12Hz-0.6B-Base (CPU-friendly), "Best" = 1.7B-Base (strong NVIDIA GPU). The helper uses CUDA when PyTorch sees it, otherwise the CPU.
- **Never keeps you waiting.** Text is split into short chunks and the next chunk is prepared while one plays. If the first chunk is not ready within 5 s, the whole reply is spoken by the Windows voice; a later chunk that stalls (9 s) falls back for that chunk only. Settings shows compute-per-second-of-speech so you can see whether your computer keeps up.
- **Downloads:** setup runs `pip install qwen-tts soundfile` (about 3 GB) only when you press Set up; the first start downloads the model from Hugging Face into `<userData>/tts/hf`. After that it works offline. Packages come from PyPI, so this is a supply-chain trust step you take knowingly.
- **CSP** now allows `blob:` for media only (to play the generated audio).
- **Scenes** are saved lists of simple steps (open/close an approved app, set volume/brightness). There is deliberately no terminal step. `list_scenes` only reads them; JARVIS performs a scene step by step with the normal tools, so every step still needs your approval and its real result.
- **Focus mode** is a timer handled by code ("Jarvis, focus for 25 minutes", "stop focus"): spoken start, halfway and end, a FOCUS pill, and toasts held back (security alerts still show).
- **Speed:** each chat turn now shows the model only the tools that match the request, keeps the model loaded, caps context and reply length, and warms the model at launch.

## Known limits
Qwen3-TTS on CPU is not documented by its authors and is untested here: expect it to fall back to the Windows voice on slower machines. Not run on real Windows yet: helper install, model download and playback.
