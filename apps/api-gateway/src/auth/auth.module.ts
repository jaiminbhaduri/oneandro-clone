import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtVerifierService } from './jwt-verifier.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [JwtVerifierService],
  exports: [JwtVerifierService],
})
export class AuthModule {}
