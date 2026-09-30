import type { ImgHTMLAttributes } from 'react';
import { useAuthedUrl } from '../lib/useAuthedUrl';

/**
 * An `<img>` of an API resource, loaded with the session's token.
 *
 * Draws nothing until the bytes arrive, and nothing if they never do: an empty
 * space reads as "no picture", a broken-image icon reads as a fault.
 */
export function AuthedImg({ path, alt, ...rest }: { path: string; alt: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>) {
  const { url } = useAuthedUrl(path);
  return url ? <img src={url} alt={alt} {...rest} /> : null;
}
