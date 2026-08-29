/**
 * Reading documents that are not in English.
 *
 * The two failures this guards are asymmetric. Transliterating a NAME and
 * discarding the original loses the string a registrar's index actually holds
 * — recoverable only by re-reading the document. Transliterating an
 * IDENTIFIER produces a survey number that does not exist, which is worse: it
 * looks right, it will be quoted into a report, and nothing downstream can
 * tell.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectScripts, isIdentifierKey, normalizeDigits, prepareValue, scriptOf } from '@realytica/shared';

describe('detecting script', () => {
  it('names the Indic script beside English rather than calling it mixed', () => {
    // An English cover page over a Kannada deed is the ordinary shape of these
    // documents. Labelling that "mixed" would label almost everything the same
    // way and tell a reader nothing.
    assert.equal(scriptOf('Sy. No. 118, ಬೆಂಗಳೂರು'), 'kannada');
    assert.equal(scriptOf('Site No. 118, Bengaluru'), 'latin');
    assert.equal(scriptOf('సర్వే నెం 42'), 'telugu');
    assert.equal(scriptOf('सर्वे क्रमांक ४२'), 'devanagari');
  });

  it('reserves mixed for two Indic scripts together, which is genuinely unusual', () => {
    assert.equal(scriptOf('ಬೆಂಗಳೂರು हिन्दी'), 'mixed');
    assert.deepEqual(detectScripts('abc ಕನ್ನಡ'), ['kannada', 'latin']);
  });

  it('reports unknown rather than guessing at digits alone', () => {
    assert.equal(scriptOf('12345'), 'unknown');
  });
});

describe('identifiers are never romanised', () => {
  it('recognises the keys that hold one', () => {
    for (const key of ['surveyNumber', 'documentNo', 'khataNumber', 'registrationNumber', 'pid']) {
      assert.ok(isIdentifierKey(key), `${key} is an identifier`);
    }
    for (const key of ['ownerName', 'address', 'description']) {
      assert.ok(!isIdentifierKey(key), `${key} is not`);
    }
  });

  it('converts Indic digits but leaves the characters alone', () => {
    // ೧೨೩ and 123 are the same number written differently, and the register
    // holds it in Latin digits. Letters are not the same case: there is no
    // English spelling of an identifier, only the identifier.
    assert.equal(normalizeDigits('೧೨೩/೪'), '123/4');
    assert.equal(normalizeDigits('४२'), '42');
    const field = prepareValue('surveyNumber', 'Sy 118', 'ಸರ್ವೆ ೧೧೮');
    assert.equal(field.value, 'ಸರ್ವೆ 118', 'digits converted, characters kept');
    assert.equal(field.transliterated, false, 'an identifier is never a reading');
  });
});

describe('a name keeps both forms', () => {
  it('stores the reading and the original together', () => {
    const field = prepareValue('ownerName', 'Ramaiah', 'ರಾಮಯ್ಯ');
    assert.equal(field.value, 'Ramaiah');
    assert.equal(field.original, 'ರಾಮಯ್ಯ');
    assert.equal(field.script, 'kannada');
    assert.equal(field.transliterated, true, 'and says that the value is a reading');
  });

  it('costs nothing on an English page', () => {
    const field = prepareValue('ownerName', 'Ramaiah');
    assert.equal(field.original, 'Ramaiah');
    assert.equal(field.transliterated, false, 'no invented original');
  });
});
