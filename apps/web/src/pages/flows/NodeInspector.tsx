import {
  FLOW_NODE_TYPES,
  nodeLabel,
  type FlowNode,
  type FlowNodeConfig,
  type FlowProblem,
  type ProjectSummary,
} from '@realytica/shared';
import { Badge, Button, Callout, Field, Input, Select, Textarea, Toggle } from '../../components/ui/kit';

import type { FlowCatalogue } from '../../lib/api';
import { ConditionEditor } from './Conditions';

/**
 * What one node is set to do.
 *
 * A form per kind rather than a schema-driven renderer. A generic form built
 * from a JSON schema is smaller code and a worse screen: the branch editor
 * needs to add and label cases, the connector needs to say that the source it
 * points at cannot be fetched and what to do instead, and the agent needs to
 * show what its model actually resolves to. Those are the three things an
 * operator is here to find out, and none of them survives being rendered as
 * a generic string field.
 */

export function NodeInspector({
  node,
  catalogue,
  problems,
  projects,
  onChange,
  onDelete,
  onDuplicate,
}: {
  node: FlowNode;
  catalogue: FlowCatalogue | null;
  problems: FlowProblem[];
  /** For a schedule pointed at one named project. Nothing else needs them. */
  projects: ProjectSummary[];
  onChange: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const type = FLOW_NODE_TYPES[node.kind];
  const mine = problems.filter((p) => p.nodeId === node.id);
  const setConfig = (patch: Record<string, unknown>) =>
    onChange({ config: { ...node.config, ...patch } as FlowNodeConfig });

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Badge>{type.label}</Badge>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onDuplicate}>Duplicate</Button>
            {node.kind === 'trigger' ? null : <Button size="sm" variant="ghost" onClick={onDelete}>Delete</Button>}
          </div>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted">{type.summary}</p>
        {type.caution ? <p className="mt-1 text-[11.5px] text-ink-secondary">{type.caution}</p> : null}
      </div>

      {mine.map((p, i) => (
        <Callout key={i} tone={p.severity === 'error' ? 'critical' : 'warning'} title={p.severity === 'error' ? 'This stops the flow running' : 'Worth a look'}>
          {p.message}
        </Callout>
      ))}

      <Field label="Name" hint="What this node is called on the canvas.">
        <Input value={node.label ?? ''} placeholder={nodeLabel(node)} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>

      {node.kind === 'trigger' ? null : (
        <div>
          <Toggle checked={!node.disabled} onChange={(on) => onChange({ disabled: !on })} label="Runs" />
          <p className="mt-0.5 text-[11.5px] text-ink-muted">Turned off, the run passes straight through this node.</p>
        </div>
      )}

      <Body node={node} catalogue={catalogue} projects={projects} setConfig={setConfig} />

      <Field label="Note" hint="For whoever reads this next.">
        <Textarea rows={2} value={node.note ?? ''} onChange={(e) => onChange({ note: e.target.value })} />
      </Field>
    </div>
  );
}

