/**
 * A stand-in for Google's token endpoint and the Drive API v3, for tests.
 *
 * It answers the four calls the connector makes, in the shapes Google
 * documents: the JWT-bearer token grant, `files.get` for a folder's own
 * metadata, `files.list` with `q`, `pageSize` and `pageToken`, and a file's
 * bytes by `alt=media` or `files.export`. It checks what a real Drive would:
 * that the token's JWT was signed by the service account's key for the
 * read-only Drive scope, that every call carries the token it gave, and that
 * the account can see the folder asked for. A folder not shared with the
 * account is answered 404, as Drive answers it.
 *
 * Every folder, file, name and address here is invented.
 */

import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';

export const FOLDER_TYPE = 'application/vnd.google-apps.folder';
export const DOC_TYPE = 'application/vnd.google-apps.document';
export const FORM_TYPE = 'application/vnd.google-apps.form';

interface Held {
  id: string;
  name: string;
  mimeType: string;
  parent?: string;
  content?: Buffer;
  /** A size to claim that is not the content's: for a file too large to send. */
  claimedSize?: number;
  createdTime: string;
  modifiedTime: string;
}

export interface FakeDrive {
  /** The deployment's variable: the service account's key file, as JSON. */
  json: string;
  address: string;
  fetch: typeof fetch;
  /** Every call made, as "METHOD path?query". */
  calls: string[];
  /** The `q` of every list call. */
  queries: string[];
  folder(id: string, name: string, parent?: string): void;
  file(id: string, name: string, parent: string, content: string | Buffer, opts?: { mimeType?: string; at?: string; claimedSize?: number }): void;
  /** Change a file's content, as of a time. */
  change(id: string, content: string, at: string): void;
  share(folderId: string): void;
  unshare(folderId: string): void;
  /** Answer the next list of this folder with a server error. */
  breakList(folderId: string): void;
  downloads(): string[];
}

let made = 0;

export function fakeDrive(): FakeDrive {
  made += 1;
  const address = `reader-${made}@invented-project.iam.gserviceaccount.com`;
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const json = JSON.stringify({ type: 'service_account', client_email: address, private_key: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const token = `token-${made}`;
  const held = new Map<string, Held>();
  const shared = new Set<string>();
  const broken = new Set<string>();
  const calls: string[] = [];
  const queries: string[] = [];

  /** Whether the account can see this: it, or a folder above it, was shared. */
  const visible = (id: string): boolean => {
    for (let at = held.get(id); at; at = at.parent ? held.get(at.parent) : undefined) if (shared.has(at.id)) return true;
    return false;
  };
  const json200 = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const refuse = (status: number, reason: string, message: string) =>
    new Response(JSON.stringify({ error: { code: status, message, errors: [{ reason, message }] } }), { status, headers: { 'content-type': 'application/json' } });
  const metadata = (file: Held) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    webViewLink: `https://drive.google.com/open?id=${file.id}`,
    trashed: false,
    ...(file.content && !file.mimeType.startsWith('application/vnd.google-apps.') ? { size: String(file.claimedSize ?? file.content.length), md5Checksum: createHash('md5').update(file.content).digest('hex') } : {}),
  });

  const answer = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}${url.search}`);

    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init?.body ?? ''));
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json200({ error: 'unsupported_grant_type' });
      const [head, body, signature] = (form.get('assertion') ?? '').split('.');
      const claims = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf-8')) as Record<string, unknown>;
      const signed = createVerify('RSA-SHA256').update(`${head}.${body}`).verify(key.publicKey, Buffer.from(signature ?? '', 'base64url'));
      const sound = signed && claims.iss === address && claims.aud === 'https://oauth2.googleapis.com/token' && claims.scope === 'https://www.googleapis.com/auth/drive.readonly' && Number(claims.exp) - Number(claims.iat) <= 3600;
      if (!sound) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT' }), { status: 400 });
      return json200({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
    }

    if (url.origin !== 'https://www.googleapis.com' || !url.pathname.startsWith('/drive/v3/files')) throw new Error(`the stand-in Drive has no ${url.href}`);
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${token}`) return refuse(401, 'authError', 'Invalid Credentials');

    const rest = url.pathname.slice('/drive/v3/files'.length).split('/').filter(Boolean);
    if (rest.length === 0) {
      const q = url.searchParams.get('q') ?? '';
      queries.push(q);
      const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? '';
      if (!visible(parent)) return refuse(404, 'notFound', `File not found: ${parent}.`);
      if (broken.delete(parent)) return refuse(500, 'backendError', 'Backend Error');
      if (url.searchParams.get('supportsAllDrives') !== 'true' || url.searchParams.get('includeItemsFromAllDrives') !== 'true') return refuse(400, 'invalid', 'the shared drive flags were not sent');
      const after = /modifiedTime > '([^']+)'/.exec(q)?.[1];
      const all = [...held.values()].filter((file) => file.parent === parent && (!after || file.mimeType === FOLDER_TYPE || file.modifiedTime > after || file.createdTime > after));
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const from = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(from, from + size);
      return json200({ kind: 'drive#fileList', files: page.map(metadata), ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
    }

    const file = held.get(rest[0]!);
    if (!file || !visible(file.id)) return refuse(404, 'notFound', `File not found: ${rest[0]}.`);
    if (rest[1] === 'export') {
      if (!file.content) return refuse(403, 'fileNotExportable', 'Export only supports Docs Editors files.');
      return new Response(new Uint8Array(file.content), { status: 200, headers: { 'content-type': url.searchParams.get('mimeType') ?? 'application/pdf' } });
    }
    if (url.searchParams.get('alt') === 'media') return new Response(new Uint8Array(file.content ?? Buffer.alloc(0)), { status: 200, headers: { 'content-type': file.mimeType } });
    return json200(metadata(file));
  };

  return {
    json,
    address,
    fetch: answer as typeof fetch,
    calls,
    queries,
    folder: (id, name, parent) => void held.set(id, { id, name, mimeType: FOLDER_TYPE, parent, createdTime: '2026-01-05T09:00:00.000Z', modifiedTime: '2026-01-05T09:00:00.000Z' }),
    file: (id, name, parent, content, opts = {}) => {
      const at = opts.at ?? '2026-02-10T09:00:00.000Z';
      held.set(id, { id, name, parent, mimeType: opts.mimeType ?? 'text/plain', content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'), createdTime: at, modifiedTime: at, ...(opts.claimedSize ? { claimedSize: opts.claimedSize } : {}) });
    },
    change: (id, content, at) => {
      const file = held.get(id)!;
      file.content = Buffer.from(content, 'utf-8');
      file.modifiedTime = at;
    },
    share: (folderId) => void shared.add(folderId),
    unshare: (folderId) => void shared.delete(folderId),
    breakList: (folderId) => void broken.add(folderId),
    downloads: () => calls.filter((call) => call.includes('alt=media') || call.includes('/export')),
  };
}
