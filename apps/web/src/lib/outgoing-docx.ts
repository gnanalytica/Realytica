import type { OutgoingDocument } from '@realytica/shared';

/**
 * A draft that goes out, as a Word document.
 *
 * Built from the layout the shared rules give (`outgoingDocument`), the way
 * a report's file is built: in a plain firm template, by the `docx` library,
 * loaded when the file is asked for and not with the app. Until the draft is
 * approved its header says so, and a header is on every page. Once approved
 * the file carries who approved it and when, and no header.
 *
 * Gives the file's bytes. Nothing here touches the page or the network, so
 * the bytes a person saves are the bytes a test reads back.
 */
export async function outgoingDocx(file: OutgoingDocument): Promise<Uint8Array> {
  const { AlignmentType, BorderStyle, Document, Footer, Header, Packer, PageNumber, Paragraph, TextRun } = await import('docx');
  const quiet = '555555';

  const head = file.head.map(
    (row, at) =>
      new Paragraph({
        spacing: { after: at === file.head.length - 1 ? 280 : 40 },
        ...(at === file.head.length - 1 ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 8 } } } : {}),
        children: [new TextRun({ text: `${row.label}: `, bold: true }), new TextRun(row.value ? { text: row.value } : { text: 'Not said yet', italics: true, color: quiet })],
      }),
  );

  const body = file.body.length
    ? file.body.map((part) =>
        part.kind === 'heading'
          ? new Paragraph({ keepNext: true, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: part.text, bold: true })] })
          : part.kind === 'item'
            ? new Paragraph({ spacing: { after: 60 }, indent: { left: 360, hanging: 360 }, children: [new TextRun(part.text)] })
            : new Paragraph({ spacing: { after: 160 }, children: [new TextRun(part.text)] }),
      )
    : [new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'The body is not written yet.', italics: true, color: quiet })] })];

  const sources = file.sources.length
    ? [
        new Paragraph({ keepNext: true, spacing: { before: 360, after: 80 }, children: [new TextRun({ text: 'Sources', bold: true })] }),
        ...file.sources.map((line, at) => new Paragraph({ spacing: { after: 60 }, indent: { left: 360, hanging: 360 }, children: [new TextRun({ text: `${at + 1}. ${line}`, size: 20 })] })),
      ]
    : [];

  const document = new Document({
    creator: 'Realytica',
    title: file.fileName.replace(/\.docx$/, ''),
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        properties: {},
        ...(file.banner
          ? { headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: file.banner, bold: true, color: 'B42318' })] })] }) } }
          : {}),
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${file.head.find((row) => row.label === 'Reference')?.value ?? ''} · page `, size: 16, color: '777777' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '777777' }),
                  new TextRun({ text: ' of ', size: 16, color: '777777' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '777777' }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: file.title, bold: true, size: 32 })] }),
          ...head,
          ...body,
          ...(file.approval ? [new Paragraph({ spacing: { before: 320 }, children: [new TextRun({ text: file.approval, italics: true })] })] : []),
          ...sources,
        ],
      },
    ],
  });
  return Packer.pack(document, 'uint8array');
}
