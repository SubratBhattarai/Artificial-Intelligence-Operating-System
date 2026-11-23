/** Contracts for the optional Qwen3-TTS voice (runs locally in a Python helper). */

export type TtsState = 'not_installed' | 'installing' | 'stopped' | 'starting' | 'ready' | 'error';

export type TtsQuality = 'fast' | 'best';

export interface TtsStatus {
  state: TtsState;
  /** Plain-language line for the Settings panel. */
  message: string;
  /** Last lines of installer or model-download output while busy. */
  log: string[];
  device?: string;
  /** Seconds of compute per second of audio on the last sentence. Under 1 = faster than real time. */
  rtf?: number;
  hasReference: boolean;
  quality: TtsQuality;
  /** Use Qwen3-TTS when it is ready; otherwise (or on any failure) the Windows voice speaks. */
  enabled: boolean;
}

export interface TtsAudio {
  /** WAV bytes. */
  wav: Uint8Array;
  rtf: number;
}
