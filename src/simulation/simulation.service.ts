import { Injectable } from '@nestjs/common';
import { RobotState } from '../common/interfaces';

function createDefaultState(): RobotState {
  return {
    x: 0,
    z: 0,
    rotation: Math.PI,
    velocity: 0,
    angularVelocity: 0,
    armState: 'idle',
    hasBall: false,
    isColliding: false,
    grabAvailable: false,
    ballPosition: { x: 0, z: -5 },
  };
}

@Injectable()
export class SimulationService {
  private states = new Map<string, RobotState>();

  private getOrCreate(clientId: string): RobotState {
    if (!this.states.has(clientId)) {
      this.states.set(clientId, createDefaultState());
    }
    return this.states.get(clientId)!;
  }

  getState(clientId: string): RobotState {
    return { ...this.getOrCreate(clientId) };
  }

  updateState(clientId: string, state: RobotState): void {
    this.states.set(clientId, { ...state });
  }

  resetState(clientId: string): RobotState {
    this.states.set(clientId, createDefaultState());
    return this.getState(clientId);
  }

  removeClient(clientId: string): void {
    this.states.delete(clientId);
  }
}
