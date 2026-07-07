import { Controller } from '@nestjs/common';
import { GuardsService } from './guards.service';

@Controller('guards')
export class GuardsController {
  constructor(private readonly guardsService: GuardsService) {}
}
