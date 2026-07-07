import { PartialType } from '@nestjs/mapped-types';
import { CreateTransferRequestDto } from './create-transfer_request.dto';

export class UpdateTransferRequestDto extends PartialType(CreateTransferRequestDto) {}
