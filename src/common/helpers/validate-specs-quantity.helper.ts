import { SpecsDto } from '../dto/specs.dto';
import { businessError } from '../exceptions/business.exception';

export function validateSpecsQuantity(specs: SpecsDto, quantity: number): void {
  const total = specs.sizes.reduce((sum, item) => sum + item.quantity, 0);
  if (total !== quantity) {
    businessError('INVALID_SPECS_QUANTITY');
  }
}
