import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/app";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Credits" };

// The postcodes.io lines name the current year; render per request rather than freezing it at build.
export const dynamic = "force-dynamic";

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-ink underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function Source({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <Eyebrow className="mb-2 px-1">{title}</Eyebrow>
      <Card className="space-y-2 text-[0.95rem] text-ink-soft">{children}</Card>
    </section>
  );
}

export default function CreditsPage() {
  const year = new Date().getFullYear();
  return (
    <Page>
      <PageHeader kicker={APP_NAME} title="Credits" />

      <Source title="Countries">
        <p>
          Country list and regions from{" "}
          <A href="https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes">
            lukes/ISO-3166-Countries-with-Regional-Codes
          </A>{" "}
          v10.0, licensed under{" "}
          <A href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</A>. Display names
          and two missing regions were adjusted for this app.
        </p>
      </Source>

      <Source title="Postcodes">
        <p>
          Restaurant locations come from <A href="https://postcodes.io">postcodes.io</A>.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Contains Ordnance Survey data © Crown copyright and database right {year}</li>
          <li>Contains Royal Mail data © Royal Mail copyright and database right {year}</li>
          <li>Contains National Statistics data © Crown copyright and database right {year}</li>
        </ul>
      </Source>

      <Source title="Maps">
        <p>
          Map tiles and data ©{" "}
          <A href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</A>, under
          the <A href="https://opendatacommons.org/licenses/odbl/">Open Database Licence</A>{" "}
          (ODbL).
        </p>
        <p>
          The world map uses <A href="https://www.naturalearthdata.com">Natural Earth</A> (public
          domain) through <A href="https://github.com/topojson/world-atlas">world-atlas</A> (ISC
          licence).
        </p>
      </Source>

      <Source title="Flags and fonts">
        <p>
          Flags: <A href="https://github.com/lipis/flag-icons">flag-icons</A> (MIT licence).
        </p>
        <p>
          Fonts: Fraunces, DM Sans and DM Mono, from Google Fonts under the{" "}
          <A href="https://openfontlicense.org">SIL Open Font Licence</A> (OFL).
        </p>
      </Source>
    </Page>
  );
}
