import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from '@nestjs/authentication';
import { UsersService, type User } from '../users/users.service.js';

@Injectable()
export class SessionAuth extends SessionCookieProvider<User> {
  constructor(
    private readonly usersService: UsersService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  validate(session: SessionRecord): Promise<User | null> {
    return this.usersService.findById(session.userId);
  }
}
