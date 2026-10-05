import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';

import { User } from '@modules/users/entities/user.entity';

import type { ManagerTransientParams } from './types';

/** Password behind the factory hash, for tests that log a factory user in. */
export const FACTORY_USER_PASSWORD = 'Test1234!';

/** bcrypt hash of `Test1234!` (cost 4) so no hashing happens per build. */
const PASSWORD_HASH =
  '$2b$04$le0E9pls3D0fXBhXbv3aS.ejZsbJdrtuJIxiO0ov95jwoBVgaknaS';

export const UserFactory = Factory.define<User, ManagerTransientParams>(
  ({ onCreate, sequence, transientParams }) => {
    onCreate(async (user) => {
      const manager = transientParams.manager;
      if (!manager) return user;

      return manager.getRepository(User).save(user);
    });

    const user = new User();
    user.username = `user-${sequence}-${faker.internet.username().toLowerCase()}`;
    user.email = `user-${sequence}-${faker.string.alphanumeric(6)}@example.com`;
    user.passwordHash = PASSWORD_HASH;
    user.firstName = faker.person.firstName();
    user.lastName = faker.person.lastName();
    user.phoneNumber = `+519${String(sequence).padStart(8, '0')}`;
    user.avatarUrl = faker.image.avatar();
    user.isPlatformAdmin = false;

    return user;
  },
);