function Body({
  node,
  catalogue,
  projects,
  setConfig,
}: {
  node: FlowNode;
  catalogue: FlowCatalogue | null;
  projects: ProjectSummary[];
  setConfig: (patch: Record<string, unknown>) => void;
}) {
  const c = node.config;

  if (c.kind === 'trigger') {
    return (
      <>
        <Field label="Starts when">
          <Select value={c.on} onChange={(e) => setConfig({ on: e.target.value })}>
            <option value="manual">Somebody runs it</option>
            <option value="project_created">A project is created</option>
            <option value="evidence_uploaded">A document is uploaded</option>
            <option value="assessment_started">An assessment is started</option>
            <option value="schedule">On a timer</option>
          </Select>
        </Field>

        {c.on === 'manual' ? null : (
          <Callout tone="warning" title="This will run on its own">
            Anything but “somebody runs it” fires for real — models are called and connectors are reached. It still
            only ever proposes: a person accepts a draft before it reaches a register. Switch the flow on with the
            toggle at the top for any of this to happen.
          </Callout>
        )}

        {c.on === 'schedule' ? (
          <>
            <Field label="Every" hint="Minutes between runs. The clock is checked once a minute, so anything under that runs every minute.">
              <Input
                type="number"
                min={1}
                value={c.everyMinutes ?? ''}
                placeholder="e.g. 1440 for daily"
                onChange={(e) => setConfig({ everyMinutes: e.target.value ? Number(e.target.value) : undefined })}
              />
            </Field>
            <Field label="Against" hint="A clock knows nothing about projects, so a timer has to be told which.">
              <Select
                value={c.scope ?? 'open'}
                onChange={(e) => setConfig({ scope: e.target.value, ...(e.target.value === 'open' ? { projectId: undefined } : {}) })}
              >
                <option value="open">Every project that is not closed</option>
                <option value="named">One project</option>
              </Select>
            </Field>
            {c.scope === 'named' ? (
              <Field label="Project">
                <Select value={c.projectId ?? ''} onChange={(e) => setConfig({ projectId: e.target.value || undefined })}>
                  <option value="">Choose a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.reference} · {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  if (c.kind === 'agent') {
    const known = catalogue?.agents.find((a) => a.agent === c.agent);
    return (
      <>
        <Field label="Agent" hint="What it does is fixed. Everything below is yours.">
          <Select value={c.agent} onChange={(e) => setConfig({ agent: e.target.value })}>
            {(catalogue?.agents ?? []).map((a) => (
              <option key={a.agent} value={a.agent}>{a.agent.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </Field>
        <Field label="Model" hint={known ? `Leave empty for ${known.model}, which its ${known.tier} tier resolves to.` : undefined}>
          <Input value={c.model ?? ''} placeholder={known?.model ?? ''} onChange={(e) => setConfig({ model: e.target.value || undefined })} />
        </Field>
        <Field label="Extra instruction" hint="Added to its prompt. Never replaces it — the prompt is what keeps the agent honest.">
          <Textarea rows={3} value={c.extraInstruction ?? ''} onChange={(e) => setConfig({ extraInstruction: e.target.value || undefined })} />
        </Field>
        <Field label="Reply cap" hint="Tokens. Higher costs more.">
          <Input
            type="number"
            value={c.maxTokens ?? ''}
            placeholder="1500"
            onChange={(e) => setConfig({ maxTokens: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
      </>
    );
  }

  if (c.kind === 'query') {
    return (
      <>
        <Field label="Register">
          <Select value={c.register} onChange={(e) => setConfig({ register: e.target.value })}>
            {['evidence', 'findings', 'risks', 'actions', 'checks', 'assessments', 'decisions'].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Keep only rows where" hint="Left empty, it reads every row.">
          <ConditionEditor group={c.where ?? { match: 'all', conditions: [] }} onChange={(where) => setConfig({ where })} />
        </Field>
        <Field label="At most">
          <Input type="number" value={c.limit ?? ''} placeholder="all" onChange={(e) => setConfig({ limit: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
      </>
    );
  }

  if (c.kind === 'retrieve') {
    return (
      <>
        <Field label="From">
          <Select value={c.from} onChange={(e) => setConfig({ from: e.target.value })}>
            <option value="graph">This project&rsquo;s graph</option>
            <option value="memory">What earlier files taught</option>
            <option value="shelf">The reference shelf</option>
          </Select>
        </Field>
        <Field label="Look up" hint="Use {{ }} to take a value from the run, e.g. {{project.name}}.">
          <Input value={c.query} onChange={(e) => setConfig({ query: e.target.value })} />
        </Field>
      </>
    );
  }

  if (c.kind === 'connector') {
    const source = catalogue?.connectors.find((s) => s.id === c.sourceId);
    return (
      <>
        <Field label="Source">
          <Select value={c.sourceId} onChange={(e) => setConfig({ sourceId: e.target.value })}>
            <option value="">Choose one…</option>
            {(catalogue?.connectors ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </Field>
        {source ? (
          <>
            <p className="text-[12px] text-ink-secondary">{source.whatItWouldHaveAnswered}</p>
            {source.access !== 'open' ? (
              // The registry knows this portal wants a captcha or a person with
              // a receipt. Saying so here beats a run that times out and reads
              // as a fault.
              <Callout tone="warning" title="This one cannot be fetched">
                {source.manualRoute ?? 'It has to be obtained by hand.'} The node will say so rather than trying.
              </Callout>
            ) : null}
          </>
        ) : null}
        <CredentialPicker catalogue={catalogue} value={c.credentialId} onChange={(credentialId) => setConfig({ credentialId })} />
      </>
    );
  }

  if (c.kind === 'mcp') {
    return (
      <>
        <Field label="Server URL" hint="Or leave empty and pick a stored MCP credential below.">
          <Input value={c.url ?? ''} placeholder="https://tools.example.com/mcp" onChange={(e) => setConfig({ url: e.target.value || undefined })} />
        </Field>
        <Field label="Tool">
          <Input value={c.tool} placeholder="search_records" onChange={(e) => setConfig({ tool: e.target.value })} />
        </Field>
        <KeyValueEditor label="Arguments" pairs={c.arguments ?? {}} onChange={(args) => setConfig({ arguments: args })} />
        <CredentialPicker catalogue={catalogue} value={c.credentialId} onChange={(credentialId) => setConfig({ credentialId })} />
      </>
    );
  }

  if (c.kind === 'http') {
    return (
      <>
        <Field label="Method">
          <Select value={c.method} onChange={(e) => setConfig({ method: e.target.value })}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="URL" hint="{{ }} takes a value from the run.">
          <Input value={c.url} onChange={(e) => setConfig({ url: e.target.value })} />
        </Field>
        <KeyValueEditor label="Headers" pairs={c.headers ?? {}} onChange={(headers) => setConfig({ headers })} />
        <Field label="Body">
          <Textarea rows={4} value={c.body ?? ''} onChange={(e) => setConfig({ body: e.target.value || undefined })} />
        </Field>
        <CredentialPicker catalogue={catalogue} value={c.credentialId} onChange={(credentialId) => setConfig({ credentialId })} />
      </>
    );
  }

  if (c.kind === 'filter') {
    return (
      <Field label="Carry on when">
        <ConditionEditor group={c.where} onChange={(where) => setConfig({ where })} />
      </Field>
    );
  }

  if (c.kind === 'branch') {
    return (
      <div className="space-y-3">
        <p className="text-[12px] text-ink-muted">First match wins; the rest take the default.</p>
        {c.cases.map((k, i) => (
          <div key={k.id} className="rounded-lg border border-hairline p-2.5">
            <div className="flex items-center gap-2">
              <Input
                value={k.label}
                aria-label={`Name for case ${i + 1}`}
                onChange={(e) => setConfig({ cases: c.cases.map((x) => (x.id === k.id ? { ...x, label: e.target.value } : x)) })}
              />
              <Button size="sm" variant="ghost" onClick={() => setConfig({ cases: c.cases.filter((x) => x.id !== k.id) })}>×</Button>
            </div>
            <ConditionEditor
              className="mt-2"
              group={k.where}
              onChange={(where) => setConfig({ cases: c.cases.map((x) => (x.id === k.id ? { ...x, where } : x)) })}
            />
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setConfig({
              cases: [...c.cases, { id: `case_${Math.random().toString(36).slice(2, 8)}`, label: 'When…', where: { match: 'all', conditions: [] } }],
            })
          }
        >
          Add a case
        </Button>
      </div>
    );
  }

  if (c.kind === 'loop') {
    return (
      <>
        <Field label="Over" hint="A path to a list on the run, e.g. rows or evidence.">
          <Input value={c.over} onChange={(e) => setConfig({ over: e.target.value })} />
        </Field>
        <Field label="Call each one" hint="What the body refers to it as.">
          <Input value={c.itemName} onChange={(e) => setConfig({ itemName: e.target.value })} />
        </Field>
        <Field label="At most" hint="Capped at 50 whatever this says — a loop around an agent is a bill.">
          <Input type="number" value={c.maxIterations ?? ''} placeholder="10" onChange={(e) => setConfig({ maxIterations: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
      </>
    );
  }

  if (c.kind === 'transform') {
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-ink-muted">Sets a new value on the run from an existing one.</p>
        {c.set.map((rule, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={rule.to}
              placeholder="title"
              aria-label="New name"
              className="w-32 font-mono text-[12px]"
              onChange={(e) => setConfig({ set: c.set.map((r, j) => (j === i ? { ...r, to: e.target.value } : r)) })}
            />
            <span className="text-[12px] text-ink-muted">from</span>
            <Input
              value={rule.from}
              placeholder="doc.name"
              aria-label="Taken from"
              className="flex-1 font-mono text-[12px]"
              onChange={(e) => setConfig({ set: c.set.map((r, j) => (j === i ? { ...r, from: e.target.value } : r)) })}
            />
            <Button size="sm" variant="ghost" onClick={() => setConfig({ set: c.set.filter((_, j) => j !== i) })}>×</Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setConfig({ set: [...c.set, { to: '', from: '' }] })}>Add a field</Button>
      </div>
    );
  }

  if (c.kind === 'output') {
    return (
      <>
        <Callout tone="info" title="This proposes, it does not write">
          A person accepts the card.
        </Callout>
        <Field label="Propose a">
          <Select value={c.draft} onChange={(e) => setConfig({ draft: e.target.value })}>
            <option value="note">Note</option>
            <option value="finding">Finding</option>
            <option value="action">Action</option>
            <option value="evidence_request">Document request</option>
          </Select>
        </Field>
        <Field label="Title" hint="{{ }} takes a value from the run.">
          <Input value={c.title} onChange={(e) => setConfig({ title: e.target.value })} />
        </Field>
        <Field label="Body">
          <Textarea rows={3} value={c.bodyTemplate ?? ''} onChange={(e) => setConfig({ bodyTemplate: e.target.value || undefined })} />
        </Field>
      </>
    );
  }

  return null;
}

function CredentialPicker({
  catalogue,
  value,
  onChange,
}: {
  catalogue: FlowCatalogue | null;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  return (
    <Field label="Credential" hint="Stored once under Setup. The secret itself is never shown again.">
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">None</option>
        {(catalogue?.credentials ?? []).map((cred) => (
          <option key={cred.id} value={cred.id}>{cred.label} · ••••{cred.hint}</option>
        ))}
      </Select>
    </Field>
  );
}

function KeyValueEditor({
  label,
  pairs,
  onChange,
}: {
  label: string;
  pairs: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const rows = Object.entries(pairs);
  return (
    <Field label={label}>
      <div className="space-y-1.5">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={k}
              aria-label={`${label} name`}
              className="w-32 font-mono text-[12px]"
              onChange={(e) => {
                const next = Object.fromEntries(rows.map(([kk, vv], j) => (j === i ? [e.target.value, vv] : [kk, vv])));
                onChange(next);
              }}
            />
            <Input
              value={v}
              aria-label={`${label} value`}
              className="flex-1 font-mono text-[12px]"
              onChange={(e) => {
                const next = Object.fromEntries(rows.map(([kk, vv], j) => (j === i ? [kk, e.target.value] : [kk, vv])));
                onChange(next);
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => onChange(Object.fromEntries(rows.filter((_, j) => j !== i)))}>×</Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...pairs, '': '' })}>Add</Button>
      </div>
    </Field>
  );
}
