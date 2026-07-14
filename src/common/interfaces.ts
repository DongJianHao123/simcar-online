export interface RobotState {
  x: number;
  z: number;
  rotation: number;
  velocity: number;
  angularVelocity: number;
  armState: 'idle' | 'picking_down' | 'picking_up' | 'holding' | 'dropping_down' | 'dropping_up';
  hasBall: boolean;
  isColliding: boolean;
  grabAvailable: boolean;
  ballPosition: { x: number; z: number } | null;
}

export interface ControlCommand {
  action: 'up' | 'down' | 'left' | 'right' | 'stop' | 'grab' | 'release' | 'setSpeed' | 'setTurnSpeed' | 'turnAngle';
  value?: number;
  distance?: number; // 距离（厘米）
  angle?: number;    // 角度（度）
  speed?: number;    // 速度
  time?: number;     // 时间（毫秒）
}

export interface SpeedSettings {
  speed: number;
  turnSpeed: number;
}
