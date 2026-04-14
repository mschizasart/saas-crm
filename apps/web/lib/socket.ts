import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (socket?.connected) return socket;

  const token = localStorage.getItem('access_token');
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  socket = io(`${url}/notifications`, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
