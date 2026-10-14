import { IsString, IsUUID } from 'class-validator';
export class CreateNotificationDto {
  @IsUUID() userId!: string;
  @IsString() title!: string;
  @IsString() message!: string;
}
