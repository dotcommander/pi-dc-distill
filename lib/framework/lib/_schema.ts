import { Type, type TSchemaOptions, type TUnsafe } from "typebox";

export function StringEnum<const Values extends readonly string[]>(
  values: Values,
  options?: TSchemaOptions,
): TUnsafe<Values[number]> {
  return Type.Unsafe<Values[number]>(
    Type.Union(
      values.map((value) => Type.Literal(value)),
      options,
    ),
  );
}
