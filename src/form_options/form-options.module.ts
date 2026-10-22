import {
  Controller,
  Get,
  Global,
  Header,
  Module,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { OperationalReadGuard } from '../guards/operational-read.guard';
import { FormOptionsService } from './form-options.service';

@Controller('api/form-options')
@UseGuards(AuthGuard, OperationalReadGuard)
export class FormOptionsController {
  constructor(private readonly options: FormOptionsService) {}
  @Get() @Header('Cache-Control', 'private, no-store') get(
    @Query('context') context: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.options.get(context, req.user.id);
  }
}
@Global()
@Module({
  controllers: [FormOptionsController],
  providers: [FormOptionsService],
  exports: [FormOptionsService],
})
export class FormOptionsModule {}
