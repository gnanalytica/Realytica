/**
 * Synthetic Indic deed extracts, for measuring what the language rules claim.
 *
 * The multilingual handling has been in the extractor, the prompt and the
 * stored field since it was written, and its CODE PATH is covered by
 * `test/script.test.ts`. What has never been measured is whether a model
 * actually obeys the three rules — and they are not the same question. A
 * prompt is a request, not a constraint; the repo already learned that with
 * the off-registry key drop and the ungrounded-suggestion drop, both of which
 * had to move from the prompt into code before they held.
 *
 * The three rules, and the failure each one exists to catch:
 *
 * 1. A NAME keeps both forms. "ರಾಮಯ್ಯ" becoming only "Ramaiah" is a lossy
 *    reading presented as a fact: two different Kannada names romanise to the
 *    same English spelling, and the registrar's index holds the original, so
 *    a report carrying only the romanisation gives a lawyer nothing to check.
 * 2. An IDENTIFIER is never romanised. There is no English spelling of a
 *    survey number — an identifier that looks right and is not names a
 *    different instrument, and nothing downstream can tell.
 * 3. Indic DIGITS are converted. ೧೨೩ and 123 are the same number, so leaving
 *    them as-is makes an extent unusable in arithmetic for no gain.
 *
 * Everything here is invented. No real deed, no real person, no real survey
 * number — the whole point of a fixture set is that it can live in a public
 * repo, and property documents are full of third parties' personal data.
 */

export interface MultilingualExpectation {
  key: string;
  /** The English reading we expect in `value`. Null means the field must be absent. */
  value: string | null;
  /**
   * What `originalValue` must hold.
   *
   * `'same'` means the value is an identifier or already English and must NOT
   * be romanised or duplicated — `originalValue` is either absent or equal to
   * `value`. A string means the exact page text must be carried through.
   */
  original: string | 'same' | null;
  /** Why this field is in the set, for a failure report worth reading. */
  rule: 'name-keeps-both' | 'identifier-verbatim' | 'digits-converted' | 'english-no-original';
}

export interface MultilingualFixture {
  id: string;
  script: 'kannada' | 'telugu' | 'devanagari';
  label: string;
  /** The page, as OCR would hand it over — Indic and English mixed, as real ones are. */
  text: string;
  expectations: MultilingualExpectation[];
}

