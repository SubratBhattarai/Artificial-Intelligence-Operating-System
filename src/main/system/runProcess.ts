import { execFile } from 'node:child_process';

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export const MAX_OUTPUT_BYTES = 20_000;

export type ProcessRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ProcessResult>;

/** Run one program with an argument list (never through a shell string), time-limited and size-capped. */
export const runProcess: ProcessRunner = (file, args, options = {}) =>
  new Promise((resolve) => {
    let truncated = false;
    const child = execFile(
      file,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: MAX_OUTPUT_BYTES * 4,
        windowsHide: true,
        signal: options.signal,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const cap = (text: string): string => {
          if (text.length > MAX_OUTPUT_BYTES) {
            truncated = true;
            return `${text.slice(0, MAX_OUTPUT_BYTES)}\n…[output cut]`;
          }
          return text;
        };
        const code = (error as (NodeJS.ErrnoException & { code?: number | string }) | null)?.code;
        resolve({
          exitCode: error ? (typeof code === 'number' ? code : null) : 0,
          stdout: cap(stdout ?? ''),
          stderr: cap(stderr ?? ''),
          timedOut: Boolean(
            error && (error as { killed?: boolean }).killed && !options.signal?.aborted,
          ),
          truncated,
        });
      },
    );
    child.on('error', () => undefined);
  });

/** Run a fixed PowerShell script. Scripts are built only from constants and validated integers. */
export function runPowerShell(
  script: string,
  runner: ProcessRunner = runProcess,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ProcessResult> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return runner(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    options,
  );
}

/** A terminal command the user has approved, run in PowerShell with a time limit and output cap. */
export function runApprovedCommand(
  command: string,
  cwd: string,
  options: { timeoutMs: number; signal?: AbortSignal },
  runner: ProcessRunner = runProcess,
): Promise<ProcessResult> {
  return runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}
