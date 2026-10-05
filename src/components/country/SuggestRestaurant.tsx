"use client";

import { useState, useTransition } from "react";
import { BottomSheet, Button, useToast } from "@/components/ui";

/**
 * "Suggest a restaurant" on a Country page (brief 6.4). Posts to /api/submissions, which geocodes
 * the postcode and files a pending submission for the curator. Only the restaurant's postcode is
 * sent: never a position.
 */
export function SuggestRestaurant({ iso2, countryName }: { iso2: string; countryName: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();

  function submit(form: HTMLFormElement) {
    setError(null);
    const f = new FormData(form);
    const body = {
      countryIso2: iso2,
      name: String(f.get("name") ?? ""),
      address: String(f.get("address") ?? ""),
      postcode: String(f.get("postcode") ?? ""),
      googlePlaceId: String(f.get("googlePlaceId") ?? ""),
      website: String(f.get("website") ?? ""),
      note: String(f.get("note") ?? ""),
    };
    start(async () => {
      try {
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && data.ok) {
          setOpen(false);
          form.reset();
          toast("Thanks! A curator will check it and add it to the list.", "success");
        } else {
          const msg = data.error ?? "We couldn't send that. Please try again.";
          setError(msg);
          toast(msg, "error");
        }
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  const formId = `suggest-${iso2}`;

  return (
    <>
      <Button variant="secondary" block onClick={() => setOpen(true)}>
        Suggest a restaurant
      </Button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Suggest a ${countryName} restaurant`}
        footer={
          <Button type="submit" form={formId} block size="lg" loading={pending}>
            Send suggestion
          </Button>
        }
      >
        <p className="mb-4 text-[0.95rem] text-ink-soft">
          Only places that mostly cook {countryName} food count. A curator checks every suggestion before
          it joins the list.
        </p>
        <form
          id={formId}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          <Field label="Name" htmlFor={`${formId}-name`}>
            <input id={`${formId}-name`} name="name" className="input" required maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Address" htmlFor={`${formId}-address`} hint="Optional">
            <input id={`${formId}-address`} name="address" className="input" maxLength={300} autoComplete="off" />
          </Field>
          <Field label="Postcode" htmlFor={`${formId}-postcode`} hint="We use it to pin the place on the map">
            <input
              id={`${formId}-postcode`}
              name="postcode"
              className="input uppercase"
              required
              maxLength={12}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="N1 9AB"
            />
          </Field>
          <Field label="Website" htmlFor={`${formId}-website`} hint="Optional">
            <input
              id={`${formId}-website`}
              name="website"
              className="input"
              inputMode="url"
              maxLength={300}
              autoComplete="off"
              placeholder="https://"
            />
          </Field>
          <Field label="Google place ID" htmlFor={`${formId}-gpid`} hint="Optional">
            <input id={`${formId}-gpid`} name="googlePlaceId" className="input" maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Note" htmlFor={`${formId}-note`} hint="Why it counts, what to order">
            <textarea id={`${formId}-note`} name="note" className="input min-h-24" maxLength={1000} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-stamp-red">
              {error}
            </p>
          )}
        </form>
      </BottomSheet>
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
