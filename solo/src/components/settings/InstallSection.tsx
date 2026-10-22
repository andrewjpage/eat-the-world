import { Button } from "@/components/ui/Button";
import { isStandalone, promptInstall } from "@solo/pwa-install";
import { useInstallAvailable } from "@solo/state/useInstallAvailable";
import { Section } from "./Section";

/**
 * A way to install when the dialog was put off. Only there while the browser has an install on offer
 * and the app is still in a browser tab. The person is asking, so the 14 day snooze does not apply.
 */
export function InstallSection() {
  const canInstall = useInstallAvailable();
  if (!canInstall || isStandalone()) return null;

  return (
    <Section title="Install">
      <p>Add Eat the World to your home screen to open it like an app, even without a connection.</p>
      <Button block variant="secondary" onClick={() => void promptInstall()}>
        Install app
      </Button>
    </Section>
  );
}
