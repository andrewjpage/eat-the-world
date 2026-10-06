import { getMyProfile, requireUser } from "@/components/auth/session";
import { FlagGrid, parseFilter } from "@/components/passport/FlagGrid";
import { PassportHeader } from "@/components/passport/PassportHeader";
import { PendingBanner } from "@/components/passport/PendingBanner";
import { loadPassport } from "@/components/passport/data";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";

export const metadata = { title: "Passport" };

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await requireUser("/");
  const [data, profile, sp] = await Promise.all([
    loadPassport(user.id),
    getMyProfile(),
    searchParams,
  ]);
  const filter = parseFilter(sp.show);
  const brandNew = data.anywhereStamps === 0 && !data.hasGroup;

  return (
    <Page>
      <PendingBanner items={data.pending} />
      <PassportHeader
        name={profile?.display_name ?? "Friend"}
        londonStamped={data.londonStamped}
        londonListed={data.londonListed}
        anywhereStamps={data.anywhereStamps}
        points={data.points}
        isoTotal={data.isoTotal}
      />
      {brandNew && (
        <Card tone="sunk" className="mb-4 text-center">
          <p className="font-display text-xl text-ink">Your passport is blank</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-ink-soft">
            Start a dining group with friends, then eat your way round London. Already been
            places? Add them first.
          </p>
          <div className="mt-4 space-y-2">
            <ButtonLink href="/group" block>
              Create or join a group
            </ButtonLink>
            <ButtonLink href="/settings/backfill" variant="secondary" block>
              Add countries you&apos;ve already done
            </ButtonLink>
          </div>
        </Card>
      )}
      <FlagGrid countries={data.countries} filter={filter} />
    </Page>
  );
}
