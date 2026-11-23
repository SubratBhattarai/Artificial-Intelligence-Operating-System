export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDateTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString([], { dateStyle: 'medium' });
}

export function formatRelative(ms: number, now = Date.now()): string {
  const seconds = Math.round((now - ms) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(ms);
}

/** m:ss for recording timers. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Split a path into clickable segments (works for both Windows and POSIX separators). */
export function pathSegments(fullPath: string): Array<{ label: string; path: string }> {
  const separator = fullPath.includes('\\') ? '\\' : '/';
  const parts = fullPath.split(/[\\/]/);
  const segments: Array<{ label: string; path: string }> = [];
  let accumulated = '';
  parts.forEach((part, index) => {
    if (index === 0) {
      accumulated = part === '' ? separator : part;
      segments.push({
        label: part === '' ? separator : part,
        path: part === '' ? separator : `${part}${separator}`,
      });
      return;
    }
    if (part === '') return;
    accumulated = accumulated.endsWith(separator)
      ? `${accumulated}${part}`
      : `${accumulated}${separator}${part}`;
    segments.push({ label: part, path: accumulated });
  });
  return segments;
}

export function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(separator) ? `${folder}${name}` : `${folder}${separator}${name}`;
}
