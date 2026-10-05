"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { joinGroupAction, type JoinState } from "./actions";

/** POSTs the join (a server action); the action redirects on success. */
export function JoinButton({ code }: { code: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(joinGroupAction.bind(null, code), {});
  return (
    <form action={action} className="space-y-3">
      {state.error && (
        <p role="alert" className="text-sm font-medium text-stamp-red">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={pending}>
        Join the table
      </Button>
    </form>
  );
}
