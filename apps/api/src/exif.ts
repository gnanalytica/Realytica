/**
 * Minimal EXIF reader: GPS position and the moment of capture, from a JPEG.
 *
 * Hand-rolled rather than a dependency because the whole need is three tags
 * — GPSLatitude, GPSLongitude, DateTimeOriginal — and an EXIF library ships
 * a parser for hundreds, most of which (device serials, owner names) this
 * product must not read at all. Everything here is bounds-checked and every
 * failure path returns "nothing found": a malformed or stripped EXIF block
 * is the common case (WhatsApp strips it, screenshots never had it), not an
 * error.
 *
 * Why read it at all: the design doc's capture rule — a site photo enters
 * the graph "geotagged and timestamped where physical". The phone already
 * stamped where and when the shot was taken; asking the person to retype
 * what the file carries is how the mapping stops happening.
 */

export interface ExifCapture {
  lat?: number;
  lng?: number;
  /** DateTimeOriginal as ISO date-time (no timezone — EXIF does not carry one). */
  takenAt?: string;
}

const TAG_GPS_IFD = 0x8825;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LNG_REF = 0x0003;
const TAG_GPS_LNG = 0x0004;
const TAG_DATETIME_ORIGINAL = 0x9003;

export function readExifCapture(buffer: Buffer): ExifCapture {
  try {
    return parse(buffer);
  } catch {
    return {};
  }
}

function parse(buffer: Buffer): ExifCapture {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return {};

  // Walk JPEG segments for APP1/Exif.
  let offset = 2;
  let tiffStart = -1;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xda) break; // start of scan — no EXIF past here
    const size = buffer.readUInt16BE(offset + 2);
    if (marker === 0xe1 && offset + 10 <= buffer.length && buffer.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') {
      tiffStart = offset + 10;
      break;
    }
    offset += 2 + size;
  }
  if (tiffStart < 0 || tiffStart + 8 > buffer.length) return {};

  const order = buffer.toString('ascii', tiffStart, tiffStart + 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return {};
  const u16 = (at: number): number => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (at: number): number => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  if (u16(tiffStart + 2) !== 0x2a) return {};

  const inBounds = (at: number, len: number): boolean => at >= tiffStart && at + len <= buffer.length;

  interface Entry {
    type: number;
    count: number;
    /** Absolute offset of the value (inline when it fits in 4 bytes). */
    valueAt: number;
  }

  const readIfd = (ifdAt: number): Map<number, Entry> => {
    const entries = new Map<number, Entry>();
    if (!inBounds(ifdAt, 2)) return entries;
    const count = u16(ifdAt);
    for (let i = 0; i < count; i += 1) {
      const at = ifdAt + 2 + i * 12;
      if (!inBounds(at, 12)) break;
      const tag = u16(at);
      const type = u16(at + 2);
      const n = u32(at + 4);
      const typeSize = type === 3 ? 2 : type === 5 || type === 10 ? 8 : 1;
      const byteLen = n * typeSize;
      const valueAt = byteLen <= 4 ? at + 8 : tiffStart + u32(at + 8);
      entries.set(tag, { type, count: n, valueAt });
    }
    return entries;
  };

  const ascii = (entry: Entry): string | undefined => {
    if (!inBounds(entry.valueAt, entry.count)) return undefined;
    return buffer.toString('ascii', entry.valueAt, entry.valueAt + entry.count).replace(/\0+$/, '');
  };

  const rationals = (entry: Entry): number[] | undefined => {
    if (entry.type !== 5 || !inBounds(entry.valueAt, entry.count * 8)) return undefined;
    const out: number[] = [];
    for (let i = 0; i < entry.count; i += 1) {
      const num = u32(entry.valueAt + i * 8);
      const den = u32(entry.valueAt + i * 8 + 4);
      if (den === 0) return undefined;
      out.push(num / den);
    }
    return out;
  };

  const ifd0 = readIfd(tiffStart + u32(tiffStart + 4));
  const result: ExifCapture = {};

  const gpsPointer = ifd0.get(TAG_GPS_IFD);
  if (gpsPointer) {
    const gps = readIfd(tiffStart + u32(gpsPointer.valueAt));
    const latRef = gps.get(TAG_GPS_LAT_REF) && ascii(gps.get(TAG_GPS_LAT_REF) as Entry);
    const lngRef = gps.get(TAG_GPS_LNG_REF) && ascii(gps.get(TAG_GPS_LNG_REF) as Entry);
    const latDms = gps.get(TAG_GPS_LAT) && rationals(gps.get(TAG_GPS_LAT) as Entry);
    const lngDms = gps.get(TAG_GPS_LNG) && rationals(gps.get(TAG_GPS_LNG) as Entry);
    if (latDms && latDms.length === 3 && lngDms && lngDms.length === 3) {
      const lat = (latDms[0] + latDms[1] / 60 + latDms[2] / 3600) * (latRef === 'S' ? -1 : 1);
      const lng = (lngDms[0] + lngDms[1] / 60 + lngDms[2] / 3600) * (lngRef === 'W' ? -1 : 1);
      // (0, 0) is the null island every stripped-GPS writer emits — not a place.
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
        result.lat = Math.round(lat * 1e6) / 1e6;
        result.lng = Math.round(lng * 1e6) / 1e6;
      }
    }
  }

  const exifPointer = ifd0.get(TAG_EXIF_IFD);
  if (exifPointer) {
    const exif = readIfd(tiffStart + u32(exifPointer.valueAt));
    const dtEntry = exif.get(TAG_DATETIME_ORIGINAL);
    const raw = dtEntry ? ascii(dtEntry) : undefined;
    // EXIF format: "YYYY:MM:DD HH:MM:SS".
    const match = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (match) {
      const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
      if (Number.isFinite(Date.parse(iso))) result.takenAt = iso;
    }
  }

  return result;
}
