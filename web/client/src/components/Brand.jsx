import React from 'react';
import { Star } from 'lucide-react';

export function Brand({ small }) {
  return <div className="brand"><Star size={small ? 18 : 20} className="star" fill="currentColor" /><span>ApplyPilot</span></div>;
}
