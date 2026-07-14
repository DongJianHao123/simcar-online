import { Injectable } from '@nestjs/common';
import { ControlCommand, SpeedSettings } from '../common/interfaces';

@Injectable()
export class CarService {
  private speed = 0.1;
  private turnSpeed = 0.05;

  processCommand(command: ControlCommand): ControlCommand {
    return command;
  }

  getSpeed(): SpeedSettings {
    return { speed: this.speed, turnSpeed: this.turnSpeed };
  }

  updateSpeed(settings: Partial<SpeedSettings>): SpeedSettings {
    if (typeof settings.speed === 'number') {
      this.speed = settings.speed;
    }
    if (typeof settings.turnSpeed === 'number') {
      this.turnSpeed = settings.turnSpeed;
    }
    return this.getSpeed();
  }
}
