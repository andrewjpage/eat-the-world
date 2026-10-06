"use client";

import { useState } from "react";
import { Badge, BottomSheet, Button, Card, EmptyState } from "@/components/ui";
import { saveDishAction, setDishStatusAction } from "@/app/curator/actions";
import { useRun } from "./useRun";

export interface DishRow {
  id: string;
  name: string;
  note: string | null;
  status: "draft" | "approved";
}

export function DishesEditor({ iso2, countryName, dishes }: { iso2: string; countryName: string; dishes: DishRow[] }) {
  const [editing, setEditing] = useState<DishRow | "new" | null>(null);

  return (
    <>
      <Button block className="mb-4" onClick={() => setEditing("new")}>
        Add a dish for {countryName}
      </Button>
      {dishes.length === 0 ? (
        <Card tone="sunk">
          <EmptyState emoji="🍲" title="No dishes yet" className="py-4">
            Approved dishes appear on the country page and earn the +2 dish bonus at check-in.
          </EmptyState>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {dishes.map((d) => (
            <DishItem key={d.id} d={d} onEdit={() => setEditing(d)} />
          ))}
        </ul>
      )}
      {editing && (
        <DishSheet
          key={editing === "new" ? "new" : editing.id}
          iso2={iso2}
          countryName={countryName}
          dish={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function DishItem({ d, onEdit }: { d: DishRow; onEdit: () => void }) {
  const t = useRun();
  const approved = d.status === "approved";
  return (
    <li>
      <Card className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-ink">{d.name}</p>
            {d.note && <p className="text-sm text-ink-soft">{d.note}</p>}
          </div>
          <Badge tone={approved ? "teal" : "gold"}>{approved ? "Approved" : "Draft"}</Badge>
        </div>
        {t.error && (
          <p role="alert" className="mt-2 text-sm text-stamp-red">
            {t.error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="sm"
            variant={approved ? "danger" : "teal"}
            loading={t.pending}
            onClick={() => t.run(() => setDishStatusAction(d.id, approved ? "draft" : "approved"))}
          >
            {approved ? "Demote to draft" : "Approve"}
          </Button>
        </div>
      </Card>
    </li>
  );
}

function DishSheet({
  iso2,
  countryName,
  dish,
  onClose,
}: {
  iso2: string;
  countryName: string;
  dish: DishRow | null;
  onClose: () => void;
}) {
  const save = useRun();
  const [name, setName] = useState(dish?.name ?? "");
  const [note, setNote] = useState(dish?.note ?? "");
  const [status, setStatus] = useState<"draft" | "approved">(dish?.status ?? "approved");

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={dish ? "Edit dish" : `New ${countryName} dish`}
      footer={
        <Button
          block
          size="lg"
          loading={save.pending}
          onClick={() => save.run(() => saveDishAction({ id: dish?.id ?? null, country: iso2, name, note, status }), onClose)}
        >
          {dish ? "Save dish" : "Add dish"}
        </Button>
      }
    >
      <label htmlFor="dish-name" className="mb-1 block text-sm font-semibold text-ink">
        Name
      </label>
      <input id="dish-name" className="input mb-3" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="dish-note" className="mb-1 block text-sm font-semibold text-ink">
        Note <span className="font-normal text-muted">One line on what it is</span>
      </label>
      <textarea id="dish-note" className="input mb-3 min-h-20" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      <label htmlFor="dish-status" className="mb-1 block text-sm font-semibold text-ink">
        Status
      </label>
      <select id="dish-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as "draft" | "approved")}>
        <option value="approved">Approved (shown, earns the dish bonus)</option>
        <option value="draft">Draft (hidden from players)</option>
      </select>
      {save.error && (
        <p role="alert" className="mt-3 text-sm text-stamp-red">
          {save.error}
        </p>
      )}
    </BottomSheet>
  );
}
