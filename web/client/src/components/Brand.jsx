import React from 'react';

/** ApplyPilot "check-plane" mark (a check whose long stroke is a folded paper plane). */
export function Mark({ size = 22, className = '' }) {
  return <img src="/brand/applypilot-mark.svg" alt="" width={size} height={size} className={`brand-mark ${className}`} draggable={false} style={{ flexShrink: 0, display: 'block' }} />;
}

export function Brand({ small }) {
  return <div className="brand"><Mark size={small ? 22 : 26} /><span>ApplyPilot</span></div>;
}
