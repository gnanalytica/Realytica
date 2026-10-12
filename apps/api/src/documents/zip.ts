/**
 * A zip read and written without a library, for the two files that are one:
 * a Word document and a workbook.
 *
 * Read by its index (the central directory), every offset checked against
 * the file's own length, as `docx-outline` and `workbookMayBeOpened` read
 * one. Nothing is unpacked on the way: an entry is unpacked only when it is
 * asked for, and only under a limit the caller gives, because a file may say
 * anything about its own sizes.
 *
 * Written so that a part can be replaced and every other part goes back as
 * the bytes it came in as, still packed. That is what keeps a filled
 * template's styles, images and numbering exactly as they were sent.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  /** 0 is stored, 8 is deflated. Anything else is carried and never unpacked. */
  method: number;
  /** The bytes as they sit in the file, still packed. */
  data: Buffer;
  crc: number;
  /** The size the file gives for the entry unpacked. Not trusted for anything but writing it back. */
  size: number;
  time: number;
  date: number;
  external: number;
}

/** A file that is not a zip this can read. Its message is for the person who sent it. */
export class NotAZip extends Error {}

/** An entry that unpacks to more than it may. */
export class ZipTooLarge extends Error {}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The entries of a zip, in the order its index lists them. Refuses a file
 * with no index, one whose index points outside it, one split or in the
 * 64-bit form, and one that lists more entries than `maxEntries`.
 */
export function readZip(zip: Buffer, maxEntries = 2000): ZipEntry[] {
  // End of central directory: the last 22 bytes, plus up to 64 KB of comment.
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new NotAZip('That file could not be opened: it is not a Word document or a workbook.');
  const count = zip.readUInt16LE(end + 10);
  if (count > maxEntries) throw new ZipTooLarge(`That file holds ${count.toLocaleString('en-IN')} parts, more than can be opened.`);
  let at = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new NotAZip('That file could not be opened: its index is damaged.');
    const method = zip.readUInt16LE(at + 10);
    const time = zip.readUInt16LE(at + 12);
    const date = zip.readUInt16LE(at + 14);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const external = zip.readUInt32LE(at + 38);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new ZipTooLarge('That file is too large to open.');
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new NotAZip('That file could not be opened: its index is damaged.');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (start + compressed > zip.length) throw new NotAZip('That file could not be opened: its index is damaged.');
    entries.push({ name, method, data: zip.subarray(start, start + compressed), crc, size, time, date, external });
  }
  return entries;
}

/**
 * One entry unpacked, to no more than `max` bytes: unpacking stops there and
 * the entry is refused, whatever size the file gave for it.
 */
export function unpack(entry: ZipEntry, max: number): Buffer {
  if (entry.method === 0) {
    if (entry.data.length > max) throw new ZipTooLarge(`${entry.name} is too large to open.`);
    return Buffer.from(entry.data);
  }
  if (entry.method !== 8) throw new NotAZip(`${entry.name} is packed in a way that cannot be opened.`);
  try {
    return inflateRawSync(entry.data, { maxOutputLength: max });
  } catch {
    throw new ZipTooLarge(`${entry.name} is too large to open, or is damaged.`);
  }
}

/** An entry made from its unpacked bytes, taking the place of `like` where one is given. */
export function packed(name: string, content: Buffer, like?: ZipEntry): ZipEntry {
  // 1 January 2020, midnight: a file written by code carries no clock of its own.
  return { name, method: 8, data: deflateRawSync(content), crc: crc32(content), size: content.length, time: like?.time ?? 0, date: like?.date ?? 0x5021, external: like?.external ?? 0 };
}

/** A zip of these entries, in this order. Each goes in as the bytes it holds: nothing is packed again. */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const index: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // Bit 11: the name is UTF-8. No data descriptor follows: the sizes are in the header.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(entry.time, 10);
    local.writeUInt16LE(entry.date, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.size, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt16LE(entry.time, 12);
    central.writeUInt16LE(entry.date, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.external, 38);
    central.writeUInt32LE(offset, 42);
    index.push(central, name);
    offset += 30 + name.length + entry.data.length;
  }
  const indexBytes = Buffer.concat(index);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(indexBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, indexBytes, end]);
}

/** A zip of these files, each packed: how a test, or a writer starting from nothing, makes one. */
export function zipOf(files: ReadonlyArray<{ name: string; content: string | Buffer }>): Buffer {
  return writeZip(files.map((file) => packed(file.name, Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8'))));
}
