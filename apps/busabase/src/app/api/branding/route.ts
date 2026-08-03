import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "~/db";
import { getAppBrandingSafe, updateAppBranding } from "~/domains/settings/logic/app-branding-store";
import {
  AppBrandingVOSchema,
  UpdateAppBrandingDTOSchema,
} from "~/domains/settings/types/app-branding";

/**
 * Read the white-label branding. Called by the Settings → Branding tab and by
 * the dashboard shell (to render the sidebar top-left slot). Uses the "safe"
 * read so a not-yet-migrated instance renders defaults instead of erroring.
 */
export async function GET() {
  const db = await getDb();
  const branding = await getAppBrandingSafe(db);
  return NextResponse.json(AppBrandingVOSchema.parse(branding));
}

/** Save the branding. An empty/omitted field resets it to the built-in default. */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = UpdateAppBrandingDTOSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid branding payload." }, { status: 400 });
  }

  const db = await getDb();
  const branding = await updateAppBranding(db, parsed.data);
  return NextResponse.json(AppBrandingVOSchema.parse(branding));
}
