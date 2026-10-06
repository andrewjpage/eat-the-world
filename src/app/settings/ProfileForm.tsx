"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { ActionState } from "@/app/group/actions";
import { updateDisplayNameAction } from "./actions";

export function ProfileForm({ displayName }: { displayName: string }) {
  const { toast } = useToast();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateDisplayNameAction,
    {},
  );

  useEffect(() => {
    if (state.ok && state.message) toast(state.message, "success");
  }, [state, toast]);

  return (
    <form action={action} className="space-y-3">
      <label htmlFor="display_name" className="block text-sm font-semibold text-ink-soft">
        Name your friends see
      </label>
      <div className="flex gap-2">
        <input
          id="display_name"
          name="display_name"
          required
          maxLength={60}
          autoComplete="nickname"
          defaultValue={displayName}
          className="input"
        />
        <Button type="submit" variant="secondary" loading={pending} className="shrink-0">
          Save
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm font-medium text-stamp-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
