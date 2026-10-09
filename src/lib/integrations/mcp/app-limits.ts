// The static app is larger than tool results because it includes its SDK and
// strict schema validators. Only the registered resources/read response uses
// this allowance; structured tool output keeps its separate 64 KiB limit.
export const MAX_APP_HTML_BYTES = 768 * 1024;
export const MAX_APP_RESPONSE_BYTES = 1024 * 1024;
