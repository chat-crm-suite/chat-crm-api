import {
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';

import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import { AuthUserSchema, UserResponseSchema, paginatedSchema } from '../../contracts/index';

import { UserSearchDto } from './dto/user-search.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserTableQueryDto } from '../../common/schemas/user-table-query.schema';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly service: UsersService) { }

  @Get('me')
  @ZodSerializerDto(AuthUserSchema.nullable())
  me() {
    return this.service.identify();
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.service.importCsv(file);
  }

  @Post()
  @ZodSerializerDto(UserResponseSchema)
  create(@Body() createUserDto: CreateUserDto) {
    return this.service.create(createUserDto);
  }

  @Post('table')
  @ZodSerializerDto(paginatedSchema(UserResponseSchema))
  getTable(@Body() query: UserTableQueryDto) {
    return this.service.table(query);
  }

  @Get("search")
  @ZodSerializerDto(UserResponseSchema.array())
  search(@Query() query: UserSearchDto) {
    return this.service.searchUser(query);
  }

  @Get()
  @ZodSerializerDto(UserResponseSchema.array())
  async all(): Promise<User[]> {
    return await this.service.all();
  }

  @Get(':username')
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodSerializerDto(UserResponseSchema.nullable())
  find(@Param('username') username: string) {
    return this.service.find({ username });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.service.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
