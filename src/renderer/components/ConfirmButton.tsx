import { useEffect, useState } from 'react';

interface ConfirmButtonProps {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}

/** Two-step button for destructive actions: first click asks, second click does it. */
export function ConfirmButton({
  label,
  confirmLabel = 'Confirm delete',
  onConfirm,
  disabled,
  className = '',
}: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 5000);
    return () => clearTimeout(timer);
  }, [asking]);

  if (!asking) {
    return (
      <button
        type="button"
        className={`btn ${className}`}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-group">
      <button
        type="button"
        className="btn danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
