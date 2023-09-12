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
}

export enum StatusWord {
  Success = 0x9000,
}

// ISO/IEC 7816-4:2005 Command APDU (Application Protocol Data Unit)
export interface Command {
  cla: number, // Class byte
  ins: Instruction,
  p1: number, // Parameter byte 1
  p2: number, // Parameter byte 2
  data?: ArrayBuffer, // Command data
  ne?: number // Maximum number of bytes expected in the response data field
}

// ISO/IEC 7816-4:2005 Response APDU
export interface Response {
  data?: ArrayBuffer,
  sw: number, // Status bytes
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
      sw: swBytes.getUint16(0)
    };
  }

  return {
    data: (new Uint8Array(buffer, 0, buffer.byteLength - statusBytesLength)).buffer,
    sw: swBytes.getUint16(0)
  };
}

export function serializeCommand(apdu: Command) : ArrayBuffer {
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
  const bytes = new Uint8Array(buffer);
  bytes[i++] = apdu.cla;
  bytes[i++] = apdu.ins;
  bytes[i++] = apdu.p1;
  bytes[i++] = apdu.p2;
  if (apdu.data !== undefined) {
    // Lc field
    // TODO Handle Lc fields bigger than 1 byte.
    bytes[i++] = apdu.data.byteLength;

    // Command data
    bytes.set(new Uint8Array(apdu.data), i);
    i += apdu.data.byteLength;
  }
  if (apdu.ne !== undefined) {
    // TODO: consider an Ne which takes more than one byte
    bytes[i++] = apdu.ne;
  }
  assert(i === apduSize, `serializeCommand: i=${i}, apduSize=${apduSize}`);

  return buffer;
}
