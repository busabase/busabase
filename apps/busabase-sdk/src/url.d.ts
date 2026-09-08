/**
 * Normalize a user-supplied base URL to the server root. The API contract
 * already carries `/api/v1`, so accept either form and strip the suffix.
 */
export declare function normalizeBaseUrl(raw: string): string;
