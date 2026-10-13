/**
 * Asking by voice and hearing the answer.
 *
 * The browser listens and speaks; these are the choices made around it. Which
 * languages are offered and whose choice is kept, how heard words join what
 * is in the message box without typing over a correction, what of an answer
 * is read aloud and in which voice, and the one line the model is given so
 * that a question in another language is answered in it with the record's
 * figures, names and numbers left as they are.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createProject } from '@realytica/shared';
import {
  SPEECH_LANGUAGES,
  SPEECH_NOTICE,
  canReadAloud,
  chosenLanguage,
  dictationFrom,
  dictationStep,
  languageOfText,
  noVoiceSaid,
  pickVoice,
  recogniserOf,
  sourcesSaid,
  speechChunks,
  speechLanguageKey,
  speechLanguages,
  speechRefused,
  spokenAnswer,
} from '../apps/web/src/components/chat/speech';

describe('whether the browser can', () => {
  it('finds the recogniser under either name, and nothing where there is none', () => {
    class Rec {}
    assert.equal(recogniserOf({ SpeechRecognition: Rec }), Rec);
    assert.equal(recogniserOf({ webkitSpeechRecognition: Rec }), Rec);
    assert.equal(recogniserOf({}), undefined);
    assert.equal(recogniserOf(undefined), undefined);
    assert.equal(recogniserOf({ SpeechRecognition: 'yes' }), undefined);
  });

  it('reads aloud only with both the speaker and what it is handed', () => {
    const speechSynthesis = { speak() {}, cancel() {} };
    class SpeechSynthesisUtterance {}
    assert.equal(canReadAloud({ speechSynthesis, SpeechSynthesisUtterance }), true);
    assert.equal(canReadAloud({ speechSynthesis }), false);
    assert.equal(canReadAloud({ SpeechSynthesisUtterance }), false);
    assert.equal(canReadAloud({}), false);
  });

  it('says in one line who turns speech into text', () => {
    assert.match(SPEECH_NOTICE, /by your browser/);
    assert.ok(!SPEECH_NOTICE.includes('\n') && SPEECH_NOTICE.length < 100);
  });
});

describe('the language spoken', () => {
  it('offers the five, then the browser’s own', () => {
    const offered = speechLanguages(['en-GB', 'mr-IN', 'hi', 'en-IN', 'EN-in', 'not a tag', '']);
    assert.deepEqual(
      offered.map((l) => l.tag),
      ['en-IN', 'hi-IN', 'kn-IN', 'ta-IN', 'te-IN', 'en-GB', 'mr-IN'],
      'a bare language already offered, a repeat and a non-tag are left out',
    );
    assert.equal(offered[0]!.label, 'English (India)');
    assert.match(offered.find((l) => l.tag === 'mr-IN')!.label, /Marathi/);
    assert.deepEqual(speechLanguages(), [...SPEECH_LANGUAGES]);
  });

  it('keeps each person’s choice under their own key', () => {
    assert.notEqual(speechLanguageKey('person-a'), speechLanguageKey('person-b'));
    assert.equal(speechLanguageKey(undefined), speechLanguageKey('  '));
  });

  it('listens in what was chosen before while it is still offered, else English (India)', () => {
    const offered = speechLanguages(['mr-IN']);
    assert.equal(chosenLanguage('kn-IN', offered), 'kn-IN');
    assert.equal(chosenLanguage('MR-in', offered), 'mr-IN');
    assert.equal(chosenLanguage('fr-FR', offered), 'en-IN', 'a choice the browser no longer lists');
    assert.equal(chosenLanguage(null, offered), 'en-IN');
  });
});

describe('words into the message box', () => {
  const heard = (transcript: string, final = false) => ({ transcript, final });

  it('writes what is heard after what was typed, as it is recognised', () => {
    let held = dictationFrom('On Title:');
    held = dictationStep(held, 'On Title:', [heard('what is')]);
    assert.equal(held.wrote, 'On Title: what is');
    held = dictationStep(held, held.wrote, [heard(' what is the extent ', true)]);
    assert.equal(held.wrote, 'On Title: what is the extent', 'a later guess replaces the earlier one');
  });

  it('starts an empty box with no space, and changes nothing while nothing is heard', () => {
    assert.equal(dictationStep(dictationFrom(''), '', [heard('ಜಮೀನಿನ ವಿಸ್ತೀರ್ಣ ಎಷ್ಟು')]).wrote, 'ಜಮೀನಿನ ವಿಸ್ತೀರ್ಣ ಎಷ್ಟು');
    assert.equal(dictationStep(dictationFrom('typed'), 'typed', []).wrote, 'typed');
    assert.equal(dictationStep(dictationFrom('typed'), 'typed', [heard('  ')]).wrote, 'typed');
  });

  it('never types over a correction', () => {
    let held = dictationFrom('');
    held = dictationStep(held, '', [heard('what is the extant', true), heard('of the')]);
    assert.equal(held.wrote, 'what is the extant of the');
    // The person fixes a word while the browser is still listening.
    const fixed = 'what is the extent';
    held = dictationStep(held, fixed, [heard('what is the extant', true), heard('of the plot')]);
    assert.equal(held.wrote, 'what is the extent of the plot', 'the fixed words stay and only what is still being heard is added');
    held = dictationStep(held, held.wrote, [heard('what is the extant', true), heard('of the plot in Whitefield', true)]);
    assert.equal(held.wrote, 'what is the extent of the plot in Whitefield');
  });

  it('adds nothing after a correction when everything heard is already settled', () => {
    const held = dictationStep({ base: '', from: 0, wrote: 'one two' }, 'one', [heard('one two', true)]);
    assert.equal(held.wrote, 'one');
  });

  it('says why the browser would not listen, and nothing when the person said nothing', () => {
    assert.equal(speechRefused('no-speech', 'Hindi'), null);
    assert.equal(speechRefused('aborted', 'Hindi'), null);
    assert.match(speechRefused('not-allowed', 'Hindi')!, /microphone was not allowed/);
    assert.match(speechRefused('language-not-supported', 'Telugu')!, /does not take Telugu/);
    assert.match(speechRefused('network', 'Hindi')!, /speech service/);
    assert.match(speechRefused('something-new', 'Hindi')!, /type the question/);
  });
});

describe('what is read aloud from an answer', () => {
  it('reads the words, not the citations, and says how many sources', () => {
    const spoken = spokenAnswer(
      'On Title: the extent is **2,023 sqm** [ev:ev_deed:p3], and the khata agrees [ev:ev_khata]. The sketch differs [ev:ev_deed:p5] [ev:ev_sketch].',
    );
    assert.deepEqual(spoken.lines, ['On Title: the extent is 2,023 sqm, and the khata agrees. The sketch differs.', 'Three sources.']);
    assert.equal(spoken.sources, 3, 'two pages of one paper are one source');
    assert.equal(spoken.language, 'en-IN');
  });

  it('says one source as one, and says nothing of sources when there are none', () => {
    assert.equal(spokenAnswer('The deed is registered [ev:ev_deed].').lines.at(-1), 'One source.');
    assert.deepEqual(spokenAnswer('Nothing on the file says.').lines, ['Nothing on the file says.']);
    assert.deepEqual(spokenAnswer('[ev:ev_deed]').lines, [], 'a citation alone is nothing to read');
    assert.equal(sourcesSaid(14), '14 sources.');
    assert.equal(sourcesSaid(0), '');
  });

  it('says one source as one in each language offered', () => {
    assert.equal(sourcesSaid(1, 'hi-IN'), '1 स्रोत.');
    assert.equal(sourcesSaid(1, 'kn-IN'), '1 ಮೂಲ.');
    assert.equal(sourcesSaid(2, 'kn-IN'), '2 ಮೂಲಗಳು.');
    assert.equal(sourcesSaid(1, 'ta-IN'), '1 ஆதாரம்.');
    assert.equal(sourcesSaid(3, 'ta-IN'), '3 ஆதாரங்கள்.');
    assert.equal(sourcesSaid(1, 'te-IN'), '1 ఆధారం.');
    assert.equal(sourcesSaid(4, 'te-IN'), '4 ఆధారాలు.');
    assert.equal(spokenAnswer('ಒಟ್ಟು ವೆಚ್ಚ ₹1.25 Cr ಆಗಿದೆ [ev:ev_cr].').lines.at(-1), '1 ಮೂಲ.');
  });

  it('passes over an empty cell of a table, and does not read its column’s name alone', () => {
    const spoken = spokenAnswer(['| Package | Budget | Forecast |', '|---|---|---|', '| Civil | ₹4.2 Cr | ₹4.6 Cr |', '| MEP |  | ₹1.1 Cr |', '| Lifts | [ev:ev_a] | |'].join('\n'));
    assert.deepEqual(spoken.lines, ['Package: Civil, Budget: ₹4.2 Cr, Forecast: ₹4.6 Cr.', 'Package: MEP, Forecast: ₹1.1 Cr.', 'Package: Lifts.', 'One source.']);
  });

  it('does not read a sentence that only pointed at its citations', () => {
    assert.deepEqual(spokenAnswer('See [ev:ev_a][ev:ev_a:p2] and [notes:mtg_1].').lines, [], 'nothing is left to say, so nothing is said');
    assert.deepEqual(spokenAnswer('The khata agrees [ev:ev_khata]. See also [ev:ev_deed] and [ev:ev_sketch].').lines, ['The khata agrees.', 'Three sources.']);
    assert.deepEqual(spokenAnswer('खाता यही कहता है [ev:ev_khata]। देखें [ev:ev_deed] और [ev:ev_sketch]।').lines, ['खाता यही कहता है।', '3 स्रोत.']);
    // A sentence with something to say is read, short as it may be, and so is one that cites nothing.
    assert.deepEqual(spokenAnswer('Approved [ev:ev_a]. See the deed [ev:ev_deed]. See and.').lines, ['Approved. See the deed. See and.', 'Two sources.']);
  });

  it('reads a record by its name and leaves an id it cannot name unread', () => {
    const spoken = spokenAnswer('Open [dd-risk-1] before [dd-risk-…cut].', { nodeName: (id) => (id === 'dd-risk-1' ? 'Access road encroachment' : undefined) });
    assert.deepEqual(spoken.lines, ['Open Access road encroachment before.']);
  });

  it('reads lists a line at a time and a table a row at a time, each cell after its column', () => {
    const spoken = spokenAnswer(['Two things are open:', '- Fire NOC [ev:ev_noc]', '- Khata transfer', '', '| Paper | Extent |', '|---|---|', '| Sale deed | 2,023 sqm |', '| Khata | 2,010 sqm |'].join('\n'));
    assert.deepEqual(spoken.lines, ['Two things are open.', 'Fire NOC.', 'Khata transfer.', 'Paper: Sale deed, Extent: 2,023 sqm.', 'Paper: Khata, Extent: 2,010 sqm.', 'One source.']);
  });

  it('says where a statement stood, since that is part of what it claims', () => {
    const text = 'The road is 12 m wide [waiting].';
    const at = text.indexOf('[waiting]');
    const spoken = spokenAnswer(text, { places: [{ tag: 'proposed', at: [at] }] });
    assert.deepEqual(spoken.lines, ['The road is 12 m wide (waiting).']);
  });

  it('knows the language of an answer by its script, with names and figures left in Latin letters', () => {
    assert.equal(languageOfText('ಕ್ರಯಪತ್ರದ ಪ್ರಕಾರ ವಿಸ್ತೀರ್ಣ 2,023 sqm, Sy. No. 118/2, Whitefield.'), 'kn-IN');
    assert.equal(languageOfText('विक्रय पत्र के अनुसार क्षेत्रफल 2,023 sqm है।'), 'hi-IN');
    assert.equal(languageOfText('விற்பனை பத்திரத்தின்படி பரப்பு 2,023 sqm.'), 'ta-IN');
    assert.equal(languageOfText('విక్రయ పత్రం ప్రకారం విస్తీర్ణం 2,023 sqm.'), 'te-IN');
    assert.equal(languageOfText('The deed recites the vendor as ರಾಮ in one place and nowhere else in its forty pages.'), 'en-IN');
    assert.equal(languageOfText('2,023'), 'en-IN');
  });

  it('says the count of sources in the answer’s own language', () => {
    const spoken = spokenAnswer('विक्रय पत्र के अनुसार क्षेत्रफल 2,023 sqm है [ev:ev_deed:p3]। खाता भी यही कहता है [ev:ev_khata]।');
    assert.equal(spoken.language, 'hi-IN');
    assert.deepEqual(spoken.lines, ['विक्रय पत्र के अनुसार क्षेत्रफल 2,023 sqm है। खाता भी यही कहता है।', '2 स्रोत.']);
  });

  it('hands the browser pieces short enough to be read to the end', () => {
    const long = `${'The sanction plan allows four floors over a stilt. '.repeat(8)}`.trim();
    const chunks = speechChunks([long, 'Three sources.'], 120);
    assert.ok(chunks.length > 3);
    assert.ok(chunks.every((chunk) => chunk.length <= 120));
    assert.equal(chunks.join(' '), `${long} Three sources.`, 'nothing is lost or reordered');
    assert.deepEqual(speechChunks(['a,'.repeat(3) + ' ' + 'word '.repeat(60).trim()], 40).every((c) => c.length <= 40), true);
    assert.deepEqual(speechChunks(['', '  ']), []);
  });

  it('picks a voice for the answer’s language, and none of another', () => {
    const voices = [
      { name: 'English one', lang: 'en-US', localService: true },
      { name: 'Hindi online', lang: 'hi-IN', localService: false },
      { name: 'Hindi on device', lang: 'hi_IN', localService: true },
      { name: 'English India', lang: 'en-IN', localService: false },
      { name: 'Tamil elsewhere', lang: 'ta-LK', localService: true },
    ];
    assert.equal(pickVoice(voices, 'hi-IN')?.name, 'Hindi on device', 'one on the device first; Android writes the tag with an underscore');
    assert.equal(pickVoice(voices, 'en-IN')?.name, 'English India', 'the country asked for before another');
    assert.equal(pickVoice(voices, 'ta-IN')?.name, 'Tamil elsewhere', 'any voice of the language');
    assert.equal(pickVoice(voices, 'kn-IN'), undefined, 'Kannada is not read by another language’s voice');
    assert.equal(noVoiceSaid('kn-IN'), 'This device has no Kannada voice to read this.');
  });
});

describe('the instruction to the model', () => {
  const BASE = 'http://speech.test';
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  let runProjectChat: typeof import('../packages/agents/src/agents/project-copilot').runProjectChat;
  let rule = '';

  before(async () => {
    process.env.REALYTICA_BASE_URL = BASE;
    process.env.REALYTICA_API_KEY = 'test-key';
    process.env.REALYTICA_MODEL_JUDGMENT = 'senior/model';
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(BASE)) return realFetch(input as string, init);
      sent.push(input instanceof Request ? await input.text() : String(init?.body ?? '{}'));
      const body = { id: 'msg_1', type: 'message', role: 'assistant', model: 'senior/model', content: [{ type: 'text', text: 'यह परियोजना Whitefield में है।' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const copilot = await import('../packages/agents/src/agents/project-copilot');
    runProjectChat = copilot.runProjectChat;
    rule = copilot.ANSWER_LANGUAGE_RULE;
  });

  after(() => {
    globalThis.fetch = realFetch;
    for (const name of ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_JUDGMENT']) delete process.env[name];
  });

  it('tells the model to read the question in its own language and to write no answer in any', () => {
    assert.match(rule, /Read the question in its own language/);
    assert.match(rule, /You write no answer in any language/);
    assert.match(rule, /printed from the record as the record holds it/);
  });

  it('is sent to the model with the question as it was asked', async () => {
    const question = 'यह परियोजना कहाँ है?';
    const answer = await runProjectChat({ project: createProject({ name: 'Whitefield plot', type: 'commercial', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-S1'), question });
    // The model's Hindi sentence is not the reply. It picked nothing, so the template says so, in Hindi.
    assert.equal(answer.text, 'इसका उत्तर न रिकॉर्ड में है, न काग़ज़ों में।');
    const body = JSON.parse(sent.at(-1)!) as { system: unknown; messages: unknown };
    assert.ok(JSON.stringify(body.system).includes(JSON.stringify(rule).slice(1, -1)), 'the rule is part of the standing instruction');
    assert.ok(JSON.stringify(body.messages).includes(question), 'the question is not translated on its way');
  });
});
