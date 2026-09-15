import { createFileRoute } from "@tanstack/react-router";
import { handleNets } from "@/lib/multiplayer/signaling.server";

const handle = () => handleNets();

export const Route = createFileRoute("/api/nets")({
  server: { handlers: { GET: handle } },
});
