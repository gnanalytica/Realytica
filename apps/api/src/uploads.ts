/**
 * What this deployment can actually accept.
 *
 * Its own module because it is a deployment fact rather than a route's: the
 * health endpoint reports it so the client can enforce the limit before
 * sending rather than discover it from a failed request, and the project
 * upload routes size their multer instances from it. It used to live in the
 * document router, which is why that file outlived by two hundred lines the
 * surface it was written for.
 */

const MAX_FILES_PER_UPLOAD = 10;
const LOCAL_MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Vercel rejects a request body over 4.5 MB at the platform edge, before the
 * function is invoked at all. Multer never sees it, so no limit set here can
 * turn that into a useful error — the client gets an opaque
 * FUNCTION_PAYLOAD_TOO_LARGE page instead.
 *
 * Rounded down to a flat 4 MiB. The documented figure is ambiguous between
 * 4.5 million bytes and 4.5 MiB, and multipart framing adds a few hundred
 * bytes per file on top of the file contents, so the exact number is not
 * worth cutting close to. A whole number of MiB also means the client can
 * quote the limit back to the user as "4.0 MB" rather than an odd figure.
 */
const VERCEL_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

const onVercel = process.env.VERCEL === '1';

/**
 * `maxRequestBytes` is the cap on one upload call: on Vercel that is the
 * platform's, everywhere else it is just however many files of the maximum
 * size are allowed at once.
 */
export const UPLOAD_LIMITS = {
  maxFiles: MAX_FILES_PER_UPLOAD,
  maxFileBytes: onVercel ? VERCEL_MAX_REQUEST_BYTES : LOCAL_MAX_FILE_BYTES,
  maxRequestBytes: onVercel ? VERCEL_MAX_REQUEST_BYTES : LOCAL_MAX_FILE_BYTES * MAX_FILES_PER_UPLOAD,
};
