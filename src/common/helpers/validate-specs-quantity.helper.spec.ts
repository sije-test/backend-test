import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-code.const';
import { SpecsDto } from '../dto/specs.dto';
import { validateSpecsQuantity } from './validate-specs-quantity.helper';

function makeSpecs(sizes: { size: string; quantity: number }[]): SpecsDto {
  const dto = new SpecsDto();
  dto.color = 'RED';
  dto.sizes = sizes;
  return dto;
}

describe('validateSpecsQuantity', () => {
  it('sizes 합계가 quantity와 일치하면 예외 없이 통과한다', () => {
    const specs = makeSpecs([
      { size: 'S', quantity: 2 },
      { size: 'M', quantity: 3 },
    ]);

    expect(() => validateSpecsQuantity(specs, 5)).not.toThrow();
  });

  it('sizes가 1개이고 quantity와 일치하면 통과한다', () => {
    const specs = makeSpecs([{ size: 'L', quantity: 10 }]);

    expect(() => validateSpecsQuantity(specs, 10)).not.toThrow();
  });

  it('sizes 합계가 quantity보다 작으면 INVALID_SPECS_QUANTITY 400 예외를 던진다', () => {
    const specs = makeSpecs([
      { size: 'S', quantity: 1 },
      { size: 'M', quantity: 1 },
    ]);

    expect(() => validateSpecsQuantity(specs, 5)).toThrow(HttpException);

    try {
      validateSpecsQuantity(specs, 5);
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((ex.getResponse() as any).code).toBe('INVALID_SPECS_QUANTITY');
      expect((ex.getResponse() as any).message).toBe(
        ErrorCode.INVALID_SPECS_QUANTITY.message,
      );
    }
  });

  it('sizes 합계가 quantity보다 크면 INVALID_SPECS_QUANTITY 400 예외를 던진다', () => {
    const specs = makeSpecs([
      { size: 'S', quantity: 5 },
      { size: 'M', quantity: 5 },
    ]);

    expect(() => validateSpecsQuantity(specs, 3)).toThrow(HttpException);
  });

  it('sizes가 빈 배열이고 quantity가 0보다 크면 INVALID_SPECS_QUANTITY 예외를 던진다', () => {
    const specs = makeSpecs([]);

    expect(() => validateSpecsQuantity(specs, 1)).toThrow(HttpException);

    try {
      validateSpecsQuantity(specs, 1);
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((ex.getResponse() as any).code).toBe('INVALID_SPECS_QUANTITY');
    }
  });

  it('sizes가 빈 배열이고 quantity도 0이면 통과한다', () => {
    const specs = makeSpecs([]);

    expect(() => validateSpecsQuantity(specs, 0)).not.toThrow();
  });
});
