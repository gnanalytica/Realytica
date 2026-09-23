/**
 * pdf.js ships its worker as a plain module with no type declaration. It is
 * imported only to hand to pdf.js as `globalThis.pdfjsWorker`, so its shape
 * is never read here.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
