import { Injectable } from '@nestjs/common';
import { CreateTransferRequestDto } from './dto/create-transfer_request.dto';
import { UpdateTransferRequestDto } from './dto/update-transfer_request.dto';

@Injectable()
export class TransferRequestsService {
  create(createTransferRequestDto: CreateTransferRequestDto) {
    return 'This action adds a new transferRequest';
  }

  findAll() {
    return `This action returns all transferRequests`;
  }

  findOne(id: number) {
    return `This action returns a #${id} transferRequest`;
  }

  update(id: number, updateTransferRequestDto: UpdateTransferRequestDto) {
    return `This action updates a #${id} transferRequest`;
  }

  remove(id: number) {
    return `This action removes a #${id} transferRequest`;
  }
}
