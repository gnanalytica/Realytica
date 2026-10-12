/**
 * Google Drive, read as a service account.
 *
 * No consent screen and no token of a person's: the deployment holds one
 * service account (`GOOGLE_SERVICE_ACCOUNT_JSON`, the key file Google Cloud
 * gives, as it is or base64), a folder's owner shares the folder with that
 * account's address as a viewer, and this reads what was shared. Without the
 * variable nothing here calls anything, and `configured()` says so.
 *
 * Written against the Drive API v3 as documented in October 2026:
 *
 *   - a token is asked of `https://oauth2.googleapis.com/token` with a JWT
 *     signed RS256 by the account's key (`iss` the account, `scope`
 *     `drive.readonly`, `aud` the token address, an hour at most), grant
 *     type `urn:ietf:params:oauth:grant-type:jwt-bearer`;
 *   - `files.list` with `q`, `pageToken` and `nextPageToken`, at most 1,000 a
 *     page, with `supportsAllDrives` and `includeItemsFromAllDrives` so a
 *     folder on a shared drive is read as one on My Drive is;
 *   - `files.get?alt=media` for a file's bytes, and `files.export` for a
 *     Google document, which has no bytes of its own: Docs, Slides and
 *     Drawings as PDF, Sheets as xlsx. Drive exports no more than 10 MB;
 *   - `md5Checksum` is given for a file with bytes and for no Google
 *     document, so those are told apart by `modifiedTime`. (`version` moves
 *     on changes nobody sees, a share among them, so it is not used.)
 *
 * A folder is polled, not watched. Drive's `changes` feed is of everything
 * the account can see, across every project's folder, and says nothing of
 * which folder a change is under; asking each folder for what was made or
 * changed after a time is one call a folder and needs no state at Google.
 * A file made after then is asked for as well as one changed: a file
 * uploaded with Drive for desktop keeps the day it was last changed on the
 * person's disk, which may be years back.
 */

import { createSign } from 'node:crypto';
import { FileUnreadable, FolderGone, tooLarge, type FolderProvider, type RemoteEntry } from './provider';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_TYPE = /^application\/vnd\.google-apps\./;
const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A Google document has no bytes: it is exported as one of these, under its name with the extension added. */
const EXPORTED_AS: Record<string, { mimeType: string; ext: string }> = {
  'application/vnd.google-apps.document': { mimeType: PDF, ext: '.pdf' },
  'application/vnd.google-apps.presentation': { mimeType: PDF, ext: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: PDF, ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet': { mimeType: XLSX, ext: '.xlsx' },
};

/** The kinds of Google's own that are no file at all, as a person would name them. */
const NOT_A_FILE: Record<string, string> = {
  'application/vnd.google-apps.shortcut': 'A shortcut. Put the file itself in the folder.',
  'application/vnd.google-apps.form': 'A Google Form cannot be taken in as a file.',
  'application/vnd.google-apps.site': 'A Google Site cannot be taken in as a file.',
  'application/vnd.google-apps.map': 'A Google My Map cannot be taken in as a file.',
};

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** The service account the deployment holds: the key file's JSON, as it is or base64. Nothing where it is absent or is not one. */
export function serviceAccount(env: NodeJS.ProcessEnv = process.env): ServiceAccount | undefined {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8')) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') return undefined;
    if (!parsed.client_email.includes('@') || !parsed.private_key.includes('PRIVATE KEY')) return undefined;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return undefined;
  }
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

/** A token held until a minute before it runs out, by the account it was given to. */
const TOKENS = new Map<string, { token: string; until: number }>();

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url');

/** Why Drive refused, as it says it: the first reason of its error body, and its message. */
async function refusal(res: Response): Promise<{ reason: string; message: string }> {
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } | string; error_description?: string };
    if (typeof body.error === 'string') return { reason: body.error, message: body.error_description ?? body.error };
    return { reason: body.error?.errors?.[0]?.reason ?? '', message: body.error?.message ?? res.statusText };
  } catch {
    return { reason: '', message: res.statusText };
  }
}

export interface DriveDeps {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Files asked for a page. Drive gives at most 1,000. */
  pageSize?: number;
}

