import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile, requireUser } from "@/components/auth/session";
import { Badge, Page, PageHeader } from "@/components/ui";
import {
  CityStatusTab,
  ClosuresTab,
  DishesTab,
  RestaurantsTab,
  SetsTab,
  SubmissionsTab,
  type CuratorCtx,
} from "@/components/curator/tabs";

export const metadata: Metadata = { title: "Curator", robots: { index: false } };

const TABS = [
  { id: "submissions", label: "Submissions" },
  { id: "closures", label: "Closures" },
  { id: "restaurants", label: "Restaurants" },
  { id: "status", label: "Status" },
  { id: "sets", label: "Sets" },
  { id: "dishes", label: "Dishes" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Curator console (brief 6.8). 404 for everyone else, decided on the server before any data loads. */
export default async function CuratorPage({ searchParams }: PageProps<"/curator">) {
  await requireUser("/curator");
  const profile = await getMyProfile();
  if (!profile?.is_curator) notFound();

  const sp = await searchParams;
  const tabParam = first(sp.tab);
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "submissions";

  const supabase = await createClient();
  const { data: city } = await supabase.from("cities").select("id, name").eq("slug", "london").maybeSingle();
  if (!city) notFound();

  const [countriesRes, statusRes, pendingRes, reportsRes] = await Promise.all([
    supabase.from("countries").select("iso2, name, iso_name").order("name"),
    supabase.from("city_country_status").select("country_iso2, status, restaurant_count").eq("city_id", city.id),
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("closure_reports").select("id", { count: "exact", head: true }).eq("resolved", false),
  ]);

  const ctx: CuratorCtx = {
    supabase,
    cityId: city.id,
    cityName: city.name,
    countries: (countriesRes.data ?? []).map((c) => ({ iso2: c.iso2, name: c.name || c.iso_name || c.iso2, iso_name: c.iso_name })),
    status: new Map(
      (statusRes.data ?? []).map((s) => [s.country_iso2 as string, { status: s.status as string, count: s.restaurant_count as number }]),
    ),
  };
  const badges: Partial<Record<TabId, number>> = {
    submissions: pendingRes.count ?? 0,
    closures: reportsRes.count ?? 0,
  };

  return (
    <Page>
      <PageHeader kicker="Curator" title="The list">
        You decide what counts. Every change here is live for everyone.
      </PageHeader>

      <nav aria-label="Curator sections" className="-mx-4 mb-5 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-1">
          {TABS.map((t) => {
            const active = t.id === tab;
            const n = badges[t.id] ?? 0;
            return (
              <li key={t.id} className="shrink-0">
                <Link
                  href={`/curator?tab=${t.id}`}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition ${
                    active ? "border-stamp-red bg-stamp-red text-on-stamp-red" : "border-line bg-paper-raised text-ink"
                  }`}
                >
                  {t.label}
                  {n > 0 && (
                    <Badge tone={active ? "neutral" : "red"} className="px-1.5">
                      {n}
                    </Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === "submissions" && <SubmissionsTab ctx={ctx} />}
      {tab === "closures" && <ClosuresTab ctx={ctx} />}
      {tab === "restaurants" && <RestaurantsTab ctx={ctx} q={first(sp.q)} />}
      {tab === "status" && <CityStatusTab ctx={ctx} />}
      {tab === "sets" && <SetsTab ctx={ctx} />}
      {tab === "dishes" && <DishesTab ctx={ctx} country={first(sp.country).toUpperCase()} />}
    </Page>
  );
}
