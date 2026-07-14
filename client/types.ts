export interface RobotState {
  x: number;
  z: number;
  rotation: number;
  velocity: number;
  angularVelocity: number;
  armState: string;
  hasBall: boolean;
  isColliding: boolean;
  grabAvailable: boolean;
  ballPosition: { x: number; z: number } | null;
}

export interface ControlCommand {
  action: string;
  value?: number;
  distance?: number;
  angle?: number;
  speed?: number;
  time?: number;
}
