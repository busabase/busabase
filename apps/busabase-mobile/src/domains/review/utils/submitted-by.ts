/**
 * The actor a change request is filed under.
 *
 * `"local-editor"` rather than a mobile-specific id, matching what the web
 * dashboard sends. On a self-hosted server the client's claim IS the author
 * (there is no session to resolve), and the server answers the Inbox's "mine"
 * filter with `resolveActorId("local-editor")` — so a phone that filed under
 * `"mobile-editor"` could never find its own change requests again. In the
 * cloud this value is ignored entirely: the host overrides it with the real
 * resolved actor.
 */
export const SUBMITTED_BY = "local-editor";
