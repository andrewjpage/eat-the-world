"use client";

import { useState, useTransition } from "react";
import { APP_NAME } from "@/lib/app";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { rotateInviteCodeAction } from "../actions";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older iOS / insecure origins: fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** The group's invite link with Copy, Share (Web Share, else WhatsApp) and, for the owner, a new link. */
export function InviteCard({
  groupId,
  groupName,
  inviteUrl,
  inviteCode,
  isOwner,
  memberCount,
  maxMembers,
}: {
  groupId: string;
  groupName: string;
  inviteUrl: string;
  inviteCode: string;
  isOwner: boolean;
  memberCount: number;
  maxMembers: number;
}) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rotating, startRotate] = useTransition();
  const full = memberCount >= maxMembers;

  const shareText = `Join "${groupName}" on ${APP_NAME}: we're eating our way round the world in London 🌍🍽️`;

  async function onCopy() {
    const ok = await copyText(inviteUrl);
    toast(ok ? "Invite link copied" : "Couldn't copy. Press and hold the link instead.", ok ? "success" : "error");
  }

  async function onShare() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: APP_NAME, text: shareText, url: inviteUrl });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Any other failure: fall through to WhatsApp.
      }
    }
    const wa = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${inviteUrl}`)}`;
    window.open(wa, "_blank", "noopener,noreferrer");
  }

  function onRotate() {
    startRotate(async () => {
      const res = await rotateInviteCodeAction(groupId);
      setConfirmOpen(false);
      if (res.error) toast(res.error, "error");
      else toast(res.message ?? "New link ready", "success");
    });
  }

  return (
    <Card perforated>
      <Eyebrow>Invite friends</Eyebrow>
      <p className="mt-1 text-[0.95rem] text-ink-soft">
        {full
          ? `The table is full: ${maxMembers} is the limit.`
          : "Anyone with this link can join the group."}
      </p>

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-ink/30 bg-paper-sunk px-3 py-2.5">
        <code
          data-testid="invite-url"
          className="min-w-0 flex-1 truncate font-mono text-sm text-ink select-all"
        >
          {inviteUrl}
        </code>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Code <span className="font-mono font-medium tracking-widest text-ink-soft">{inviteCode}</span>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCopy}>
          Copy link
        </Button>
        <Button onClick={onShare}>Share</Button>
      </div>

      {isOwner && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="mt-3 w-full text-center text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Make a new link
        </button>
      )}

      <BottomSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Make a new invite link?"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep this one
            </Button>
            <Button onClick={onRotate} loading={rotating}>
              New link
            </Button>
          </div>
        }
      >
        <p className="text-ink-soft">
          The current link stops working straight away. Everyone already in the group stays in.
        </p>
      </BottomSheet>
    </Card>
  );
}
