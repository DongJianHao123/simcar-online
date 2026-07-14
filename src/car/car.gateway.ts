import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { ControlCommand, RobotState } from '../common/interfaces';
import { SimulationService } from '../simulation/simulation.service';

@WebSocketGateway({
  namespace: '/car',
  cors: { origin: '*' },
})
export class CarGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Namespace;

  constructor(private readonly simulationService: SimulationService) {}

  handleConnection(client: Socket) {
    console.log(`[WS] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    const clientId = client.data.clientId as string | undefined;
    console.log(`[WS] Client disconnected: ${client.id} (car: ${clientId ?? 'unknown'})`);
    if (clientId) {
      this.simulationService.removeClient(clientId);
    }
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { role: string; clientId?: string },
  ) {
    const clientId = data.clientId || client.id;
    client.data.clientId = clientId;
    client.join(clientId);
    console.log(`[WS] Client ${client.id} joined as ${data.role} in room ${clientId}`);
  }

  @SubscribeMessage('command')
  handleCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ControlCommand & { distance?: number; angle?: number; speed?: number; time?: number },
  ) {
    const clientId = client.data.clientId as string | undefined;
    if (!clientId) {
      console.log(`[WS] Command ignored: client ${client.id} has no clientId`);
      return;
    }
    console.log(`[WS] Command: ${data.action} dist=${data.distance ?? '-'} angle=${data.angle ?? '-'} -> room ${clientId}`);
    this.server.to(clientId).emit('command', data);
  }

  @SubscribeMessage('state')
  handleState(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: RobotState,
  ) {
    const clientId = client.data.clientId as string | undefined;
    if (clientId) {
      this.simulationService.updateState(clientId, data);
      // Broadcast state to other clients in the same room
      client.to(clientId).emit('state', data);
    }
  }
}
