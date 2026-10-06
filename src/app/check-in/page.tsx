import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/countries";
import { requireUser } from "@/components/auth/session";
import { NearbyPicker, type Candidate } from "@/components/checkin/NearbyPicker";
import { Page, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Check in" };

interface Row {
  id: string;
  name: string;
  address: string | null;
  postcode: string;
  lat: number;
  lon: number;
  country_iso2: string;
  countries: { iso2: string; name: string; iso_name: string } | null;
}

/**
 * Pick where you are. The restaurant list (public seed data) is sent to the browser,
 * which sorts it by distance after one tap: no position ever reaches the server here.
 */
export default async function CheckInIndexPage() {
  await requireUser("/check-in");
  const supabase = await createClient();
  const { data } = await supabase
    .from("restaurants")
    .select("id, name, address, postcode, lat, lon, country_iso2, countries(iso2, name, iso_name)")
    .in("status", ["active", "reported_closed"])
    .order("name")
    .limit(1000);

  const restaurants: Candidate[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    postcode: r.postcode,
    lat: r.lat,
    lon: r.lon,
    countryIso2: r.country_iso2,
    countryName: r.countries ? displayName(r.countries) : r.country_iso2,
  }));

  return (
    <Page>
      <PageHeader title="Where are you?" kicker="Check in">
        Pick the restaurant, tag your table, get the stamp.
      </PageHeader>
      <NearbyPicker restaurants={restaurants} />
    </Page>
  );
}
