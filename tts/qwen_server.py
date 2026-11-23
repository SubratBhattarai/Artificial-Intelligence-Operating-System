"""Local Qwen3-TTS helper for AI OS.

Listens on 127.0.0.1 only, requires a per-run token, never reaches out except to download the
model files once (Hugging Face) the first time it starts. Speaks in the voice cloned from the
reference clip you chose in Settings.
"""
import argparse
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_CHARS = 700
state = {"ready": False, "loading": True, "device": "", "error": "", "rtf": 0.0}
lock = threading.Lock()
model = None
prompt = None
token = os.environ.get("AIOS_TTS_TOKEN", "")


def normalize_reference(path):
    """Decode WAV/MP3/FLAC/OGG/M4A to a mono WAV the model can read (MP3 needs a recent libsndfile or librosa)."""
    import numpy as np
    import soundfile as sf

    try:
        audio, rate = sf.read(path, dtype="float32", always_2d=False)
    except Exception:
        import librosa

        audio, rate = librosa.load(path, sr=None, mono=True)
    if getattr(audio, "ndim", 1) > 1:
        audio = np.mean(audio, axis=1)
    audio = audio[: int(rate * 30)]  # a few seconds is plenty; cap at 30 s
    out = os.path.splitext(path)[0] + ".converted.wav"
    sf.write(out, audio, rate, subtype="PCM_16")
    return out


def load(args):
    global model, prompt
    try:
        import torch
        from qwen_tts import Qwen3TTSModel

        if torch.cuda.is_available():
            device, dtype = "cuda:0", torch.bfloat16
        else:
            device, dtype = "cpu", torch.float32
            torch.set_num_threads(max(2, min(8, (os.cpu_count() or 4))))
        model = Qwen3TTSModel.from_pretrained(args.model, device_map=device, dtype=dtype)
        ref_text = ""
        if args.ref_text and os.path.exists(args.ref_text):
            with open(args.ref_text, encoding="utf-8") as handle:
                ref_text = handle.read().strip()
        prompt = model.create_voice_clone_prompt(
            ref_audio=normalize_reference(args.ref_audio),
            ref_text=ref_text or None,
            x_vector_only_mode=not ref_text,
        )
        # Warm-up so the first real sentence is not the slow one.
        model.generate_voice_clone(text="Ready.", language="English", voice_clone_prompt=prompt)
        state.update(ready=True, loading=False, device=device)
        print("READY device=" + device, flush=True)
    except Exception as error:  # reported to the app, which falls back to the Windows voice
        state.update(loading=False, error=str(error)[:300])
        print("ERROR " + str(error)[:300], flush=True)


def synthesize(text):
    import numpy as np
    import soundfile as sf

    started = time.time()
    with lock:
        wavs, rate = model.generate_voice_clone(text=text, language="English", voice_clone_prompt=prompt)
    audio = np.asarray(wavs[0], dtype="float32")
    seconds = len(audio) / float(rate) if rate else 0.0
    if seconds > 0:
        state["rtf"] = round((time.time() - started) / seconds, 2)
    buffer = io.BytesIO()
    sf.write(buffer, audio, rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue(), state["rtf"]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep the console quiet
        pass

    def _send(self, code, body, kind="application/json", extra=None):
        self.send_response(code)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        return bool(token) and self.headers.get("x-token") == token

    def do_GET(self):
        if not self._authorized():
            return self._send(403, b"{}")
        if self.path == "/health":
            return self._send(200, json.dumps(state).encode())
        self._send(404, b"{}")

    def do_POST(self):
        if not self._authorized():
            return self._send(403, b"{}")
        if self.path != "/speak" or not state["ready"]:
            return self._send(503 if self.path == "/speak" else 404, b"{}")
        try:
            length = min(int(self.headers.get("content-length", "0")), 8192)
            text = str(json.loads(self.rfile.read(length)).get("text", "")).strip()[:MAX_CHARS]
            if not text:
                return self._send(400, b"{}")
            wav, rtf = synthesize(text)
            self._send(200, wav, "audio/wav", {"x-rtf": str(rtf)})
        except Exception as error:
            self._send(500, json.dumps({"error": str(error)[:200]}).encode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--ref-text", default="")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    print("PORT=" + str(server.server_address[1]), flush=True)
    threading.Thread(target=load, args=(args,), daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
