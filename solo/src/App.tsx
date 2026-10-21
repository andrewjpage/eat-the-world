import { Stamp } from "@/components/ui/Stamp";

export default function App() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-3xl font-semibold text-ink">Eat the World</h1>
      <div className="w-44">
        <Stamp iso2="FR" name="France" date="2026-10-21" verification="geo_verified" />
      </div>
    </main>
  );
}
