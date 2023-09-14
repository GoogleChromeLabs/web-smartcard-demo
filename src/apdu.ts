/**
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { assert } from './util'

// ISO/IEC 7816-4:2005 APDU Instruction byte
export enum Instruction {
  Select = 0xA4,
  Verify = 0x20,
  GetData = 0xCB,
  GetResponse = 0xC0,
}

export enum SelectP1 {
  SelectDFByName = 0x04,
}

export enum SelectP2 {
  FirstOrOnlyOccurrence = 0x00,
}

export enum GetResponseP {
  Unused = 0x00,
}

export enum GetDataP {
  CurrentDF = 0x3FFF, // Current Dedicated File
}

export enum SW {
  Success = 0x9000,
}

export enum SW1 {
  BytesStillAvailable = 0x61,
}

// ISO/IEC 7816-4:2005
// 8.5.1 Indirect references to data elements
export const TagList:number = 0x5C; // Tag List

export const DiscretionaryData = 0x53; // 'discretionary data' tag

// ISO/IEC 7816-4:2005 Command APDU (Application Protocol Data Unit)
export interface Command {
  cla: number, // Class byte
  ins: Instruction,
  p1: number, // Parameter byte 1
  p2: number, // Parameter byte 2
  data?: ArrayBuffer, // Command data
  ne?: number // Maximum number of bytes expected in the response data field
}
export interface CommandP {
  cla: number, // Class byte
  ins: Instruction,
  p: number, // Parameter bytes, big endian
  data?: ArrayBuffer, // Command data
  ne?: number // Maximum number of bytes expected in the response data field
}

// ISO/IEC 7816-4:2005 Response APDU
export interface Response {
  data?: ArrayBuffer,
  sw: number, // Status bytes (1 and 2 together)
  sw1: number, // Status byte 1
  sw2: number, // Status byte 2
}

export function deserializeResponse(buffer: ArrayBuffer) : Response {
  const statusBytesLength = 2;
  if (buffer.byteLength < statusBytesLength) {
    throw Error("Response APDU is too short");
  }

  const swBytes = new DataView(buffer,
                               buffer.byteLength - statusBytesLength,
                               statusBytesLength);

  if (buffer.byteLength === statusBytesLength) {
    return {
      sw: swBytes.getUint16(0),
      sw1: swBytes.getUint8(0),
      sw2: swBytes.getUint8(1),
    };
  }

  return {
    data: buffer.slice(0, buffer.byteLength - statusBytesLength),
    sw: swBytes.getUint16(0),
    sw1: swBytes.getUint8(0),
    sw2: swBytes.getUint8(1),
  };
}

export function serializeCommand(apdu: Command | CommandP) : ArrayBuffer {
  const headerSize:number = 4; // cla + ins + p1 + p2

  // 1) Find how many bytes we need

  let apduSize:number = headerSize;

  if (apdu.data !== undefined) {
    // TODO: calculate how many bytes are needed to hold Nc
    apduSize += 1; // Lc field. Assuming the data size fits in one byte.
    apduSize += apdu.data.byteLength; // Nc field.
  }

  if (apdu.ne !== undefined) {
    if (apdu.ne === 0) {
      throw new Error("Command Ne cannot be 0");
    }
    // TODO: calculate how many bytes are needed to hold Ne
    apduSize += 1; // Le field. Assuming the Ne size fits in one byte.
  }

  // 2) Write the Command

  const buffer = new ArrayBuffer(apduSize);
  let i:number = 0;
  const bytes = new DataView(buffer);
  bytes.setUint8(i++, apdu.cla);
  bytes.setUint8(i++, apdu.ins);
  if ('p1' in apdu) {
    const c = apdu as Command;
    bytes.setUint8(i++, c.p1);
    bytes.setUint8(i++, c.p2);
  } else {
    const c = apdu as CommandP;
    bytes.setUint16(i, c.p);
    i += 2;
  }
  if (apdu.data !== undefined) {
    // Lc field
    // TODO Handle Lc fields bigger than 1 byte.
    bytes.setUint8(i++, apdu.data.byteLength);

    // Command data
    const typedBytes = new Uint8Array(buffer);
    typedBytes.set(new Uint8Array(apdu.data), i);
    i += apdu.data.byteLength;
  }
  if (apdu.ne !== undefined) {
    // TODO: consider an Ne which takes more than one byte
    bytes.setUint8(i++, apdu.ne);
  }
  assert(i === apduSize, `serializeCommand: i=${i}, apduSize=${apduSize}`);

  return buffer;
}
