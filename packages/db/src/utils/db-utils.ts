import {
  type IdTypePrefixNames,
  type TypeId,
  typeIdFromUuid,
  typeIdToUuid,
} from "@vps-claude/shared";
import { customType, timestamp } from "drizzle-orm/pg-core";

/**
 * TypeID column type generator that stores as UUID in DB for performance
 * while providing type-safe TypeID strings in application code
 */
export const typeId = <const T extends IdTypePrefixNames>(
  prefix: T,
  columnName: string
) =>
  customType<{
    data: TypeId<T>;
    driverData: string; // Stored as UUID string in DB
  }>({
    dataType() {
      return "uuid";
    },
    fromDriver(input: string): TypeId<T> {
      // Convert UUID from DB back to full TypeID string
      return typeIdFromUuid(prefix, input);
    },
    toDriver(input: TypeId<T>): string {
      return typeIdToUuid(input).uuid;
    },
  })(columnName);

/**
 * Creates a timestamp field with timezone support
 */
export const createTimestampField = (name?: string) => {
  if (!name) {
    return timestamp({ withTimezone: true, mode: "date" });
  }
  return timestamp(name, { withTimezone: true, mode: "date" });
};

/**
 * Standard entity fields for createdAt/updatedAt with auto-update
 */
export const baseEntityFields = {
  createdAt: createTimestampField("created_at").defaultNow().notNull(),
  updatedAt: createTimestampField("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};
