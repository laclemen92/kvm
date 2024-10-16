import type { Key, KeyParts, StringKeyedValueObject } from "./types.ts";

export const isDenoKvKeyPart = (
  value: StringKeyedValueObject | unknown | Deno.KvKeyPart,
): value is Deno.KvKeyPart => {
  return (value as Deno.KvKeyPart) !== undefined;
};

export const isStringKeyedValueObject = (
  value: StringKeyedValueObject | unknown | Deno.KvKeyPart,
): value is StringKeyedValueObject => {
  return (value as StringKeyedValueObject) !== undefined &&
    typeof value !== "string";
};

export const buildPrimaryKey = (
  primaryKeyDef: Key,
  value: unknown | Deno.KvKeyPart | StringKeyedValueObject,
): Deno.KvKey => {
  const primaryKey: Deno.KvKeyPart[] = [];
  primaryKeyDef.forEach((keyPart: KeyParts) => {
    if (keyPart.name) {
      primaryKey.push(keyPart.name);
    }
    if (keyPart.key && isStringKeyedValueObject(value)) {
      primaryKey.push(value[keyPart.key]);
    } else if (isDenoKvKeyPart(value)) {
      primaryKey.push(value);
    }
  });

  return primaryKey;
};
