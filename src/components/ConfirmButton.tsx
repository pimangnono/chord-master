import { useEffect, useState } from 'react';

/** Two-step destructive button: the first click asks, the second confirms. Browser confirm() is blocked inside artifacts. */
export function ConfirmButton({ label, confirmLabel = '정말 삭제할까요?', onConfirm, className = 'btn ghost small danger' }: { label: string; confirmLabel?: string; onConfirm: () => void; className?: string }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking]);
  if (!asking) {
    return (
      <button className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-row">
      <span className="small">{confirmLabel}</span>
      <button className="btn small danger-solid" onClick={onConfirm}>
        삭제
      </button>
      <button className="btn ghost small" onClick={() => setAsking(false)}>
        취소
      </button>
    </span>
  );
}
