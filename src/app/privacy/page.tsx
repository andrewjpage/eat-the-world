import type { Metadata } from "next";
import { APP_NAME } from "@/lib/app";
import { Card } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Privacy" };

// Placeholder: the full privacy page arrives at launch (brief sections 8 and 10.7).
export default function PrivacyPage() {
  return (
    <Page>
      <PageHeader kicker={APP_NAME} title="Privacy" />
      <Card className="space-y-3 text-[0.95rem] text-ink-soft">
        <p>
          {APP_NAME} is a private, invite-only game run by Andrew Page for a group of friends. It has
          no ads, no analytics and no commercial side.
        </p>
        <p>
          Your location is checked once, at check-in, to work out how far you are from the
          restaurant. Only that distance is kept, never your coordinates.
        </p>
        <p>To have your data deleted, ask Andrew.</p>
      </Card>
    </Page>
  );
}
