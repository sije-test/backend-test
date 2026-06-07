import * as runtime from '@prisma/client/runtime/client';

export class PrismaClient {
  $connect = jest.fn();
  $disconnect = jest.fn();
  $transaction = jest.fn();
  purchaseOrder = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
  purchaseOrderVersion = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  };
  orderStatusLog = { create: jest.fn(), findMany: jest.fn() };
  changeRequest = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
}

export const Prisma = {
  Decimal: runtime.Decimal,
};
