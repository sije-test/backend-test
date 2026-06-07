import { of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  it('응답 데이터를 { success: true, data } 형태로 래핑한다', (done) => {
    const interceptor = new TransformInterceptor();
    const mockCallHandler = { handle: () => of({ id: 1 }) };
    const mockContext = {} as any;

    interceptor
      .intercept(mockContext, mockCallHandler as any)
      .subscribe((result) => {
        expect(result).toEqual({ success: true, data: { id: 1 } });
        done();
      });
  });
});
