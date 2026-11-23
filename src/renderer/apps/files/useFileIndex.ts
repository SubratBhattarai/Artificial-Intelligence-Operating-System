import { useCallback, useEffect, useState } from 'react';
import type { FileIndexOverview, IndexProgress } from '../../../shared/protocol';
import { errorText } from '../../lib/format';

export interface FileIndexController {
  overview: FileIndexOverview | null;
  progress: IndexProgress | null;
  error: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  addFolder: () => Promise<void>;
  removeFolder: (folder: string) => Promise<void>;
  reindex: (folder?: string) => Promise<void>;
  cancel: () => Promise<void>;
  clearError: () => void;
}

/** Shared view of the file index for every tab of the Files app. */
export function useFileIndex(): FileIndexController {
  const api = window.aios;
  const [overview, setOverview] = useState<FileIndexOverview | null>(null);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const next = await api.files.overview();
      setOverview(next);
      setProgress((current) => current ?? (next.progress.phase === 'idle' ? null : next.progress));
    } catch (err) {
      setError(errorText(err));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    if (!api) return;
    return api.files.onProgress((next) => {
      setProgress(next);
      if (next.phase !== 'scanning') void refresh();
    });
  }, [api, refresh]);

  const guard = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(errorText(err));
      }
      await refresh();
    },
    [refresh],
  );

  return {
    overview,
    progress,
    error,
    busy: progress?.phase === 'scanning',
    refresh,
    addFolder: () => guard(() => api!.files.pickFolder()),
    removeFolder: (folder) => guard(() => api!.files.removeFolder(folder)),
    reindex: (folder) => guard(() => api!.files.reindex(folder)),
    cancel: () => guard(() => api!.files.cancelIndex()),
    clearError: () => setError(null),
  };
}
