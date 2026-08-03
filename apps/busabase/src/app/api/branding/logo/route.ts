import { ORPCError } from "@orpc/server";
import {
  BRANDING_LOGO_MAX_BYTES,
  uploadBrandingLogo,
} from "busabase-core/domains/attachments/logic";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "~/db";

export const dynamic = "force-dynamic";

/**
 * Upload the sidebar logo.
 *
 * App-local like its sibling `/api/branding` (branding is a single-instance
 * setting, not part of the shared oRPC protocol). The picked file arrives as
 * `multipart/form-data` under `file`; the response is the public URL to store
 * in `logoUrl`.
 *
 * The logo is stored as a plain attachment, NOT as a Drive asset: an asset row
 * would show up in the Assets library as permanently "unused" and be deletable,
 * which would silently break the branding.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a `file` field." }, { status: 400 });
  }

  // Checked before reading the body into memory, so an oversized upload can't
  // be used to make the server buffer it. The logic layer re-checks the real
  // byte length — `file.size` is client-reported.
  if (file.size > BRANDING_LOGO_MAX_BYTES) {
    return NextResponse.json(
      { error: `The logo must be ${BRANDING_LOGO_MAX_BYTES / 1024 / 1024} MB or smaller.` },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const result = await uploadBrandingLogo(db, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
    });
    return NextResponse.json({ url: result.publicUrl, attachmentId: result.attachmentId });
  } catch (error) {
    if (error instanceof ORPCError && error.code === "BAD_REQUEST") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[branding] logo upload failed:", error);
    return NextResponse.json({ error: "Couldn't store the logo." }, { status: 500 });
  }
}
