import type { Metadata } from "next";
import { APP_NAME } from "@/lib/app";
import { Card } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Credits" };

// Placeholder: the full credits page arrives at launch (brief sections 8 and 10.7).
export default function CreditsPage() {
  return (
    <Page>
      <PageHeader kicker={APP_NAME} title="Credits" />
      <Card>
        <ul className="list-disc space-y-2 pl-5 text-[0.95rem] text-ink-soft">
          <li>Country data: lukes/ISO-3166-Countries-with-Regional-Codes (CC BY-SA 4.0)</li>
          <li>Flags: flag-icons (MIT)</li>
          <li>Postcodes: postcodes.io (Ordnance Survey, Royal Mail, ONS)</li>
          <li>Maps: © OpenStreetMap contributors; Natural Earth via world-atlas</li>
        </ul>
      </Card>
    </Page>
  );
}
