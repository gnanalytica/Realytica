/**
 * When a file was made, read without a browser: the day on a person's own
 * clock, and the moment a camera wrote in a photograph. Kept apart from what
 * needs a page to run, so it can be checked where there is none.
 */

const two = (n: number): string => String(n).padStart(2, '0');

/** A moment as a day on this person's own clock. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * The moment a camera wrote in a JPEG (EXIF DateTimeOriginal), as
 * "YYYY-MM-DDTHH:MM:SS". Three tags are walked and nothing else is read: the
 * same file carries the phone's make and its owner's name. Undefined for a
 * file with no such tag, which is the common case for a forwarded picture.
 */
export function exifTakenAt(buffer: ArrayBuffer): string | undefined {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint16(0) !== 0xffd8) return undefined;
    let at = 2;
    while (at + 4 <= view.byteLength) {
      const marker = view.getUint16(at);
      const size = view.getUint16(at + 2);
      if (marker === 0xffda || (marker & 0xff00) !== 0xff00) return undefined;
      // "Exif\0\0", then a TIFF header.
      if (marker === 0xffe1 && view.getUint32(at + 4) === 0x45786966) {
        const tiff = at + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const u16 = (o: number) => view.getUint16(o, little);
        const u32 = (o: number) => view.getUint32(o, little);
        const entry = (ifd: number, tag: number): number | undefined => {
          const count = u16(ifd);
          for (let i = 0; i < count; i += 1) {
            const e = ifd + 2 + i * 12;
            if (u16(e) === tag) return e;
          }
          return undefined;
        };
        const exif = entry(tiff + u32(tiff + 4), 0x8769);
        if (exif === undefined) return undefined;
        const taken = entry(tiff + u32(exif + 8), 0x9003);
        if (taken === undefined) return undefined;
        const from = tiff + u32(taken + 8);
        let text = '';
        for (let i = 0; i < 19; i += 1) text += String.fromCharCode(view.getUint8(from + i));
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
        return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : undefined;
      }
      at += 2 + size;
    }
  } catch {
    /* a file that is not what it says it is carries no date */
  }
  return undefined;
}
