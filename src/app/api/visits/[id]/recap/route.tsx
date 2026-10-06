import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { APP_NAME } from "@/lib/app";
import { displayName } from "@/lib/countries";
import { UUID_RE, confirmWindowOpen } from "@/components/checkin/logic";
import {
  arrangePeople,
  dishLabel,
  recapDate,
  recapFooter,
  recapPointsLabel,
  type RecapPerson,
} from "@/components/recap/logic";

/**
 * GET /api/visits/[id]/recap: the share card as a 1080x1350 PNG.
 *
 * Members of the visit's group only (RLS decides: anyone else gets a 404). The card
 * shows the people at the table (confirmed, and tagged people still inside the 7-day
 * confirm window as "Confirming…"), dishes, ratings and points; no photo, no coordinates,
 * no avatars. Fonts are the app's own, bundled here, so the card matches the passport.
 */
const W = 1080;
const H = 1350;
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

// Passport palette (light): hex because an image has no CSS variables.
const PAPER = "#f6efe1";
const RAISED = "#fffaf0";
const SUNK = "#ede3cf";
const LINE = "#d9cdb4";
const INK = "#1f2a44";
const SOFT = "#4a5068";
const RED = "#c8102e";
const GOLD = "#9a6416";

const FONT_DIR = path.join(process.cwd(), "src/app/api/visits/[id]/recap/fonts");
type CardFonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]>;
let fontsPromise: Promise<CardFonts> | null = null;

/** Fraunces for the display lines, DM Sans for the rest. Read once per process. */
function loadFonts(): Promise<CardFonts> {
  fontsPromise ??= Promise.all(
    ["Fraunces-Bold.ttf", "DMSans-Regular.ttf", "DMSans-Bold.ttf"].map((f) => readFile(path.join(FONT_DIR, f))),
  ).then(([fraunces, dmRegular, dmBold]) => [
    { name: "Fraunces", data: fraunces, weight: 700, style: "normal" },
    { name: "DM Sans", data: dmRegular, weight: 400, style: "normal" },
    { name: "DM Sans", data: dmBold, weight: 700, style: "normal" },
  ]);
  fontsPromise.catch(() => {
    fontsPromise = null; // try again next time
  });
  return fontsPromise;
}

async function flagDataUri(iso2: string): Promise<string | null> {
  const code = iso2.toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return null;
  try {
    const svg = await readFile(path.join(process.cwd(), "node_modules/flag-icons/flags/4x3", `${code}.svg`));
    return `data:image/svg+xml;base64,${svg.toString("base64")}`;
  } catch {
    return null;
  }
}

function Stars({ rating }: { rating: number }) {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width="28" height="28" viewBox="0 0 24 24">
          <path
            d="M12 2l3.1 6.6 7.2.9-5.3 5 1.4 7.2L12 18.1 5.6 21.7 7 14.5 1.7 9.5l7.2-.9z"
            fill={i < n ? GOLD : LINE}
          />
        </svg>
      ))}
    </div>
  );
}

