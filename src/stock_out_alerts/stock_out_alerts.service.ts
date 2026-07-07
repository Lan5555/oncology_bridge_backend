import { Injectable } from '@nestjs/common';
import { CreateStockOutAlertDto } from './dto/create-stock_out_alert.dto';
import { UpdateStockOutAlertDto } from './dto/update-stock_out_alert.dto';

@Injectable()
export class StockOutAlertsService {
  create(createStockOutAlertDto: CreateStockOutAlertDto) {
    return 'This action adds a new stockOutAlert';
  }

  findAll() {
    return `This action returns all stockOutAlerts`;
  }

  findOne(id: number) {
    return `This action returns a #${id} stockOutAlert`;
  }

  update(id: number, updateStockOutAlertDto: UpdateStockOutAlertDto) {
    return `This action updates a #${id} stockOutAlert`;
  }

  remove(id: number) {
    return `This action removes a #${id} stockOutAlert`;
  }
}
