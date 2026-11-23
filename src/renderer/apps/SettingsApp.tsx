import { useState } from 'react';
import type { ReactElement } from 'react';
import { resetLayout } from '../state/windowStore';
import { useChat } from '../state/chatStore';
import { useContextGrant } from '../state/contextStore';
import { sortVoices, useSystemVoices } from '../lib/voices';
import { useVoice } from '../state/voiceStore';
import { AppTabs } from './appKit';
import { DisplayPanel } from './settings/DisplayPanel';
import { PermissionsPanel } from './settings/PermissionsPanel';
import { StoragePanel } from './settings/StoragePanel';
import { TtsPanel } from './settings/TtsPanel';
import { WakePanel } from './settings/WakePanel';
import type { ShellAppProps } from './types';

type SettingsTab = 'permissions' | 'voice' | 'display' | 'data' | 'general';
const TABS: Array<[SettingsTab, string]> = [
  ['permissions', 'Permissions'],
  ['voice', 'Voice'],
  ['display', 'Display'],
  ['data', 'Data & storage'],
  ['general', 'General'],
];

const SHORTCUTS: Array<[string, string]> = [
  ['Alt + Space', 'Summon / dismiss JARVIS'],
  ['Ctrl + Space', 'Open / close the app launcher'],
  ['Ctrl + Shift + ← / →', 'Cycle window focus'],
  ['Ctrl + Shift + ↑', 'Maximize / restore focused window'],
  ['Ctrl + Shift + M', 'Minimize focused window'],
  ['Ctrl + Shift + W', 'Close focused window'],
  ['Escape', 'Close launcher / JARVIS'],
];

