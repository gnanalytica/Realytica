// Reading Telangana's published guidance (circle) rates.
//
// IGRS drives its district -> mandal -> village cascade over AJAX behind a
// session, which is why this module existed as a hand-entered snapshot for so
// long. It is replicable after all: establish a session by loading the search
// page, then POST the form to `/UnitRateMV/unitRateMV` with an `encodestr`
// parameter that is nothing more sinister than base64 of the same fields as
// JSON. No browser required.
//
// Hand-entering was not merely incomplete, it was WRONG: the snapshot carried
// Gachibowli at Rs 32,000/sq yd against a published Rs 40,100 effective
// 05/06/2026. That is the case for reading the source rather than estimating
// it, and the reason this module exists.
//
// Used by `scripts/capture-igrs-rates.ts`, not on the request path. The state
// portal is slow and has no SLA; a user lookup must never wait on it.
