#!/usr/bin/env node
/**
 * File a folder of documents into a project's vault, through the API, the way
 * the web app does: each file in 4 MB parts, assembled and read on the server.
 *
 *   node scripts/load-documents.mjs --folder <dir> --project <projectId>
 *   node scripts/load-documents.mjs --folder <dir> --create "Name" --city Bengaluru --location "Locality" [--stage construction]
 *
 * Options
 *   --api <url>       API base, default http://localhost:5174/api
 *   --token <token>   Bearer token; or set REALYTICA_TOKEN. Not needed when the
 *                     API runs with REALYTICA_AUTH_MODE=off.
 *   --only <a,b>      file names (or parts of them) to load, comma-separated
 *   --read            afterwards, ask the chat to read the filed documents
 *                     (the model reads what the local reader could not)
 *
 * Nothing is read from or written to anywhere but the API it is pointed at.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const API = (opt('api', process.env.REALYTICA_API ?? 'http://localhost:5174/api')).replace(/\/+$/, '');
const TOKEN = opt('token', process.env.REALYTICA_TOKEN);
const folder = opt('folder');
if (!folder) {
  console.error('Give --folder <dir>.');
  process.exit(2);
}

const TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain' };

async function call(method, route, body, raw) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${json.error ?? text.slice(0, 200)}`);
  return json;
}

async function projectId() {
  const given = opt('project');
  if (given) return given;
  const name = opt('create');
  if (!name) throw new Error('Give --project <id> or --create "Name".');
  const created = await call('POST', '/projects', {
    name,
    type: opt('type', 'residential'),
    city: opt('city', 'Bengaluru'),
    location: opt('location', name),
    currentStage: opt('stage', 'opportunity_site'),
  });
  console.log(`Created ${created.reference} ${created.name} (${created.id})`);
  return created.id;
}

async function fileOne(id, file) {
  const bytes = await readFile(file);
  const name = path.basename(file);
  const contentType = TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
  const started = Date.now();
  const upload = await call('POST', `/projects/${id}/uploads`, { fileName: name, contentType, size: bytes.length });
  for (let n = 0; n < upload.parts; n += 1) {
    const part = bytes.subarray(n * upload.partBytes, Math.min(bytes.length, (n + 1) * upload.partBytes));
    for (let attempt = 1; ; attempt += 1) {
      try {
        await call('PUT', `/projects/${id}/uploads/${upload.uploadId}/parts/${n}`, undefined, part);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
      }
    }
    process.stdout.write(`\r  ${name}: ${n + 1}/${upload.parts} parts`);
  }
  const done = await call('POST', `/projects/${id}/uploads/${upload.uploadId}/complete`, {});
  const row = done.project.evidence.find((e) => e.id === done.evidenceId);
  const facts = (row?.facts ?? []).length;
  console.log(`\r  ${name}: filed as ${row?.documentType ?? 'a document'}${facts ? `, ${facts} facts read` : ''} (${((Date.now() - started) / 1000).toFixed(0)}s, ${(bytes.length / 1048576).toFixed(1)} MB)`);
}

const id = await projectId();
const only = (opt('only') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const names = (await readdir(folder)).filter((n) => !n.startsWith('.') && TYPES[path.extname(n).toLowerCase()]).filter((n) => !only.length || only.some((o) => n.toLowerCase().includes(o))).sort();
for (const name of names) {
  const file = path.join(folder, name);
  if (!(await stat(file)).isFile()) continue;
  try {
    await fileOne(id, file);
  } catch (err) {
    console.log(`\r  ${name}: FAILED — ${err.message}`);
  }
}
if (flag('read')) {
  console.log('Asking the chat to read what the local reader could not…');
  const res = await fetch(`${API}/projects/${id}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ question: 'Read the filed documents' }),
  });
  const text = await res.text();
  console.log(`  ${res.status}: ${text.split('\n').filter(Boolean).length} events`);
}
console.log(`Done: ${API.replace(/\/api$/, '')}/projects/${id}`);
