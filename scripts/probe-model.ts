/**
 * Does a document survive the hop to this model?
 *
 * Reaching a vendor other than Anthropic means going through a gateway that
 * speaks Anthropic's format and routes onward, and the whole case for that
 * rests on one claim: the gateway carries a `document` block and a citation
 * request through to whatever vendor answers. Measured against a real proxy,
 * a PDF reaches Gemini as `inline_data` and an OpenAI-shaped endpoint not at
 * all — silently. So it is a claim to check per model, not to assume.
 *
 * It is a CLI and not a test because it needs a live proxy and spends real
 * money, and it drives the production provider rather than a hand-rolled
 * request — a probe that exercises its own transport proves nothing about the
 * one the agents use.
 *
 *   pnpm probe:model --model anthropic/claude-haiku-4.5
 *   pnpm probe:model --model google/gemini-2.5-flash --pdf ./some-scan.pdf
 *
 * With no --pdf it generates a one-page PDF containing a made-up khata number
 * and asks for it back. A model that answers correctly read the document; one
 * that says it cannot see a document was handed nothing.
 */
import { readFile } from 'node:fs/promises';
import { anthropicProvider } from '@realytica/agents';
import type { LlmRequest } from '@realytica/agents';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** The fact planted in the generated PDF. Distinctive enough that a model cannot guess it. */
const PLANTED = 'KH-7741-B/2019';

/**
 * A one-page PDF with a single line of text.
 *
 * Written by hand rather than with a library because the probe must not depend
 * on anything the app does not already ship, and because an uncompressed PDF
 * is legible in a hex dump when the answer is confusing.
 */
function samplePdf(): Buffer {
  const text = `BT /F1 14 Tf 60 720 Td (Khata No. ${PLANTED}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function main(): Promise<void> {
  const model = arg('model');
  if (!model) {
    console.error('Name the model to probe, as LiteLLM knows it: --model realytica-extraction');
    process.exitCode = 1;
    return;
  }

  const endpoint = process.env.REALYTICA_BASE_URL?.trim();
  console.log(`Endpoint  ${endpoint || 'api.anthropic.com (REALYTICA_BASE_URL is unset)'}`);
  console.log(`Model     ${model}`);

  const pdfPath = arg('pdf');
  const bytes = pdfPath ? await readFile(pdfPath) : samplePdf();
  const question = pdfPath
    ? 'Quote the single most identifying number in this document, and say which page it is on.'
    : `Read the attached document and reply with the khata number exactly as written. Nothing else.`;
  console.log(`Document  ${pdfPath ?? `generated, one page, contains ${PLANTED}`} (${bytes.length} bytes)\n`);

  const request: LlmRequest = {
    agent: 'document_intelligence',
    model,
    maxTokens: 512,
    system: [{ text: 'You read property documents. Answer only from what the attached document actually says.' }],
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          document: { base64: bytes.toString('base64'), mediaType: 'application/pdf', title: 'probe.pdf', wantCitations: true },
        },
        { type: 'text', text: question },
      ],
    }],
  };

  const started = Date.now();
  const result = await anthropicProvider.complete(request);
  const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const citations = result.content.flatMap(b => (b.type === 'text' && b.citations ? b.citations : []));

  console.log(`Answer    ${text || '(empty)'}`);
  console.log(`Citations ${citations.length === 0 ? 'none returned' : citations.map(c => `p${c.page ?? '?'} ${c.verified ? '(verified)' : '(self-reported)'}`).join(', ')}`);
  if (result.capabilityGaps.length > 0) console.log(`Gaps      ${result.capabilityGaps.join(', ')}`);
  console.log(`Tokens    ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, ${Date.now() - started}ms\n`);

  // Stated as three separate verdicts because they fail independently: a
  // proxy can deliver the bytes and drop the citation request, which reads as
  // success right up until a page reference in a report turns out to be a
  // guess.
  const readIt = pdfPath ? text.length > 0 : text.includes(PLANTED);
  console.log(`Document reached the model   ${readIt ? 'yes' : 'NO — it answered without the content'}`);
  console.log(`Citations came back          ${citations.length > 0 ? 'yes' : 'no'}`);
  console.log(`Citations are verified       ${citations.some(c => c.verified) ? 'yes' : 'no — page references would be self-reported'}`);
  if (!readIt || !citations.some(c => c.verified)) {
    console.log('\nThis route cannot serve document intelligence at full fidelity. Point that\nagent at a route that can, and leave the rest here.');
  }
}

main().catch((err: unknown) => {
  console.error(`\nProbe failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