function fit(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/visits/[id]/recap">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404, headers: NO_STORE });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response("Sign in to see this.", { status: 401, headers: NO_STORE });

  const { data: visit } = await supabase
    .from("visits")
    .select("id, visited_at, groups(name), restaurants(name, country_iso2, countries(iso2, name, iso_name))")
    .eq("id", id)
    .maybeSingle();
  if (!visit) return new Response("Not found", { status: 404, headers: NO_STORE });

  const restaurant = visit.restaurants as unknown as {
    name: string;
    country_iso2: string;
    countries: { iso2: string; name: string; iso_name: string } | null;
  };
  const groupName = (visit.groups as unknown as { name: string } | null)?.name ?? "";
  const countryName = restaurant.countries ? displayName(restaurant.countries) : restaurant.country_iso2;

  const [{ data: att }, { data: pts }, flag, fonts] = await Promise.all([
    supabase
      .from("visit_attendees")
      .select("user_id, status, stamp_waiting, rating, dish_other, profiles(display_name), signature_dishes(name)")
      .eq("visit_id", id)
      .in("status", ["confirmed", "pending"]),
    supabase.from("stamp_totals").select("user_id, points").eq("visit_id", id),
    flagDataUri(restaurant.country_iso2),
    loadFonts(),
  ]);

  const points = new Map(((pts ?? []) as { user_id: string; points: number }[]).map((p) => [p.user_id, p.points]));
  // Tagged people are "at the table" while they can still confirm; after that, not.
  const windowOpen = confirmWindowOpen(visit.visited_at);
  const people: RecapPerson[] = (
    (att ?? []) as unknown as {
      user_id: string;
      status: "confirmed" | "pending";
      stamp_waiting: boolean;
      rating: number | null;
      dish_other: string | null;
      profiles: { display_name: string } | null;
      signature_dishes: { name: string } | null;
    }[]
  )
    .filter((a) => a.status === "confirmed" || windowOpen)
    .map((a): RecapPerson => {
      const stamped = a.status === "confirmed" && points.has(a.user_id);
      return {
        name: a.profiles?.display_name ?? "Former member",
        dish: dishLabel(a.signature_dishes?.name, a.dish_other),
        rating: a.rating,
        points: stamped ? (points.get(a.user_id) ?? 0) : 0,
        state: a.status === "pending" ? "pending" : stamped ? "stamped" : a.stamp_waiting ? "waiting" : "repeat",
      };
    });
  const { shown, more } = arrangePeople(people);

  const image = (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        background: PAPER,
        padding: 36,
        fontFamily: "DM Sans",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          border: `6px dashed ${RED}`,
          borderRadius: 40,
          padding: "44px 56px 36px",
          background: RAISED,
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 8, color: RED, fontWeight: 700 }}>
          {APP_NAME.toUpperCase()} · LONDON
        </div>

        <div style={{ display: "flex", marginTop: 34, padding: 10, background: PAPER, border: `3px solid ${LINE}`, borderRadius: 12 }}>
          {flag ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={flag} width={360} height={270} alt="" style={{ borderRadius: 6 }} />
          ) : (
            <div style={{ display: "flex", width: 360, height: 270, background: SUNK }} />
          )}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 30,
            fontSize: 84,
            lineHeight: 1.2,
            fontFamily: "Fraunces",
            fontWeight: 700,
            color: INK,
            textAlign: "center",
          }}
        >
          {fit(countryName, 22)}
        </div>
        <div style={{ display: "flex", marginTop: 6, fontSize: 40, lineHeight: 1.3, color: SOFT, textAlign: "center" }}>
          {fit(restaurant.name, 38)}
        </div>
        <div style={{ display: "flex", marginTop: 4, fontSize: 30, lineHeight: 1.3, color: SOFT }}>
          {recapDate(visit.visited_at)}
          {groupName ? ` · ${fit(groupName, 28)}` : ""}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 30,
            width: "100%",
            background: SUNK,
            borderRadius: 28,
            padding: "10px 28px",
          }}
        >
          {shown.length === 0 && (
            <div style={{ display: "flex", padding: "20px 0", fontSize: 30, color: SOFT }}>Waiting for the table to confirm</div>
          )}
          {shown.map((p, i) => {
            const label = recapPointsLabel(p);
            return (
            <div
              key={`${p.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "14px 0",
                borderTop: i === 0 ? "none" : `2px solid ${LINE}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 62,
                  height: 62,
                  borderRadius: 31,
                  background: INK,
                  color: RAISED,
                  fontSize: 30,
                  fontWeight: 700,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {(p.name.trim()[0] ?? "?").toUpperCase()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 20 }}>
                <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: INK }}>{fit(p.name, 20)}</div>
                <div style={{ display: "flex", fontSize: 25, color: SOFT }}>{p.dish ? fit(p.dish, 32) : "No dish logged"}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                {label.isPoints ? (
                  <div style={{ display: "flex", fontSize: 38, fontFamily: "Fraunces", fontWeight: 700, color: RED }}>
                    {label.text}
                  </div>
                ) : (
                  <div style={{ display: "flex", fontSize: 26, color: SOFT }}>{label.text}</div>
                )}
                {p.rating ? <Stars rating={p.rating} /> : <div style={{ display: "flex" }} />}
              </div>
            </div>
            );
          })}
          {more > 0 && (
            <div style={{ display: "flex", padding: "8px 0 12px", fontSize: 26, color: SOFT }}>+{more} more at the table</div>
          )}
        </div>

        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: INK, fontFamily: "Fraunces", fontWeight: 700 }}>
          {recapFooter(people)}
        </div>
        <div style={{ display: "flex", marginTop: 10, fontSize: 24, lineHeight: 1.3, color: SOFT, letterSpacing: 4 }}>
          EAT THE WORLD, ONE TABLE AT A TIME
        </div>
      </div>
    </div>
  );

  return new ImageResponse(image, {
    width: W,
    height: H,
    fonts,
    headers: NO_STORE,
  });
}
