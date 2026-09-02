import { CHECK_DEFINITIONS, DD_TYPE_DEFINITIONS, SCOPE_DEFINITIONS, SCOPE_LABEL } from '@realytica/shared';
import { Card, CardBody, CardHeader } from '../../components/ui/kit';

export default function Libraries() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Libraries</h1>
      </div>
      <Card>
        <CardHeader title="DD types" subtitle={`${DD_TYPE_DEFINITIONS.length} templates`} />
        <CardBody className="divide-y divide-hairline p-0">
          {DD_TYPE_DEFINITIONS.map((d) => (
            <div key={d.key} className="px-4 py-3">
              <p className="text-[13px] font-medium text-ink">{d.label}</p>
              <p className="mt-1 text-[12px] text-ink-secondary">{d.purpose}</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                Scopes: {d.defaultScopes.map((k) => SCOPE_LABEL[k]).join(', ') || 'none (custom)'}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Scopes" subtitle={`${SCOPE_DEFINITIONS.length} reusable methodologies`} />
        <CardBody className="divide-y divide-hairline p-0">
          {SCOPE_DEFINITIONS.map((s) => (
            <div key={s.key} className="px-4 py-3">
              <p className="text-[13px] font-medium text-ink">{s.label}</p>
              <p className="mt-1 text-[12px] text-ink-secondary">{s.purpose}</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                {CHECK_DEFINITIONS.filter((c) => c.scopeKey === s.key).length} checks · {s.sections.join(' · ')}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
