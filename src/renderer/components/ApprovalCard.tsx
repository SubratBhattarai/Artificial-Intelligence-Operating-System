import { useEffect, useState } from 'react';
import type { ApprovalInfo } from '../../shared/protocol';
import { useChat } from '../state/chatStore';

const TIER_TEXT: Record<string, string> = {
  low: 'Small change',
  medium: 'Changes files or apps',
  high: 'Runs on your computer — cannot be undone',
};

export function ApprovalCard({ approval }: { approval: ApprovalInfo }) {
  const decide = useChat((state) => state.decide);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((approval.expiresAt - now) / 1000));
  return (
    <div className="approval-card" role="alertdialog" aria-label={approval.title}>
      <div className="approval-head">
        <strong>{approval.title}</strong>
        <span className="approval-tier">{TIER_TEXT[approval.riskTier] ?? 'Change'}</span>
      </div>
      <ul className="approval-lines">
        {approval.lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      <div className="approval-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => void decide(approval.id, true)}
        >
          Approve
        </button>
        <button type="button" className="btn" onClick={() => void decide(approval.id, false)}>
          Deny
        </button>
        <span className="muted approval-timer">expires in {seconds}s</span>
      </div>
    </div>
  );
}
