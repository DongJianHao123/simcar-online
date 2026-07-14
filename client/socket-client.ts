import { io, Socket } from 'socket.io-client';

const SOCKET_URL = '/car';

let socket: Socket | null = null;

// Generate a unique client ID per browser tab (persists across refreshes)
function getOrCreateClientId(): string {
  const key = 'car-client-id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = 'car-' + Math.random().toString(36).substring(2, 11);
    sessionStorage.setItem(key, id);
  }
  return id;
}

let clientId: string;

export function getClientId(): string {
  return clientId;
}

export function connectSocket(serverUrl?: string): Socket {
  if (socket?.connected) return socket;

  clientId = getOrCreateClientId();
  const url = serverUrl ? `${serverUrl}/car` : SOCKET_URL;

  socket = io(url, {
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket?.id, 'clientId:', clientId);
    socket?.emit('join', { role: 'simulator', clientId });
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected');
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}

export function sendCommand(action: string, value?: number, extra?: { distance?: number; angle?: number; speed?: number; time?: number }): void {
  if (!socket?.connected) {
    console.warn('[Socket] Not connected, cannot send command');
    return;
  }
  socket.emit('command', { action, value, ...extra });
}

export function sendState(state: unknown): void {
  if (!socket?.connected) return;
  socket.emit('state', state);
}

export function onCommand(callback: (data: { action: string; value?: number; distance?: number; angle?: number; speed?: number; time?: number }) => void): void {
  socket?.on('command', callback);
}

export function onState(callback: (data: unknown) => void): void {
  socket?.on('state', callback);
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
