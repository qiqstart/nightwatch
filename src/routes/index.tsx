import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RadioSet } from "@/components/radio/RadioSet";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === "string" || typeof search.c === "number" ? String(search.c) : undefined,
  }),
  component: Home,
});

function Home() {
  const { c } = Route.useSearch();
  const [split, setSplit] = useState(false);
  const [armed, setArmed] = useState<"a" | "b">("a");

  return (
    <div className={split ? "bench bench-split" : "bench"}>
      <RadioSet
        rig="a"
        channel={c}
        compact={split}
        armed={!split || armed === "a"}
        split={split}
        onArm={() => setArmed("a")}
        onToggleSplit={() => {
          setSplit((v) => !v);
          setArmed("a");
        }}
      />
      {split ? (
        <RadioSet
          rig="b"
          channel={c}
          compact
          armed={armed === "b"}
          split
          onArm={() => setArmed("b")}
        />
      ) : null}
    </div>
  );
}
