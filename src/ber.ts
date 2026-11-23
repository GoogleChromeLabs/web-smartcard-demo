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

// Some basic functions related to Basic Encoding Rules (BER) Tag-Length-Value
// (TLV) handling.

import {
  assert,
} from './util'

// Returns how many bytes are needed to hold the give number
export function numberByteSize(value: number): number {
  let byteSize = 0;
  while (value > 0) {
    byteSize++;
    value = value >> 8;
  }
  return byteSize;
}

// Serializes (in big-endian) the number `n` in  `bytes` with `bytesOffset`.
export function serializeNumber(bytes: Uint8Array, bytesOffset:number, n: number) {
  let i:number = bytesOffset;

  let currentDigit:number = numberByteSize(n);

  while (currentDigit > 0) {
    let digitValue = (n >> (8 * (currentDigit - 1))) & 0xFF;
    bytes[i++] = digitValue;
    currentDigit--;
  }
}

export interface BERLength {
  length: number,
  valueOffset: number
}

export function deserializeNumber(bytes: Uint8Array,
                           bytesOffset:number,
                           numberByteSize:number): number {
  assert(bytesOffset >= 0 && bytesOffset < bytes.byteLength,
         "deserializeNumber: invalid bytesOffset");
  assert(numberByteSize > 0 && numberByteSize <= 4 &&
         numberByteSize <= (bytes.byteLength - bytesOffset),
        "deserializeNumber: invalid numberByteSize");

  let n = 0;
  for (let i = bytesOffset; i < bytesOffset + numberByteSize; i++) {
    n = n * 256 + bytes[i];
  }
  return n;
}

/**
 * Reads the length field of a BER entry.
 *
 * @param bytes - The buffer containing the BER-encoded data.
 * @param bytesOffset - Offset of the first byte of the length field in `bytes`.
 * @returns The decoded value length and the offset where the value starts.
 */
export function readLength(bytes: Uint8Array, bytesOffset: number): BERLength {
  let i = bytesOffset;
  const firstByte = bytes[i++];
  let length: number;

  if (firstByte < 128) {
    // Definite, short
    length = firstByte;
  } else if (firstByte === 128) {
    // Indefinite
    // Assuming the two last bytes are End-of-Content (EOC) identifiers.
    length = bytes.byteLength - i - 2;
  } else {
    // Definite, long
    const numberByteSize = firstByte & 127;
    length = deserializeNumber(bytes, i, numberByteSize);
    i += numberByteSize;
  }

  if (length < 0 || i + length > bytes.byteLength) {
    throw Error('Invalid BER length: value extends past end of buffer');
  }

  return { length, valueOffset: i };
}

// Given a buffer filled with consecutive BER entries, returns the value of the
// one with the given tag.
// Throws if not found.
export function getValue(buffer: ArrayBuffer, tag: number) : ArrayBuffer {
  let i = 0;
  const bytes = new Uint8Array(buffer);

  while(i < bytes.byteLength) {
    const currentTag = bytes[i++];
    const berLength = readLength(bytes, i);

    if (currentTag !== tag) {
      // Skip it.
      i = berLength.valueOffset + berLength.length;
      continue;
    }

    return buffer.slice(berLength.valueOffset,
                        berLength.valueOffset + berLength.length);
  }

  throw Error(`Could not find tag 0x${tag.toString(16)}.`);
}
