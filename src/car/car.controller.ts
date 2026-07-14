import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { CarService } from './car.service';
import { CarGateway } from './car.gateway';
import { SimulationService } from '../simulation/simulation.service';
import { ControlCommand, RobotState, SpeedSettings } from '../common/interfaces';

@Controller('api')
export class CarController {
  constructor(
    private readonly carService: CarService,
    private readonly simulationService: SimulationService,
    private readonly carGateway: CarGateway,
  ) {}

  @Get('car/state')
  getState(@Query('clientId') clientId?: string): RobotState {
    return this.simulationService.getState(clientId || 'default');
  }

  @Post('car/control')
  control(@Body() command: ControlCommand & { clientId?: string }): { success: boolean; command: ControlCommand; target?: string } {
    this.carService.processCommand(command);
    if (command.clientId) {
      this.carGateway.server.to(command.clientId).emit('command', command);
    }
    return { success: true, command, target: command.clientId || undefined };
  }

  @Post('car/reset')
  reset(@Query('clientId') clientId?: string): RobotState {
    return this.simulationService.resetState(clientId || 'default');
  }

  @Get('car/speed')
  getSpeed(): SpeedSettings {
    return this.carService.getSpeed();
  }

  @Post('car/speed')
  updateSpeed(@Body() settings: Partial<SpeedSettings>): SpeedSettings {
    return this.carService.updateSpeed(settings);
  }

  @Get('control')
  controlGet(
    @Query('action') action: string,
    @Query('clientId') clientId?: string,
    @Query('speed') speed?: string,
    @Query('distance') distance?: string,
    @Query('angle') angle?: string,
    @Query('time') time?: string,
  ): { success: boolean; command: ControlCommand; target?: string } {
    const command: ControlCommand = { action: action as ControlCommand['action'] };
    if (speed !== undefined) command.speed = parseFloat(speed);
    if (distance !== undefined) command.distance = parseFloat(distance);
    if (angle !== undefined) command.angle = parseFloat(angle);
    if (time !== undefined) command.time = parseFloat(time);
    this.carService.processCommand(command);
    if (clientId) {
      this.carGateway.server.to(clientId).emit('command', command);
    }
    return { success: true, command, target: clientId || undefined };
  }
}