export const MULTILINGUAL_FIXTURES: MultilingualFixture[] = [
  {
    id: 'ka-sale-deed',
    script: 'kannada',
    label: 'Kannada sale deed — mixed script, Indic digits in the extent',
    text: `ಕ್ರಯ ಪತ್ರ (SALE DEED)

ಈ ಕ್ರಯ ಪತ್ರವನ್ನು ೧೨ ನೇ ಏಪ್ರಿಲ್ ೨೦೧೯ ರಂದು ಬೆಂಗಳೂರಿನಲ್ಲಿ ಬರೆದುಕೊಡಲಾಗಿದೆ.

ಮಾರಾಟಗಾರರು (VENDOR): ಶ್ರೀ ರಾಮಯ್ಯ, ಬಿನ್ ಶ್ರೀ ಕೃಷ್ಣಪ್ಪ
ಖರೀದಿದಾರರು (PURCHASER): Smt. Anita Rao, W/o Sri Suresh Rao

ಆಸ್ತಿಯ ವಿವರ (SCHEDULE OF PROPERTY):
ಗ್ರಾಮ (Village): ವರ್ತೂರು
ಸರ್ವೇ ನಂಬರ್ (Survey No.): ೧೧೨/೩
ಖಾತಾ ಸಂಖ್ಯೆ (Khata No.): KH-7741-B/2019
ವಿಸ್ತೀರ್ಣ (Extent): ೨೪೦೦ ಚದರ ಅಡಿ

ದಸ್ತಾವೇಜು ಸಂಖ್ಯೆ (Document No.): BLR-1-04521-2019-20
ಉಪ ನೋಂದಣಾಧಿಕಾರಿ ಕಚೇರಿ (SRO): ವೈಟ್‌ಫೀಲ್ಡ್`,
    expectations: [
      { key: 'vendorName', value: 'Ramaiah', original: 'ರಾಮಯ್ಯ', rule: 'name-keeps-both' },
      { key: 'purchaserName', value: 'Anita Rao', original: 'same', rule: 'english-no-original' },
      { key: 'village', value: 'Varthur', original: 'ವರ್ತೂರು', rule: 'name-keeps-both' },
      { key: 'surveyNumber', value: '112/3', original: 'same', rule: 'digits-converted' },
      { key: 'khataNumber', value: 'KH-7741-B/2019', original: 'same', rule: 'identifier-verbatim' },
      { key: 'documentNumber', value: 'BLR-1-04521-2019-20', original: 'same', rule: 'identifier-verbatim' },
      { key: 'extentSqft', value: '2400', original: 'same', rule: 'digits-converted' },
    ],
  },
  {
    id: 'te-sale-deed',
    script: 'telugu',
    label: 'Telugu sale deed — Telugu digits, English identifier',
    text: `విక్రయ దస్తావేజు (SALE DEED)

ఈ దస్తావేజు ౨౦౨౧ సంవత్సరం మార్చి ౮ వ తేదీన హైదరాబాద్‌లో వ్రాయబడినది.

విక్రేత (VENDOR): శ్రీ వెంకటేశ్వర్లు, తండ్రి శ్రీ నరసింహం
కొనుగోలుదారు (PURCHASER): Sri Mohan Reddy

ఆస్తి వివరాలు:
గ్రామం (Village): కూకట్‌పల్లి
సర్వే నంబరు (Survey No.): ౨౧౪/అ
విస్తీర్ణం (Extent): ౩౦౦ చదరపు గజాలు
దస్తావేజు సంఖ్య (Document No.): HYD/SRO-12/0987/2021`,
    expectations: [
      { key: 'vendorName', value: 'Venkateswarlu', original: 'వెంకటేశ్వర్లు', rule: 'name-keeps-both' },
      { key: 'purchaserName', value: 'Mohan Reddy', original: 'same', rule: 'english-no-original' },
      { key: 'village', value: 'Kukatpally', original: 'కూకట్‌పల్లి', rule: 'name-keeps-both' },
      // The trap: the survey number's SUFFIX is a Telugu letter, not a digit.
      // Converting the digits is right; romanising the letter to "A" would
      // name a different plot, and that is the whole of rule 2.
      { key: 'surveyNumber', value: '214/అ', original: 'same', rule: 'identifier-verbatim' },
      { key: 'documentNumber', value: 'HYD/SRO-12/0987/2021', original: 'same', rule: 'identifier-verbatim' },
      { key: 'extentSqyd', value: '300', original: 'same', rule: 'digits-converted' },
    ],
  },
  {
    id: 'hi-gift-deed',
    script: 'devanagari',
    label: 'Devanagari gift deed — Devanagari digits throughout',
    text: `दान पत्र (GIFT DEED)

यह दान पत्र दिनांक १५ जून २०२० को निष्पादित किया गया।

दाता (DONOR): श्री हरिप्रसाद शर्मा
गृहीता (DONEE): श्रीमती कमला देवी

सम्पत्ति का विवरण:
ग्राम (Village): रामपुर
खसरा संख्या (Khasra No.): ४५७/२
क्षेत्रफल (Area): १०८० वर्ग फुट
पंजीकरण संख्या (Registration No.): RJ-JPR-2020-3312`,
    expectations: [
      { key: 'donorName', value: 'Hariprasad Sharma', original: 'हरिप्रसाद शर्मा', rule: 'name-keeps-both' },
      { key: 'doneeName', value: 'Kamala Devi', original: 'कमला देवी', rule: 'name-keeps-both' },
      { key: 'village', value: 'Rampur', original: 'रामपुर', rule: 'name-keeps-both' },
      { key: 'khasraNumber', value: '457/2', original: 'same', rule: 'digits-converted' },
      { key: 'areaSqft', value: '1080', original: 'same', rule: 'digits-converted' },
      { key: 'registrationNumber', value: 'RJ-JPR-2020-3312', original: 'same', rule: 'identifier-verbatim' },
    ],
  },
];
