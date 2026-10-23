import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { Context, Router } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { encodeBusabaseOpenApiError } from "./error-envelope";

/**
 * The one `/api/v1` handler factory. Both servers (the open-source app and
 * Busabase Cloud) mount the same contract, so they must agree not only
 * on the error envelope but on how a request is READ — this is the single
 * place to drift from.
 *
 * Query coercion: a query string has no types, so `?mine=true` arrives as the
 * string `"true"` and `?page=2` as `"2"`. Without coercion every GET input
 * field that is not a string or a `z.coerce` number answered 400 to a client
 * that followed the published spec (`GET /change-requests?mine=true` →
 * "expected boolean, received string"). `SmartCoercionPlugin` converts each
 * value against the procedure's own input JSON Schema — the same converter the
 * spec in `./spec.ts` is generated with — before zod validates it, so the spec
 * stays the truth about what is accepted:
 * - booleans accept only `true`/`false` (and `on`/`off`), case-insensitive;
 *   anything else (including `1`/`0`) stays a string and is still rejected. Unlike
 *   `z.coerce.boolean()`, `"false"` becomes `false`.
 * - numbers/integers accept only strings that ARE that number.
 * - values that already match the schema are left untouched.
 *
 * Not covered: a bare scalar for an array field (`?status=merged`) stays a
 * string and is rejected; send `status[]=merged` as the spec's deepObject
 * style documents. Fields declared as `array | scalar` (e.g. `nodes.list`'s
 * `types`) already accept both.
 */
export const createBusabaseOpenApiHandler = <T extends Context>(router: Router<any, T>) =>
  new OpenAPIHandler<T>(router, {
    customErrorResponseBodyEncoder: encodeBusabaseOpenApiError,
    plugins: [new SmartCoercionPlugin({ schemaConverters: [new ZodToJsonSchemaConverter()] })],
  });
