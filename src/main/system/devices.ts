/** Windows volume and brightness, through fixed PowerShell scripts that only ever embed validated integers. */

const AUDIO_TYPE = String.raw`
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-46B6-9CCE-4D1260F9F8E5")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); }
  }
  public static bool Mute {
    get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); }
  }
}
`;

function percent(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100)
    throw new Error('The level must be a whole number from 0 to 100.');
  return value;
}

/** Sets and/or reads volume. Output is "<volume 0-100>|<muted true/false>". */
export function volumeScript(change: { level?: number; mute?: boolean }): string {
  const lines = [`Add-Type -TypeDefinition @'${AUDIO_TYPE}'@`];
  if (change.level !== undefined)
    lines.push(`[Audio]::Volume = ${(percent(change.level) / 100).toFixed(2)}`);
  if (change.mute !== undefined) lines.push(`[Audio]::Mute = $${change.mute ? 'true' : 'false'}`);
  lines.push(
    'Write-Output (([math]::Round([Audio]::Volume * 100)).ToString() + "|" + [Audio]::Mute.ToString().ToLower())',
  );
  return lines.join('\n');
}

export function parseVolume(output: string): { level: number; muted: boolean } | null {
  const match = output
    .trim()
    .split(/\r?\n/)
    .pop()
    ?.match(/^(\d{1,3})\|(true|false)$/);
  return match ? { level: Number(match[1]), muted: match[2] === 'true' } : null;
}

/** Sets (when a level is given) and reads brightness. Output is the current 0-100 value. */
export function brightnessScript(level?: number): string {
  const lines: string[] = [];
  if (level !== undefined) {
    lines.push(
      `Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${percent(level)}} | Out-Null`,
    );
  }
  lines.push(
    'Write-Output ((Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness)',
  );
  return lines.join('\n');
}

export function parseBrightness(output: string): number | null {
  const last = output.trim().split(/\r?\n/).pop() ?? '';
  return /^\d{1,3}$/.test(last) ? Number(last) : null;
}

/** tasklist /FO CSV /NH output: true when the image name is listed. */
export function isProcessRunning(csv: string, imageName: string): boolean {
  const wanted = imageName.toLowerCase();
  return csv
    .split(/\r?\n/)
    .some((line) => (line.match(/^"([^"]+)"/)?.[1] ?? '').toLowerCase() === wanted);
}
