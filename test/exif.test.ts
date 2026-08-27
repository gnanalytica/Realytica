/**
 * The EXIF capture reader.
 *
 * The buffer under test is built byte-by-byte rather than committed as a
 * binary fixture, so the test states exactly which tags it wrote and the
 * parser cannot pass by accident. The load-bearing properties: a real GPS +
 * DateTimeOriginal block reads back to the coordinates and moment the tags
 * encode; a stripped, truncated or non-JPEG buffer reads back to nothing —
 * never a throw, never a fabricated position; and null island is treated as
 * no fix, not as a place.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readExifCapture } from '../apps/api/src/exif';

/** Little-endian TIFF/EXIF block with a GPS IFD and an Exif IFD, wrapped as a JPEG APP1 segment. */
function jpegWithExif(options: { latDms?: [number, number, number]; latRef?: string; lngDms?: [number, number, number]; lngRef?: string; dateTime?: string }): Buffer {
  const chunks: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

  // Layout (offsets relative to TIFF start):
  //   0  header (8)
  //   8  IFD0: count + 2 entries + next = 2 + 24 + 4 = 30  -> ends 38
  //  38  GPS IFD: count + 4 entries + next = 2 + 48 + 4 = 54 -> ends 92
  //  92  Exif IFD: count + 1 entry + next = 2 + 12 + 4 = 18 -> ends 110
  // 110  lat rationals (24), 134 lng rationals (24), 158 datetime (20)
  const GPS_IFD = 38;
  const EXIF_IFD = 92;
  const LAT_AT = 110;
  const LNG_AT = 134;
  const DT_AT = 158;

  chunks.push(0x49, 0x49, ...u16(0x2a), ...u32(8)); // II, 42, IFD0 at 8

  // IFD0
  chunks.push(...u16(2));
  chunks.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(GPS_IFD)); // GPS pointer
  chunks.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(EXIF_IFD)); // Exif pointer
  chunks.push(...u32(0));

  // GPS IFD
  const ref = (s: string) => [s.charCodeAt(0), 0, 0, 0];
  chunks.push(...u16(4));
  chunks.push(...u16(0x0001), ...u16(2), ...u32(2), ...ref(options.latRef ?? 'N'));
  chunks.push(...u16(0x0002), ...u16(5), ...u32(3), ...u32(LAT_AT));
  chunks.push(...u16(0x0003), ...u16(2), ...u32(2), ...ref(options.lngRef ?? 'E'));
  chunks.push(...u16(0x0004), ...u16(5), ...u32(3), ...u32(LNG_AT));
  chunks.push(...u32(0));

  // Exif IFD
  chunks.push(...u16(1));
  chunks.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(DT_AT));
  chunks.push(...u32(0));

  // Value area
  const rational = (value: number) => [...u32(Math.round(value * 100)), ...u32(100)];
  for (const part of options.latDms ?? [0, 0, 0]) chunks.push(...rational(part));
  for (const part of options.lngDms ?? [0, 0, 0]) chunks.push(...rational(part));
  const dt = (options.dateTime ?? '2026:08:14 10:30:00').padEnd(19, ' ');
  for (const ch of dt) chunks.push(ch.charCodeAt(0));
  chunks.push(0);

  const tiff = Buffer.from(chunks);
  const app1Body = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    Buffer.from([(app1Body.length + 2) >> 8, (app1Body.length + 2) & 0xff]),
    app1Body,
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe('readExifCapture', () => {
  it('reads a Bengaluru fix and the capture moment out of a GPS-tagged JPEG', () => {
    const jpeg = jpegWithExif({
      latDms: [12, 58, 17.64],
      lngDms: [77, 35, 34.56],
      dateTime: '2026:08:14 10:30:00',
    });
    const capture = readExifCapture(jpeg);
    assert.ok(capture.lat !== undefined && Math.abs(capture.lat - 12.9716) < 0.0005, `lat ${capture.lat}`);
    assert.ok(capture.lng !== undefined && Math.abs(capture.lng - 77.5929) < 0.0005, `lng ${capture.lng}`);
    assert.equal(capture.takenAt, '2026-08-14T10:30:00');
  });

  it('a southern/western fix carries its sign', () => {
    const capture = readExifCapture(jpegWithExif({ latDms: [33, 51, 0], latRef: 'S', lngDms: [151, 12, 0], lngRef: 'E' }));
    assert.ok((capture.lat ?? 0) < 0, 'south of the equator is negative');
    assert.ok((capture.lng ?? 0) > 0);
  });

  it('null island is no fix, not a place', () => {
    const capture = readExifCapture(jpegWithExif({ latDms: [0, 0, 0], lngDms: [0, 0, 0] }));
    assert.equal(capture.lat, undefined);
    assert.equal(capture.lng, undefined);
  });

  it('a stripped, truncated or non-JPEG buffer reads back to nothing, never a throw', () => {
    assert.deepEqual(readExifCapture(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), {});
    assert.deepEqual(readExifCapture(Buffer.from('not a jpeg at all')), {});
    assert.deepEqual(readExifCapture(jpegWithExif({ latDms: [12, 58, 17] }).subarray(0, 30)), {});
    assert.deepEqual(readExifCapture(Buffer.alloc(0)), {});
  });
});
