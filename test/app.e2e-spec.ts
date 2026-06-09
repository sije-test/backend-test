import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

const TABLES = [
  'order_status_logs',
  'purchase_order_versions',
  'change_requests',
  'purchase_orders',
];

describe('SIJE API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // 역할/ID 헤더를 자동으로 붙인 HTTP 메서드 반환
  const as = (role: string, id = 'user-1') => {
    const h = { 'X-User-Role': role, 'X-User-Id': id };
    const s = () => app.getHttpServer();
    return {
      get: (path: string) => supertest(s()).get(path).set(h),
      post: (path: string) => supertest(s()).post(path).set(h),
      patch: (path: string) => supertest(s()).patch(path).set(h),
    };
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    // FK 의존 순서(자식 → 부모)로 삭제해 제약 없이 초기화
    for (const t of TABLES) {
      await prisma.$executeRawUnsafe(`DELETE FROM ${t}`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const baseOrderPayload = {
    productName: '반팔 티셔츠 A형',
    quantity: 100,
    unitPrice: 5000,
    specs: {
      color: '흰색',
      sizes: [
        { size: 'S', quantity: 40 },
        { size: 'M', quantity: 60 },
      ],
    },
    deliveryDate: '2025-12-01',
    buyerId: 'user-1',
    status: 'PENDING',
  };

  describe('시나리오 1: 생성→확정→변경요청→승인→history/compare', () => {
    it('전체 흐름이 정상 동작하고 history 2건, compare diff에 변경 필드가 포함된다', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      expect(createRes.status).toBe(201);
      const orderId: number = createRes.body.data.id;

      const confirmRes = await as('SOURCING', 'sourcing-1').patch(
        `/orders/${orderId}/confirm`,
      );
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.status).toBe('CONFIRMED');

      const changeReqRes = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({
          reason: '납기일 및 수량 변경',
          changes: { quantity: 120, deliveryDate: '2026-01-15' },
        });
      expect(changeReqRes.status).toBe(201);
      const requestId: number = changeReqRes.body.data.id;

      const approveRes = await as('SOURCING', 'sourcing-1')
        .patch(`/orders/${orderId}/change-requests/${requestId}/approve`)
        .send({});
      expect(approveRes.status).toBe(200);

      const historyRes = await as('BUYER').get(`/orders/${orderId}/history`);
      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data).toHaveLength(2);

      const compareRes = await as('BUYER').get(
        `/orders/${orderId}/compare?from=1&to=2`,
      );
      expect(compareRes.status).toBe(200);
      const diffFields: string[] = compareRes.body.data.diff.map(
        (d: { field: string }) => d.field,
      );
      expect(diffFields).toContain('quantity');
      expect(diffFields).toContain('deliveryDate');
    });
  });

  describe('시나리오 1-1: status 생략하면 DRAFT로 생성된다', () => {
    it('status를 보내지 않으면 data.status가 DRAFT이다', async () => {
      const { status: _omit, ...payloadWithoutStatus } = baseOrderPayload;
      const res = await as('BUYER').post('/orders').send(payloadWithoutStatus);
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
    });
  });

  describe('시나리오 2: DRAFT/PENDING 상태에 변경요청 생성 시도', () => {
    it('DRAFT 발주서에 변경요청 생성 시 400 ORDER_NOT_CONFIRMED', async () => {
      const { status: _omit, ...draftPayload } = baseOrderPayload;
      const createRes = await as('BUYER').post('/orders').send(draftPayload);
      const orderId: number = createRes.body.data.id;

      const res = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({ reason: '변경', changes: { quantity: 50 } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_NOT_CONFIRMED');
    });

    it('PENDING 발주서에 변경요청 생성 시 400 ORDER_NOT_CONFIRMED', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;

      const res = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({ reason: '변경', changes: { quantity: 50 } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_NOT_CONFIRMED');
    });
  });

  describe('시나리오 3: PENDING 변경요청 중복 생성 시 409', () => {
    it('이미 PENDING인 변경요청이 있으면 409 CHANGE_REQUEST_ALREADY_PENDING', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);

      const first = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({ reason: '첫 번째', changes: { quantity: 110 } });
      expect(first.status).toBe(201);

      const second = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({ reason: '두 번째', changes: { quantity: 120 } });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CHANGE_REQUEST_ALREADY_PENDING');
    });
  });

  describe('시나리오 4: BUYER가 변경요청 승인 호출 시 403', () => {
    it('BUYER가 approve 호출 시 403 FORBIDDEN_ROLE', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);
      const crRes = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({ reason: '변경', changes: { quantity: 110 } });
      const requestId: number = crRes.body.data.id;

      const res = await as('BUYER')
        .patch(`/orders/${orderId}/change-requests/${requestId}/approve`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('시나리오 5: changes가 빈 객체이면 400', () => {
    it('changes: {} 로 변경요청 생성 시 400', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);

      const res = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({ reason: '사유', changes: {} });
      expect(res.status).toBe(400);
    });
  });

  describe('시나리오 6: specs 합계 ≠ quantity이면 400', () => {
    it('specs.sizes 합계가 quantity와 다르면 400 INVALID_SPECS_QUANTITY', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);

      const res = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({
          reason: '스펙 변경',
          changes: {
            quantity: 120,
            specs: {
              color: '검정',
              sizes: [
                { size: 'S', quantity: 50 },
                { size: 'M', quantity: 50 }, // 합계 100 ≠ quantity 120
              ],
            },
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_SPECS_QUANTITY');
    });
  });

  describe('시나리오 6-1: specs 포함, 합계 정상이면 201', () => {
    it('specs.sizes 합계가 quantity와 일치하면 201', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);

      const res = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({
          reason: '스펙 변경',
          changes: {
            quantity: 100,
            specs: {
              color: '검정',
              sizes: [
                { size: 'S', quantity: 40 },
                { size: 'M', quantity: 60 }, // 합계 100 = quantity 100
              ],
            },
          },
        });
      expect(res.status).toBe(201);
    });
  });

  describe('시나리오 6-2: changes에 허용 외 필드 포함 시 400', () => {
    it('허용되지 않은 필드(foo)가 있으면 400', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);

      const res = await as('BUYER')
        .post(`/orders/${orderId}/change-requests`)
        .send({ reason: '사유', changes: { quantity: 110, foo: 'bar' } });
      expect(res.status).toBe(400);
    });
  });

  describe('시나리오 7: 없는 버전 조회 시 404', () => {
    it('존재하지 않는 버전 조회 시 404 VERSION_NOT_FOUND', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);

      const res = await as('BUYER').get(`/orders/${orderId}/versions/99`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('VERSION_NOT_FOUND');
    });
  });

  describe('시나리오 8: 동일 버전 비교 시 diff가 빈 배열', () => {
    it('from=1, to=1 비교 시 200이고 diff가 빈 배열', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);

      const res = await as('BUYER').get(
        `/orders/${orderId}/compare?from=1&to=1`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.diff).toEqual([]);
    });
  });

  describe('시나리오 10: 생성→확정→생산시작→완료 후 status-history 검증', () => {
    it('상태 전이 이력이 순서대로 반환된다', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;

      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/confirm`);
      await as('SOURCING', 'sourcing-1').patch(
        `/orders/${orderId}/start-production`,
      );
      await as('SOURCING', 'sourcing-1').patch(`/orders/${orderId}/complete`);

      const res = await as('BUYER').get(`/orders/${orderId}/status-history`);
      expect(res.status).toBe(200);

      const logs: { fromStatus: string; toStatus: string }[] = res.body.data;
      expect(logs.length).toBeGreaterThanOrEqual(3);

      const transitions = logs.map((l) => `${l.fromStatus}->${l.toStatus}`);
      expect(transitions).toContain('PENDING->CONFIRMED');
      expect(transitions).toContain('CONFIRMED->IN_PRODUCTION');
      expect(transitions).toContain('IN_PRODUCTION->COMPLETED');
    });
  });

  describe('시나리오 10-1: 상태 전이 없는 발주서의 status-history는 빈 배열', () => {
    it('발주서 생성 직후 status-history 조회 시 빈 배열', async () => {
      const createRes = await as('BUYER').post('/orders').send(baseOrderPayload);
      const orderId: number = createRes.body.data.id;

      const res = await as('BUYER').get(`/orders/${orderId}/status-history`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
