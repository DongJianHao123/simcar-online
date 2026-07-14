import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CarModule } from './car/car.module';

@Module({
  imports: [
    // Serve built assets from public/ (production)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
      exclude: ['/api/(.*)', '/socket.io/(.*)'],
    }),
    // Serve .html files from project root (development)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..'),
      serveRoot: '/',
      exclude: ['/api/(.*)', '/socket.io/(.*)', '/src/(.*)', '/node_modules/(.*)', '/client/(.*)'],
    }),
    CarModule,
  ],
})
export class AppModule {}
