import type { Metadata } from "next";
import { requireUser } from "@/components/auth/session";
import { loadWorldData } from "@/components/world/data";
import { WorldView } from "@/components/world/WorldView";

export const metadata: Metadata = { title: "World" };

/** Choropleth of my visit stamps or my group's combined stamps. The map loads on this screen only. */
export default async function WorldPage() {
  const user = await requireUser("/world");
  const data = await loadWorldData(user.id);
  return (
    <>
      <h1 className="sr-only">World view</h1>
      <WorldView data={data} />
    </>
  );
}
