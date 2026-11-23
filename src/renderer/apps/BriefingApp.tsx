import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useBriefing } from '../state/briefingStore';
import { useVoice } from '../state/voiceStore';
import { Banners } from './appKit';

export function BriefingApp(): ReactElement {
  const { briefing, loading, error, settings, load, readAloud, loadSettings, saveSettings } =
    useBriefing();
  const stopSpeaking = useVoice((state) => state.stopSpeaking);
  const speaking = useVoice((state) => state.speaking);
  const [city, setCity] = useState('');
  const [feeds, setFeeds] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void load();
    void loadSettings();
  }, [load, loadSettings]);
  useEffect(() => {
    if (!settings) return;
    setCity(settings.city);
    setFeeds(settings.feeds.join('\n'));
  }, [settings]);

  return (
    <div className="app-pad">
      <div className="row">
        <h3>{briefing ? briefing.greeting : 'Daily briefing'}</h3>
        <span className="hud-spacer" />
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
          {loading ? 'Gathering…' : 'Refresh'}
        </button>
        {speaking ? (
          <button type="button" className="btn" onClick={stopSpeaking}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={loading}
            onClick={() => void readAloud()}
          >
            Read aloud
          </button>
        )}
      </div>
      <Banners error={error} notice={saved} />
      {briefing?.sections.map((section) => (
        <section key={section.id} className="card">
          <h4>{section.title}</h4>
          {section.unavailable ? (
            <p className="hint">{section.unavailable}</p>
          ) : (
            <ul className="brief-list">
              {section.lines.map((line, index) => (
                <li key={`${section.id}-${index}`}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <section className="card">
        <h4>Briefing settings</h4>
        <p className="hint">
          Weather and news use public sources and need Web access in Settings › Permissions.
          Headlines are shown as titles only. Say “Jarvis, briefing” any time.
        </p>
        <div className="form-row">
          <label>Your city</label>
          <input
            value={city}
            placeholder="e.g. Dubuque"
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label>News feeds (https, one per line, up to 3)</label>
          <textarea rows={3} value={feeds} onChange={(e) => setFeeds(e.target.value)} />
        </div>
        <div className="form-row">
          <label>
            <input
              type="checkbox"
              checked={settings?.atLaunch ?? true}
              onChange={(e) =>
                settings && void saveSettings({ ...settings, atLaunch: e.target.checked })
              }
            />{' '}
            Offer my briefing once a day when AI OS opens
          </label>
        </div>
        <div className="form-row">
          <label>Units</label>
          <select
            value={settings?.units ?? 'imperial'}
            onChange={(e) =>
              settings &&
              void saveSettings({ ...settings, units: e.target.value as 'imperial' | 'metric' })
            }
          >
            <option value="imperial">°F</option>
            <option value="metric">°C</option>
          </select>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!settings}
            onClick={() =>
              settings &&
              void saveSettings({
                ...settings,
                city,
                feeds: feeds
                  .split('\n')
                  .map((f) => f.trim())
                  .filter(Boolean),
              }).then(() => {
                setSaved('Saved.');
                void load();
              })
            }
          >
            Save
          </button>
        </div>
      </section>
    </div>
  );
}
