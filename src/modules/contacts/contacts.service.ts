import { Readable } from 'stream';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WhatsappNotificationContact } from '@daweto/whatsapp-api-types';
import { CsvParser } from 'nest-csv-parser';
import {
  paginate,
  Pagination,
} from 'nestjs-typeorm-paginate';
import { FindManyOptions, IsNull, Like, Repository, UpdateResult } from 'typeorm';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { Contact } from './entities/contact.entity';
import {
  isDuplicateEntryError,
  normalizePhoneNumber,
} from '../../lib/helpers/phone.helper';
import { ContactQueryDto } from './contact.types';
import type { ContactTableQuery } from '../../common/schemas/contact-table-query.schema';
import { buildQueryOptions } from '../../lib/helpers/build-query-options.helper';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    private readonly csv: CsvParser,
  ) { }

  async importCsv(file: Express.Multer.File, companyId?: string): Promise<{ count: number }> {
    const stream = Readable.from(file.buffer);
    const parsed = await this.csv.parse(stream, CreateContactDto, undefined, undefined, {
      strict: true,
      separator: ',',
    });

    const contacts = parsed.list.map((row: Partial<Contact>) => ({
      username: row.username,
      phoneNumber: row.phoneNumber,
      waId: row.phoneNumber,
      company: { id: companyId }
    }));

    await this.contactRepo.insert(contacts);

    return { count: contacts.length };
  }

  async table(query: ContactQueryDto): Promise<Pagination<Contact>> {
    const { findOptions, paginationOptions } = buildQueryOptions<Contact>(query);

    const defaultFindOptions: FindManyOptions<Contact> = {
      where: { deletedAt: IsNull() },
      order: { status: 'DESC', updatedAt: 'DESC' },
    };

    const mergedFindOptions: FindManyOptions<Contact> = {
      ...defaultFindOptions,
      ...findOptions,
      where: { ...defaultFindOptions.where, ...findOptions.where },
      order: { ...defaultFindOptions.order, ...findOptions.order },
    };

    return paginate<Contact>(
      this.contactRepo,
      paginationOptions,
      mergedFindOptions,
    );
  }

  async findPaginated(query: ContactTableQuery): Promise<Pagination<Contact>> {
    const { findOptions, paginationOptions } = buildQueryOptions(query);

    const optionsWithRelations: FindManyOptions<Contact> = {
      ...(findOptions as FindManyOptions<Contact>)
    };

    return paginate<Contact>(
      this.contactRepo,
      paginationOptions,
      optionsWithRelations,
    );
  }

  async search(q: string = '', limit: number = 10): Promise<Contact[]> {
    const findOptions: FindManyOptions<Contact> = {
      where: [
        { username: Like(`%${q}%`) },
        { firstNames: Like(`%${q}%`) },
        { lastNames: Like(`%${q}%`) },
        { phoneNumber: Like(`%${q}%`) },
        { email: Like(`%${q}%`) },
      ],
      take: limit,
      order: { username: 'ASC' }
    };

    return this.contactRepo.find(findOptions);
  }

  async create(dto: CreateContactDto): Promise<Contact> {
    const contact = this.contactRepo.create(dto);

    return this.contactRepo.save(contact);
  }

  async findAll() {
    return this.contactRepo.find()
  }

  async update(id: string, dto: UpdateContactDto): Promise<UpdateResult> {
    return await this.contactRepo.update(id, { ...dto });
  }

  async remove(id: string) {
    const res = await this.contactRepo.softDelete({ id });

    if (res.affected === 0) {
      throw new NotFoundException(`Contacto con id ${id} no encontrado`);
    }

    return { success: true, id }
  }

  async findOrCreateByPhone(
    phoneNumber: string,
    companyId: string,
    waProfile?: WhatsappNotificationContact
  ): Promise<Contact> {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    const findContact = () =>
      this.contactRepo.findOne({
        where: {
          phoneNumber: normalizedPhone,
          company: { id: companyId }
        }
      });

    let contact = await findContact();

    if (!contact) {
      try {
        contact = await this.contactRepo.save(
          this.contactRepo.create({
            phoneNumber: normalizedPhone,
            waId: normalizedPhone,
            source: 'whatsapp',
            company: { id: companyId },
            username: waProfile?.profile?.name || 'Unknown',
          }),
        );
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        contact = await findContact();
        if (!contact) throw error;
      }
    }

    return contact;
  }

  findByPhone(phoneNumber: string): Promise<Contact | null> {
    return this.contactRepo.findOne({
      where: { phoneNumber },
    });
  }
}
