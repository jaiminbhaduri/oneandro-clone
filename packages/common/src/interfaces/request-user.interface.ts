import { Role } from '../enums/role.enum';

/** Shape attached to `request.user` by every service's JwtStrategy (or, in api-gateway's case, JwtVerifierService). */
export interface RequestUser {
  userId: string;
  email: string;
  role: Role;
}
