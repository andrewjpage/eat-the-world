"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { createGroupAction, type ActionState } from "./actions";

/** Name + Create. On success the action redirects to the new group. */
export function CreateGroupForm({ cta = "Create group" }: { cta?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createGroupAction, {});
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="group-name" className="block text-sm font-semibold text-ink-soft">
        Group name
      </label>
      <input
        id="group-name"
        name="name"
        required
        maxLength={60}
        autoComplete="off"
        placeholder="e.g. Thursday Supper Club"
        className="input"
      />
      {state.error && (
        <p role="alert" className="text-sm font-medium text-stamp-red">
          {state.error}
        </p>
      )}
      <Button type="submit" block loading={pending}>
        {cta}
      </Button>
    </form>
  );
}
