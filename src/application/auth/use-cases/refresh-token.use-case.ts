import type { IamPort } from '#domain/auth/iam.port';
import type { RefreshDto } from '#domain/auth/auth.dto';
import type { AuthTokens } from '#domain/auth/auth.entity';

export class RefreshTokenUseCase {
  public constructor(private readonly iam: IamPort) {}

  public execute(dto: RefreshDto): Promise<AuthTokens> {
    return this.iam.refresh(dto.refresh_token);
  }
}
