import type { ReactNode } from "react";
import { Section } from "./Section";

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-2">
      {children}
    </a>
  );
}

/**
 * Who made the data and the maps this app uses. The wording follows the group app's credits page.
 * These are plain links: nothing here loads from another site until you tap one.
 */
export function AboutSection() {
  const year = new Date().getFullYear();
  return (
    <Section title="About">
      <p>Everything stays on this phone: no account, no tracking. Only the map tiles need a connection.</p>
      <p>
        Map tiles and data © <A href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</A>, under the{" "}
        <A href="https://opendatacommons.org/licenses/odbl/">Open Database Licence</A> (ODbL).
      </p>
      <p>
        The world map uses <A href="https://www.naturalearthdata.com">Natural Earth</A> (public domain) through{" "}
        <A href="https://github.com/topojson/world-atlas">world-atlas</A> (ISC licence).
      </p>
      <p>
        Flags: <A href="https://github.com/lipis/flag-icons">flag-icons</A> (MIT licence).
      </p>
      <p>
        Country list and regions from{" "}
        <A href="https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes">
          lukes/ISO-3166-Countries-with-Regional-Codes
        </A>{" "}
        v10.0, licensed under <A href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</A>. Display
        names and two missing regions were adjusted for this app.
      </p>
      <p>
        London restaurant locations come from <A href="https://postcodes.io">postcodes.io</A>.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>Contains Ordnance Survey data © Crown copyright and database right {year}</li>
        <li>Contains Royal Mail data © Royal Mail copyright and database right {year}</li>
        <li>Contains National Statistics data © Crown copyright and database right {year}</li>
      </ul>
    </Section>
  );
}
