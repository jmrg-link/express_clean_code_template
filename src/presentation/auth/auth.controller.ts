import type { Request, Response, NextFunction } from 'express';
import type { AuthFacade } from '#application/auth/auth.facade';
import { ResponseFormatter } from '#domain/shared/response/response.formatter';
import { CustomError } from '#domain/shared/errors';

export class AuthController {
  public constructor(private readonly facade: AuthFacade) {}

  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const meta = {
        ip: req.ip ?? undefined,
        userAgent: req.header('user-agent') ?? undefined,
      };
      const session = await this.facade.login(req.body, meta);
      res.status(200).json(
        ResponseFormatter.success('Login successful', {
          access_token: session.tokens.access_token,
          refresh_token: session.tokens.refresh_token,
          expires_in: session.tokens.expires_in,
          user: session.user,
        }),
      );
    } catch (err) {
      next(err);
    }
  };

  public register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await this.facade.register(req.body);
      res.status(201).json(
        ResponseFormatter.success('Registration successful', {
          access_token: session.tokens.access_token,
          refresh_token: session.tokens.refresh_token,
          expires_in: session.tokens.expires_in,
          user: session.user,
        }),
      );
    } catch (err) {
      next(err);
    }
  };

  public refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tokens = await this.facade.refresh(req.body);
      res.status(200).json(ResponseFormatter.success('Token refreshed', tokens));
    } catch (err) {
      next(err);
    }
  };

  public me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw CustomError.unauthorized();
      const user = await this.facade.me(req.user.id);
      res.status(200).json(ResponseFormatter.success('User profile retrieved', user));
    } catch (err) {
      next(err);
    }
  };
}
