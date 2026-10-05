import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/components/auth/session";
import { Page, PageHeader } from "@/components/ui/Page";
import { BackfillPicker, type BackfillCountry } from "./BackfillPicker";

export const metadata: Metadata = { title: "Countries before the app" };

export default async function BackfillPage({ searchParams }: PageProps<"/settings/backfill">) {
  const sp = await searchParams;
  const onboarding = sp.onboarding === "1";
  const user = await requireUser(onboarding ? "/settings/backfill?onboarding=1" : "/settings/backfill");
  const supabase = await createClient();

  const [{ data: countries, error }, { data: stamps }] = await Promise.all([
    supabase.from("countries").select("iso2, name, m49_group").order("name"),
    supabase.from("stamps").select("country_iso2, backfilled").eq("user_id", user.id),
  ]);
  if (error) throw new Error("Couldn't load the country list.");

  const list: BackfillCountry[] = (countries ?? []).map((c) => ({
    iso2: c.iso2 as string,
    name: c.name as string,
    m49_group: (c.m49_group as string | null) ?? "Other",
  }));
  const backfilled = (stamps ?? []).filter((s) => s.backfilled).map((s) => s.country_iso2 as string);
  const visit = (stamps ?? []).filter((s) => !s.backfilled).map((s) => s.country_iso2 as string);

  return (
    <Page>
      <PageHeader
        kicker={onboarding ? "Welcome aboard" : "Passport"}
        title={onboarding ? "Where have you eaten already?" : "Countries before the app"}
      >
        <p>
          Tap the countries whose food you&apos;ve already eaten. They go in your passport as{" "}
          <strong className="text-ink">memories</strong>, worth <strong className="text-ink">0 points</strong>, and
          never count on a leaderboard.
        </p>
        <p className="mt-2">
          Eat one at a London restaurant later and it becomes a full stamp, points and all.
        </p>
      </PageHeader>
      <BackfillPicker
        countries={list}
        initialBackfilled={backfilled}
        visitStamped={visit}
        onboarding={onboarding}
      />
    </Page>
  );
}
