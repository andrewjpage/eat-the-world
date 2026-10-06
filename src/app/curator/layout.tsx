import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getMyProfile, requireUser } from "@/components/auth/session";

/**
 * The curator gate. It lives in the layout, above loading.tsx's Suspense boundary, so a
 * non-curator gets a real 404 status before anything streams. Server actions and RLS re-check.
 */
export default async function CuratorLayout({ children }: { children: ReactNode }) {
  await requireUser("/curator");
  const profile = await getMyProfile();
  if (!profile?.is_curator) notFound();
  return children;
}
