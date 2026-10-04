import { Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Injectable } from "@nestjs/common";

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>
  ) { }

  findUserById(id: string) {
    return this.repo.findOne({
      where: { id },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        address: true,
        avatar: true,
        email: true,
        phoneNumber: true,
        status: true,
        // The front gates admin-only UI with this field.
        role: true,
      }
    });
  }

}