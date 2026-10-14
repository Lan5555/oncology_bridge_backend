import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { StockOutAlertsService } from './stock_out_alerts.service';
import { CreateStockOutAlertDto } from './dto/create-stock_out_alert.dto';
import { UpdateStockOutAlertDto } from './dto/update-stock_out_alert.dto';

@Controller(['stock-out-alerts', 'api/stock-out-alerts'])
@UseGuards(AuthGuard)
export class StockOutAlertsController {
  constructor(private readonly stockOutAlertsService: StockOutAlertsService) {}

  @Post()
  create(@Body() createStockOutAlertDto: CreateStockOutAlertDto) {
    return this.stockOutAlertsService.create(createStockOutAlertDto);
  }

  @Get()
  findAll() {
    return this.stockOutAlertsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stockOutAlertsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateStockOutAlertDto: UpdateStockOutAlertDto,
  ) {
    return this.stockOutAlertsService.update(id, updateStockOutAlertDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stockOutAlertsService.remove(id);
  }
}
