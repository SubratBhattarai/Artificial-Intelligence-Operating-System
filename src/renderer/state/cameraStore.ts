import { create } from 'zustand';
import { usePermissions } from './permissionStore';

interface CameraState {
  stream: MediaStream | null;
  status: 'off' | 'starting' | 'on' | 'error';
  error: string | null;
  start: () => Promise<void>;
  /** Releases the camera at once. */
  stop: () => void;
}

function friendly(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The camera was blocked. Check Settings › Permissions and Windows privacy settings.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return 'Could not start the camera.';
}

let startToken = 0;

export const useCamera = create<CameraState>((set, get) => ({
  stream: null,
  status: 'off',
  error: null,

  async start() {
    if (get().status === 'on' || get().status === 'starting') return;
    if (usePermissions.getState().levels.camera !== 'write') {
      set({ status: 'error', error: 'Camera is off. Turn it on in Settings › Permissions.' });
      return;
    }
    startToken += 1;
    const token = startToken;
    set({ status: 'starting', error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (token !== startToken) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => get().stop());
      set({ stream, status: 'on' });
    } catch (error) {
      set({ status: 'error', error: friendly(error), stream: null });
    }
  },

  stop() {
    startToken += 1;
    get()
      .stream?.getTracks()
      .forEach((track) => track.stop());
    set({ stream: null, status: 'off' });
  },
}));

// The camera switches off the moment its permission does.
usePermissions.subscribe((state) => {
  if (state.levels.camera !== 'write' && useCamera.getState().status !== 'off') {
    useCamera.getState().stop();
  }
});
