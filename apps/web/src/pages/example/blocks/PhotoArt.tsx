import type { ReactNode } from 'react';
import type { PhotoArtKind } from '../types';

/** The red ring round the part of a photograph that was read. */
const RING = { fill: 'none', stroke: '#B42318', strokeWidth: 3 };

/*
 * Six drawn scenes that stand in for site photographs. The colours are the
 * picture's own, so they are fixed: concrete is grey in either theme.
 */
const ART: Record<PhotoArtKind, ReactNode> = {
  column: (
    <>
      <rect y="262" width="600" height="78" fill="#B9C0C8" />
      <rect x="40" y="60" width="120" height="202" fill="#CDD2D8" />
      <rect x="430" y="90" width="130" height="172" fill="#CDD2D8" />
      <rect x="210" width="150" height="262" fill="#C7CCD2" />
      <rect x="210" width="14" height="262" fill="#B4BAC1" />
      <path d="M252 118q14-10 30-2 18-8 30 6 12 16-2 30 8 16-12 24-22 10-38-4-18-8-14-28-6-16 6-26z" fill="#8D959E" />
      <circle cx="270" cy="140" r="5" fill="#6D757E" />
      <circle cx="292" cy="152" r="6" fill="#6D757E" />
      <circle cx="282" cy="168" r="4" fill="#6D757E" />
      <ellipse cx="286" cy="150" rx="62" ry="54" {...RING} />
    </>
  ),
  damp: (
    <>
      <rect width="600" height="236" fill="#CFD4DA" />
      <rect y="236" width="600" height="104" fill="#B4BBC3" />
      <path d="M0 78h600M0 156h600" stroke="#C3C9D0" strokeWidth="2" />
      <path d="M196 236q6-64 62-74 58-10 92 26 24 26 20 48z" fill="#9BA7B3" />
      <path d="M236 236q4-30 34-36 34-4 48 36z" fill="#84919E" />
      <ellipse cx="284" cy="204" rx="112" ry="58" {...RING} />
    </>
  ),
  edge: (
    <>
      <rect width="600" height="212" fill="#DDE6EE" />
      <rect y="212" width="600" height="128" fill="#BFC5CC" />
      <path d="M0 140h214M410 140h190M0 176h214M410 176h190" stroke="#6D757E" strokeWidth="4" />
      <path d="M30 212v-74M120 212v-74M210 212v-74M414 212v-74M504 212v-74M590 212v-74" stroke="#6D757E" strokeWidth="5" />
      <rect x="222" y="126" width="182" height="96" rx="10" {...RING} />
    </>
  ),
  stone: (
    <>
      <rect width="600" height="170" fill="#DDE6EE" />
      <rect y="170" width="600" height="170" fill="#B7C4AE" />
      <path d="M0 128h600M0 150h600" stroke="#7C858E" strokeWidth="3" />
      <path d="M40 170v-52M130 170v-52M220 170v-52M310 170v-52M400 170v-52M490 170v-52M580 170v-52" stroke="#7C858E" strokeWidth="4" />
      <rect x="318" y="226" width="46" height="62" rx="7" fill="#EEF0F2" stroke="#8D959E" strokeWidth="3" />
      <ellipse cx="341" cy="256" rx="64" ry="56" {...RING} />
    </>
  ),
  road: (
    <>
      <rect width="600" height="150" fill="#DDE6EE" />
      <rect y="150" width="600" height="190" fill="#AEB5BD" />
      <path d="M0 150h150v-70h-150zM450 150h150v-86h-150z" fill="#CDD2D8" />
      <path d="M300 170v30M300 222v36M300 284v40" stroke="#E9ECEF" strokeWidth="5" />
      <path d="M156 206h288M156 192v28M444 192v28" {...RING} />
    </>
  ),
  drain: (
    <>
      <rect width="600" height="140" fill="#DDE6EE" />
      <rect y="140" width="600" height="200" fill="#B7C4AE" />
      <rect y="116" width="600" height="26" fill="#CDD2D8" />
      <path d="M0 214h600v62h-600z" fill="#7F8E9B" />
      <path d="M0 214h600M0 276h600" stroke="#6D757E" strokeWidth="3" />
      <rect x="196" y="196" width="208" height="98" rx="10" {...RING} />
    </>
  ),
};

/**
 * An example photograph, drawn. On a contact sheet it is decoration beside
 * its own description; shown `large` in the proof pane it is the source
 * itself, so it is named for a screen reader.
 */
export function PhotoArt({ kind, large = false }: { kind: PhotoArtKind; large?: boolean }) {
  return (
    <svg
      viewBox="0 0 600 340"
      preserveAspectRatio="xMidYMid slice"
      className={large ? 'block h-auto w-full' : 'block size-full'}
      {...(large ? { role: 'img', 'aria-label': 'Example photograph, with the part that was read ringed' } : { 'aria-hidden': true })}
    >
      <rect width="600" height="340" fill="#DCE1E6" />
      {ART[kind] ?? ART.column}
    </svg>
  );
}
