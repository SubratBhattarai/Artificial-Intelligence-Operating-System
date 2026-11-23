import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { EventRecord } from '../../shared/apps';
import { ConfirmButton } from '../components/ConfirmButton';
import { AppTabs, Banners, describeExport, describeImport, todayString, useRunner } from './appKit';
import type { ShellAppProps } from './types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function timeLabel(event: EventRecord): string {
  if (event.allDay) return 'All day';
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${new Date(event.start).toLocaleTimeString([], options)} – ${new Date(event.end).toLocaleTimeString([], options)}`;
}

export function CalendarApp(_props: ShellAppProps): ReactElement {
  const api = window.aios;
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(todayString());
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');

  // Grid always shows 6 weeks starting on the Sunday on/before the 1st.
  const gridStart = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    return start;
  }, [cursor]);

  const reload = useCallback(async () => {
    if (!api) return;
    const end = new Date(gridStart);
    end.setDate(end.getDate() + 42);
    setEvents(await api.events.list({ from: gridStart.getTime(), to: end.getTime() }));
  }, [api, gridStart]);
  const { error, notice, setNotice, setError, run } = useRunner(reload);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload, setError]);

  if (!api) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  const byDay = new Map<string, EventRecord[]>();
  for (const event of events) {
    const key = dayKey(new Date(event.start));
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(date.getDate() + index);
    return date;
  });
  const today = todayString();
  const dayEvents = events.filter((event) => dayKey(new Date(event.start)) === selected);

  const shift = (months: number) =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + months, 1));

  const add = () => {
    if (!title.trim()) return;
    void run(async () => {
      const start = new Date(`${selected}T${allDay ? '00:00' : startTime}`).getTime();
      const end = allDay ? undefined : new Date(`${selected}T${endTime}`).getTime();
      await api.events.create({ title, start, end, allDay, location });
      setTitle('');
      setLocation('');
    });
  };

  return (
    <div className="mem">
      <AppTabs
        tabs={[['month', cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })]]}
        value="month"
        onChange={() => undefined}
        trailing={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => shift(-1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const now = new Date();
                setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                setSelected(today);
              }}
            >
              Today
            </button>
            <button type="button" className="btn" onClick={() => shift(1)} aria-label="Next month">
              ›
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void run(async () => {
                  const result = await api.events.importIcs();
                  setNotice(describeImport(result) || null);
                }, undefined)
              }
            >
              Import .ics
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void (async () => {
                  try {
                    setNotice(describeExport(await api.events.exportIcs()) || null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                })()
              }
            >
              Export .ics
            </button>
          </>
        }
      />
      <Banners error={error} notice={notice} />
      <div className="cal-layout">
        <div className="cal-grid" role="grid">
          {WEEKDAYS.map((name) => (
            <div key={name} className="cal-head">
              {name}
            </div>
          ))}
          {days.map((date) => {
            const key = dayKey(date);
            const count = byDay.get(key)?.length ?? 0;
            return (
              <button
                key={key}
                type="button"
                className={`cal-day ${date.getMonth() !== cursor.getMonth() ? 'dim' : ''} ${
                  key === today ? 'today' : ''
                } ${key === selected ? 'selected' : ''}`}
                onClick={() => setSelected(key)}
                aria-label={`${key}, ${count} events`}
              >
                <span>{date.getDate()}</span>
                {count > 0 && <i className="cal-dot">{count > 1 ? count : ''}</i>}
              </button>
            );
          })}
        </div>
        <div className="cal-side">
          <h3 className="cal-selected">
            {new Date(`${selected}T00:00:00`).toLocaleDateString([], {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </h3>
          <div className="cal-agenda">
            {dayEvents.length === 0 && <div className="empty">No events.</div>}
            {dayEvents.map((event) => (
              <div key={event.id} className="list-row">
                <div className="list-main">
                  <div className="list-title">{event.title}</div>
                  <div className="list-sub">
                    {timeLabel(event)}
                    {event.location && ` · ${event.location}`}
                    {event.source === 'jarvis' && ' · added by JARVIS'}
                  </div>
                </div>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete event"
                  onConfirm={() => void run(() => api.events.remove(event.id))}
                />
              </div>
            ))}
          </div>
          <form
            className="app-form wrap"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <input
              className="input grow"
              placeholder="New event on this day…"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
              />
              All day
            </label>
            {!allDay && (
              <>
                <input
                  className="input"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <input
                  className="input"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </>
            )}
            <input
              className="input grow"
              placeholder="Location (optional)"
              value={location}
              maxLength={300}
              onChange={(event) => setLocation(event.target.value)}
            />
            <button type="submit" className="btn primary" disabled={!title.trim()}>
              Add event
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
