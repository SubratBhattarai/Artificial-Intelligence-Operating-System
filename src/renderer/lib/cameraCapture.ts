import { sharpnessOf } from '../../shared/frameQuality';
import { useCamera } from '../state/cameraStore';

const SETTLE_MS = 600;
const FRAME_GAP_MS = 180;
const FRAMES = 3;
const MAX_WIDTH = 1024;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Takes a few frames a moment apart and keeps the sharpest, so motion blur and focus hunting do not ruin a scan. */
export async function grabBestFrame(video: HTMLVideoElement): Promise<string> {
  const sourceWidth = video.videoWidth || MAX_WIDTH;
  const scale = Math.min(1, MAX_WIDTH / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round((video.videoHeight || 720) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not read the camera picture.');
  let best = '';
  let bestScore = -1;
  for (let frame = 0; frame < FRAMES; frame += 1) {
    context.drawImage(video, 0, 0, width, height);
    const score = sharpnessOf(context.getImageData(0, 0, width, height).data, width, height);
    if (score > bestScore) {
      bestScore = score;
      best = canvas.toDataURL('image/jpeg', 0.9);
    }
    if (frame < FRAMES - 1) await wait(FRAME_GAP_MS);
  }
  return best;
}

/**
 * Grab one JPEG frame for JARVIS. Goes through the same camera store as the Camera app, so the
 * CAMERA indicator shows, the permission switch is honoured, and the camera is released afterwards
 * (unless the Camera app already had it on).
 */
export async function captureOneFrame(): Promise<string> {
  const camera = useCamera.getState();
  const wasOn = camera.status === 'on';
  if (!wasOn) await camera.start();
  const { stream, error } = useCamera.getState();
  if (!stream) throw new Error(error ?? 'The camera is off.');
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await wait(wasOn ? 150 : SETTLE_MS);
    const frame = await grabBestFrame(video);
    video.srcObject = null;
    return frame;
  } finally {
    if (!wasOn) useCamera.getState().stop();
  }
}

export function listenForCaptureRequests(): (() => void) | undefined {
  return window.aios?.awareness.onCaptureRequest((id) => {
    captureOneFrame().then(
      (dataUrl) => void window.aios?.awareness.sendCapture(id, dataUrl),
      (err: unknown) =>
        void window.aios?.awareness.sendCapture(
          id,
          null,
          err instanceof Error ? err.message : 'Camera capture failed.',
        ),
    );
  });
}
