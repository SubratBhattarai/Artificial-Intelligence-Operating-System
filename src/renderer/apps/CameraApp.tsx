import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { PhotoInfo } from '../../shared/platform';
import { ConfirmButton } from '../components/ConfirmButton';
import { errorText, formatDateTime } from '../lib/format';
import { usePermissions } from '../state/permissionStore';
import { useCamera } from '../state/cameraStore';
import { captureOneFrame } from '../lib/cameraCapture';
import { Banners, useRunner } from './appKit';

function Thumb({ name }: { name: string }): ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void window.aios?.photos
      .read(name)
      .then((url) => alive && setSrc(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [name]);
  return src ? (
    <img src={src} alt={name} className="photo-thumb" />
  ) : (
    <div className="photo-thumb" />
  );
}

export function CameraApp(): ReactElement {
  const api = window.aios;
  const { stream, status, error: cameraError, start, stop } = useCamera();
  const level = usePermissions((state) => state.levels.camera);
  const setPermission = usePermissions((state) => state.set);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [question, setQuestion] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{
    description: string;
    visibleText: string;
    model: string;
  } | null>(null);

  const reload = useCallback(async () => {
    if (api) setPhotos(await api.photos.list());
  }, [api]);
  const { error, notice, setError, run } = useRunner(reload);

  useEffect(() => {
    void reload().catch((err) => setError(errorText(err)));
  }, [reload, setError]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = stream;
  }, [stream]);

  // The camera never stays on when the window is closed.
  useEffect(() => () => useCamera.getState().stop(), []);

  if (!api) return <div className="banner error">Backend bridge unavailable.</div>;

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    void run(
      () => api.photos.save(canvas.toDataURL('image/jpeg', 0.92)),
      'Photo saved inside AI OS.',
    );
  };

  const scanNow = () => {
    setScanning(true);
    setScan(null);
    setError(null);
    captureOneFrame()
      .then((frame) => api.awareness.scan(frame, question))
      .then(setScan)
      .catch((err) => setError(errorText(err)))
      .finally(() => setScanning(false));
  };

  return (
    <div className="app-pad">
      <Banners error={error ?? cameraError} notice={notice} />
      {level !== 'write' ? (
        <section className="card">
          <p>The camera is off. AI OS can only use it after you allow it.</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => void setPermission('camera', 'write').then(() => start())}
          >
            Allow camera
          </button>
        </section>
      ) : (
        <section className="card">
          <video ref={videoRef} autoPlay muted playsInline className="camera-view" />
          <div className="row">
            {status === 'on' ? (
              <>
                <button type="button" className="btn primary" onClick={capture}>
                  Take photo
                </button>
                <button type="button" className="btn" onClick={stop}>
                  Stop camera
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={status === 'starting'}
                onClick={() => void start()}
              >
                {status === 'starting' ? 'Starting…' : 'Start camera'}
              </button>
            )}
          </div>
        </section>
      )}
      {level === 'write' && status === 'on' && (
        <section className="card">
          <h3>Scan what the camera sees</h3>
          <p className="hint">
            Hold an object close, steady and well lit. A local model describes it and reads any
            printed words. Nothing is saved or sent anywhere.
          </p>
          <div className="row">
            <input
              className="input grow"
              value={question}
              maxLength={200}
              placeholder="Optional: what should I look for? e.g. what am I holding?"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button type="button" className="btn primary" disabled={scanning} onClick={scanNow}>
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
          </div>
          {scanning && (
            <div className="skeleton-lines" aria-hidden>
              <span />
              <span />
              <span />
            </div>
          )}
          {scan && (
            <div className="scan-result">
              <p>{scan.description}</p>
              {scan.visibleText && <p className="hint">Printed text: {scan.visibleText}</p>}
              <p className="hint">Model: {scan.model}</p>
            </div>
          )}
        </section>
      )}
      <section className="card">
        <h3>Photos</h3>
        {photos.length === 0 && (
          <p className="hint">No photos yet. They are stored only inside AI OS.</p>
        )}
        <div className="photo-grid">
          {photos.map((photo) => (
            <figure key={photo.name}>
              <Thumb name={photo.name} />
              <figcaption className="hint">{formatDateTime(photo.takenAt)}</figcaption>
              <ConfirmButton
                label="Delete"
                confirmLabel="Yes"
                onConfirm={() => void run(() => api.photos.remove(photo.name))}
              />
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
