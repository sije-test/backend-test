import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

export function AtLeastOneField(validationOptions?: ValidationOptions) {
  return function (target: Function) {
    registerDecorator({
      name: 'atLeastOneField',
      target,
      propertyName: '',
      options: {
        message: '최소 1개 이상의 필드를 입력해야 합니다.',
        ...validationOptions,
      },
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as Record<string, unknown>;
          return Object.values(obj).some((v) => v !== undefined && v !== null);
        },
      },
    });
  };
}
