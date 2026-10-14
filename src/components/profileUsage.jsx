import React from 'react';
import { Users } from 'lucide-react';
import { useApp } from '../lib/store';

// Applications attempted today by each profile against the plan's single daily allowance, so it is clear when
// one profile is using most of it. Same day boundary and counting rule as the campaign runner (UTC date of attemptedAt).
export function profileAttemptsToday(app) {
  const day = new Date().toISOString().slice(0, 10);
  const byCampaign = new Map((app.campaigns || []).map((c) => [c.id, c.profileId || null]));
  const out = {};
  let total = 0;
  for (const a of app.applications || []) {
    if (!(a.attemptedAt && a.attemptedAt.startsWith(day))) continue;
    const id = a.profileId || (a.campaignId && byCampaign.get(a.campaignId)) || 'main';
    out[id] = (out[id] || 0) + 1;
    total++;
  }
  return { byProfile: out, total };
}

export function ProfileUsage({ style }) {
  const app = useApp();
  const profiles = app.profiles || [];
  if (profiles.length < 2) return null;
  const { byProfile, total } = profileAttemptsToday(app);
  const plan = app.plan || {};
  const cap = Math.min(plan.dailyApplies || Infinity, Number(app.settings && app.settings.dailyApplyLimit) || plan.dailyApplies || Infinity);
  return (
    <div className="card pad row wrap" style={{ gap: 10, alignItems: 'center', ...(style || {}) }}>
      <span className="row small muted" style={{ gap: 6 }}><Users size={14} />Applied today by profile</span>
      {profiles.map((p) => <span key={p.id} className="badge" title={`${byProfile[p.id] || 0} application attempt(s) today for ${p.label}`}>{p.label} · {byProfile[p.id] || 0}</span>)}
      <span className="grow" />
      <span className="small" title="One daily allowance is shared by all profiles">{total}{Number.isFinite(cap) ? ` / ${cap}` : ''} used of the daily limit</span>
    </div>
  );
}
