import 'reflect-metadata';
import { validate } from 'class-validator';
import { ChangesDto } from '../dto/changes.dto';

async function validateChanges(partial: Partial<ChangesDto>) {
  const dto = Object.assign(new ChangesDto(), partial);
  return validate(dto);
}

describe('AtLeastOneField (ChangesDto)', () => {
  it('필드가 1개 이상 존재하면 검증을 통과한다 (quantity만)', async () => {
    const errors = await validateChanges({ quantity: 5 });
    const atLeastOneError = errors.find((e) =>
      Object.keys(e.constraints ?? {}).includes('atLeastOneField'),
    );
    expect(atLeastOneError).toBeUndefined();
  });

  it('필드가 1개 이상 존재하면 검증을 통과한다 (productName만)', async () => {
    const errors = await validateChanges({ productName: '상품명' });
    const atLeastOneError = errors.find((e) =>
      Object.keys(e.constraints ?? {}).includes('atLeastOneField'),
    );
    expect(atLeastOneError).toBeUndefined();
  });

  it('여러 필드가 존재할 때도 검증을 통과한다', async () => {
    const errors = await validateChanges({
      quantity: 10,
      productName: '테스트 상품',
      unitPrice: 5000,
    });
    const atLeastOneError = errors.find((e) =>
      Object.keys(e.constraints ?? {}).includes('atLeastOneField'),
    );
    expect(atLeastOneError).toBeUndefined();
  });

  it('모든 필드가 undefined인 빈 객체는 atLeastOneField 검증에 실패한다', async () => {
    const errors = await validateChanges({});
    const atLeastOneError = errors.find((e) =>
      Object.keys(e.constraints ?? {}).includes('atLeastOneField'),
    );
    expect(atLeastOneError).toBeDefined();
    expect(atLeastOneError?.constraints?.atLeastOneField).toBe(
      '최소 1개 이상의 필드를 입력해야 합니다.',
    );
  });
});
