// Type definitions for google-protobuf FieldMask
declare module 'google-protobuf/google/protobuf/field_mask_pb' {
  import * as jspb from 'google-protobuf';

  export class FieldMask extends jspb.Message {
    constructor(opt_data?: any);

    getPathsList(): string[];
    setPathsList(value: string[]): FieldMask;
    addPaths(value: string, opt_index?: number): FieldMask;
    clearPathsList(): FieldMask;

    toObject(includeInstance?: boolean): FieldMask.AsObject;
    serializeBinary(): Uint8Array;
    static deserializeBinary(bytes: Uint8Array): FieldMask;
    static serializeBinaryToWriter(message: FieldMask, writer: jspb.BinaryWriter): void;
    static toObject(includeInstance: boolean, msg: FieldMask): FieldMask.AsObject;

    // Add any additional method or property signatures needed by FieldMask
  }

  namespace FieldMask {
    type AsObject = {
      pathsList: string[];
      // Add any additional field signatures needed by FieldMask.AsObject
    }
  }
}
