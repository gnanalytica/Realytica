import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, Trash2 } from 'lucide-react';
import { workspaceApi, type PairCode, type PairedDevice } from '../../lib/workspace-api';
import { useAsync } from '../../lib/useAsync';
import { Button, Card, CardBody, CardHeader, useToast } from '../ui/kit';

function grouped(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function since(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'never';
}

/**
 * Pairing a phone for the site app.
 *
 * The phone never sees a password. A signed-in person asks for a code, the
 * phone scans it (or someone types it) within ten minutes, and from then on
 * the phone holds a token of its own that reaches only the site log — and can
 * be revoked here at any time.
 */
export function PairPhone() {
  const toast = useToast();
  const [code, setCode] = useState<PairCode | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const devices = useAsync(() => workspaceApi.devices(), []);

  useEffect(() => {
    if (!code) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(code.expiresAt) - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  useEffect(() => {
    if (!code) {
      setQr(null);
      return;
    }
    // The phone reads the server and the code from one scan.
    QRCode.toDataURL(JSON.stringify({ server: window.location.origin, code: code.code }), { margin: 1, width: 220 }).then(setQr, () => setQr(null));
  }, [code]);

  async function issue() {
    setBusy(true);
    try {
      setCode(await workspaceApi.pairCode());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not make a code', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: PairedDevice) {
    try {
      await workspaceApi.revokeDevice(device.id);
      await devices.refresh();
      toast(`${device.name} is no longer paired.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not revoke it', 'critical');
    }
  }

  const expired = code && left === 0;

  return (
    <Card>
      <span id="pair" />
      <CardHeader
        icon={<Smartphone size={15} className="text-brand" />}
        title="The site app"
        subtitle="Log the day from site, with or without signal"
        action={
          <Button size="sm" variant="primary" loading={busy} onClick={() => void issue()}>
            {code && !expired ? 'New code' : 'Pair a phone'}
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {code && !expired ? (
          <div className="flex flex-wrap items-center gap-5 rounded-lg bg-sunken p-4">
            {qr ? <img src={qr} alt="Pairing code to scan with the site app" className="h-36 w-36 rounded-md bg-white p-1" /> : null}
            <div className="space-y-1">
              <p className="text-[12px] text-ink-secondary">In the Realytica Site app, scan this or type:</p>
              <p className="font-mono text-[28px] font-semibold tracking-[0.12em] text-ink">{grouped(code.code)}</p>
              <p className="text-[12px] text-ink-secondary">
                Server: <span className="font-mono">{window.location.origin}</span>
              </p>
              <p className="text-micro text-ink-muted">
                Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more. The phone then signs in as you and reaches only the site log.
              </p>
            </div>
          </div>
        ) : expired ? (
          <p className="text-[13px] text-ink-secondary">That code has expired. Make a new one.</p>
        ) : null}
        <div>
          <p className="mb-1 text-[12px] font-semibold text-ink">Paired phones</p>
          {devices.data?.devices.length ? (
            <ul className="divide-y divide-hairline">
              {devices.data.devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="text-ink">{d.name}</span>
                    <span className="block text-micro text-ink-muted">
                      {d.email} · paired {since(d.createdAt)} · last seen {since(d.lastSeenAt)}
                      {d.push ? ' · notifications on' : ''}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => void revoke(d)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-secondary">None yet.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
