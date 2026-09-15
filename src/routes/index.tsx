import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RadioSet } from "@/components/radio/RadioSet";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [split, setSplit] = useState(false);
  const [armed, setArmed] = useState<"a" | "b">("a");

  return (
    <div className={split ? "bench bench-split" : "bench"}>
      <RadioSet
        rig="a"
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
          compact
          armed={armed === "b"}
          split
          onArm={() => setArmed("b")}
        />
      ) : null}
    </div>
  );
}