export function googleDrive(deps: DriveDeps = {}): FolderProvider {
  const call = deps.fetch ?? ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init));
  const account = () => serviceAccount(deps.env);
  const pageSize = Math.min(Math.max(deps.pageSize ?? 1000, 1), 1000);

  async function token(fresh = false): Promise<string> {
    const held = account();
    if (!held) throw new Error('Google Drive is not set up on this deployment.');
    const cached = TOKENS.get(held.client_email);
    if (!fresh && cached && cached.until > Date.now()) return cached.token;
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: held.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
    let signature: string;
    try {
      signature = createSign('RSA-SHA256').update(unsigned).sign(held.private_key).toString('base64url');
    } catch {
      throw new Error('The Google service account’s key could not be used.');
    }
    const res = await call(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    });
    if (!res.ok) throw new Error(`Google did not accept the service account: ${(await refusal(res)).message}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Google gave no token for the service account.');
    TOKENS.set(held.client_email, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 });
    return body.access_token;
  }

  /** One call to Drive as the account. A token Drive no longer takes is asked for again, once. */
  async function drive(path: string, params: Record<string, string>): Promise<Response> {
    const url = `${API}${path}?${new URLSearchParams(params).toString()}`;
    let res = await call(url, { headers: { authorization: `Bearer ${await token()}` } });
    if (res.status === 401) res = await call(url, { headers: { authorization: `Bearer ${await token(true)}` } });
    return res;
  }

  function entryOf(file: DriveFile): RemoteEntry {
    const type = file.mimeType ?? 'application/octet-stream';
    const name = (file.name ?? 'Untitled').slice(0, 240);
    const exported = EXPORTED_AS[type];
    const google = GOOGLE_TYPE.test(type);
    const size = Number(file.size);
    return {
      id: file.id,
      name: exported && !name.toLowerCase().endsWith(exported.ext) ? `${name}${exported.ext}` : name,
      mimeType: exported?.mimeType ?? type,
      folder: type === FOLDER_TYPE,
      // A Google document's size is of its own storage, not of the file it is exported as.
      ...(!google && Number.isFinite(size) ? { sizeBytes: size } : {}),
      checksum: file.md5Checksum ?? `changed:${file.modifiedTime ?? ''}`,
      contentChecksum: Boolean(file.md5Checksum),
      ...(file.modifiedTime ? { modifiedAt: file.modifiedTime } : {}),
      ...(file.webViewLink ? { link: file.webViewLink } : {}),
      ...(exported ? { exported: true as const } : {}),
      ...(google && !exported && type !== FOLDER_TYPE ? { unreadable: NOT_A_FILE[type] ?? 'A Google file of a kind that cannot be exported.' } : {}),
    };
  }

  return {
    kind: 'google_drive',
    configured: () => Boolean(account()),
    address: () => account()?.client_email,

    async folder(folderId) {
      const res = await drive(`/files/${encodeURIComponent(folderId)}`, { fields: 'id,name,mimeType,webViewLink,trashed', supportsAllDrives: 'true' });
      if (res.status === 404) throw new FolderGone();
      if (!res.ok) throw new Error(`Google Drive did not answer for the folder: ${(await refusal(res)).message}`);
      const file = (await res.json()) as DriveFile & { trashed?: boolean };
      if (file.mimeType !== FOLDER_TYPE) throw new FolderGone('That link is to a file, not a folder.');
      if (file.trashed) throw new FolderGone('That folder is in the bin.');
      return { id: file.id, name: file.name ?? 'Folder', ...(file.webViewLink ? { link: file.webViewLink } : {}) };
    },

    async list(folderId, since) {
      // The id is letters, digits, dashes and underscores (`folderIdOf`); a quote in one would end the query's string.
      if (!/^[A-Za-z0-9_-]+$/.test(folderId)) throw new FolderGone();
      const after = since ? new Date(since).toISOString() : undefined;
      const q = [`'${folderId}' in parents`, 'trashed = false', ...(after ? [`(mimeType = '${FOLDER_TYPE}' or modifiedTime > '${after}' or createdTime > '${after}')`] : [])].join(' and ');
      const out: RemoteEntry[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive('/files', {
          q,
          fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,webViewLink)',
          pageSize: String(pageSize),
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        });
        // A folder the account cannot see is, to Drive, a folder that is not there.
        if (res.status === 404) throw new FolderGone();
        if (!res.ok) throw new Error(`Google Drive did not list the folder: ${(await refusal(res)).message}`);
        const page = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
        out.push(...(page.files ?? []).filter((file) => typeof file.id === 'string').map(entryOf));
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
      return out;
    },

    async download(entry, maxBytes) {
      const res = entry.exported
        ? await drive(`/files/${encodeURIComponent(entry.id)}/export`, { mimeType: entry.mimeType })
        : await drive(`/files/${encodeURIComponent(entry.id)}`, { alt: 'media', supportsAllDrives: 'true' });
      if (!res.ok) {
        const why = await refusal(res);
        if (why.reason === 'exportSizeLimitExceeded') throw new FileUnreadable('Too large to export from Google Drive, which exports up to 10 MB.');
        if (why.reason === 'cannotDownloadFile' || why.reason === 'cannotDownloadAbusiveFile' || why.reason === 'fileNotExportable') throw new FileUnreadable('Google Drive does not allow this file to be downloaded.');
        if (res.status === 404) throw new FileUnreadable('The file is no longer in the folder.');
        throw new Error(`Google Drive did not give ${entry.name}: ${why.message}`);
      }
      const length = Number(res.headers.get('content-length'));
      if (Number.isFinite(length) && length > maxBytes) throw new FileUnreadable(tooLarge(maxBytes));
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > maxBytes) throw new FileUnreadable(tooLarge(maxBytes));
      return bytes;
    },
  };
}
