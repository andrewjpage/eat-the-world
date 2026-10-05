import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/app";
import { Card, Eyebrow } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Privacy" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <Eyebrow className="mb-2 px-1">{title}</Eyebrow>
      <Card className="space-y-2 text-[0.95rem] text-ink-soft">{children}</Card>
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <Page>
      <PageHeader kicker={APP_NAME} title="Privacy" />

      <Section title="Who runs this">
        <p>
          {APP_NAME} is run by Andrew Page for a group of friends. It is non-commercial and
          invite-only, it sits behind a sign-in, and search engines are asked to ignore it. There
          are no ads and no analytics.
        </p>
      </Section>

      <Section title="What we keep">
        <List
          items={[
            "Your email address, for signing in.",
            "Your profile name, and your Google photo if you sign in with Google.",
            "Which groups you are in.",
            "Your visits, who was at the table, ratings, dishes and notes.",
            "Your stamps and set awards.",
            "Photos you add to a visit, with their metadata (including any location) stripped.",
            "Reactions and plan RSVPs.",
          ]}
        />
      </Section>

      <Section title="What we do not keep">
        <List
          items={[
            "Your location. When you check in, your phone sends its position once, over HTTPS, so the server can work out how far you are from the restaurant. Only whether you were within range is kept (plus the distance, rounded to 10 m, when you were, which no other player can see). Your coordinates are never stored, logged or put in a link.",
            "Analytics, tracking or advertising data.",
          ]}
        />
      </Section>

      <Section title="Who can see what">
        <p>
          A visit&apos;s photo is visible only to the members of that visit&apos;s group. Group
          members see each other&apos;s names, stamps and visits. Reactions show as counts, never
          with names.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          Go to{" "}
          <Link href="/settings" className="font-semibold text-ink underline underline-offset-2">
            Settings
          </Link>
          , then <strong className="text-ink">Delete account</strong>. That removes everything
          listed above. If you would rather not do it yourself, ask Andrew and he will.
        </p>
        <p>
          If you were at a table with others, they keep their attendance and stamps for that
          visit; your name and your photo are gone from it.
        </p>
      </Section>

      <p className="pb-4 text-center text-sm text-muted">
        Data sources and licences are on the{" "}
        <Link href="/credits" className="underline underline-offset-2">
          credits page
        </Link>
        .
      </p>
    </Page>
  );
}
