import { createFileRoute } from "@tanstack/react-router";
import { RadioSet } from "@/components/radio/RadioSet";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <RadioSet />;
}
