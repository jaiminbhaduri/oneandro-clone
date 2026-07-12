import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ServiceTokenService } from './service-token.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [ServiceTokenService],
  exports: [ServiceTokenService],
})
export class AuthModule {}
