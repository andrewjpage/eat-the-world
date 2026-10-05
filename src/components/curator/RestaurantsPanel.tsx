"use client";

import { useState } from "react";
import { Badge, BottomSheet, Button, Card, Eyebrow, Flag } from "@/components/ui";
import { markVerifiedAction, saveRestaurantAction } from "@/app/curator/actions";
import { CONFIDENCES, RESTAURANT_STATUSES, statusImpact, type Confidence, type CountryOption, type RestaurantStatus } from "./logic";
import { useRun } from "./useRun";

export interface RestaurantRow {
  id: string;
  name: string;
  address: string | null;
  postcode: string;
  country_iso2: string;
  status: RestaurantStatus;
  confidence: Confidence;
  curator_note: string | null;
  google_place_id: string | null;
  website: string | null;
  verified_at: string | null;
}


const STATUS_LABEL: Record<RestaurantStatus, string> = {
  active: "Active",
  reported_closed: "Reported closed",
  closed: "Closed",
  pending: "Pending",
};

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

export function RestaurantsPanel({
  rows,
  countries,
  eligibleCounts,
}: {
  rows: RestaurantRow[];
  countries: CountryOption[];
  /** London eligible restaurants per country. */
  eligibleCounts: Record<string, number>;
}) {
  const [editing, setEditing] = useState<RestaurantRow | null>(null);
  const nameOf = (iso: string) => countries.find((c) => c.iso2 === iso)?.name ?? iso;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setEditing(r)} className="block w-full text-left">
              <Card className="flex items-center gap-3 py-3 transition active:scale-[0.99]">
                <Flag iso2={r.country_iso2} size="md" label={nameOf(r.country_iso2)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{r.name}</p>
                  <p className="truncate font-mono text-xs text-muted">
                    {r.postcode} · {r.verified_at ? `verified ${dateFmt.format(new Date(r.verified_at))}` : "never verified"}
                  </p>
                </div>
                <Badge tone={r.status === "active" ? "teal" : r.status === "closed" ? "red" : "gold"}>
                  {STATUS_LABEL[r.status]}
                </Badge>
              </Card>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <EditSheet
          key={editing.id}
          row={editing}
          countries={countries}
          eligibleCounts={eligibleCounts}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function EditSheet({
  row,
  countries,
  eligibleCounts,
  onClose,
}: {
  row: RestaurantRow;
  countries: CountryOption[];
  eligibleCounts: Record<string, number>;
  onClose: () => void;
}) {
  const save = useRun();
  const verify = useRun();
  const [status, setStatus] = useState<RestaurantStatus>(row.status);
  const [country, setCountry] = useState(row.country_iso2);
  const formId = `edit-${row.id}`;

  const impacts: string[] = [];
  const nameOf = (iso: string) => countries.find((c) => c.iso2 === iso)?.name ?? iso;
  if (country !== row.country_iso2) {
    const eligibleNow = status === "active" || status === "reported_closed";
    if (eligibleNow) impacts.push(`${nameOf(country)} gains an eligible restaurant.`);
    if (row.status === "active" || row.status === "reported_closed") {
      const left = statusImpact({ countryName: nameOf(row.country_iso2), from: row.status, to: "closed", eligibleCount: eligibleCounts[row.country_iso2] ?? 0 });
      if (left) impacts.push(left);
    }
  } else {
    const line = statusImpact({
      countryName: nameOf(row.country_iso2),
      from: row.status,
      to: status,
      eligibleCount: eligibleCounts[row.country_iso2] ?? 0,
    });
    if (line) impacts.push(line);
  }

  function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    const g = (k: string) => String(f.get(k) ?? "");
    save.run(
      () =>
        saveRestaurantAction(row.id, {
          name: g("name"),
          address: g("address"),
          postcode: g("postcode"),
          country_iso2: country,
          status,
          confidence: g("confidence") as Confidence,
          curator_note: g("curator_note"),
          google_place_id: g("google_place_id"),
          website: g("website"),
        }),
      onClose,
    );
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Edit restaurant"
      footer={
        <Button type="submit" form={formId} block size="lg" loading={save.pending}>
          Save changes
        </Button>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-paper-sunk px-3 py-2">
        <div className="min-w-0">
          <Eyebrow>Verified</Eyebrow>
          <p className="text-sm text-ink">
            {row.verified_at ? dateFmt.format(new Date(row.verified_at)) : "Never checked by a curator"}
          </p>
        </div>
        <Button
          size="sm"
          variant="teal"
          loading={verify.pending}
          onClick={() => verify.run(() => markVerifiedAction(row.id), onClose)}
        >
          Mark verified today
        </Button>
      </div>
      {verify.error && (
        <p role="alert" className="mb-3 text-sm text-stamp-red">
          {verify.error}
        </p>
      )}

      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <Field id={`${formId}-name`} label="Name">
          <input id={`${formId}-name`} name="name" className="input" required maxLength={200} defaultValue={row.name} />
        </Field>
        <Field id={`${formId}-address`} label="Address">
          <input id={`${formId}-address`} name="address" className="input" maxLength={300} defaultValue={row.address ?? ""} />
        </Field>
        <Field id={`${formId}-postcode`} label="Postcode" hint="Changing it re-geocodes the pin">
          <input
            id={`${formId}-postcode`}
            name="postcode"
            className="input uppercase"
            required
            maxLength={12}
            autoCapitalize="characters"
            defaultValue={row.postcode}
          />
        </Field>
        <Field id={`${formId}-country`} label="Country">
          <select id={`${formId}-country`} className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
            {countries.map((c) => (
              <option key={c.iso2} value={c.iso2}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id={`${formId}-status`} label="Status">
            <select id={`${formId}-status`} className="input" value={status} onChange={(e) => setStatus(e.target.value as RestaurantStatus)}>
              {RESTAURANT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${formId}-confidence`} label="Confidence">
            <select id={`${formId}-confidence`} name="confidence" className="input" defaultValue={row.confidence}>
              {CONFIDENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {impacts.map((t) => (
          <p key={t} className="text-sm font-semibold text-gold">
            {t}
          </p>
        ))}
        <Field id={`${formId}-note`} label="Curator note" hint="Shown on contested picks">
          <textarea id={`${formId}-note`} name="curator_note" className="input min-h-20" maxLength={1000} defaultValue={row.curator_note ?? ""} />
        </Field>
        <Field id={`${formId}-website`} label="Website">
          <input id={`${formId}-website`} name="website" className="input" maxLength={300} defaultValue={row.website ?? ""} />
        </Field>
        <Field id={`${formId}-gpid`} label="Google place ID">
          <input id={`${formId}-gpid`} name="google_place_id" className="input" maxLength={200} defaultValue={row.google_place_id ?? ""} />
        </Field>
        {save.error && (
          <p role="alert" className="text-sm text-stamp-red">
            {save.error}
          </p>
        )}
      </form>
    </BottomSheet>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
