import { Page, PageHeader } from "@/components/ui/Page";
import { AboutSection } from "@solo/components/settings/AboutSection";
import { BackupSection } from "@solo/components/settings/BackupSection";
import { DataSection } from "@solo/components/settings/DataSection";
import { StorageSection } from "@solo/components/settings/StorageSection";

export default function Settings() {
  return (
    <Page>
      <PageHeader kicker="Eat the World" title="Settings" />
      <BackupSection />
      <StorageSection />
      <DataSection />
      <AboutSection />
    </Page>
  );
}