export function SettingsApp(_props: ShellAppProps): ReactElement {
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<SettingsTab>('permissions');
  const voiceConfig = useVoice((state) => state.config);
  const prefs = useVoice((state) => state.prefs);
  const setPref = useVoice((state) => state.setPref);
  const setModel = useVoice((state) => state.setModel);
  const prepareModel = useVoice((state) => state.prepareModel);
  const previewVoice = useVoice((state) => state.previewVoice);
  const modelProgress = useVoice((state) => state.modelProgress);
  const voices = sortVoices(useSystemVoices());
  const activeModel = voiceConfig?.models.find((model) => model.id === voiceConfig.sttModel);
  const contextOn = useContextGrant((state) => state.windows);
  const setContext = useContextGrant((state) => state.setWindows);

  return (
    <div className="mem">
      <AppTabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="tab-body">
        <div className="app-pad">
          {tab === 'permissions' && (
            <>
              <PermissionsPanel />
              <section className="card">
                <h3>Context access</h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={contextOn}
                    onChange={(event) => void setContext(event.target.checked)}
                  />
                  Let JARVIS see which windows are open (this session only)
                </label>
                <p className="hint">
                  Off at every launch. Only app names and window titles are shared; screen contents
                  are never captured.
                </p>
              </section>
            </>
          )}
          {tab === 'voice' && (
            <>
              <WakePanel />
              <TtsPanel />
              <section className="card">
                <h3>Voice input</h3>
                {voiceConfig?.sttConfigured ? (
                  <>
                    <div className="form-row">
                      <select
                        className="select grow"
                        value={voiceConfig.sttModel}
                        onChange={(event) => void setModel(event.target.value)}
                        aria-label="Speech recognition model"
                      >
                        {voiceConfig.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label} · {model.sizeMb} MB
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn"
                        disabled={modelProgress !== null}
                        onClick={() => void prepareModel()}
                      >
                        {voiceConfig.modelCached ? 'Reload model' : 'Download now'}
                      </button>
                    </div>
                    <p className="hint">
                      {activeModel?.note} Speech recognition runs entirely on this device
                      {voiceConfig.modelCached
                        ? ' and the model is already stored, so voice works offline.'
                        : '; the model downloads once, then works offline.'}
                    </p>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={voiceConfig.keepLoaded}
                        onChange={(event) =>
                          void window.aios?.voice
                            .setKeepLoaded(event.target.checked)
                            .then(() => useVoice.getState().loadConfig())
                        }
                      />
                      <span>Keep the voice model loaded (no waiting between uses)</span>
                    </label>
                    <p className="hint">
                      Stored on this computer at{' '}
                      <span className="mono">{voiceConfig.cacheDir}</span>
                      {' · '}
                      {voiceConfig.modelCached ? 'downloaded' : 'not downloaded yet'}
                      {' · '}
                      {voiceConfig.loaded ? 'ready in memory' : 'not loaded'}. After the first
                      download it is read from disk only and never fetched again.
                    </p>
                    {modelProgress && (
                      <div className="progress-bar" aria-label="Model download progress">
                        <span
                          style={
                            modelProgress.percent === null
                              ? undefined
                              : { width: `${modelProgress.percent}%`, animation: 'none' }
                          }
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="hint">
                    The speech engine is not installed yet. Run{' '}
                    <span className="mono">npm install</span> and restart; typing still works.
                  </p>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.autoSend}
                    onChange={(event) => setPref('autoSend', event.target.checked)}
                  />
                  Send transcript automatically (otherwise review it first)
                </label>
                <p className="hint">
                  Hold the mic button or F8 for push-to-talk. For hands-free use, turn on “Jarvis”
                  voice activation above.
                </p>
              </section>
              <section className="card">
                <h3>Voice replies</h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.speakReplies}
                    onChange={(event) => setPref('speakReplies', event.target.checked)}
                  />
                  Read JARVIS replies aloud
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.muted}
                    onChange={(event) => setPref('muted', event.target.checked)}
                  />
                  Mute all speech output
                </label>
                <div className="form-row voice-pick">
                  <select
                    className="select grow"
                    value={prefs.voiceUri ?? ''}
                    onChange={(event) => setPref('voiceUri', event.target.value || null)}
                    aria-label="Reply voice"
                  >
                    <option value="">Best match (female, US English)</option>
                    {voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={previewVoice}>
                    Play sample
                  </button>
                </div>
                <label className="slider-row">
                  <span>Speed</span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.6}
                    step={0.05}
                    value={prefs.rate}
                    onChange={(event) => setPref('rate', Number(event.target.value))}
                  />
                  <span className="mono">{prefs.rate.toFixed(2)}×</span>
                </label>
                <label className="slider-row">
                  <span>Pitch</span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.6}
                    step={0.05}
                    value={prefs.pitch}
                    onChange={(event) => setPref('pitch', Number(event.target.value))}
                  />
                  <span className="mono">{prefs.pitch.toFixed(2)}</span>
                </label>
                <p className="hint">
                  These are the voices installed in Windows. To add more natural ones, open Windows
                  Settings › Time &amp; language › Speech › Manage voices, install one, then reopen
                  this list.
                </p>
              </section>
            </>
          )}
          {tab === 'display' && <DisplayPanel />}
          {tab === 'data' && (
            <>
              <StoragePanel />
              <section className="card">
                <h3>Window &amp; chat</h3>
                <div className="row">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      resetLayout();
                      setNotice('Window layout cleared — applies on next launch.');
                    }}
                  >
                    Reset window layout
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      useChat.getState().clear();
                      setNotice(
                        'Chat view cleared and a new session started. Saved memory is unchanged.',
                      );
                    }}
                  >
                    Clear chat view
                  </button>
                </div>
                {notice && <p className="hint">{notice}</p>}
                <p className="hint">
                  Window positions are stored in the browser profile; conversations and memory are
                  saved in your app data folder and managed in the Memory app.
                </p>
              </section>
            </>
          )}
          {tab === 'general' && (
            <>
              <section className="card">
                <h3>Keyboard shortcuts</h3>
                <table className="table">
                  <tbody>
                    {SHORTCUTS.map(([keys, description]) => (
                      <tr key={keys}>
                        <td className="mono">{keys}</td>
                        <td>{description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="card">
                <h3>Assistant</h3>
                <p>JARVIS runs privately on this computer.</p>
                <p className="hint">
                  Nothing leaves AI OS unless you turn on Internet in Permissions and approve an
                  address. Nothing here costs money.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
