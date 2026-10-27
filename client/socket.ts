import { io, type Socket } from "socket.io-client";

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

export const socket: Socket = io(serverUrl || undefined, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4_000,
  timeout: 8_000,
});

export function resetSocket(): void {
  socket.disconnect();
  socket.connect();
}
