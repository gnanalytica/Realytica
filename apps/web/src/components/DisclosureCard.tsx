import { useState } from 'react';
import { Check, Globe, Lock, ShieldCheck } from 'lucide-react';
import { DISCLOSURE_LEVELS, DISCLOSURE_ORDER, NEVER_DISCLOSED, resolveDisclosure } from '@realytica/shared';
import type { DisclosureLevel } from '@realytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, Callout, cn } from './ui/kit';

/**
 * How much about this property may be said to something outside Realytica.
 *
 * Presented as a decision with a stated cost on every option, including the
 * default — because the default has one too: at locality level, anything
 * recorded against this specific parcel simply cannot be found, and a user
 * who is not told that will read an empty result as a clean result.
 *
 * Widening is deliberately two-step. It is not a toggle in a settings pane;
 * it is a choice a person makes about one property, having read what leaves
 * and what it costs.
 */
export function DisclosureCard({
  level,
  onChange,
  busy,
}: {
  level: DisclosureLevel | undefined;
  onChange: (next: DisclosureLevel) => void | Promise<void>;
  busy?: boolean;
}) {
  const current = resolveDisclosure(level);
  const [pending, setPending] = useState<DisclosureLevel | null>(null);
  const pendingDescriptor = pending ? DISCLOSURE_LEVELS[pending] : null;

  return (
    <Card>
      <CardHeader
        title="What we may search for"
        subtitle="Searching for this property means telling a search index about it. This decides how much."
        icon={<Globe size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {DISCLOSURE_ORDER.map((key) => {
            const d = DISCLOSURE_LEVELS[key];
            const active = key === current;
            return (
              <button
                key={key}
                type="button"
                disabled={busy || active}
                onClick={() => setPending(key)}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left ring-1 transition-colors disabled:cursor-default',
                  active ? 'bg-brand-soft ring-brand' : 'bg-surface-2 ring-[var(--ring)] hover:bg-surface-3',
                )}
              >
                {active ? (
                  <Check size={15} className="mt-0.5 shrink-0 text-brand" />
                ) : (
                  <span className="mt-0.5 h-[15px] w-[15px] shrink-0 rounded-full border border-ink-faint" />
                )}
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{d.label}</span>
                    {key === 'locality_only' && <Badge tone="good">Default</Badge>}
                    {active && <Badge tone="brand">In force</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-secondary">{d.who}</span>
                  {active && (
                    <span className="mt-2 block rounded-md bg-surface p-2.5 ring-1 ring-[var(--ring)]">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Sends</span>
                      <ul className="m-0 mt-1 list-none p-0">
                        {d.sends.map((line) => (
                          <li key={line} className="text-[12px] leading-relaxed text-ink-secondary">
                            {line}
                          </li>
                        ))}
                      </ul>
                      <span className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        Cost of this choice
                      </span>
                      <span className="block text-[12px] leading-relaxed text-ink-secondary">{d.cost}</span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {pendingDescriptor && pendingDescriptor.level !== current && (
          <Callout tone={pendingDescriptor.level === 'locality_only' ? 'info' : 'warning'} title={`Switch to ${pendingDescriptor.label.toLowerCase()}?`}>
            <p className="m-0 text-[12.5px] font-medium text-ink">This would send, on the next search:</p>
            <ul className="m-0 mt-1 list-disc pl-4">
              {pendingDescriptor.sends.map((line) => (
                <li key={line} className="text-[12.5px] leading-relaxed">
                  {line}
                </li>
              ))}
            </ul>
            <p className="m-0 mt-2 text-[12.5px] leading-relaxed">{pendingDescriptor.cost}</p>
            <p className="m-0 mt-2 text-[12.5px] leading-relaxed text-ink-muted">
              It makes findable: {pendingDescriptor.unlocks.join('; ')}.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const next = pendingDescriptor.level;
                  setPending(null);
                  void onChange(next);
                }}
              >
                Yes, use {pendingDescriptor.label.toLowerCase()}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </Callout>
        )}

        <div className="rounded-lg bg-surface-2 p-3 ring-1 ring-[var(--ring)]">
          <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <Lock size={12} /> Never sent, whatever you choose
          </p>
          <ul className="m-0 mt-1.5 list-none p-0">
            {NEVER_DISCLOSED.map((line) => (
              <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-ink-secondary">
                <ShieldCheck size={12} className="mt-[3px] shrink-0 text-good" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}
